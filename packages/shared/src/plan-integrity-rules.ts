/**
 * plan-integrity-rules.ts — целостность ПЛАНОВЫХ сумм книг ГРБС.
 *
 * КАНОН п.102 (реестр интервью, docs/superpowers/audits/2026-08-14-interview-register.md):
 * колонки H/I/J/K книг несут ТРИ РАЗНЫЕ сущности, и различить их по самой
 * ячейке нельзя — (1) НМЦК неизменная (УАГЗО, УКСиМП, УД; в основном УО и
 * УЭР), (2) НМЦК минус изъятое перераспределением (культура правит K вниз
 * задним числом), (3) распределяемый лимит (УДТХ: «расписываю все наши лимиты
 * под планируемые закупки, при экономии снимаю лимиты с закупки и
 * перераспределяю на следующую»). Общий знаменатель семантик (2) и (3):
 * ЭКОНОМИЯ УХОДИТ ПРАВКОЙ ПЛАНА ЗАДНИМ ЧИСЛОМ — она исчезает из план−факт и
 * становится невидимой, хотя деньги реально высвободились. Продукт обязан
 * ловить это по журналу правок и показывать честно.
 *
 * Здесь живут три проверки уровня ЛИСТА и КНИГИ (каскад п.53 — одна карточка
 * со списком адресов, а не простыня замечаний по строкам):
 *   1. `plan_units_rubles`          — сумма набрана в рублях, книга ведётся в тысячах;
 *   2. `plan_economy_dissolved`     — плановая ячейка снижена задним числом под факт;
 *   3. `journal_provenance_blind`   — журнал правок книги почти не ведётся.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, а не rule-book.ts: правила плановой целостности —
 * самостоятельный предмет (провенанс сумм, п.102), их данные приходят не из
 * строки листа, а из журнала книги. Массив `PLAN_INTEGRITY_RULES` подключается
 * к RULE_BOOK отдельным решением; готовые записи реестра проверок —
 * `PLAN_INTEGRITY_CHECKS`.
 *
 * КАНОН п.27: свободный текст исполнителей машинно не интерпретируется. Ни
 * одна проверка этого файла не читает слов из G/M/U/AE/AF/AG/AH — только
 * числа, даты и адреса ячеек.
 *
 * ТОН п.53: механизм простыми словами → адрес ячейки → действие с адресатом.
 * Ни один текст не упрекает исполнителя: три семантики K — не нарушение
 * дисциплины, а разные рабочие практики управлений, которые продукт обязан
 * развести и подписать.
 */

import type {
  ClassifiedRow,
  RuleCheckContext,
  RuleCheckResult,
  ValidationRule,
} from './types.js';
import type { CheckRegistryEntry } from './check-registry.js';
import { toNumber } from './rule-book.js';
import { hasFactDate } from './fact-date.js';

// ============================================================
// Общий словарь колонок и предикатов
// ============================================================

/** Плановые деньги строки листа ГРБС: ФБ, КБ, МБ и итого (канон column-map). */
export const PLAN_MONEY_COLUMNS = ['H', 'I', 'J', 'K'] as const;

/** Фактические деньги строки: ФБ, КБ, МБ и итого. */
export const FACT_MONEY_COLUMNS = ['V', 'W', 'X', 'Y'] as const;

/** Итог плана строки — колонка K. */
const PLAN_TOTAL = 'K';

/** Итог факта строки — колонка Y. */
const FACT_TOTAL = 'Y';

/** Дата заключения контракта — колонка Q. */
const FACT_DATE_COLUMN = 'Q';

/** Пределы перечня в карточке: диагноз, а не простыня (тон п.53). */
const LIST_CAP = 20;

function hasCellData(val: unknown): boolean {
  return val !== null && val !== undefined && val !== '';
}

/**
 * Счётная строка — та, что несёт деньги закупки. Предикат совпадает по смыслу
 * с «счётной строкой» нумерации A из RULE_BOOK: строки-разделители, «итого» и
 * текстовые пометки денег не носят, и подозревать их в рублях бессмысленно.
 */
const COUNTED_CLASSES: ReadonlySet<string> = new Set([
  'procurement',
  'procurement_derived',
  'service',
]);

function isCountedRow(row: ClassifiedRow): boolean {
  if (row.classification === 'header') return false;
  if (COUNTED_CLASSES.has(row.classification)) return true;
  // Сомнительная классификация со способом закупки и живым планом — всё равно
  // строка закупки: пропустить её значило бы не заметить именно тот случай,
  // ради которого правило написано.
  return hasCellData(row.cells['L']) && (toNumber(row.cells[PLAN_TOTAL]) ?? 0) > 0;
}

