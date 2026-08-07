import { runPipeline, computeUnifiedGrid, reconcileUnified, type PipelineInput, type MetricRow } from '@aemr/core';
import { REPORT_MAP, getAllCellAddresses, getActiveRules, ALL_SHEETS, SVOD_SHEET_NAME, findDept, SHDYU_MONTHLY_SHEET_NAME, DEPT_HEADER_ROWS, buildCellDict, METHOD_FAMILY_MAP } from '@aemr/shared';
import type { DataSnapshot, Issue, NormalizedMetric, SvodReconRow } from '@aemr/shared';
import { buildRowDto, isDataRow } from './rows-dto.js';
import { batchGetCells, batchGetFormulas, getSheetData } from '../google-sheets.js';
import { fetchSHDYUSheet } from './google-sheets.js';
import { parseSHDYUSheet } from '@aemr/core';
import { SHDYU_SPREADSHEET_ID } from '../config.js';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { and, eq, desc, getTableColumns, lt, sql } from 'drizzle-orm';
import { createDemoSnapshot } from './demo-data.js';
import { pruneSnapshotsByRetention } from './snapshot-retention.js';
import type { DeptSheetResult } from './google-sheets.js';

/** Per-year snapshot cache: key is targetYear (number) */
const cachedSnapshots = new Map<number, { snapshot: DataSnapshot; timestamp: number }>();

/**
 * In-flight load memo per cache key (targetYear/0). Без него параллельные
 * force-refresh или expired-cache вызовы getSnapshot() независимо гоняют
 * createSnapshot() — TOCTOU-гонка, дублирующая полную перечитку всех 8
 * листов ГРБС + СВОД (B-9).
 */
const inFlightLoads = new Map<number, Promise<DataSnapshot>>();

let cachedDeptSheetData: Record<string, DeptSheetResult> = {};

/**
 * Обновляет кэш деп-листов. `data` — успешно загруженные в этом цикле депы,
 * применяются как replace по ключу. `failedDeptNames` — депы, упавшие в этом
 * цикле: их запись УДАЛЯЕТСЯ из кэша, а не остаётся молча от предыдущей
 * успешной загрузки под видом свежих данных (маскировка отказа, B-9).
 */
export function setDeptSheetCache(
  data: Record<string, DeptSheetResult>,
  failedDeptNames: readonly string[] = [],
): void {
  const next = { ...cachedDeptSheetData, ...data };
  for (const name of failedDeptNames) {
    Reflect.deleteProperty(next, name);
  }
  cachedDeptSheetData = next;
}

export function getDeptSheetCache(): Record<string, DeptSheetResult> {
  return cachedDeptSheetData;
}

/**
 * Сырые значения листа СВОД ТД-ПМ, прочитанные В ТОМ ЖЕ цикле, что и книги
 * ГРБС. Сверка «расчёт ↔ официал» обязана сравнивать один момент времени:
 * свежий запрос СВОДа рядом с пятиминутным кэшем книг давал ложные
 * расхождения на 1–2 строки (УО: КП 31≠32, ЕП 322≠323 — сотрудник добавил
 * строки, формулы СВОДа увидели их сразу, кэш книг — после обновления).
 */
let cachedSvodGrid: { values: unknown[][]; loadedAt: string } | null = null;

export function setSvodGridCache(values: unknown[][]): void {
  cachedSvodGrid = { values, loadedAt: new Date().toISOString() };
}

export function getSvodGridCache(): { values: unknown[][]; loadedAt: string } | null {
  return cachedSvodGrid;
}

/**
 * Ошибки формул Google Sheets в ЗНАЧЕНИИ ячейки. Упавший IMPORTRANGE отдаёт
 * именно их: «#REF!», «#REF! (The source sheet for this IMPORTRANGE...)».
 */
const FORMULA_ERROR_RE = /^#(REF|N\/A|VALUE|NAME|NUM|DIV\/0|NULL|ERROR|GETTING_DATA)\b/i;

