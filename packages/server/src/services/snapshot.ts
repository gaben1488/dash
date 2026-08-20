import { runPipeline, computeUnifiedGrid, reconcileUnified, type PipelineInput, type MetricRow, type PipelineSnapshot } from '@aemr/core';
import { REPORT_MAP, getAllCellAddresses, getActiveRules, ALL_SHEETS, SVOD_SHEET_NAME, findDept, SHDYU_MONTHLY_SHEET_NAME, DEPT_HEADER_ROWS, buildCellDict, METHOD_FAMILY_MAP } from '@aemr/shared';
import type { DataSnapshot, Issue, NormalizedMetric, SvodReconRow, SHDYUDeptData } from '@aemr/shared';
import { buildRowDto, isDataRow } from './rows-dto.js';
import { batchGetCells, batchGetFormulas, getSheetData, fetchSHDYUSheet } from './google-sheets.js';
import { parseSHDYUSheet } from '@aemr/core';
import { SHDYU_SPREADSHEET_ID } from '../config.js';
import { db, schema } from '../db/index.js';
import { config, isDemoMode } from '../config.js';
import { and, eq, desc, getTableColumns, lt, sql } from 'drizzle-orm';
import { createDemoSnapshot } from './demo-data.js';
import { pruneSnapshotsByRetention } from './snapshot-retention.js';
import type { DeptSheetResult } from './google-sheets.js';
import { publishLiveEvent } from './event-bus.js';
import { classifySourceFailure } from './source-failure.js';
import { logSnapshotChange, logSourceFailure, logSourceProblem } from './source-log.js';

/** Per-year snapshot cache: key is targetYear (number) */
const cachedSnapshots = new Map<number, { snapshot: PipelineSnapshot; timestamp: number }>();

/**
 * In-flight load memo per cache key (targetYear/0). Без него параллельные
 * force-refresh или expired-cache вызовы getSnapshot() независимо гоняют
 * createSnapshot() — TOCTOU-гонка, дублирующая полную перечитку всех 8
 * листов ГРБС + СВОД (B-9).
 */
const inFlightLoads = new Map<number, Promise<PipelineSnapshot>>();

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
  deptCacheFilledAt = Date.now();
}

/**
 * Момент последнего чтения книг ГРБС. Нужен не для отчётности, а для запрета
 * смешивать моменты: официальные ячейки снимок читает свежими, и если книги в
 * кэше старше, разница между сторонами — артефакт сборки, а не расхождение
 * данных (прецедент 14.08.2026: УКСиМП −181,9 и УО −313,6 при полностью
 * согласованных книгах). Ноль означает «книги ещё не читались».
 */
let deptCacheFilledAt = 0;

export function getDeptCacheFilledAt(): number {
  return deptCacheFilledAt;
}

/**
 * Перечитка всех источников одним циклом. Регистрируется приложением (app.ts),
 * чтобы снимок мог обновить книги перед сборкой, не импортируя загрузчик и не
 * замыкая цикл модулей.
 */
type SourceRefresher = () => Promise<void>;
let sourceRefresher: SourceRefresher | null = null;

export function setSourceRefresher(fn: SourceRefresher | null): void {
  sourceRefresher = fn;
}

/**
 * Гарантия одного момента: если книги в кэше старше допустимого возраста,
 * перечитываем их ДО сборки снимка. Отказ перечитки не валит снимок — он
 * собирается на том, что есть, но возраст источников остаётся видимым.
 */