/**
 * Якорь листа — первая счётная строка. check() зовётся для КАЖДОЙ строки, а
 * карточка на лист нужна одна (каскад п.53), поэтому весь разбор выполняется
 * только на якоре. WeakMap-кэш по массиву строк листа снимает повторный
 * скан на каждой строке (лист управления — тысячи строк).
 */
const anchorCache = new WeakMap<ClassifiedRow[], number | null>();

function sheetAnchor(all: ClassifiedRow[]): number | null {
  const cached = anchorCache.get(all);
  if (cached !== undefined) return cached;
  let min: number | null = null;
  for (const r of all) {
    if (isCountedRow(r) && (min === null || r.rowIndex < min)) min = r.rowIndex;
  }
  anchorCache.set(all, min);
  return min;
}

/** Счётные строки листа по возрастанию номера — общий вход всех трёх проверок. */
function countedRows(all: readonly ClassifiedRow[]): ClassifiedRow[] {
  return all.filter(isCountedRow).slice().sort((a, b) => a.rowIndex - b.rowIndex);
}

/**
 * Число тысяч рублей в операторском формате: «34 975 002,17».
 * Отдельная функция вместо готового форматтера: дома отчётных форматтеров
 * (web/src/lib/report/mappers.ts) пакету shared не виден, а тянуть его сюда
 * ради двух строк текста — заводить ещё одну копию понятия.
 */