/**
 * Ответ листа не несёт НИ ОДНОЙ содержательной строки. Два случая, и оба
 * означают «источник сломан», а не «данных нет»:
 *   • строк не больше, чем шапка (DEPT_HEADER_ROWS) — collectRowsByDept такой
 *     лист выбрасывает ЦЕЛИКОМ, и ГРБС молча исчезает из продукта;
 *   • все непустые ячейки — ошибки формул (#REF! от упавшего IMPORTRANGE:
 *     зеркало ГРБС в сводной книге отдаёт одну строку-ошибку).
 *
 * Проверка по значениям, а не по длине: зеркало УКСиМП отдавало length === 1,
 * а старое условие подстановки кэша ждало length === 0 — 673 настоящие строки
 * отбрасывались, 661 закупка и 155 152 тыс. руб. плана считались нулём.
 */
export function hasNoMeaningfulRows(values: unknown[][]): boolean {
  if (values.length <= DEPT_HEADER_ROWS) return true;
  for (const row of values) {
    for (const cell of row ?? []) {
      const s = String(cell ?? '').trim();
      if (s !== '' && !FORMULA_ERROR_RE.test(s)) return false;
    }
  }
  return true;
}

export function getDeptSheetValues(): Record<string, unknown[][]> {
  const result: Record<string, unknown[][]> = {};
  for (const [key, val] of Object.entries(cachedDeptSheetData)) {
    result[key] = val.values;
  }
  return result;
}

interface DeptLoadMeta {
  loadedAt: string;
  rowCount: number;
  sheetName: string;
  error?: string;
}

let deptLoadMeta: Record<string, DeptLoadMeta> = {};

export function setDeptLoadMeta(meta: Record<string, DeptLoadMeta>): void {
  deptLoadMeta = { ...deptLoadMeta, ...meta };
}

export function getDeptLoadMeta(): Record<string, DeptLoadMeta> {
  return deptLoadMeta;
}

/** Cached monthly data from «СВОД с месяцами». Kept under old variable names for API compatibility. */
let cachedSHDYUData: Record<string, any> | null = null;
let cachedSHDYURawRowCount = 0;
let cachedSHDYULoadError: string | null = null;
let cachedSHDYUOfficialYear: number | null = null;

export function getSHDYUCache(): Record<string, any> | null {
  return cachedSHDYUData;
}

export function getSHDYURawRowCount(): number {
  return cachedSHDYURawRowCount;
}

/**
 * Год официального помесячного слоя — параметр-ячейка AO4 листа «СВОД с месяцами».
 * Перепись 16.07: лист год-метится ГЛОБАЛЬНО одной ячейкой (18/19 год-ячеек =
 * формула =$AO$4; все 2112 месячных формул фильтруют 'ГРБС'!P=$AO$4). Помесячного
 * официала за другой год НЕ СУЩЕСТВУЕТ — сверка ?year≠AO4 обязана гейтиться.
 */
export function getSHDYUOfficialYear(): number | null {
  return cachedSHDYUOfficialYear;
}

export function getSHDYULoadError(): string | null {
  return cachedSHDYULoadError;
}

export function setSHDYUCache(data: Record<string, any>): void {
  cachedSHDYUData = data;
}

export function attachUnifiedGrid(
  snapshot: DataSnapshot,
  sheetRows: Record<string, unknown[][]>,
  targetYear?: number,
): void {
  const deptRowsById: Record<string, unknown[][]> = {};
  for (const [sheetName, rows] of Object.entries(sheetRows)) {
    if (sheetName === SVOD_SHEET_NAME) continue;
    // Канон резолва ГРБС: findDept (принимает id ИЛИ латиницу) → latinId. Не-ГРБС
    // лист (ШДЮ, служебный) findDept не знает → пропускаем, а НЕ кладём мусорный
    // lowercase-ключ (свеп консолидации: иначе downstream не сматчит → тихий дроп блока).
    const dept = findDept(sheetName);
    if (!dept) continue;
    deptRowsById[dept.latinId] = rows;
  }

  const grid = computeUnifiedGrid(deptRowsById, targetYear);
  snapshot.unifiedGrid = grid;
  snapshot.unifiedReconciliation = reconcileUnified(grid, snapshot.officialMetrics) as SvodReconRow[];
}

