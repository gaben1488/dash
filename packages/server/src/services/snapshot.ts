import { currentCalculationContextMatches } from './snapshot-calculation-context.js';
import { sourceStateReceipt, SVOD_WATERMARK_KEY } from './book-watermark.js';
import { sheetFingerprint } from './sheet-fingerprint.js';
import { measureReadStage, withoutRequestTiming } from '../plugins/request-timing.js';
import { computeTrustScore, MONITORING_DATA_SHEETS, type MetricRow, type PipelineSnapshot } from '@aemr/core';
import { REPORT_MAP, getAllCellAddresses, ALL_SHEETS, SVOD_SHEET_NAME, findDept, SHDYU_MONTHLY_SHEET_NAME, DEPT_HEADER_ROWS, DEPARTMENTS, departmentCoverage } from '@aemr/shared';
import type { DataSnapshot, Issue, SHDYUDeptData } from '@aemr/shared';
import { batchGetCells, batchGetFormulas, batchGetSheetValues, getSheetData, fetchSHDYUSheet } from './google-sheets.js';
import { parseSHDYUSheet } from '@aemr/core';
import { db, schema } from '../db/index.js';
import { recordSnapshotRead, snapshotReadContext } from './snapshot-read-context.js';
import { sameSnapshotYearScope } from './snapshot-year-scope.js';
import { config, DEPARTMENT_SPREADSHEETS, isDemoMode, SHDYU_SPREADSHEET_ID } from '../config.js';
import { and, eq, desc, lt, sql, isNull } from 'drizzle-orm';
import { createDemoSnapshot } from './demo-data.js';
import { saveSnapshotRowsToDb, saveSnapshotToDb, pruneSnapshotsInDb } from './snapshot-storage.js';
import { resolve } from 'node:path';
import type { DeptSheetResult } from './google-sheets.js';
import { publishLiveEvent } from './event-bus.js';
import { diffIssueNews, type IssueNewsBaseline } from './issue-news.js';
import { classifySourceFailure } from './source-failure.js';
import { logSnapshotChange, logSourceFailure, logSourceProblem } from './source-log.js';
import { setImmediate as yieldToReads } from 'node:timers/promises';
import { runSnapshotCalculation, runSnapshotStorage, type SnapshotCalculationInput } from './snapshot-calculation.js';

/** Per-year snapshot cache: key is targetYear (number) */
const cachedSnapshots = new Map<number, { snapshot: PipelineSnapshot; timestamp: number; generation: number }>();
// Three calendar years in the UI plus the all-years view; old scopes remain in SQLite.
const MAX_CACHED_SNAPSHOT_SCOPES = 4;
let cacheGeneration = 0;

function readState(snapshot: PipelineSnapshot, state: 'refreshing' | 'stale'): PipelineSnapshot {
  return { ...snapshot, metadata: { ...snapshot.metadata, readModel: { state } } };
}

function rememberSnapshot(key: number, snapshot: PipelineSnapshot, timestamp: number): void {
  cachedSnapshots.delete(key);
  cachedSnapshots.set(key, { snapshot, timestamp, generation: cacheGeneration });
  while (cachedSnapshots.size > MAX_CACHED_SNAPSHOT_SCOPES) {
    cachedSnapshots.delete(cachedSnapshots.keys().next().value!);
  }
}

/**
 * In-flight load memo per cache key (targetYear/0). Без него параллельные
 * force-refresh или expired-cache вызовы getSnapshot() независимо гоняют
 * createSnapshot() — TOCTOU-гонка, дублирующая полную перечитку всех 8
 * листов ГРБС + СВОД (B-9).
 */
const inFlightLoads = new Map<number, Promise<PipelineSnapshot>>();
// Different years share one CPU/memory budget; queued readers keep their saved scope.
// ponytail: one materializer per API process; use one bounded worker before multi-process scaling.
let materializationTail: Promise<void> = Promise.resolve();

let cachedDeptSheetData: Record<string, DeptSheetResult> = {};

/**
 * Обновляет кэш деп-листов. `data` — успешно загруженные в этом цикле депы,
 * применяются как replace по ключу. `failedDeptNames` — депы, упавшие в этом
 * цикле: их запись УДАЛЯЕТСЯ из кэша, а не остаётся молча от предыдущей
 * успешной загрузки под видом свежих данных (маскировка отказа, B-9).
 */
/**
 * A values-only poll must not discard a confirmed formula grid for an
 * unchanged Google revision. The matching value fingerprint is necessary but
 * NOT sufficient: a formula can be edited without changing its result.
 * Without matching source identity and version, withdraw the formula evidence.
 */