async function ensureSourcesFresh(): Promise<void> {
  if (!sourceRefresher) return;
  const maxAgeMs = config.cache.sourceFreshnessSeconds * 1000;
  const age = deptCacheFilledAt === 0 ? Infinity : Date.now() - deptCacheFilledAt;
  if (age <= maxAgeMs) return;
  try {
    await sourceRefresher();
  } catch (err) {
    logSourceFailure('перечитка книг перед сборкой снимка', {
      ms: 0,
      reason: classifySourceFailure((err as Error)?.message ?? String(err)),
    });
  }
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

/**
 * Неудачная попытка прочитать лист СВОД: когда пробовали и что ответил источник.
 *
 * Без этой записи маршрут здоровья не отличал «ещё не читали» от «читали и не
 * смогли»: успех клал сетку в кэш, а отказ не оставлял НИЧЕГО, и лист навсегда
 * числился «ещё не читался с запуска сервера». Молчащий источник обязан
 * называться молчащим — иначе картина здоровья выглядит лучше правды.
 */
let svodLoadFailure: { checkedAt: string; error: string } | null = null;

export function setSvodGridCache(values: unknown[][]): void {
  cachedSvodGrid = { values, loadedAt: new Date().toISOString() };
  // Удачное чтение снимает прежний отказ: он больше не описывает состояние.
  svodLoadFailure = null;
}

export function setSvodLoadFailure(error: string): void {
  svodLoadFailure = { checkedAt: new Date().toISOString(), error };
}

export function getSvodLoadFailure(): { checkedAt: string; error: string } | null {
  return svodLoadFailure;
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
let cachedSHDYUData: Record<string, SHDYUDeptData> | null = null;
let cachedSHDYURawRowCount = 0;
let cachedSHDYULoadError: string | null = null;
let cachedSHDYUOfficialYear: number | null = null;
/** Момент последнего УСПЕШНОГО чтения помесячного листа; null — успеха не было. */
let cachedSHDYULoadedAt: string | null = null;
/** Момент последней ПОПЫТКИ — есть и у неудачной. */
let cachedSHDYUCheckedAt: string | null = null;

export function getSHDYUCache(): Record<string, SHDYUDeptData> | null {
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

/**
 * Состояние помесячного листа «СВОД с месяцами» для маршрута здоровья.
 *
 * Лист — такой же источник, как книги управлений и лист СВОД: на нём стоит
 * весь помесячный официал, и его молчание меняет числа продукта. В картине
 * здоровья его не было вовсе, поэтому «прочитаны все источники» звучало и
 * тогда, когда помесячный слой не прочитан ни разу.
 */
export function getSHDYULoadMeta(): {
  loadedAt: string | null;
  checkedAt: string | null;
  rowCount: number | null;
  error: string | null;
} {
  return {
    loadedAt: cachedSHDYULoadedAt,
    checkedAt: cachedSHDYUCheckedAt,
    // Число строк известно только у прочитанного листа: ноль здесь означал бы
    // «прочитан и пуст», а это другое утверждение.
    rowCount: cachedSHDYULoadedAt ? cachedSHDYURawRowCount : null,
    error: cachedSHDYULoadError,
  };
}

export function setSHDYUCache(data: Record<string, SHDYUDeptData>): void {
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

/**
 * Сколько замечаний было в прошлый раз — по ключу кэша (год или «все годы»).
 * Нужно, чтобы объявлять в эфир ПРИРОСТ, а не текущий счёт: «замечаний 214»
 * читателю ничего не сообщает, «появилось 3 новых» — сообщает.
 */
const lastAnnouncedIssues = new Map<number, number>();

/**
 * Объявить пересборку снимка в прямом эфире. Событий два и они разные:
 * «снимок пересобран» — числа на экране устарели, «появились замечания» —
 * есть на что посмотреть в Контроле. Первая сборка за жизнь процесса приросты
 * не объявляет: тогда «новыми» оказались бы все замечания разом.
 */
function announceSnapshot(snapshot: DataSnapshot, year: number | null): void {
  const key = year ?? 0;
  const issues = snapshot.issues ?? [];
  const rows = snapshot.rowCount ?? 0;

  publishLiveEvent({ kind: 'snapshot-rebuilt', rows, issues: issues.length, year });

  const previous = lastAnnouncedIssues.get(key);
  lastAnnouncedIssues.set(key, issues.length);
  if (previous === undefined || issues.length <= previous) return;

  // Разбивка прироста по строгости: сам список замечаний пересобирается
  // целиком, поэтому «какие именно новые» честно назвать нельзя — называем
  // строгость тех, что есть сейчас, в доле прироста.
  const bySeverity: Record<string, number> = {};
  for (const issue of issues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
  }
  publishLiveEvent({
    kind: 'issues-appeared',
    added: issues.length - previous,
    total: issues.length,
    bySeverity,
  });
}

export async function getSnapshot(force = false, targetYear?: number): Promise<PipelineSnapshot> {
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
      announceSnapshot(snapshot, year ?? null);
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
async function createSnapshot(targetYear?: number): Promise<PipelineSnapshot> {
  try {
    // Один момент для обеих сторон сверки: официальные ячейки читаются здесь и
    // сейчас, поэтому устаревшие книги обновляются ДО чтения, а не после.
    await ensureSourcesFresh();
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
        // В журнал сервера, а не в консоль: у строки должны быть уровень,
        // время и поля, иначе её не отфильтровать и не сопоставить с запросом.
        // Причина — русской фразой из закрытого списка: текст Google несёт и
        // адрес книги, и почту служебной учётной записи.
        logSourceFailure(`чтение листа «${sheetName}» сводной книги`, {
          ms: 0,
          reason: classifySourceFailure((error as Error)?.message ?? String(error)),
        });
      }
    });

    const monthlyStartedAt = Date.now();
    const monthlyPromise = fetchSHDYUSheet(SHDYU_SPREADSHEET_ID).then((result) => {
      const sourceLabel = result.sheetName;
      cachedSHDYUCheckedAt = new Date().toISOString();
      if (result.values.length > 0) {
        const parsed = parseSHDYUSheet(result.values, result.formulas);
        cachedSHDYUData = parsed;
        cachedSHDYURawRowCount = result.values.length;
        // AO4 (строка 4, колонка AO=41-я) — глобальный год листа (см. getSHDYUOfficialYear).
        const ao4 = Number(result.values[3]?.[40]);
        cachedSHDYUOfficialYear = Number.isInteger(ao4) && ao4 >= 2020 && ao4 <= 2100 ? ao4 : null;
        cachedSHDYULoadError = null;
        cachedSHDYULoadedAt = cachedSHDYUCheckedAt;
        logSnapshotChange(
          `Помесячный лист «${sourceLabel}» прочитан: строк ${result.values.length},`
          + ` из них с формулами ${result.formulas.length}, управлений ${Object.keys(parsed).length},`
          + ` за ${Date.now() - monthlyStartedAt} мс`,
          {
            sheet: sourceLabel,
            rows: result.values.length,
            formulaRows: result.formulas.length,
            depts: Object.keys(parsed).length,
            ms: Date.now() - monthlyStartedAt,
          },
        );
      } else {
        cachedSHDYULoadError = `Лист «${sourceLabel}» прочитан, но пуст (0 строк): помесячная динамика в источнике не заполнена за выбранный период.`;
        logSourceFailure(`чтение помесячного листа «${sourceLabel}»`, {
          ms: Date.now() - monthlyStartedAt,
          reason: 'лист прочитан, но пуст',
        });
      }
    }).catch((err: unknown) => {
      cachedSHDYUCheckedAt = new Date().toISOString();
      cachedSHDYULoadError = `Не удалось прочитать лист «${SHDYU_MONTHLY_SHEET_NAME}»: ${err instanceof Error ? err.message : String(err)}`;
      logSourceFailure(`чтение помесячного листа «${SHDYU_MONTHLY_SHEET_NAME}»`, {
        ms: Date.now() - monthlyStartedAt,
        reason: classifySourceFailure((err as Error)?.message ?? String(err)),
      });
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
    /** Сколько строк каждая книга дала снимку — материал для одной итоговой строки журнала. */
    const perimeter: Array<{ dept: string; rows: number }> = [];
    for (const [deptName, deptResult] of Object.entries(cachedDeptSheetData)) {
      const mirror = sheetRows[deptName];
      if (deptResult.values.length === 0) continue;
      if (mirror && mirror.length > 0 && hasNoMeaningfulRows(mirror)) {
        brokenMirrors.push({ dept: deptName, got: mirror.length, used: deptResult.values.length });
        logSourceProblem(
          `Зеркало листа «${deptName}» в сводной книге отдало ${mirror.length} строк без данных`
          + ` (ошибка формул) — взят кэш собственной книги: ${deptResult.values.length} строк`,
          { dept: deptName, mirrorRows: mirror.length, usedRows: deptResult.values.length },
        );
      }
      perimeter.push({ dept: deptName, rows: deptResult.values.length });
      sheetRows[deptName] = deptResult.values;
    }

    // ОДНА строка на весь периметр вместо восьми поштучных: вопрос «почему в
    // отчёте столько закупок» решается суммой по книгам, а не сбором восьми
    // разрозненных сообщений из ленты журнала.
    if (perimeter.length > 0) {
      logSnapshotChange(
        `Периметр строк собран из собственных книг: ${perimeter.map((p) => `${p.dept} ${p.rows}`).join(', ')}`
        + ` — всего ${perimeter.reduce((sum, p) => sum + p.rows, 0)}`,
        {
          books: perimeter.length,
          rowsTotal: perimeter.reduce((sum, p) => sum + p.rows, 0),
          brokenMirrors: brokenMirrors.length,
        },
      );
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
    // Гейт демо-фолбэка (класс КЦЕ-прецедента 14.08): при настроенных Google-кредах
    // подменять данные сочинённым демо-снимком нельзя — сбой источника (или баг
    // пайплайна после чтения) отдаётся честно: последний сохранённый снимок из SQL,
    // а если истории нет — ошибка пробрасывается, и роуты отвечают 503.
    if (!isDemoMode) {
      const last = loadLatestSavedSnapshot();
      if (last) {
        logSourceProblem('Снимок не собран — отдан последний сохранённый из базы', {
          reason: classifySourceFailure((error as Error)?.message ?? String(error)),
          snapshotId: last.id,
          createdAt: last.createdAt,
        });
        return last;
      }
      throw error;
    }
    logSourceProblem('Таблицы недоступны и доступ не настроен — отдан демонстрационный снимок', {
      reason: classifySourceFailure((error as Error)?.message ?? String(error)),
    });
    const demo = createDemoSnapshot();
    demo.id = `demo-${demo.id}`;
    // Демо-генератор собирает снимок в общей форме DataSnapshot; его расчётные
    // словари по построению совместимы с уточнённым PipelineSnapshot.
    return demo as PipelineSnapshot;
  }
}

/**
 * Последний сохранённый настоящий снимок из SQL — фолбэк на сбой источника при
 * настроенных кредах. Просматриваем несколько последних строк: повреждённый
 * data-JSON не должен лишать продукт более старого целого снимка. Снимок может
 * не совпадать с запрошенным годом — это устаревшие, но НАСТОЯЩИЕ данные, в
 * отличие от демо-генератора.
 */
function loadLatestSavedSnapshot(): PipelineSnapshot | null {
  try {
    const rows = db.select({ data: schema.snapshots.data })
      .from(schema.snapshots)
      .orderBy(desc(schema.snapshots.createdAt))
      .limit(5)
      .all();
    for (const row of rows) {
      if (!row.data) continue;
      try {
        const snapshot = JSON.parse(row.data) as PipelineSnapshot;
        if (snapshot?.id && !snapshot.id.startsWith('demo-')) return snapshot;
      } catch {
        // Повреждённый data-JSON — пробуем снимок старше.
      }
    }
  } catch {
    // БД недоступна — фолбэка нет, вызывающий пробросит исходную ошибку.
  }
  return null;
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
 *
 * БАГ #8 (2026-08-08, docs/superpowers/audits/2026-08-08-bug-hunt-register.md):
 * id замечания намеренно стабилен между прогонами (issue-identity.ts, чтобы
 * статусы не орфанились), а issues.id — PRIMARY KEY БЕЗ snapshot_id в составе
 * (schema.ts). Второй снимок с тем же замечанием раньше падал на UNIQUE
 * ПОСЛЕ того, как snapshots и metric_history уже были записаны вне
 * транзакции — а всё, что шло следом (строки-атомы saveSnapshotRows,
 * ретеншен pruneSnapshotsByRetention), не выполнялось вообще, и внешний catch
 * глушил ошибку молча. Итог в проде: procurement_rows пуст навсегда после
 * первого снимка, ретеншен выключен навсегда, issues не растут. Фикс —
 * вставка issues идемпотентна по id (onConflictDoNothing: совпавший id значит
 * то же замечание, апдейт дублирующей строки бессмыслен — соседний паттерн у
 * routes/changes.ts:110), а вся цепочка snapshots → metric_history → issues →
 * saveSnapshotRows → pruneSnapshotsByRetention — ОДНА better-sqlite3-транзакция:
 * частичная запись теперь невозможна в принципе, либо коммитится всё, либо
 * ничего. Вложенные db.transaction() внутри saveSnapshotRows и
 * pruneSnapshotsByRetention безопасны: better-sqlite3 сам переключается на
 * SAVEPOINT/RELEASE, когда db.inTransaction уже true (node_modules/better-sqlite3/
 * lib/methods/transaction.js) — своей вложенной транзакции достаточно.
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
    logSnapshotChange(
      `Снимок сохраняется: данные ${mb(Buffer.byteLength(dataJson, 'utf8'))} МБ`
      + ` (строки-атомы и сетка СВОД: ${mb(atomsBytes)} МБ), строк ${snapshot.rowCount},`
      + ` замечаний ${snapshot.issues.length}`,
      {
        snapshotId: snapshot.id,
        bytes: Buffer.byteLength(dataJson, 'utf8'),
        atomBytes: atomsBytes,
        rows: snapshot.rowCount,
        issues: snapshot.issues.length,
      },
    );

    db.transaction((tx) => {
      tx.insert(schema.snapshots).values({
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
        tx.insert(schema.metricHistory).values({
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
        // Совпавший id — то же замечание в новом снимке: перевешиваем ТОЛЬКО
        // snapshot_id на свежий снимок. Прочие поля не трогаем (статус/комментарий
        // ставит человек через PUT — затирать их снимком нельзя). Без перевешивания
        // строка оставалась приписанной к ПЕРВОМУ снимку, ретеншен его прунил и
        // каскадом удалял живое замечание (страж: snapshot-rows.test.ts, БАГ #8).
        tx.insert(schema.issues).values({
          ...issue,
          snapshotId: snapshot.id,
        }).onConflictDoUpdate({
          target: schema.issues.id,
          set: { snapshotId: snapshot.id },
        }).run();
      }

      // Строки-атомы в SQL (пирамида, блок Е п.20). До этого атомы жили только
      // JSON-блобом внутри snapshots.data: ни колонки, ни индекса, ни группировки.
      // Теперь часть единой транзакции снимка (см. БАГ #8 выше) — сбой здесь
      // откатывает всё, а не оставляет снимок без строк.
      const savedRows = saveSnapshotRows(snapshot);
      if (savedRows > 0) {
        logSnapshotChange(`Строки-атомы снимка записаны: ${savedRows}`, { snapshotId: snapshot.id, rows: savedRows });
      }

      // Retention-канон (пользователь, 24.07): ежедневные снимки — последняя
      // неделя, еженедельные четверг-срезы — вся история; лишнее удаляется здесь
      // же, а не ручной чисткой раздутой БД. Каскад удаления снимает и
      // строки-атомы (snapshot-retention.ts: procurement_rows в транзакции).
      // pruneSnapshotsByRetention сама не бросает (ловит свои ошибки и логирует) —
      // сбой ретеншена не откатывает уже собранный снимок.
      pruneSnapshotsByRetention();
    });

    return true;
  } catch (error) {
    logSourceProblem('Снимок не сохранён в базу', {
      reason: (error as Error)?.message ?? String(error),
    });
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
export function getSnapshotAtOrBefore(day: number): PipelineSnapshot | null {
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
      const snapshot = JSON.parse(row.data) as PipelineSnapshot;
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