export async function getSnapshot(force = false, targetYear?: number): Promise<DataSnapshot> {
  // Год: валидный → этот год; иначе undefined = ВСЕ ГОДЫ (базовый вид = сумма за все
  // годы, req 4). НЕ коэрсим в currentYear — запрос без года агрегирует все годы.
  const year = Number.isInteger(targetYear) && (targetYear as number) >= 2020 && (targetYear as number) <= 2100
    ? (targetYear as number)
    : undefined;
  // Ключ кэша: год или 0 («все годы»-бакет; 0 — не валидный год, поэтому не коллизит).
  const cacheKey = year ?? 0;
  const now = Date.now();
  const ttl = config.cache.ttlSeconds * 1000;

  const cached = cachedSnapshots.get(cacheKey);
  if (!force && cached && (now - cached.timestamp) < ttl) {
    return cached.snapshot;
  }

  // Дедуп конкурентных загрузок: если для этого cacheKey уже идёт createSnapshot(),
  // все параллельные caller'ы дожидаются ОДНОГО общего промиса вместо запуска своего
  // (иначе — TOCTOU-гонка, дублирующая полную перечитку всех листов, B-9).
  const inFlight = inFlightLoads.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const loadPromise = (async () => {
    try {
      const snapshot = await createSnapshot(year);
      if (!snapshot.id.startsWith('demo-')) {
        cachedSnapshots.set(cacheKey, { snapshot, timestamp: now });
      }
      return snapshot;
    } finally {
      inFlightLoads.delete(cacheKey);
    }
  })();

  inFlightLoads.set(cacheKey, loadPromise);
  return loadPromise;
}

/**
 * Создаёт новый снимок: читает данные из Google Sheets и прогоняет пайплайн
 */