function moneyText(v: number): string {
  const sign = v < 0 ? '−' : '';
  const [int, frac] = Math.abs(v).toFixed(2).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${frac}`;
}

/**
 * Часовой пояс книг — Asia/Kamchatka (UTC+12), так стоит в properties каждой
 * книги ГРБС по дампам 18.08. Момент правки показывается ДНЁМ КНИГИ, а не днём
 * сервера: иначе правка, сделанная утром в Елизове, в карточке уедет на сутки
 * назад, и человек не найдёт её в журнале по дате.
 */
const BOOK_UTC_OFFSET_MS = 12 * 60 * 60 * 1000;

/** Момент правки для читателя: «05.08.2026». Журнал хранит мс эпохи. */
function dayText(atMs: number): string {
  if (!Number.isFinite(atMs)) return 'момент не распознан';
  const d = new Date(atMs + BOOK_UTC_OFFSET_MS);
  if (Number.isNaN(d.getTime())) return 'момент не распознан';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

/** Разбор адреса ячейки журнала: «H28» → { column: 'H', rowIndex: 28 }. */
export function parseCellRef(cell: string): { column: string; rowIndex: number } | null {
  const m = /^([A-Z]{1,2})(\d+)$/.exec(String(cell ?? '').trim().toUpperCase());
  if (!m) return null;
  const rowIndex = Number.parseInt(m[2], 10);
  if (!Number.isFinite(rowIndex) || rowIndex <= 0) return null;
  return { column: m[1], rowIndex };
}

// ============================================================
// ПРОВЕНАНС КНИГИ — журнал правок «_ChangeLog»
// ============================================================

/**
 * Одна правка ячейки из скрытого листа «_ChangeLog» книги ГРБС.
 * Колонки журнала (сверено по дампам 18.08): A=«Лист», B=«Ячейка»,
 * C=«Столбец», D=«Строка», E=«Было», F=«Стало», G=«Время», H=«Автор»,
 * I=«Приоритет», J=«Статус».
 */
export interface PlanJournalEdit {
  /** Колонка A журнала — имя листа книги, где правили ячейку. */
  sheet: string;
  /** Колонка B журнала — адрес ячейки листа («H28»). */
  cell: string;
  /** Колонка E журнала — «Было». */
  oldValue: unknown;
  /** Колонка F журнала — «Стало». */
  newValue: unknown;
  /** Колонка G журнала — момент правки, мс эпохи. */
  atMs: number;
  /** Колонка H журнала — автор правки (для адресации карточки). */
  author?: string;
}

/**
 * Провенанс плановых сумм книги — то, чего нет в самой строке листа.
 *
 * ЧЕСТНОСТЬ ГЛУБИНЫ: `journalEntryCount` — сколько записей в «_ChangeLog»
 * ВСЕЙ книги (не только по разбираемому листу). Он отделён от `edits`
 * намеренно: журнал может быть загружен частично, и тогда молчание проверки
 * «экономия растворена в плане» нельзя выдавать за отсутствие практики.
 */
export interface BookProvenance {
  /** Имя книги для текста карточки («УДТХ»). */
  bookTitle?: string;
  /** Записей в «_ChangeLog» книги — всего. */
  journalEntryCount: number;
  /** Разобранные правки ячеек. Пустой массив при ненулевом счётчике = журнал не загружен. */
  edits: readonly PlanJournalEdit[];
}

/**
 * Контекст правила, обогащённый провенансом книги.
 * ValidationRule.check принимает базовый RuleCheckContext, поэтому провенанс
 * читается опциональным полем: не подключён — проверки журнала молчат, а не
 * выдумывают выводы из пустоты.
 */
export interface PlanIntegrityContext extends RuleCheckContext {
  planProvenance?: BookProvenance;
}

/** Положить провенанс книги в контекст правила (вызывает подключающая сторона). */
export function withPlanProvenance(
  ctx: RuleCheckContext,
  provenance: BookProvenance,
): PlanIntegrityContext {
  return { ...ctx, planProvenance: provenance };
}

/** Прочитать провенанс из контекста; null — не подключён либо форма не та. */
function readProvenance(ctx: RuleCheckContext): BookProvenance | null {
  const p = (ctx as PlanIntegrityContext).planProvenance;
  if (!p || typeof p !== 'object') return null;
  if (typeof p.journalEntryCount !== 'number' || !Array.isArray(p.edits)) return null;
  return p;
}

// ============================================================
// ПРОВЕРКА 1: сумма похожа на рубли, а книга ведётся в тысячах
// ============================================================

/**
 * Абсолютный порог: 100 000 тыс. руб. = 100 млн на ОДНУ строку закупки.
 * Годовой бюджет района меньше, поэтому такая строка — не крупная закупка,
 * а почти наверняка рубли, набранные в колонку тысяч.
 */
export const RUBLES_ABSOLUTE_THRESHOLD = 100_000;

/** Строгий множитель к медиане листа: два порядка (канон п.102 — «2-3 порядка»). */
export const RUBLES_MEDIAN_RATIO = 100;

/**
 * Смягчённый множитель, когда у числа копеечный хвост.
 * ПОЧЕМУ хвост не работает сам по себе: в тысячах два знака после запятой —
 * норма (живой пример канона — 6 693,57 тыс.), и одиночный признак «две
 * цифры дробной части» пометил бы пол-листа, то есть родил бы ровно ту
 * простыню, которую запрещает п.53. Хвост только ПОДТВЕРЖДАЕТ масштаб:
 * в рублях копейки дают два знака, в тысячах те же копейки дали бы пять.
 */
export const RUBLES_MEDIAN_RATIO_WITH_KOPECKS = 50;

/** Медиана листа считается от этого числа сумм — иначе она не медиана. */
export const RUBLES_MEDIAN_MIN_SAMPLE = 5;

export type RublesLikeReason =
  /** Больше 100 млн руб. на одну строку — больше бюджета района. */
  | 'above_district_budget'
  /** На два порядка выше медианы сумм листа. */
  | 'far_above_median'
  /** Копеечный хвост подтверждает, что число набрано в рублях. */
  | 'kopecks_tail';

export interface RublesLikeHit {
  /** Адрес ячейки листа («H28»). */
  cell: string;
  rowIndex: number;
  column: string;
  value: number;
  /** Во сколько раз больше медианы листа; null — медиана не построена. */
  ratioToMedian: number | null;
  /** Как это же число выглядело бы в тысячах. */
  asThousands: number;
  reasons: RublesLikeReason[];
}

export interface RublesLikeReport {
  hits: RublesLikeHit[];
  /** Медиана положительных сумм листа; null — сумм слишком мало. */
  median: number | null;
  /** Сколько положительных сумм участвовало в медиане. */
  sampleSize: number;
}

/** Копеечный хвост: дробная часть — ровно две цифры и не нули. */
function hasKopecksTail(v: number): boolean {
  const cents = Math.round(v * 100);
  if (Math.abs(v * 100 - cents) > 1e-6) return false;
  return cents % 100 !== 0;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Найти суммы, набранные, судя по масштабу, в рублях.
 *
 * МЕХАНИЗМ: книги ведутся В ТЫСЯЧАХ рублей. Значение, набранное в рублях,
 * завышает и строку, и весь свод ровно в тысячу раз. Живой случай (канон
 * п.102, журнал УО): H28 = 34 975 002,17 вместо 34 975,00 — исправлено
 * 05.08.2026 самим управлением, то есть класс дефекта подтверждён практикой.
 */
export function detectRublesLikeAmounts(rows: readonly ClassifiedRow[]): RublesLikeReport {
  const counted = countedRows(rows);
  const population: number[] = [];
  const candidates: Array<{ cell: string; column: string; rowIndex: number; value: number }> = [];

  for (const r of counted) {
    for (const col of [...PLAN_MONEY_COLUMNS, ...FACT_MONEY_COLUMNS]) {
      const v = toNumber(r.cells[col]);
      if (v === null || v <= 0) continue;
      population.push(v);
      candidates.push({ cell: `${col}${r.rowIndex}`, column: col, rowIndex: r.rowIndex, value: v });
    }
  }

  const med = population.length >= RUBLES_MEDIAN_MIN_SAMPLE ? median(population) : null;
  const hits: RublesLikeHit[] = [];

  for (const c of candidates) {
    const reasons: RublesLikeReason[] = [];
    const kopecks = hasKopecksTail(c.value);
    const ratio = med !== null && med > 0 ? c.value / med : null;

    if (c.value > RUBLES_ABSOLUTE_THRESHOLD) reasons.push('above_district_budget');
    if (ratio !== null) {
      const need = kopecks ? RUBLES_MEDIAN_RATIO_WITH_KOPECKS : RUBLES_MEDIAN_RATIO;
      if (ratio >= need) reasons.push('far_above_median');
    }
    // Хвост — только подтверждение масштаба, самостоятельным поводом он не бывает.
    if (reasons.length > 0 && kopecks) reasons.push('kopecks_tail');
    if (reasons.length === 0) continue;

    hits.push({
      cell: c.cell,
      rowIndex: c.rowIndex,
      column: c.column,
      value: c.value,
      ratioToMedian: ratio,
      asThousands: c.value / 1000,
      reasons,
    });
  }

  hits.sort((a, b) => b.value - a.value);
  return { hits, median: med, sampleSize: population.length };
}

const REASON_TEXT: Readonly<Record<RublesLikeReason, string>> = {
  above_district_budget: 'больше 100 млн руб. на одну строку',
  far_above_median: 'на два порядка выше медианы листа',
  kopecks_tail: 'копеечный хвост',
};

const rublesLikeAmount: ValidationRule = {
  id: 'plan_units_rubles',
  name: 'Сумма похожа на рубли, а книга ведётся в тысячах',
  description:
    'Суммы книг ГРБС ведутся в тысячах рублей. Значение, набранное в рублях, ' +
    'завышает строку и весь свод ровно в тысячу раз. Отбор: сумма на два ' +
    'порядка выше медианы листа либо больше 100 млн руб. на одну строку; ' +
    'копеечный хвост подтверждает масштаб, но сам поводом не бывает. ' +
    'Одна карточка на лист со списком адресов (каскад п.53).',
  severity: 'error',
  origin: 'bi_heuristic',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!ctx.allRows || ctx.allRows.length === 0) return { passed: true };
    const anchor = sheetAnchor(ctx.allRows);
    if (anchor === null || ctx.rowIndex !== anchor) return { passed: true };

    const report = detectRublesLikeAmounts(ctx.allRows);
    if (report.hits.length === 0) return { passed: true };

    const shown = report.hits.slice(0, LIST_CAP).map((h) => {
      const why = h.reasons.map((r) => REASON_TEXT[r]).join(', ');
      return `${h.cell} — ${moneyText(h.value)} (${why}); в тысячах это ${moneyText(h.asThousands)}`;
    });
    const rest =
      report.hits.length > shown.length
        ? `; и ещё ${report.hits.length - shown.length} ячеек`
        : '';
    const medianNote =
      report.median !== null
        ? `Медиана сумм листа — ${moneyText(report.median)} тыс. руб. по ${report.sampleSize} значениям. `
        : 'Медиана листа не строилась: сумм слишком мало, отбор шёл только по абсолютному порогу. ';

    return {
      cell: report.hits[0].cell,
      passed: false,
      message:
        `Книга ведётся в тысячах рублей, а ${report.hits.length} сумм листа набраны, ` +
        `похоже, в рублях — каждая такая ячейка завышает и строку, и свод ровно в ` +
        `тысячу раз. ${medianNote}` +
        `Адреса: ${shown.join('; ')}${rest}. ` +
        `Действие: проверить единицу измерения — значение похоже на рубли, в книге ` +
        `суммы в тысячах. Живой прецедент того же класса: УО, H28 = 34 975 002,17 ` +
        `вместо 34 975,00, исправлено 05.08.2026 (канон п.102).`,
      actual: `${report.hits.length} сумм похожи на рубли`,
      expected: 'все суммы листа — в тысячах рублей',
    };
  },
};

// ============================================================
// ПРОВЕРКА 2: экономия растворена в плане
// ============================================================

/**
 * Полоса «исправление единиц»: отношение было/стало около тысячи.
 * Канон п.102 различает два класса снижений плановой ячейки — ~1000 это
 * исправление единиц (ввели рубли вместо тысяч), прочее — настоящее
 * ретро-снижение плана. Полоса не ровно 1000, потому что живое исправление
 * даёт 999,99… (УО, H28: 34 975 002,17 → 34 975,00).
 *
 * ЗНАЧЕНИЯ СОВПАДАЮТ с core/src/provenance/plan-provenance.ts (тот же канон
 * п.102, разбор журнала целиком): у одного понятия один дом, и расхождение
 * полос дало бы два честных ответа на один вопрос. Меняются — только вместе.
 * За полосой большое снижение НЕ проглатывается как «единицы»: оно попадает
 * в перечень карточки настоящих ретро-снижений.
 */
export const UNIT_FIX_RATIO_MIN = 900;
export const UNIT_FIX_RATIO_MAX = 1100;

/**
 * Чем доказано, что план правили ЗАДНИМ ЧИСЛОМ:
 *   'journal' — журнал книги хранит появление факта РАНЬШЕ правки плана;
 *   'state'   — факт у строки есть на момент чтения, но момент его появления
 *               журналом не подтверждён (журнал книги начат позже).
 * Разделение обязательно: смешать доказанное с наблюдаемым — соврать о
 * провенансе, а именно провенанс здесь и есть предмет (п.102).
 */
export type RetroCutEvidence = 'journal' | 'state';

export interface RetroPlanCut {
  cell: string;
  rowIndex: number;
  column: string;
  from: number;
  to: number;
  /** Снятая сумма: было − стало. */
  removed: number;
  atMs: number;
  author?: string;
  evidence: RetroCutEvidence;
}

export interface DissolvedEconomyReport {
  /** Настоящие ретро-снижения плана. */
  cuts: RetroPlanCut[];
  /** Снятая сумма всего: итог K строки, если правили его, иначе слагаемые H/I/J. */
  removedTotal: number;
  /** Снижения, отсеянные как исправление единиц (~1000×) — показываются счётчиком. */
  unitFixes: RetroPlanCut[];
}

/** Похоже ли снижение на исправление единиц (рубли → тысячи). */
function looksLikeUnitFix(from: number, to: number): boolean {
  // Обнуление плана — не исправление единиц: 0 не получается делением на 1000.
  if (to <= 0) return false;
  const ratio = from / to;
  return ratio >= UNIT_FIX_RATIO_MIN && ratio <= UNIT_FIX_RATIO_MAX;
}

/**
 * Момент появления факта у строки ПО ЖУРНАЛУ: первая правка, поставившая дату
 * заключения (Q) или ненулевой факт (V/W/X/Y). Undefined — журнал этого не
 * видел, и «задним числом» по нему не доказывается.
 */
function factMomentsByRow(
  edits: readonly PlanJournalEdit[],
  sheetName: string,
): Map<number, number> {
  const out = new Map<number, number>();
  const remember = (rowIndex: number, atMs: number) => {
    const prev = out.get(rowIndex);
    if (prev === undefined || atMs < prev) out.set(rowIndex, atMs);
  };

  for (const e of edits) {
    if (e.sheet !== sheetName) continue;
    const ref = parseCellRef(e.cell);
    if (!ref) continue;

    if (ref.column === FACT_DATE_COLUMN) {
      // Дата заключения появилась там, где её не было.
      if (!hasFactDate(e.oldValue) && hasFactDate(e.newValue)) remember(ref.rowIndex, e.atMs);
      continue;
    }
    if ((FACT_MONEY_COLUMNS as readonly string[]).includes(ref.column)) {
      const before = toNumber(e.oldValue) ?? 0;
      const after = toNumber(e.newValue) ?? 0;
      if (before <= 0 && after > 0) remember(ref.rowIndex, e.atMs);
    }
  }
  return out;
}

/** Есть ли у строки факт на момент чтения (дата заключения либо ненулевой итог факта). */
function rowHasFactNow(row: ClassifiedRow): boolean {
  if (hasFactDate(row.cells[FACT_DATE_COLUMN])) return true;
  return (toNumber(row.cells[FACT_TOTAL]) ?? 0) > 0;
}

/**
 * Найти ретро-снижения плановых ячеек — «экономию, растворённую в плане».
 *
 * МЕХАНИЗМ (канон п.102): при экономии на торгах управление снимает сумму с
 * плановой ячейки строки и передаёт её другой закупке. План−факт по такой
 * строке становится ≈0, экономия исчезает из расчёта, хотя деньги реально
 * высвободились и перераспределены. Дословно специалист УДТХ: «когда
 * появляется экономия по какой-то закупке, я естественно снимаю лимиты с неё
 * и перераспределяю их на следующую закупку».
 */
export function detectDissolvedEconomy(
  rows: readonly ClassifiedRow[],
  edits: readonly PlanJournalEdit[],
  sheetName: string,
): DissolvedEconomyReport {
  const byRow = new Map<number, ClassifiedRow>();
  for (const r of countedRows(rows)) byRow.set(r.rowIndex, r);

  const factMoments = factMomentsByRow(edits, sheetName);
  const cuts: RetroPlanCut[] = [];
  const unitFixes: RetroPlanCut[] = [];

  for (const e of edits) {
    if (e.sheet !== sheetName) continue;
    const ref = parseCellRef(e.cell);
    if (!ref) continue;
    if (!(PLAN_MONEY_COLUMNS as readonly string[]).includes(ref.column)) continue;

    const row = byRow.get(ref.rowIndex);
    if (!row) continue;

    const from = toNumber(e.oldValue);
    const to = toNumber(e.newValue);
    if (from === null || to === null || from <= 0 || to >= from) continue;

    // Задним числом = после появления факта. Правка плана ДО факта — обычное
    // планирование, экономии там ещё нет и растворять нечего.
    const factAt = factMoments.get(ref.rowIndex);
    let evidence: RetroCutEvidence;
    if (factAt !== undefined && e.atMs >= factAt) evidence = 'journal';
    else if (factAt === undefined && rowHasFactNow(row)) evidence = 'state';
    else continue;

    const cut: RetroPlanCut = {
      cell: e.cell,
      rowIndex: ref.rowIndex,
      column: ref.column,
      from,
      to,
      removed: from - to,
      atMs: e.atMs,
      author: e.author,
      evidence,
    };
    if (looksLikeUnitFix(from, to)) unitFixes.push(cut);
    else cuts.push(cut);
  }

  cuts.sort((a, b) => a.atMs - b.atMs || a.rowIndex - b.rowIndex);
  unitFixes.sort((a, b) => a.atMs - b.atMs || a.rowIndex - b.rowIndex);

  // Снятая сумма считается ПО СТРОКАМ, а не по ячейкам: K = H + I + J, и
  // сложение правки итога с правками слагаемых удвоило бы одни и те же деньги.
  // Правили итог — берём итог; правили только слагаемые — берём слагаемые.
  const perRow = new Map<number, { total: number; components: number }>();
  for (const c of cuts) {
    const acc = perRow.get(c.rowIndex) ?? { total: 0, components: 0 };
    if (c.column === PLAN_TOTAL) acc.total += c.removed;
    else acc.components += c.removed;
    perRow.set(c.rowIndex, acc);
  }
  let removedTotal = 0;
  for (const acc of perRow.values()) removedTotal += acc.total > 0 ? acc.total : acc.components;

  return { cuts, removedTotal, unitFixes };
}

const dissolvedEconomy: ValidationRule = {
  id: 'plan_economy_dissolved',
  name: 'Экономия растворена в плане',
  description:
    'Плановая ячейка строки (H/I/J/K) снижена задним числом — после появления ' +
    'факта или даты заключения — и это не исправление единиц (~1000×). ' +
    'Снижение плана под факт делает экономию невидимой в план−факт, хотя ' +
    'деньги высвободились и перераспределены (канон п.102). Одна карточка на ' +
    'лист: адреса, снятая сумма, глубина доказательства.',
  severity: 'warning',
  origin: 'bi_heuristic',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!ctx.allRows || ctx.allRows.length === 0) return { passed: true };
    const anchor = sheetAnchor(ctx.allRows);
    if (anchor === null || ctx.rowIndex !== anchor) return { passed: true };

    const prov = readProvenance(ctx);
    // Журнал не подключён — проверка молчит. Молчание тут честнее вывода:
    // без журнала ретро-правку не отличить от исходно низкого плана.
    if (!prov || prov.edits.length === 0) return { passed: true };

    const report = detectDissolvedEconomy(ctx.allRows, prov.edits, ctx.sheet);
    if (report.cuts.length === 0) return { passed: true };

    const shown = report.cuts.slice(0, LIST_CAP).map((c) => {
      const proof =
        c.evidence === 'journal'
          ? 'после факта по журналу'
          : 'у строки есть факт, момент его появления журнал не застал';
      return (
        `${c.cell} — ${moneyText(c.from)} → ${moneyText(c.to)} ` +
        `(снято ${moneyText(c.removed)}, ${dayText(c.atMs)}, ${proof})`
      );
    });
    const rest =
      report.cuts.length > shown.length ? `; и ещё ${report.cuts.length - shown.length} правок` : '';
    const provenTail =
      report.cuts.some((c) => c.evidence === 'state')
        ? ' Часть правок помечена как наблюдаемая, а не доказанная: журнал книги начат позже появления факта — глубину провенанса карточка не преувеличивает.'
        : '';
    const unitTail =
      report.unitFixes.length > 0
        ? ` Ещё ${report.unitFixes.length} снижений отнесены к исправлению единиц (было/стало около тысячи) и в сумму не вошли.`
        : '';

    return {
      cell: report.cuts[0].cell,
      passed: false,
      message:
        `План строк листа снижен задним числом на ${moneyText(report.removedTotal)} тыс. руб. ` +
        `в ${report.cuts.length} правках. Механизм: при экономии на торгах сумма ` +
        `снимается с плановой ячейки и передаётся другой закупке — план−факт по ` +
        `такой строке становится почти нулевым, и высвободившиеся деньги ` +
        `перестают быть видны как экономия. Адреса: ${shown.join('; ')}${rest}.` +
        `${provenTail}${unitTail} ` +
        `Действие: показать перераспределение отдельно — снятую сумму и ` +
        `строку-приёмник; в самой строке план оставить исходным.`,
      actual: `снято ${moneyText(report.removedTotal)} тыс. руб. в ${report.cuts.length} правках плана`,
      expected: 'план строки остаётся исходным, перераспределение показано отдельной парой донор → приёмник',
    };
  },
};

// ============================================================
// ПРОВЕРКА 3: журнал правок книги почти не ведётся
// ============================================================

/** Ниже этого числа записей журнал книги считается слепым. */
export const JOURNAL_BLIND_MAX_ENTRIES = 100;

/** Порог размера листа, при котором молчание журнала уже о чём-то говорит. */
export const JOURNAL_BLIND_MIN_ROWS = 200;

export interface BlindJournalReport {
  journalEntryCount: number;
  rowCount: number;
  /** Записей журнала на сотню счётных строк — мера наблюдаемости. */
  entriesPerHundredRows: number;
}

/**
 * Журнал правок ведётся НЕРАВНОМЕРНО (замер 18.08 по дампам всех восьми книг):
 * УО 33 724 записи, УКСиМП 4 904, УД 568, УФБП 124, УАГЗО 70, УДТХ 34,
 * УЭР 31, УИО 13. Отсутствие следов у управления НЕ означает отсутствия
 * практики — это дыра наблюдаемости, и показывать её надо честно, иначе
 * молчание проверки «экономия растворена в плане» прочтут как «здесь чисто».
 */
export function detectBlindJournal(
  rowCount: number,
  journalEntryCount: number,
): BlindJournalReport | null {
  if (rowCount <= JOURNAL_BLIND_MIN_ROWS) return null;
  if (journalEntryCount >= JOURNAL_BLIND_MAX_ENTRIES) return null;
  return {
    journalEntryCount,
    rowCount,
    entriesPerHundredRows: (journalEntryCount / rowCount) * 100,
  };
}

const blindJournal: ValidationRule = {
  id: 'journal_provenance_blind',
  name: 'Журнал правок книги почти не ведётся',
  description:
    'Скрытый лист «_ChangeLog» книги содержит меньше сотни записей при листе ' +
    'больше двухсот строк. Провенанс плановых сумм по такой книге слепой: ' +
    'ретро-правки плана в ней не видны, и молчание проверки «экономия ' +
    'растворена в плане» означает отсутствие следов, а не отсутствие ' +
    'практики. Информационная карточка уровня книги (канон п.102).',
  severity: 'info',
  origin: 'bi_heuristic',
  scope: 'department',
  params: {},
  check(ctx: RuleCheckContext): RuleCheckResult {
    if (!ctx.allRows || ctx.allRows.length === 0) return { passed: true };
    const anchor = sheetAnchor(ctx.allRows);
    if (anchor === null || ctx.rowIndex !== anchor) return { passed: true };

    const prov = readProvenance(ctx);
    // Счётчик не подключён — сказать нечего: «нет данных» и «нет записей» это
    // разные состояния, и путать их значит врать о провенансе.
    if (!prov) return { passed: true };

    const rowCount = countedRows(ctx.allRows).length;
    const report = detectBlindJournal(rowCount, prov.journalEntryCount);
    if (!report) return { passed: true };

    const book = prov.bookTitle ? `Книга «${prov.bookTitle}»` : 'Эта книга';
    return {
      passed: false,
      message:
        `${book}: журнал правок («_ChangeLog») хранит ${report.journalEntryCount} ` +
        `записей на ${report.rowCount} счётных строк листа — история правок ` +
        `практически не ведётся. Что это значит: провенанс плановых сумм по ` +
        `книге слепой. Снижение плана задним числом — способ, которым экономия ` +
        `уходит из план−факт (канон п.102), — по этой книге не отслеживается, ` +
        `поэтому молчание проверки «экономия растворена в плане» здесь читается ` +
        `как «следов нет», а не как «практики нет». Для сравнения: у УО журнал ` +
        `несёт 33 724 записи, у УКСиМП — 4 904. ` +
        `Действие: включить ведение журнала правок в книге (надстройка пишет ` +
        `лист «_ChangeLog»); до тех пор сверять план с НМЦК процедуры по книге ` +
        `мониторинга — это второй, независимый источник провенанса.`,
      actual: `${report.journalEntryCount} записей журнала на ${report.rowCount} строк`,
      expected: 'журнал правок ведётся: каждая правка ячейки оставляет след «было → стало → момент → автор»',
    };
  },
};

// ============================================================
// Экспорт
// ============================================================

/**
 * Правила плановой целостности (канон п.102). Подключение к RULE_BOOK —
 * отдельным решением: проверки 2 и 3 работают только когда в контексте есть
 * провенанс книги (`withPlanProvenance`), без него они молчат.
 */
export const PLAN_INTEGRITY_RULES: ValidationRule[] = [
  rublesLikeAmount, // 1 — рубли вместо тысяч (живой случай УО H28, 05.08.2026)
  dissolvedEconomy, // 2 — ретро-снижение плана под факт (УКСиМП 112, УО 192, УД 33)
  blindJournal,     // 3 — журнал почти не ведётся (УДТХ 34, УЭР 31, УИО 13)
];

/**
 * Готовые записи реестра проверок под эти правила: подключающая сторона
 * добавляет их в CHECK_REGISTRY, иначе карточки останутся без kbHint и
 * без веса в доверии (validate.ts берёт метаданные по checkId).
 */
export const PLAN_INTEGRITY_CHECKS: CheckRegistryEntry[] = [
  {
    id: 'plan_units_rubles',
    group: 'data_integrity',
    name: 'Сумма похожа на рубли, а книга ведётся в тысячах',
    description:
      'Суммы книг ГРБС ведутся в тысячах рублей. Значение, набранное в рублях, завышает строку и весь свод ровно в тысячу раз. Отбор: сумма на два порядка выше медианы листа либо больше 100 млн руб. на одну строку; копеечный хвост подтверждает масштаб, но сам поводом не бывает.',
    severity: 'error',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint:
      'Живой случай (журнал УО, канон п.102): H28 = 34 975 002,17 вместо 34 975,00, исправлено самим управлением 05.08.2026. Такая ячейка не только раздувает строку — она поднимает итог управления и весь свод района, и «экономия» по строке становится величиной, которой не существует.',
    recommendation:
      'Проверить единицу измерения: значение похоже на рубли, а в книге суммы в тысячах. Пересчитать ячейку делением на тысячу и сверить с суммой заявки.',
    trustComponent: 'data_quality',
    sourceType: 'new',
  },
  {
    id: 'plan_economy_dissolved',
    group: 'financial',
    name: 'Экономия растворена в плане',
    description:
      'Плановая ячейка строки (H/I/J/K) снижена задним числом — после появления факта или даты заключения — и это не исправление единиц (~1000×). Снижение плана под факт делает экономию невидимой в план−факт, хотя деньги высвободились и перераспределены.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint:
      'Канон п.102: три семантики плановой суммы K — НМЦК неизменная (УАГЗО, УКСиМП, УД), НМЦК минус изъятое перераспределением (культура), распределяемый лимит (УДТХ). Дословно специалист УДТХ: «когда появляется экономия по какой-то закупке, я естественно снимаю лимиты с неё и перераспределяю их на следующую закупку». Отсюда замер витрины РАСЧЕТ: «УДТХ — нулевая экономия при 93,11 % конкурентных процедур». Ретро-снижения в журналах: УО 192 случая, УКСиМП 112 (6 693,57 тыс.), УД 33 (3 900,31 тыс.).',
    recommendation:
      'Показать перераспределение отдельно: снятую сумму и строку-приёмник; в самой строке план оставить исходным. Экономия по торгам честно считается только против НМЦК процедуры (книга мониторинга).',
    trustComponent: 'data_quality',
    sourceType: 'new',
  },
  {
    id: 'journal_provenance_blind',
    group: 'completeness',
    name: 'Журнал правок книги почти не ведётся',
    description:
      'Скрытый лист «_ChangeLog» книги содержит меньше сотни записей при листе больше двухсот строк. Провенанс плановых сумм по такой книге слепой: ретро-правки плана в ней не видны, и молчание проверки «экономия растворена в плане» означает отсутствие следов, а не отсутствие практики.',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint:
      'Замер 18.08 по дампам всех восьми книг: УО 33 724 записи, УКСиМП 4 904, УД 568, УФБП 124, УАГЗО 70, УДТХ 34, УЭР 31, УИО 13. Разброс в три порядка означает, что сравнивать управления по числу найденных ретро-правок нельзя — сравнивались бы журналы, а не практики.',
    recommendation:
      'Включить ведение журнала правок в книге (надстройка пишет лист «_ChangeLog»); до тех пор сверять план с НМЦК процедуры по книге мониторинга — это второй, независимый источник провенанса.',
    trustComponent: 'data_quality',
    sourceType: 'new',
  },
];