function canKeepFormulaGrid(before: DeptSheetResult, after: DeptSheetResult): boolean {
  if (before.formulasRead !== true || after.formulasRead === true || before.formulas.length === 0) return false;
  if (!before.providerId || before.providerId !== after.providerId
      || before.sheetName !== after.sheetName
      || (before.startRow ?? 1) !== (after.startRow ?? 1)) return false;
  const sameProviderVersion = !!before.sourceVersion && before.sourceVersion === after.sourceVersion;
  const sameSharedRevision = !before.sourceVersion && !after.sourceVersion
    && !!before.sourceRevision && before.sourceRevision === after.sourceRevision;
  return (sameProviderVersion || sameSharedRevision)
    && sheetFingerprint(before.values) === sheetFingerprint(after.values);
}

export function setDeptSheetCache(
  data: Record<string, DeptSheetResult>,
  failedDeptNames: readonly string[] = [],
  acceptedAt?: string,
): void {
  const next = { ...cachedDeptSheetData };
  for (const [name, reading] of Object.entries(data)) {
    const before = next[name];
    next[name] = before && canKeepFormulaGrid(before, reading)
      ? { ...reading, formulas: before.formulas, formulasRead: true }
      : reading;
  }
  for (const name of failedDeptNames) {
    Reflect.deleteProperty(next, name);
  }
  cachedDeptSheetData = next;
  deptCacheFilledAt = acceptedAt === undefined ? Date.now() : Date.parse(acceptedAt);
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

/** Reflect one confirmed edit without mutating already selected inputs or their read time. */
export function patchDeptSheetCacheCell(deptName: string, rowIndex: number, column: number, value: unknown): boolean {
  const source = cachedDeptSheetData[deptName];
  const row = source?.values[rowIndex - 1];
  if (!Number.isInteger(rowIndex) || rowIndex < 1 || !Number.isInteger(column) || column < 0 || !row) return false;
  const values = source.values.slice();
  values[rowIndex - 1] = row.slice();
  values[rowIndex - 1][column] = value;
  const edited = { ...source, values };
  // A confirmed cell write does not establish a new complete source revision.
  delete edited.sourceRevision;
  delete edited.sourceVersion;
  cachedDeptSheetData = { ...cachedDeptSheetData, [deptName]: edited };
  if (deptLoadMeta[deptName]) {
    const meta = { ...deptLoadMeta[deptName] };
    delete meta.sourceRevision;
    deptLoadMeta = { ...deptLoadMeta, [deptName]: meta };
  }
  invalidateCache();
  return true;
}

/**
 * Перечитать источники ПРЯМО СЕЙЧАС — по требованию читателя (кнопка
 * «перечитать» раздела), а не по возрасту кэша. Возвращает true, если
 * перечитка прошла; false — перечитчик не зарегистрирован или чтение упало
 * (вызывающий считает по тому, что есть, и честно называет момент данных).
 */
export async function refreshSourcesNow(): Promise<boolean> {
  if (!sourceRefresher) return false;
  try {
    await sourceRefresher();
    return true;
  } catch (err) {
    logSourceFailure('перечитка книг по запросу читателя', {
      ms: 0,
      reason: classifySourceFailure((err as Error)?.message ?? String(err)),
    });
    return false;
  }
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

export function setSvodGridCache(values: unknown[][], acceptedAt?: string): void {
  cachedSvodGrid = { values, loadedAt: acceptedAt ?? new Date().toISOString() };
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
 *   • зеркалу одной шапки недостаточно, чтобы подтвердить полноту master;
 *     у прочитанного master шапка без позиций, напротив, сохраняет известный ноль;
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

export interface WeeklyMonitoringEvidenceInput {
  readAt: string;
  version: number;
  sheets: Record<string, unknown[][]>;
  failed: Record<string, string>;
  expectedSheets: number;
}

/**
 * Завершить недельный снимок таблиц. Snapshot уже записан обычным pipeline;
 * здесь к тому же id добавляются только недостающие исторические входы.
 * Никакого чтения live-данных внутри функции нет.
 */
export function sealWeeklyTableContext(
  snapshotId: string,
  monitoring: WeeklyMonitoringEvidenceInput,
): Promise<boolean> {
  const sealing = materializationTail.then(() => sealWeeklyTableContextNow(snapshotId, monitoring));
  materializationTail = sealing.then(() => undefined, () => undefined);
  return sealing;
}

async function sealWeeklyTableContextNow(
  snapshotId: string,
  monitoring: WeeklyMonitoringEvidenceInput,
): Promise<boolean> {
  try {
    const row = db.select({ data: schema.snapshots.data })
      .from(schema.snapshots).where(eq(schema.snapshots.id, snapshotId)).get();
    if (!row?.data) return false;
    const snapshot = JSON.parse(row.data) as PipelineSnapshot;
    const rowsByDept = snapshot.rowsByDept ?? {};
    const names = Object.keys(rowsByDept);
    const expectedMasters = Object.keys(DEPARTMENT_SPREADSHEETS).sort();
    if (names.length !== expectedMasters.length
        || names.slice().sort().some((name, index) => name !== expectedMasters[index])) return false;
    const monitoringNames = Object.keys(monitoring.sheets ?? {}).sort();
    const expectedMonitoring = [...MONITORING_DATA_SHEETS].sort();
    if (Object.keys(monitoring.failed ?? {}).length > 0
        || monitoringNames.length !== expectedMonitoring.length
        || monitoringNames.some((name, index) => name !== expectedMonitoring[index])) return false;

    const masters: NonNullable<PipelineSnapshot['weeklyTableContext']>['masters'] = {};
    for (const name of names) {
      const source = cachedDeptSheetData[name];
      const meta = deptLoadMeta[name];
      if (!source || !source.formulasRead || !meta || meta.error) return false;
      const observed = source.values.slice(DEPT_HEADER_ROWS);
      if (JSON.stringify(observed) !== JSON.stringify(rowsByDept[name])) return false;
      masters[name] = {
        sheetName: source.sheetName,
        startRow: source.startRow ?? 1,
        loadedAt: meta.loadedAt,
        headerRows: source.values.slice(0, DEPT_HEADER_ROWS),
        formulas: source.formulas,
        formulasRead: true,
      };
    }
    snapshot.weeklyTableContext = {
      contract: 'dash-weekly-table-context-v1',
      sealedAt: new Date().toISOString(),
      masters,
      monitoring: {
        readAt: monitoring.readAt,
        version: monitoring.version,
        sheets: monitoring.sheets,
      },
    };
    // Snapshot уже существует: повторный saveSnapshot() закономерно упадёт на
    // PRIMARY KEY и, хуже того, попытался бы второй раз писать метрики/issues.
    // Weekly context — дочернее доказательство того же среза, поэтому меняем
    // только data JSON ровно одной существующей строки. Retention запускается
    // после UPDATE и уже видит признак complete-week.
    await yieldToReads();
    await persistSnapshot(snapshot, 'weekly');
    return true;
  } catch (error) {
    logSourceProblem('Недельный контекст таблиц не сохранён', {
      snapshotId,
      reason: (error as Error)?.message ?? String(error),
    });
    return false;
  }
}

export function getDeptSheetValues(): Record<string, unknown[][]> {
  const result: Record<string, unknown[][]> = {};
  for (const [key, val] of Object.entries(cachedDeptSheetData)) {
    result[key] = val.values;
  }
  return result;
}

interface DeptLoadMeta {
  sourceRevision?: string;
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

export { attachUnifiedGrid } from './snapshot-calculation.js';

/**
 * База сравнения замечаний прошлой сборки — по ключу кэша (год или «все
 * годы»). Хранит СОСТАВ (стабильные id по корзинам-книгам), а не число:
 * сравнение чисел («стало 2000, было 14 → новых 1986») объявляло лавину
 * «новых» после любой просадки базы — упавшего источника или фолбэка на
 * старый снимок — и приписывало её последней правке (прецедент 20.08.2026:
 * правка одной строки УКСиМП → «новых замечаний 1986»).
 */
const issueNewsBaselines = new Map<number, IssueNewsBaseline>();

/** Только для тестов: забыть базы сравнения, как после перезапуска процесса. */
export function resetIssueNewsBaselines(): void {
  issueNewsBaselines.clear();
}

/**
 * Объявить пересборку снимка в прямом эфире. Событий два и они разные:
 * «снимок пересобран» — числа на экране устарели, «появились замечания» —
 * есть на что посмотреть в Контроле. «Новое» — замечание, чей стабильный ключ
 * появился (issue-news.ts); первая сборка за жизнь процесса новостей не
 * объявляет: тогда «новыми» оказались бы все замечания разом.
 */
function announceSnapshot(snapshot: DataSnapshot, year: number | null): void {
  const key = year ?? 0;
  const issues = snapshot.issues ?? [];
  const rows = snapshot.rowCount ?? 0;

  publishLiveEvent({ kind: 'snapshot-rebuilt', rows, issues: issues.length, year });

  const { appeared, baseline } = diffIssueNews(issueNewsBaselines.get(key), snapshot);
  issueNewsBaselines.set(key, baseline);
  if (appeared.length === 0) return;

  // Разбивка ПОЯВИВШИХСЯ по строгости: состав новых известен по ключам,
  // поэтому и строгость называется именно у них, а не у всего снимка.
  const bySeverity: Record<string, number> = {};
  for (const issue of appeared) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
  }
  publishLiveEvent({
    kind: 'issues-appeared',
    added: appeared.length,
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
  // A valid calculation belongs to an input generation, not a five-minute TTL.
  // Source/decision changes explicitly invalidate it. Retrying a failed or
  // interrupted build still uses TTL; a page visit alone never creates data.
  const unchanged = !isDemoMode && cached && cached.timestamp > 0
    && cached.generation === cacheGeneration
    && !cached.snapshot.metadata.readModel
    && cached.snapshot.metadata.sourceCoverage?.complete !== false;
  if (!force && cached && (unchanged || (now - cached.timestamp) < ttl)) {
    return recordSnapshotRead(cached.snapshot);
  }

  // Reading a page must not await Google, calculations, persistence and pruning.
  // Keep the last proven scope; its createdAt remains the actual captured time.
  if (!force && !isDemoMode) {
    const needsStorageRead = !cached || cached.generation !== cacheGeneration;
    const previous = needsStorageRead
      ? loadLatestSavedSnapshot(year) ?? cached?.snapshot
      : cached.snapshot;
    if (previous && needsStorageRead) {
      const receipt = sourceStateReceipt(DEPARTMENT_SPREADSHEETS, config.google.spreadsheetId, {
        ...cachedDeptSheetData, ...(cachedSvodGrid ? { [SVOD_WATERMARK_KEY]: cachedSvodGrid } : {}),
      });
      if (receipt && previous.metadata.sourceReceipt === receipt
        && previous.metadata.sourceCoverage?.complete === true
        && !Object.values(deptLoadMeta).some(meta => meta.error) && !svodLoadFailure
        && currentCalculationContextMatches(previous)) {
        rememberSnapshot(cacheKey, previous, now);
        return recordSnapshotRead(previous);
      }
      rememberSnapshot(cacheKey, previous, 0);
    }
    if (!inFlightLoads.has(cacheKey)) {
      void withoutRequestTiming(() => snapshotReadContext.exit(() => getSnapshot(true, year))).catch((error: unknown) => {
        logSourceProblem('Фоновая сборка снимка не завершена', {
          reason: classifySourceFailure(error instanceof Error ? error.message : String(error)),
        });
      });
    }
    if (previous) return recordSnapshotRead(readState(previous, 'refreshing'));
    throw Object.assign(new Error('Срез этого периода ещё готовится. Повторите чтение после обновления.'),
      { code: 'SNAPSHOT_NOT_READY', statusCode: 503 });
  }

  const inFlight = inFlightLoads.get(cacheKey);
  if (inFlight) return recordSnapshotRead(await inFlight);
  let generation = cacheGeneration;
  const build = materializationTail.then(() => {
    generation = cacheGeneration;
    return createSnapshot(year);
  });
  // Do not retain the large result, or let one failed scope poison the queue.
  materializationTail = build.then(() => undefined, () => undefined);
  const loadPromise = (async () => {
    try {
      const snapshot = await build;
      // An invalidation while loading cannot become a falsely fresh cache hit.
      const changedDuringLoad = generation !== cacheGeneration;
      const result = changedDuringLoad && !snapshot.metadata.readModel
        ? readState(snapshot, 'refreshing') : snapshot;
      if (!snapshot.id.startsWith('demo-')) {
        // A failed import keeps its explicit stale state for the normal retry interval.
        rememberSnapshot(cacheKey, result, changedDuringLoad && result.metadata.readModel?.state !== 'stale' ? 0 : Date.now());
      }
      announceSnapshot(result, year ?? null);
      return result;
    } finally {
      inFlightLoads.delete(cacheKey);
    }
  })();
  inFlightLoads.set(cacheKey, loadPromise);
  return recordSnapshotRead(await loadPromise);
}

/**
 * Листы сводной книги — ОДНИМ обращением вместо девяти.
 *
 * Замер 21.08.2026: сборка снимка читала каждый лист своим `values.get`
 * (`ALL_SHEETS.map(getSheetData)`) — девять запросов в одну секунду на каждую
 * пересборку, а пересборка случается после КАЖДОГО уведомления, что-то
 * изменившего. Параллельность их не удешевляет: дорог не процесс, а квота
 * Google и потолок «слишком часто» — тот же урок, что у книги мониторинга.
 * Книга одна — значит и обращение одно (`values.batchGet` со всеми
 * диапазонами, документация Sheets, samples/reading — «Read multiple ranges»).
 *
 * Пакетное чтение — всё или ничего: переименованный лист роняет весь
 * запрос. Поэтому на отказе пакета остаётся прежний путь по одному листу:
 * частичный снимок честнее пустого, а имя не прочитанного листа едет в журнал.
 */
async function readMainBookSheets(svod: typeof cachedSvodGrid): Promise<Record<string, unknown[][]>> {
  // Лист СВОД уже прочитан циклом источников — тем же самым вызовом, с теми же
  // настройками (services/source-refresh.ts). Читать его ещё раз значит платить
  // за самый большой лист книги дважды И развести стороны сверки во времени,
  // ровно против канона п.66. Берём из кэша, пока он свеж по тому же сроку,
  // по которому цикл считает книги свежими.
  const maxAgeMs = config.cache.sourceFreshnessSeconds * 1000;
  const svodFresh = svod !== null
    && svod.values.length > 0
    && Date.now() - Date.parse(svod.loadedAt) <= maxAgeMs;
  const names = (ALL_SHEETS as readonly string[]).filter((n) => !svodFresh || n !== SVOD_SHEET_NAME);
  const withSvod = (rows: Record<string, unknown[][]>): Record<string, unknown[][]> => {
    if (svodFresh && svod) rows[SVOD_SHEET_NAME] = svod.values;
    return rows;
  };

  try {
    return withSvod(await batchGetSheetValues(names));
  } catch (batchError) {
    logSourceFailure('пакетное чтение листов сводной книги', {
      ms: 0,
      reason: classifySourceFailure((batchError as Error)?.message ?? String(batchError)),
    });
  }

  const rows: Record<string, unknown[][]> = {};
  await Promise.all(
    names.map(async (sheetName) => {
      try {
        rows[sheetName] = await getSheetData(sheetName);
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
    }),
  );
  return withSvod(rows);
}

/**
 * Создаёт новый снимок: читает данные из Google Sheets и прогоняет пайплайн
 */
async function createSnapshot(targetYear?: number): Promise<PipelineSnapshot> {
  try {
    // Один момент для обеих сторон сверки: официальные ячейки читаются здесь и
    // сейчас, поэтому устаревшие книги обновляются ДО чтения, а не после.
    await ensureSourcesFresh();
    // Select the source generation before any more I/O. Refresh/edit paths
    // replace cache entries, so later arrivals cannot change this calculation.
    const deptSources = cachedDeptSheetData;
    const inputReceipt = sourceStateReceipt(DEPARTMENT_SPREADSHEETS, config.google.spreadsheetId,
      { ...deptSources, ...(cachedSvodGrid ? { [SVOD_WATERMARK_KEY]: cachedSvodGrid } : {}) });
    const svodSource = cachedSvodGrid;
    let monthlyData = cachedSHDYUData;
    let monthlyYear = cachedSHDYUOfficialYear;
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
    const sheetsPromise = readMainBookSheets(svodSource).then((rows) => {
      Object.assign(sheetRows, rows);
    });

    const monthlyStartedAt = Date.now();
    const monthlyPromise = fetchSHDYUSheet(SHDYU_SPREADSHEET_ID).then((result) => {
      const sourceLabel = result.sheetName;
      cachedSHDYUCheckedAt = new Date().toISOString();
      if (result.values.length > 0) {
        const parsed = measureReadStage('normalize', () => parseSHDYUSheet(result.values, result.formulas));
        monthlyData = parsed;
        cachedSHDYUData = parsed;
        cachedSHDYURawRowCount = result.values.length;
        // AO4 (строка 4, колонка AO=41-я) — глобальный год листа (см. getSHDYUOfficialYear).
        const ao4 = Number(result.values[3]?.[40]);
        cachedSHDYUOfficialYear = Number.isInteger(ao4) && ao4 >= 2020 && ao4 <= 2100 ? ao4 : null;
        monthlyYear = cachedSHDYUOfficialYear;
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

    await Promise.all([sheetsPromise, monthlyPromise]);

    // ОДИН ПЕРИМЕТР СТРОК (аудит 30.07 №14). Первоисточник — собственные
    // книги ГРБС: зеркала в сводной — производные IMPORTRANGE, они отстают
    // и ломаются («#REF!» у УКСиМП). Прежний порядок был обратным: снимок
    // предпочитал зеркала, а /api/report — книги, и один ряд недель опирался
    // на две популяции строк (УАГЗО +60 млн плана между источниками).
    // Кэш master — источник строк; отсутствие master не разрешает непроверенное зеркало.
    // Сломанные зеркала по-прежнему оставляют след: «источник сломан»
    // не должен быть неотличим от «данных нет» (см. hasNoMeaningfulRows).
    const brokenMirrors: Array<{ dept: string; got: number; used: number }> = [];
    /**
     * Формулы формульных граф книг — для слоя целостности формул в ядре
     * (`core/pipeline/formula-integrity.ts`). Наполняется ровно теми книгами,
     * у которых формулы В ЭТОМ чтении читались; книга без чтения формул
     * остаётся вне карты, и слой про неё честно молчит.
     */
    const sheetFormulas: Record<string, unknown[][]> = {};
    /** Сколько строк каждая книга дала снимку — материал для одной итоговой строки журнала. */
    const perimeter: Array<{ dept: string; rows: number }> = [];
    for (const dept of DEPARTMENTS) {
      if (!deptSources[dept.nameShort]?.values.length) Reflect.deleteProperty(sheetRows, dept.nameShort);
    }
    for (const [deptName, deptResult] of Object.entries(deptSources)) {
      const mirror = sheetRows[deptName];
      if (deptResult.values.length < DEPT_HEADER_ROWS) {
        Reflect.deleteProperty(sheetRows, deptName);
        continue;
      }
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
      // Формулы книги — тому же слою, что и строки, и ТОЛЬКО когда их читали
      // (решение владельца §22 п.7: по вебхуку и в ночном обходе, не при
      // каждом быстром обновлении). Ключ не ставится вовсе, если чтения не
      // было: пустая сетка и отсутствие ключа значат для ядра одно —
      // «формулы не читали», и ни то ни другое не выдаётся за «дефектов нет».
      if (deptResult.formulasRead && deptResult.formulas.length > 0) {
        sheetFormulas[deptName] = deptResult.formulas;
      }
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

    // The report worker and Dash may finish calculations on opposite sides
    // of Kamchatka midnight. Use the report capture's actual instant only when
    // all eight accepted master rows still belong to that exact revision.
    // Otherwise calculate the live input normally, without a shared-source claim.
    const masters = Object.entries(DEPARTMENT_SPREADSHEETS);
    const firstReading = deptSources[masters[0]?.[0] ?? ''];
    const revision = firstReading?.sourceRevision;
    const capturedAt = firstReading?.readAt;
    const sharedCapture = masters.length === DEPARTMENTS.length
      && perimeter.length === masters.length
      && typeof revision === 'string' && /^SRC-[a-f0-9]{64}$/.test(revision)
      && typeof capturedAt === 'string' && Number.isFinite(Date.parse(capturedAt))
      && masters.every(([name, providerId]) => {
        const source = deptSources[name];
        return source?.providerId === providerId
          && source.sourceRevision === revision && source.readAt === capturedAt
          && source.formulasRead === true && source.values.length >= DEPT_HEADER_ROWS;
      })
      ? { sourceRevision: revision, asOf: new Date(capturedAt) }
      : null;

    const pipelineInput: SnapshotCalculationInput = {
      batchGetData,
      sheetRows,
      // Ключ ставится только при непустой карте: пустой объект и отсутствие
      // ключа для ядра равнозначны, но пустой объект в переписке читался бы
      // как «формулы читали, и они чисты».
      ...(Object.keys(sheetFormulas).length > 0 ? { sheetFormulas } : {}),
      reportMap: REPORT_MAP,
      spreadsheetId: config.google.spreadsheetId,
      targetYear,
      ...(sharedCapture ? { asOf: sharedCapture.asOf } : {}),
      // Год официального листа (Д21): без него сверка вычитала многолетний
      // расчёт из одногодичного официала и звала это расхождением.
      officialYear: monthlyYear ?? undefined,
    };

    pipelineInput.sourceBindings = Object.fromEntries(Object.entries(deptSources).map(([name, reading]) => [name, {
      providerId: reading.providerId ?? null, sheetName: reading.sheetName,
      version: reading.sourceVersion ?? null, readAt: reading.readAt ?? null,
    }]));
    const snapshot = await runSnapshotCalculation(pipelineInput);
    snapshot.metadata.sourceReceipt = inputReceipt;
    snapshot.metadata.sourceCoverage = departmentCoverage(DEPARTMENTS.map(dept => dept.nameShort), perimeter.map(dept => dept.dept));
    if (sharedCapture && snapshot.metadata.sourceCoverage.complete) {
      snapshot.metadata.sourceRevision = sharedCapture.sourceRevision;
    }

    // След сломанного зеркала — в самом снимке, а не только в консоли: замечание
    // сохраняется вместе со снимком и видно в продукте. Без него подстановка
    // кэша тиха, и «источник сломан» снова выглядел бы как «данных нет».
    for (const m of brokenMirrors) {
      const issue: Issue = {
        // Id СТАБИЛЕН между сборками (без snapshot.id): пока зеркало сломано,
        // это одно и то же замечание, а не «новое» на каждом пересчёте —
        // иначе каждая пересборка объявляла бы его в эфир заново, а статусы
        // в SQLite орфанились бы (тот же канон, что у issue-identity.ts).
        id: `mirror-broken-${m.dept}`,
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

    if (monthlyData) {
      snapshot.shdyuData = monthlyData;
    }
    if (!(await saveSnapshot(snapshot))) {
      throw new Error('SNAPSHOT_PERSIST_FAILED');
    }

    return snapshot;
  } catch (error) {
    // Гейт демо-фолбэка (класс КЦЕ-прецедента 14.08): при настроенных Google-кредах
    // подменять данные сочинённым демо-снимком нельзя — сбой источника (или баг
    // пайплайна после чтения) отдаётся честно: последний сохранённый снимок из SQL,
    // а если истории нет — ошибка пробрасывается, и роуты отвечают 503.
    if (!isDemoMode) {
      const last = loadLatestSavedSnapshot(targetYear);
      if (last) {
        logSourceProblem('Снимок не собран — отдан последний сохранённый из базы', {
          reason: classifySourceFailure((error as Error)?.message ?? String(error)),
          snapshotId: last.id,
          createdAt: last.createdAt,
        });
        return readState(last, 'stale');
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
 * data-JSON не должен лишать продукт более старого целого снимка. Периметр должен точно
 * совпадать с запрошенным: чужой год или all-years не являются заменой.
 */
function loadLatestSavedSnapshot(targetYear?: number): PipelineSnapshot | null {
  try {
    const scopeType = sql`CASE WHEN json_valid(${schema.snapshots.data}) THEN json_type(${schema.snapshots.data}, '$.metadata.targetYear') END`;
    const scopeValue = sql`CASE WHEN json_valid(${schema.snapshots.data}) THEN json_extract(${schema.snapshots.data}, '$.metadata.targetYear') END`;
    const rows = db.select({ data: schema.snapshots.data })
      .from(schema.snapshots)
      // Scope before limit: retained heads of other years/books are not candidates.
      .where(and(
        eq(schema.snapshots.spreadsheetId, config.google.spreadsheetId),
        eq(scopeType, targetYear === undefined ? 'null' : 'integer'),
        targetYear === undefined ? isNull(scopeValue) : eq(scopeValue, targetYear),
      ))
      .orderBy(desc(schema.snapshots.createdAt))
      .limit(5)
      .toSQL();
    const cursor = measureReadStage('sql', () => db.$client.prepare(rows.sql).iterate(...rows.params));
    try {
      for (let next = measureReadStage('sql', () => cursor.next()); !next.done; next = measureReadStage('sql', () => cursor.next())) {
        const raw = next.value;
        const row = raw as { data: string | null };
        if (!row.data) continue;
        try {
          const snapshot = measureReadStage('decode', () => JSON.parse(row.data!)) as PipelineSnapshot;
          if (snapshot?.id && !snapshot.id.startsWith('demo-') && sameSnapshotYearScope(snapshot, targetYear)) {
            // The current fallback must not revive an obsolete perfect grade.
            // Reassess its captured evidence without changing data/time or writing
            // history; getStoredSnapshotById still returns the original record.
            if (snapshot.trust?.overall != null || snapshot.trust?.grade != null) {
              return { ...snapshot, trust: computeTrustScore(new Map(Object.entries(snapshot.officialMetrics)),
                snapshot.issues, snapshot.deltas, snapshot.id, snapshot.trust?.coverage) };
            }
            return snapshot;
          }
        } catch {
          // Повреждённый data-JSON — пробуем снимок старше.
        }
      }
    } finally { cursor.return?.(); }
  } catch {
    // БД недоступна — фолбэка нет, вызывающий пробросит исходную ошибку.
  }
  return null;
}

export { buildProcurementRowValues } from './snapshot-storage.js';

export function saveSnapshotRows(snapshot: DataSnapshot): number {
  return saveSnapshotRowsToDb(snapshot, db);
}

async function persistSnapshot(snapshot: DataSnapshot, operation: 'insert' | 'weekly'): Promise<void> {
  const today = new Date();
  if (operation === 'insert' && db.select({ id: schema.snapshots.id }).from(schema.snapshots)
    .where(eq(schema.snapshots.id, snapshot.id)).get()) throw new Error('SNAPSHOT_ALREADY_EXISTS');
  if (db.$client.name === ':memory:' || db.$client.name === '') {
    if (operation === 'weekly') {
      const updated = db.update(schema.snapshots).set({ data: JSON.stringify(snapshot) })
        .where(eq(schema.snapshots.id, snapshot.id)).run();
      if (updated.changes !== 1) throw new Error('WEEKLY_SNAPSHOT_NOT_UNIQUE');
    } else saveSnapshotToDb(snapshot, db, today);
    await yieldToReads();
    pruneSnapshotsInDb(db, config.weeklySnapshot.utcOffsetHours, today);
    return;
  }
  try {
    await runSnapshotStorage({ snapshot, operation, today, path: resolve(db.$client.name),
      offset: config.weeklySnapshot.utcOffsetHours });
  } catch (error) {
    // A lost worker/receipt cannot turn an already committed write into failure.
    // Exact payload equality also prevents accepting an older row with this ID.
    const saved = db.select({ data: schema.snapshots.data }).from(schema.snapshots)
      .where(eq(schema.snapshots.id, snapshot.id)).get();
    if (saved?.data !== JSON.stringify(snapshot)) throw error;
    logSourceProblem('Снимок записан; фоновое обслуживание не подтверждено', { snapshotId: snapshot.id });
  }
}

export async function saveSnapshot(snapshot: DataSnapshot): Promise<boolean> {
  try {
    await yieldToReads();
    await persistSnapshot(snapshot, 'insert');
    return true;
  } catch (error) {
    logSourceProblem('Снимок не сохранён в базу', {
      reason: (error as Error)?.message ?? String(error),
    });
    return false;
  }
}

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

/** Exact immutable record; never substitute the latest state for a missing ID. */
export function getStoredSnapshotById(id: string): PipelineSnapshot | null {
  const row = db.select({ data: schema.snapshots.data }).from(schema.snapshots).where(eq(schema.snapshots.id, id)).get();
  if (!row?.data) return null;
  try {
    const snapshot = JSON.parse(row.data) as PipelineSnapshot;
    if (snapshot.id !== id || !snapshot.metadata || !snapshot.createdAt) throw new Error('invalid stored snapshot');
    return snapshot;
  } catch {
    throw new Error('STORED_SNAPSHOT_INVALID');
  }
}


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
 * SQLite cursor держит в памяти не более одного JSON; число отклонённых
 * кандидатов не обрезает доступ к пригодному архиву. Разбор ниже перепроверяет непустоту rowsByDept (маркер может стоять и у
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
    .toSQL();

  for (const raw of db.$client.prepare(rows.sql).iterate(...rows.params)) {
    const row = raw as { data: string | null };
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

/** Упорядоченный SQLite cursor: число отклонённых попыток не ограничивает доноров. */
export function* iterateWeeklySnapshotHistory(): Generator<{ id: string; createdAt: string }> {
  const query = db.select({ id: schema.snapshots.id, createdAt: sql<string>`${schema.snapshots.createdAt}`.as('createdAt') })
    .from(schema.snapshots)
    .where(sql`instr(${schema.snapshots.data}, '"weeklyTableContext"') > 0`)
    .orderBy(desc(schema.snapshots.createdAt), desc(schema.snapshots.id))
    .toSQL();
  for (const raw of db.$client.prepare(query.sql).iterate(...query.params)) {
    yield raw as { id: string; createdAt: string };
  }
}

/** Совместимый metadata API; проверенные потребители используют cursor до своего result-cap. */
export function getWeeklySnapshotHistory(limit = 50): Array<{ id: string; createdAt: string }> {
  const result: Array<{ id: string; createdAt: string }> = [];
  for (const row of iterateWeeklySnapshotHistory()) {
    if (result.length >= limit) break;
    result.push(row);
  }
  return result;
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
  cacheGeneration++;
  for (const entry of cachedSnapshots.values()) entry.timestamp = 0;
}

/** Dependency identity for derived read models; elapsed time is not a change. */
export function getSnapshotGeneration(): number {
  return cacheGeneration;
}