async function createSnapshot(targetYear?: number): Promise<DataSnapshot> {
  try {
    const cellAddresses = getAllCellAddresses();
    const [batchValues, batchFormulas] = await Promise.all([
      batchGetCells(cellAddresses),
      batchGetFormulas(cellAddresses),
    ]);

    const batchGetData = batchValues.map((v, i) => ({
      range: v.range,
      values: v.values,
      formulas: batchFormulas[i]?.formulas,
    }));

    const sheetRows: Record<string, unknown[][]> = {};
    const sheetReadPromises = ALL_SHEETS.map(async (sheetName: string) => {
      try {
        const rows = await getSheetData(sheetName);
        sheetRows[sheetName] = rows;
      } catch (error) {
        console.warn(`Не удалось прочитать лист "${sheetName}":`, error);
      }
    });

    const monthlyPromise = fetchSHDYUSheet(SHDYU_SPREADSHEET_ID).then((result) => {
      const sourceLabel = result.sheetName;
      if (result.values.length > 0) {
        const parsed = parseSHDYUSheet(result.values, result.formulas);
        cachedSHDYUData = parsed;
        cachedSHDYURawRowCount = result.values.length;
        // AO4 (строка 4, колонка AO=41-я) — глобальный год листа (см. getSHDYUOfficialYear).
        const ao4 = Number(result.values[3]?.[40]);
        cachedSHDYUOfficialYear = Number.isInteger(ao4) && ao4 >= 2020 && ao4 <= 2100 ? ao4 : null;
        cachedSHDYULoadError = null;
        console.log(`📊 ${sourceLabel}: ${result.values.length} строк (${result.formulas.length} с формулами), ${Object.keys(parsed).length} ГРБС`);
      } else {
        cachedSHDYULoadError = `Лист «${sourceLabel}» прочитан, но пуст (0 строк): помесячная динамика в источнике не заполнена за выбранный период.`;
      }
    }).catch((err: unknown) => {
      cachedSHDYULoadError = `Не удалось прочитать лист «${SHDYU_MONTHLY_SHEET_NAME}»: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`Не удалось загрузить ${SHDYU_MONTHLY_SHEET_NAME}:`, err);
    });

    await Promise.all([...sheetReadPromises, monthlyPromise]);

    // ОДИН ПЕРИМЕТР СТРОК (аудит 30.07 №14). Первоисточник — собственные
    // книги ГРБС: зеркала в сводной — производные IMPORTRANGE, они отстают
    // и ломаются («#REF!» у УКСиМП). Прежний порядок был обратным: снимок
    // предпочитал зеркала, а /api/report — книги, и один ряд недель опирался
    // на две популяции строк (УАГЗО +60 млн плана между источниками).
    // Теперь кэш книги побеждает всегда; зеркало — только когда книги нет.
    // Сломанные зеркала по-прежнему оставляют след: «источник сломан»
    // не должен быть неотличим от «данных нет» (см. hasNoMeaningfulRows).
    const brokenMirrors: Array<{ dept: string; got: number; used: number }> = [];
    for (const [deptName, deptResult] of Object.entries(cachedDeptSheetData)) {
      const mirror = sheetRows[deptName];
      if (deptResult.values.length === 0) continue;
      if (mirror && mirror.length > 0 && hasNoMeaningfulRows(mirror)) {
        brokenMirrors.push({ dept: deptName, got: mirror.length, used: deptResult.values.length });
        console.warn(
          `⚠️ Лист "${deptName}" в сводной книге отдал ${mirror.length} строк без данных` +
          ` (ошибка формул/зеркала) — использован кэш собственной книги: ${deptResult.values.length} строк`,
        );
      } else {
        console.log(`📋 Лист "${deptName}": ${deptResult.values.length} строк из кэша собственной книги (канонический периметр)`);
      }
      sheetRows[deptName] = deptResult.values;
    }

    const pipelineInput: PipelineInput = {
      batchGetData,
      sheetRows,
      reportMap: REPORT_MAP,
      rules: getActiveRules(),
      spreadsheetId: config.google.spreadsheetId,
      targetYear,
      // Год официального листа (Д21): без него сверка вычитала многолетний
      // расчёт из одногодичного официала и звала это расхождением.
      officialYear: getSHDYUOfficialYear() ?? undefined,
    };

    const snapshot = runPipeline(pipelineInput);

    // След сломанного зеркала — в самом снимке, а не только в консоли: замечание
    // сохраняется вместе со снимком и видно в продукте. Без него подстановка
    // кэша тиха, и «источник сломан» снова выглядел бы как «данных нет».
    for (const m of brokenMirrors) {
      const issue: Issue = {
        id: `mirror-broken-${m.dept}-${snapshot.id}`,
        severity: 'error',
        origin: 'runtime_error',
        category: 'source_integrity',
        title: `Лист «${m.dept}» в сводной книге не отдал данных`,
        description:
          `Зеркало вернуло ${m.got} строк без содержательных данных (ошибка формул, ` +
          `обычно упавший IMPORTRANGE). Снимок посчитан по кэшу собственной книги ГРБС: ` +
          `${m.used} строк. Числа ГРБС в отчёте живы, но зеркало в сводной книге чинить надо.`,
        sheet: m.dept,
        departmentId: findDept(m.dept)?.latinId,
        recommendation: 'Проверить формулу IMPORTRANGE листа в сводной книге и доступ к книге-источнику.',
        status: 'open',
        detectedAt: snapshot.createdAt,
        detectedBy: 'snapshot.createSnapshot',
      };
      snapshot.issues.push(issue);
    }

    if (cachedSHDYUData) {
      snapshot.shdyuData = cachedSHDYUData;
    }

    attachUnifiedGrid(snapshot, sheetRows, targetYear);
    await saveSnapshot(snapshot);

    return snapshot;
  } catch (error) {
    console.error('❌ Google Sheets unavailable, falling back to demo data:', error);
    const demo = createDemoSnapshot();
    demo.id = `demo-${demo.id}`;
    return demo;
  }
}

/**
 * Тип закупки по способу из колонки L. ЕП — единственный поставщик, ЭА/ЭК/ЭЗК —
 * конкурентная процедура (канон семейств METHOD_FAMILY_MAP). Мусор оператора в
 * L типом не притворяется: null честнее догадки, а SQL-фильтр по типу тогда
 * честно не находит такую строку, вместо того чтобы приписать её к семейству.
 */
function procurementTypeOf(method: string): 'competitive' | 'single_provider' | null {
  const code = method.trim().toUpperCase();
  if ((METHOD_FAMILY_MAP.EP as readonly string[]).includes(code)) return 'single_provider';
  if ((METHOD_FAMILY_MAP.COMPETITIVE as readonly string[]).includes(code)) return 'competitive';
  return null;
}

/**
 * Процент экономии одной строки. Нулевого (или нечислового) плана нет как
 * знаменателя — отношение не существует и выдаётся как null, а не как ноль:
 * ноль здесь читался бы «экономии не было», хотя её просто не от чего считать.
 */
function economyPercentOf(economy: number, plan: number): number | null {
  if (!Number.isFinite(plan) || plan === 0) return null;
  return (economy / plan) * 100;
}

/** Полностью пустая строка листа — добивка диапазона, а не атом. */
function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => String(cell ?? '').trim() === '');
}

/**
 * Атом-запись `procurement_rows` для каждой строки книг ГРБС снимка.
 *
 * Семантика строки (сигналы, состояние, суммы, способ) берётся из
 * ЕДИНСТВЕННОГО билдера `buildRowDto` — того же, которым живёт реестр
 * `/api/rows`. Вторая семантика атома завела бы расхождение «SQL против
 * реестра» на ровном месте (пирамида §4: одна свёртка — одно место).
 *
 * Служебные строки листа (итоги, разделы, шапки) не выбрасываются, а
 * помечаются состоянием `non-data`: популяция таблицы остаётся точной копией
 * листа, а потребитель отсекает служебное явным условием, а не догадкой о том,
 * какие строки мы по дороге потеряли.
 */
export function buildProcurementRowValues(
  snapshot: DataSnapshot,
): Array<typeof schema.procurementRows.$inferInsert> {
  const out: Array<typeof schema.procurementRows.$inferInsert> = [];
  for (const [sheetName, rows] of Object.entries(snapshot.rowsByDept ?? {})) {
    // Ось ГРБС в SQL — латинский id (как у issues.department_id): один язык
    // ключа на всю базу. Лист, которого реестр ГРБС не знает, не выдумываем —
    // кладём имя как есть, чтобы строки не пропали молча.
    const departmentId = findDept(sheetName)?.latinId ?? sheetName;
    rows.forEach((row, idx) => {
      if (!Array.isArray(row) || isBlankRow(row)) return;
      const dto = buildRowDto(row, idx, { deptId: departmentId });
      const isData = isDataRow(dto);
      out.push({
        snapshotId: snapshot.id,
        departmentId,
        // 1-based номер строки листа (шапка в DEPT_HEADER_ROWS строк уже срезана
        // в rowsByDept) — адрес, по которому правку видно в самой книге.
        rowIndex: dto.rowIndex,
        cellsJson: JSON.stringify(buildCellDict(row)),
        // Активные сигналы строки; ложные не пишем — они восстановимы по канону
        // сигналов, а в тысячах строк удваивали бы объём ничем.
        signalsJson: JSON.stringify(dto.signals),
        rowState: isData ? dto.state : 'non-data',
        procurementType: isData ? procurementTypeOf(dto.method) : null,
        subject: String(dto.subject ?? '').trim(),
        planAmount: dto.planSum,
        factAmount: dto.factSum,
        economy: dto.economy,
        economyPercent: economyPercentOf(dto.economy, dto.planSum),
        createdAt: snapshot.createdAt,
      });
    });
  }
  return out;
}

/**
 * Потолок связываемых параметров одного SQL-запроса. SQLite современных сборок
 * держит 32 766, но исторический предел — 999; считаем по нижнему, чтобы размер
 * пакета не стал сюрпризом на чужой сборке. Число колонок берётся из самой
 * схемы, а не переписывается сюда руками: блок Е п.21 добавит колонки осей, и
 * пакет ужмётся сам, вместо того чтобы разъехаться с таблицей.
 */
const MAX_BIND_PARAMS = 900;
const ATOM_ROWS_PER_BATCH = Math.floor(
  MAX_BIND_PARAMS / Object.keys(getTableColumns(schema.procurementRows)).length,
);

/**
 * Кладёт строки-атомы снимка в `procurement_rows` — ОДНОЙ транзакцией
 * пакетами: снимок несёт тысячи строк, и построчная вставка вне транзакции
 * означала бы тысячи отдельных фиксаций на диск.
 *
 * Идемпотентна: сначала сносит уже записанные строки этого снимка. Своего
 * бизнес-ключа у атома нет (пирамида §1: строка живёт без идентификатора,
 * только с позицией на листе), поэтому единственный честный способ не удвоить
 * популяцию при повторной записи — переписать её целиком.
 *
 * Возвращает число записанных строк. Снимок без `rowsByDept` (формат до
 * 24.07.2026) даёт 0 и не падает.
 */
export function saveSnapshotRows(snapshot: DataSnapshot): number {
  const values = buildProcurementRowValues(snapshot);
  db.transaction((tx) => {
    tx.delete(schema.procurementRows)
      .where(eq(schema.procurementRows.snapshotId, snapshot.id))
      .run();
    for (let i = 0; i < values.length; i += ATOM_ROWS_PER_BATCH) {
      tx.insert(schema.procurementRows).values(values.slice(i, i + ATOM_ROWS_PER_BATCH)).run();
    }
  });
  return values.length;
}

/**
 * Сохраняет снимок в БД. Возвращает true, если снимок ЗАПИСАН, и false при
 * сбое: ошибка логируется, но не бросается (сохранение — побочный путь
 * createSnapshot и не должен ронять отдачу данных). Вызыватели, которым важен
 * факт записи (бэкфилл-скрипт: честный счётчик «сохранено N»), обязаны
 * проверять результат; остальные могут игнорировать — поведение additive.
 */
export async function saveSnapshot(snapshot: DataSnapshot): Promise<boolean> {
  try {
    const dataJson = JSON.stringify(snapshot);
    // Замер прироста от атомов истории (строки книг + сетка СВОД): поля добавлены
    // 2026-07-24, снимок потяжелел — держим цифру на виду, а не узнаём по раздутой БД.
    const mb = (n: number): string => (n / 1048576).toFixed(2);
    const atomsBytes = Buffer.byteLength(
      JSON.stringify({ rowsByDept: snapshot.rowsByDept, svodGrid: snapshot.svodGrid }),
      'utf8',
    );
    console.log(
      `💾 Снимок ${snapshot.id}: data-JSON ${mb(Buffer.byteLength(dataJson, 'utf8'))} МБ` +
      ` (строки-атомы и сетка СВОД: ${mb(atomsBytes)} МБ)`,
    );

    db.insert(schema.snapshots).values({
      id: snapshot.id,
      spreadsheetId: snapshot.spreadsheetId,
      createdAt: snapshot.createdAt,
      trustOverall: snapshot.trust.overall,
      trustGrade: snapshot.trust.grade,
      issueCount: snapshot.issues.length,
      criticalIssueCount: snapshot.issues.filter(i => i.severity === 'critical').length,
      metricsCount: Object.keys(snapshot.officialMetrics).length,
      rowCount: snapshot.rowCount,
      readDurationMs: snapshot.metadata.readDurationMs,
      pipelineDurationMs: snapshot.metadata.pipelineDurationMs,
      data: dataJson,
    }).run();

    for (const [key, metric] of Object.entries(snapshot.officialMetrics) as [string, NormalizedMetric][]) {
      db.insert(schema.metricHistory).values({
        snapshotId: snapshot.id,
        metricKey: key,
        numericValue: metric.numericValue,
        displayValue: metric.displayValue,
        confidence: metric.confidence,
        origin: metric.origin,
        createdAt: snapshot.createdAt,
      }).run();
    }

    for (const issue of snapshot.issues) {
      db.insert(schema.issues).values({
        ...issue,
        snapshotId: snapshot.id,
      }).run();
    }

    // Строки-атомы в SQL (пирамида, блок Е п.20). До этого атомы жили только
    // JSON-блобом внутри snapshots.data: ни колонки, ни индекса, ни группировки.
    // Сбой записи атомов не отменяет уже сохранённый снимок и не должен
    // отменять retention — поэтому он ловится здесь и произносится вслух
    // (тот же приём, что у самого retention), а не роняет весь saveSnapshot.
    try {
      const savedRows = saveSnapshotRows(snapshot);
      if (savedRows > 0) {
        console.log(`🧱 Строки-атомы снимка ${snapshot.id}: записано ${savedRows}`);
      }
    } catch (error) {
      console.error(`Строки-атомы снимка ${snapshot.id} не записаны (снимок сохранён):`, error);
    }

    // Retention-канон (пользователь, 24.07): ежедневные снимки — последняя
    // неделя, еженедельные четверг-срезы — вся история; лишнее удаляется здесь
    // же, а не ручной чисткой раздутой БД. Каскад удаления снимает и
    // строки-атомы (snapshot-retention.ts: procurement_rows в транзакции).
    pruneSnapshotsByRetention();
    return true;
  } catch (error) {
    console.error('Ошибка сохранения снимка:', error);
    return false;
  }
}

/**
 * Сколько последних снимков просматриваем в поиске строк-атомов. Снимки без
 * rowsByDept (сохранённые до 2026-07-24) пропускаются — лимит не даёт разбору
 * многомегабайтных JSON уйти вглубь истории без шанса на успех.
 */
const SNAPSHOT_LOOKBACK_LIMIT = 50;

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/**
 * Конец календарного дня `day` ПРОДУКТА как UTC-инстант (ISO-строка): полночь
 * дня day+1 в поясе продукта = (day+1)·сутки − offset·час по UTC. createdAt
 * хранится toISOString — лексикографическое сравнение со строкой границы
 * и есть хронологическое.
 */
const productDayEndIso = (day: number, utcOffsetHours: number): string =>
  new Date((day + 1) * MS_PER_DAY - utcOffsetHours * MS_PER_HOUR).toISOString();

/**
 * Последний снимок, созданный не позже календарного дня `day` (номер суток
 * dayNumberOf) И несущий строки-атомы rowsByDept — источник честного отчёта
 * прошлой недели. Нет подходящего — null: вызывающий код обязан честно сказать
 * об этом читателю, а не подменять.
 *
 * Граница «≤ день» считается в оси календаря ПРОДУКТА (смещение из конфига,
 * Камчатка +12): снимок пятницы продукта 00:30 (= четверг 12:30 UTC) в срез
 * «≤ четверг» НЕ входит — иначе он затенял бы настоящий снимок среза (ревью
 * R2a №4). Строконосность префильтруется в SQL маркером instr — до
 * SNAPSHOT_LOOKBACK_LIMIT многомегабайтных JSON не разбираются зря (№10);
 * разбор ниже перепроверяет непустоту rowsByDept (маркер может стоять и у
 * пустого объекта).
 */
export function getSnapshotAtOrBefore(day: number): DataSnapshot | null {
  const rows = db.select({ data: schema.snapshots.data })
    .from(schema.snapshots)
    .where(and(
      lt(schema.snapshots.createdAt, productDayEndIso(day, config.weeklySnapshot.utcOffsetHours)),
      sql`instr(${schema.snapshots.data}, '"rowsByDept"') > 0`,
    ))
    .orderBy(desc(schema.snapshots.createdAt))
    .limit(SNAPSHOT_LOOKBACK_LIMIT)
    .all();

  for (const row of rows) {
    if (!row.data) continue;
    try {
      const snapshot = JSON.parse(row.data) as DataSnapshot;
      if (snapshot.rowsByDept && Object.keys(snapshot.rowsByDept).length > 0) {
        return snapshot;
      }
    } catch {
      // Повреждённый data-JSON — снимок непригоден, ищем старше.
    }
  }
  return null;
}

export function getSnapshotHistory(limit = 50): Array<{
  id: string;
  createdAt: string;
  trustOverall: number | null;
  trustGrade: string | null;
  issueCount: number | null;
}> {
  return db.select({
    id: schema.snapshots.id,
    createdAt: schema.snapshots.createdAt,
    trustOverall: schema.snapshots.trustOverall,
    trustGrade: schema.snapshots.trustGrade,
    issueCount: schema.snapshots.issueCount,
  })
    .from(schema.snapshots)
    .orderBy(desc(schema.snapshots.createdAt))
    .limit(limit)
    .all();
}

export function getMetricTrend(metricKey: string, limit = 30): Array<{
  numericValue: number | null;
  createdAt: string;
}> {
  return db.select({
    numericValue: schema.metricHistory.numericValue,
    createdAt: schema.metricHistory.createdAt,
  })
    .from(schema.metricHistory)
    .where(eq(schema.metricHistory.metricKey, metricKey))
    .orderBy(desc(schema.metricHistory.createdAt))
    .limit(limit)
    .all();
}

export function getSnapshotMetrics(snapshotId: string): MetricRow[] {
  const rows = db
    .select({
      metricKey: schema.metricHistory.metricKey,
      numericValue: schema.metricHistory.numericValue,
      createdAt: schema.metricHistory.createdAt,
    })
    .from(schema.metricHistory)
    .where(eq(schema.metricHistory.snapshotId, snapshotId))
    .all();
  return rows.map((r) => ({ metricKey: r.metricKey, numericValue: r.numericValue, at: r.createdAt }));
}

export function invalidateCache(): void {
  cachedSnapshots.clear();
}
