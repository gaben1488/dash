/**
 * Договор экрана «Мониторинг · Аналитика» с сервером: GET /api/monitoring/analytics
 * и GET /api/monitoring/match (канон п.101а — «своя аналитика, свои визуальные
 * метрики и графики; своя сверка и подтяжка к нашим данным»).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ДОПИСКА В `contract.ts`. Реестр и аналитика
 * приезжают ДВУМЯ разными запросами с разной судьбой: реестр читается всегда,
 * аналитика — тяжелее и может не подняться, а сверка с книгами ГРБС зависит
 * ещё и от того, прочитаны ли восемь чужих книг. Склеить их в один тип значило
 * бы уронить реестр из-за неподнятой сверки.
 *
 * ВХОД — `unknown`. Разбор оборонительный: раздела нет — раздел равен null, и
 * экран говорит «этого сервер ещё не отдаёт», а не рисует пустой график,
 * притворяющийся посчитанным. Числа читаются только числами: строка «—» из
 * книги становится null, а не нулём.
 *
 * ЧЕСТНАЯ ПУСТОТА ВМЕСТО НУЛЯ (п.36). Каждый процент и каждая сумма допускают
 * null. Ноль и «не посчитано» — разные новости: снижение ровно 0 % значит
 * «торги прошли без единого шага», а null значит «состоявшихся процедур в
 * знаменателе нет вовсе».
 *
 * ДЕНЬГИ — РУБЛИ. Книга мониторинга ведётся в рублях, книги управлений — в
 * тысячах. В сверке обе стороны уже приведены к рублям сервером, и подпись
 * единицы обязана стоять у каждой суммы на экране.
 */
import { fetchJSON } from '../../api';

// ── Мелкие оборонительные читалки ────────────────────────────────────
//
// Свои, а не общие с `contract.ts`: тот файл пишет соседний агент той же
// волны, и общий импорт связал бы два экрана одной правкой. Читалки
// тривиальны, дублирование здесь дешевле связанности.

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Число либо null. NaN и Infinity — не числа: их место в null. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Число с запасным значением — только там, где ноль содержателен (счётчики). */
function count(v: unknown): number {
  return num(v) ?? 0;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function strList(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

function bool(v: unknown): boolean {
  return v === true;
}

// ── Периметр ответа ──────────────────────────────────────────────────

export interface AnalyticsSource {
  bookName: string;
  /** Момент чтения книги (ISO) — плашка периода данных (п.58). */
  readAt: string;
  /** Единица денег ответа: у этой книги — рубли. */
  moneyUnit: string;
  sheetsRead: string[];
  /** Лист → русская причина отказа. Пусто — прочитано всё. */
  sheetsFailed: Record<string, string>;
}

function readSource(v: unknown): AnalyticsSource {
  const s = rec(v);
  const failed: Record<string, string> = {};
  for (const [k, val] of Object.entries(rec(s.sheetsFailed))) {
    if (typeof val === 'string') failed[k] = val;
  }
  return {
    bookName: str(s.bookName) ?? 'Ежедневный мониторинг',
    readAt: text(s.readAt),
    moneyUnit: str(s.moneyUnit) ?? 'руб',
    sheetsRead: strList(s.sheetsRead),
    sheetsFailed: failed,
  };
}

// ── §3.1. Воронка стадий ─────────────────────────────────────────────

export type FunnelStepKey = string;

export interface FunnelStep {
  key: FunnelStepKey;
  label: string;
  count: number;
  /** Конверсия из предыдущей ступени, %; у первой — null, и это не ноль. */
  conversionPct: number | null;
  /** Оговорка ядра, когда ступень заполнена полнее предыдущей. */
  note: string | null;
}

export interface StageFunnelData {
  total: number;
  steps: FunnelStep[];
  reachedPriced: number;
  reachedPricedPct: number | null;
}

function readFunnel(v: unknown): StageFunnelData {
  const f = rec(v);
  return {
    total: count(f.total),
    steps: arr(f.steps).map((x): FunnelStep => {
      const s = rec(x);
      return {
        key: text(s.key),
        label: text(s.label),
        count: count(s.count),
        conversionPct: num(s.conversionPct),
        note: str(s.note),
      };
    }).filter((s) => s.key !== ''),
    reachedPriced: count(f.reachedPriced),
    reachedPricedPct: num(f.reachedPricedPct),
  };
}

// ── §3.2. Три коэффициента снижения ──────────────────────────────────

/**
 * Три числа с ТРЕМЯ РАЗНЫМИ знаменателями. Их нельзя показывать по одному и
 * нельзя подменять друг другом: портфельный делит деньги на деньги, средний
 * построчный — проценты на число процедур, третий — только на те процедуры,
 * где снижение вообще было. Разрыв между ними велик не от ошибки счёта, а от
 * того, что у почти половины состоявшихся процедур цена в точности равна
 * начальной.
 */
export interface ReductionCoefficients {
  portfolioPct: number | null;
  portfolio: {
    count: number;
    nmckRub: number;
    priceRub: number;
    savingsRub: number;
  };
  rowMeanPct: number | null;
  rowMedianPct: number | null;
  rowCount: number;
  reducedMeanPct: number | null;
  reducedMedianPct: number | null;
  reducedQ1Pct: number | null;
  reducedQ3Pct: number | null;
  reducedCount: number;
  /** Цена в точности равна НМЦК — торги без единого шага снижения. */
  equalPriceCount: number;
  equalPriceSharePct: number | null;
}

function readReduction(v: unknown): ReductionCoefficients {
  const r = rec(v);
  const p = rec(r.portfolio);
  return {
    portfolioPct: num(r.portfolioPct),
    portfolio: {
      count: count(p.count),
      nmckRub: count(p.nmckRub),
      priceRub: count(p.priceRub),
      savingsRub: count(p.savingsRub),
    },
    rowMeanPct: num(r.rowMeanPct),
    rowMedianPct: num(r.rowMedianPct),
    rowCount: count(r.rowCount),
    reducedMeanPct: num(r.reducedMeanPct),
    reducedMedianPct: num(r.reducedMedianPct),
    reducedQ1Pct: num(r.reducedQ1Pct),
    reducedQ3Pct: num(r.reducedQ3Pct),
    reducedCount: count(r.reducedCount),
    equalPriceCount: count(r.equalPriceCount),
    equalPriceSharePct: num(r.equalPriceSharePct),
  };
}

// ── §3.2. Гистограмма снижения ───────────────────────────────────────

export interface DiscountBucket {
  key: string;
  label: string;
  fromPct: number;
  toPct: number | null;
  count: number;
  nmckRub: number;
  priceRub: number;
}

function readHistogram(v: unknown): DiscountBucket[] {
  return arr(v).map((x): DiscountBucket => {
    const b = rec(x);
    return {
      key: text(b.key),
      label: text(b.label),
      fromPct: count(b.fromPct),
      toPct: num(b.toPct),
      count: count(b.count),
      nmckRub: count(b.nmckRub),
      priceRub: count(b.priceRub),
    };
  }).filter((b) => b.key !== '');
}

// ── §3.3. Поставщики и концентрация ──────────────────────────────────

export interface SupplierRow {
  key: string;
  inn: string | null;
  name: string;
  wins: number;
  moneyRub: number;
  depts: string[];
  customers: string[];
}

export interface SupplierConcentration {
  top5WinsPct: number | null;
  top10WinsPct: number | null;
  top5MoneyPct: number | null;
  top10MoneyPct: number | null;
}

export interface SupplierProfile {
  suppliers: SupplierRow[];
  uniqueCount: number;
  totalWins: number;
  totalMoneyRub: number;
  singleWinCount: number;
  singleWinSharePct: number | null;
  concentration: SupplierConcentration;
  /** Победы без ИНН: группировка по имени менее надёжна — сказать вслух. */
  winsWithoutInn: number;
}

function readSuppliers(v: unknown): SupplierProfile {
  const s = rec(v);
  const c = rec(s.concentration);
  return {
    suppliers: arr(s.suppliers).map((x): SupplierRow => {
      const r = rec(x);
      return {
        key: text(r.key),
        inn: str(r.inn),
        name: text(r.name),
        wins: count(r.wins),
        moneyRub: count(r.moneyRub),
        depts: strList(r.depts),
        customers: strList(r.customers),
      };
    }).filter((r) => r.key !== ''),
    uniqueCount: count(s.uniqueCount),
    totalWins: count(s.totalWins),
    totalMoneyRub: count(s.totalMoneyRub),
    singleWinCount: count(s.singleWinCount),
    singleWinSharePct: num(s.singleWinSharePct),
    concentration: {
      top5WinsPct: num(c.top5WinsPct),
      top10WinsPct: num(c.top10WinsPct),
      top5MoneyPct: num(c.top5MoneyPct),
      top10MoneyPct: num(c.top10MoneyPct),
    },
    winsWithoutInn: count(s.winsWithoutInn),
  };
}

/** Повторяющаяся связка «поставщик ↔ заказчик»: факт о рынке, не обвинение. */
export interface SupplierCustomerPair {
  supplierKey: string;
  supplierName: string;
  inn: string | null;
  customer: string;
  wins: number;
  moneyRub: number;
  /** Предметы закупок этой пары — механизм объясняет сам себя (п.104). */
  subjects: string[];
}

function readPairs(v: unknown): SupplierCustomerPair[] {
  return arr(v).map((x): SupplierCustomerPair => {
    const p = rec(x);
    return {
      supplierKey: text(p.supplierKey),
      supplierName: text(p.supplierName),
      inn: str(p.inn),
      customer: text(p.customer),
      wins: count(p.wins),
      moneyRub: count(p.moneyRub),
      subjects: strList(p.subjects),
    };
  }).filter((p) => p.supplierKey !== '');
}

// ── §3.4. Сроки этапов ───────────────────────────────────────────────

export interface DurationOutlier {
  sheet: string;
  row: number;
  code: string | null;
  days: number;
  /** 'negative' — торги раньше публикации; 'long' — хвост распределения. */
  reason: string;
}

export interface DurationStats {
  key: string;
  label: string;
  count: number;
  medianDays: number | null;
  meanDays: number | null;
  minDays: number | null;
  maxDays: number | null;
  q1Days: number | null;
  q3Days: number | null;
  negativeCount: number;
  outliers: DurationOutlier[];
}

function readDurations(v: unknown): DurationStats[] {
  return arr(v).map((x): DurationStats => {
    const d = rec(x);
    return {
      key: text(d.key),
      label: text(d.label),
      count: count(d.count),
      medianDays: num(d.medianDays),
      meanDays: num(d.meanDays),
      minDays: num(d.minDays),
      maxDays: num(d.maxDays),
      q1Days: num(d.q1Days),
      q3Days: num(d.q3Days),
      negativeCount: count(d.negativeCount),
      outliers: arr(d.outliers).map((y): DurationOutlier => {
        const o = rec(y);
        return {
          sheet: text(o.sheet),
          row: count(o.row),
          code: str(o.code),
          days: count(o.days),
          reason: text(o.reason),
        };
      }),
    };
  }).filter((d) => d.key !== '');
}

// ── §3.5. Сезонность ─────────────────────────────────────────────────

export interface SeasonPoint {
  /** «2026-03» для месяца, «2026-I» для квартала. */
  period: string;
  count: number;
  nmckRub: number;
  priceRub: number;
}

export interface Seasonality {
  /** По какой дате построена: подмена основания меняет картину. */
  basis: string;
  months: SeasonPoint[];
  quarters: SeasonPoint[];
  /** Строк без выбранной даты — счёт объявляется неполным честно. */
  undated: number;
}

function readSeasonPoints(v: unknown): SeasonPoint[] {
  return arr(v).map((x): SeasonPoint => {
    const p = rec(x);
    return {
      period: text(p.period),
      count: count(p.count),
      nmckRub: count(p.nmckRub),
      priceRub: count(p.priceRub),
    };
  }).filter((p) => p.period !== '');
}

function readSeasonality(v: unknown): Seasonality {
  const s = rec(v);
  return {
    basis: str(s.basis) ?? 'publication',
    months: readSeasonPoints(s.months),
    quarters: readSeasonPoints(s.quarters),
    undated: count(s.undated),
  };
}

// ── §2.6. Корзины НМЦК ───────────────────────────────────────────────

export interface NmckBucket {
  key: string;
  label: string;
  count: number;
  nmckRub: number;
  /** Портфельное снижение внутри корзины, %. */
  reductionPct: number | null;
}

function readNmckBuckets(v: unknown): NmckBucket[] {
  return arr(v).map((x): NmckBucket => {
    const b = rec(x);
    return {
      key: text(b.key),
      label: text(b.label),
      count: count(b.count),
      nmckRub: count(b.nmckRub),
      reductionPct: num(b.reductionPct),
    };
  }).filter((b) => b.key !== '');
}

// ── §3.7. Сравнение управлений ───────────────────────────────────────

export interface DeptComparisonRow {
  dept: string;
  sheet: string;
  count: number;
  nmckRub: number;
  priceRub: number;
  savingsBookRub: number;
  reductionPct: number | null;
  withReductionSharePct: number | null;
  noResultSharePct: number | null;
  medianTotalDays: number | null;
  controlErrorSharePct: number | null;
  splitMissingSharePct: number | null;
}

function readDepts(v: unknown): DeptComparisonRow[] {
  return arr(v).map((x): DeptComparisonRow => {
    const d = rec(x);
    return {
      dept: text(d.dept),
      sheet: text(d.sheet),
      count: count(d.count),
      nmckRub: count(d.nmckRub),
      priceRub: count(d.priceRub),
      savingsBookRub: count(d.savingsBookRub),
      reductionPct: num(d.reductionPct),
      withReductionSharePct: num(d.withReductionSharePct),
      noResultSharePct: num(d.noResultSharePct),
      medianTotalDays: num(d.medianTotalDays),
      controlErrorSharePct: num(d.controlErrorSharePct),
      splitMissingSharePct: num(d.splitMissingSharePct),
    };
  }).filter((d) => d.dept !== '');
}

// ── §3.6, §3.8. Несостоявшиеся и аномалии ────────────────────────────

export interface UnsuccessfulProcedures {
  count: number;
  sharePct: number | null;
  nmckRub: number;
  byDept: Array<{ dept: string; count: number; nmckRub: number }>;
  /** Тексты исходов из ячейки победителя и их частота. */
  outcomes: Array<{ text: string; count: number }>;
}

function readUnsuccessful(v: unknown): UnsuccessfulProcedures {
  const u = rec(v);
  return {
    count: count(u.count),
    sharePct: num(u.sharePct),
    nmckRub: count(u.nmckRub),
    byDept: arr(u.byDept).map((x) => {
      const d = rec(x);
      return { dept: text(d.dept), count: count(d.count), nmckRub: count(d.nmckRub) };
    }).filter((d) => d.dept !== ''),
    outcomes: arr(u.outcomes).map((x) => {
      const o = rec(x);
      return { text: text(o.text), count: count(o.count) };
    }).filter((o) => o.text !== ''),
  };
}

export interface AnomalyRef {
  sheet: string;
  row: number;
  code: string | null;
  note: string;
}

/** Карточка диагноста: механизм · адреса · действие (п.53). */
export interface AnomalyGroup {
  kind: string;
  title: string;
  mechanism: string;
  action: string;
  count: number;
  refs: AnomalyRef[];
}

function readAnomalies(v: unknown): AnomalyGroup[] {
  return arr(v).map((x): AnomalyGroup => {
    const g = rec(x);
    return {
      kind: text(g.kind),
      title: text(g.title),
      mechanism: text(g.mechanism),
      action: text(g.action),
      count: count(g.count),
      refs: arr(g.refs).map((y): AnomalyRef => {
        const r = rec(y);
        return {
          sheet: text(r.sheet),
          row: count(r.row),
          code: str(r.code),
          note: text(r.note),
        };
      }),
    };
  }).filter((g) => g.kind !== '');
}

// ── Целый ответ аналитики ────────────────────────────────────────────

export interface MonitoringAnalytics {
  funnel: StageFunnelData;
  reduction: ReductionCoefficients;
  histogram: DiscountBucket[];
  suppliers: SupplierProfile;
  pairs: SupplierCustomerPair[];
  durations: DurationStats[];
  seasonality: Seasonality;
  nmckBuckets: NmckBucket[];
  depts: DeptComparisonRow[];
  unsuccessful: UnsuccessfulProcedures;
  anomalies: AnomalyGroup[];
}

export interface AnalyticsPayload {
  source: AnalyticsSource;
  analytics: MonitoringAnalytics;
  notes: string[];
}

export function normalizeAnalytics(raw: unknown): AnalyticsPayload {
  const r = rec(raw);
  const a = rec(r.analytics);
  return {
    source: readSource(r.source),
    analytics: {
      funnel: readFunnel(a.funnel),
      reduction: readReduction(a.reduction),
      histogram: readHistogram(a.histogram),
      suppliers: readSuppliers(a.suppliers),
      pairs: readPairs(a.pairs),
      durations: readDurations(a.durations),
      seasonality: readSeasonality(a.seasonality),
      nmckBuckets: readNmckBuckets(a.nmckBuckets),
      depts: readDepts(a.depts),
      unsuccessful: readUnsuccessful(a.unsuccessful),
      anomalies: readAnomalies(a.anomalies),
    },
    notes: strList(r.notes),
  };
}

/** По какой дате строить сезонность — выбор читателя, а не умолчание экрана. */
export type SeasonBasis = 'publication' | 'auction';

export async function fetchMonitoringAnalytics(
  basis: SeasonBasis = 'publication',
): Promise<AnalyticsPayload> {
  const raw = await fetchJSON<unknown>(`/monitoring/analytics?basis=${basis}`);
  return normalizeAnalytics(raw);
}

// ── §4. Сверка с книгами ГРБС ────────────────────────────────────────
//
// Ответ роута сверки — не плоский список, а пять разных исходов, и это
// содержательно: «пары нет в мониторинге» и «один код в двух книгах» —
// разные новости с разными действиями. Экран показывает классы отдельно, а
// внутри класса — адреса ОБЕИХ сторон.

/** Сравнение одной суммы: сторона книги, сторона мониторинга и разрыв. */
export interface MoneyComparison {
  bookRub: number | null;
  monitoringRub: number | null;
  deltaRub: number | null;
  /** Относительный разрыв, доля (0,012 — это 1,2 %). */
  relDiff: number | null;
  /** null — сравнивать нечего: одной из сторон нет. */
  agrees: boolean | null;
}

function readMoney(v: unknown): MoneyComparison {
  const m = rec(v);
  return {
    bookRub: num(m.bookRub),
    monitoringRub: num(m.monitoringRub),
    deltaRub: num(m.deltaRub),
    relDiff: num(m.relDiff),
    agrees: typeof m.agrees === 'boolean' ? m.agrees : null,
  };
}

export interface MatchSummary {
  bookRowsWithCode: number;
  proceduresWithCode: number;
  matched: number;
  bookOnly: number;
  monitoringOnly: number;
  ambiguousAcrossBooks: number;
  ambiguousSameBook: number;
  listCells: number;
  /** Доля кодов мониторинга, нашедших пару, %. */
  coveragePct: number | null;
  nmckAgree: number;
  nmckDisagree: number;
  nmckNoComparison: number;
  factAgree: number;
  factDisagree: number;
  factNoComparison: number;
}

function readSummary(v: unknown): MatchSummary {
  const s = rec(v);
  return {
    bookRowsWithCode: count(s.bookRowsWithCode),
    proceduresWithCode: count(s.proceduresWithCode),
    matched: count(s.matched),
    bookOnly: count(s.bookOnly),
    monitoringOnly: count(s.monitoringOnly),
    ambiguousAcrossBooks: count(s.ambiguousAcrossBooks),
    ambiguousSameBook: count(s.ambiguousSameBook),
    listCells: count(s.listCells),
    coveragePct: num(s.coveragePct),
    nmckAgree: count(s.nmckAgree),
    nmckDisagree: count(s.nmckDisagree),
    nmckNoComparison: count(s.nmckNoComparison),
    factAgree: count(s.factAgree),
    factDisagree: count(s.factDisagree),
    factNoComparison: count(s.factNoComparison),
  };
}

/** Сошедшаяся пара: код, адрес книги ГРБС, адрес листа мониторинга, две суммы. */
export interface MatchedPair {
  code: string;
  /** Короткое имя книги управления («УО») и строка её листа. */
  book: string;
  bookRowKey: string;
  /** Лист мониторинга и ключ строки «лист:строка». */
  sheet: string;
  procKey: string;
  nmck: MoneyComparison;
  fact: MoneyComparison;
}

function readMatched(v: unknown): MatchedPair[] {
  return arr(v).map((x): MatchedPair => {
    const m = rec(x);
    const bookRow = rec(m.bookRow);
    const primary = rec(m.primary);
    return {
      code: text(m.code),
      book: text(bookRow.book),
      bookRowKey: text(bookRow.rowKey),
      sheet: text(primary.sheet),
      procKey: text(primary.procKey),
      nmck: readMoney(m.nmck),
      fact: readMoney(m.fact),
    };
  }).filter((m) => m.code !== '');
}

/** Код без пары — с той стороны, где он есть. */
export interface UnmatchedCode {
  code: string;
  /** Адреса стороны, где код найден: «УО:214» либо «8. УО:100». */
  addresses: string[];
}

function readBookOnly(v: unknown): UnmatchedCode[] {
  return arr(v).map((x): UnmatchedCode => {
    const b = rec(x);
    const row = rec(b.bookRow);
    return { code: text(b.code), addresses: [text(row.rowKey)].filter((a) => a !== '') };
  }).filter((b) => b.code !== '');
}

function readMonitoringOnly(v: unknown): UnmatchedCode[] {
  return arr(v).map((x): UnmatchedCode => {
    const m = rec(x);
    return {
      code: text(m.code),
      addresses: arr(m.procedures).map((p) => text(rec(p).procKey)).filter((a) => a !== ''),
    };
  }).filter((m) => m.code !== '');
}

/** Один код у нескольких строк: в разных книгах — норма, в одной — аномалия. */
export interface AmbiguousCode {
  code: string;
  bookAddresses: string[];
  procedureAddresses: string[];
  /** true — обе строки в ОДНОЙ книге: это уже не совместная закупка. */
  sameBook: boolean;
}

function readAmbiguous(v: unknown): AmbiguousCode[] {
  return arr(v).map((x): AmbiguousCode => {
    const a = rec(x);
    return {
      code: text(a.code),
      bookAddresses: arr(a.bookRows).map((r) => text(rec(r).rowKey)).filter((s) => s !== ''),
      procedureAddresses: arr(a.procedures).map((r) => text(rec(r).procKey)).filter((s) => s !== ''),
      sameBook: bool(a.sameBook),
    };
  }).filter((a) => a.code !== '');
}

/** Ячейка со списком кодов: парная сверка сумм по ней невозможна. */
export interface ListCellRow {
  address: string;
  codes: string[];
  missingInMonitoring: string[];
}

function readListCells(v: unknown): ListCellRow[] {
  return arr(v).map((x): ListCellRow => {
    const l = rec(x);
    return {
      address: text(rec(l.bookRow).rowKey),
      codes: strList(l.codes),
      missingInMonitoring: strList(l.missingInMonitoring),
    };
  }).filter((l) => l.address !== '');
}

/** Сторона внутренней сверки: лист управления либо переходящий реестр. */
export interface InternalSideRow {
  sheet: string;
  row: number;
  nmckRub: number | null;
  priceRub: number | null;
}

export interface InternalDiffRow {
  code: string;
  /** 'sums-differ' | 'sheets-only' | 'journal-only'. */
  kind: string;
  sheetRows: InternalSideRow[];
  journalRows: InternalSideRow[];
  nmckDeltaRub: number | null;
  priceDeltaRub: number | null;
  /** Совместная закупка: доли управлений против целого в журнале. */
  joint: boolean;
  note: string;
}

function readSide(v: unknown): InternalSideRow[] {
  return arr(v).map((x): InternalSideRow => {
    const s = rec(x);
    return {
      sheet: text(s.sheet),
      row: count(s.row),
      nmckRub: num(s.nmckRub),
      priceRub: num(s.priceRub),
    };
  });
}

export interface InternalDiff {
  codesOnSheets: number;
  codesInJournal: number;
  codesInBoth: number;
  rows: InternalDiffRow[];
  counts: Record<string, number>;
}

function readInternal(v: unknown): InternalDiff {
  const i = rec(v);
  const counts: Record<string, number> = {};
  for (const [k, val] of Object.entries(rec(i.counts))) {
    const n = num(val);
    if (n !== null) counts[k] = n;
  }
  return {
    codesOnSheets: count(i.codesOnSheets),
    codesInJournal: count(i.codesInJournal),
    codesInBoth: count(i.codesInBoth),
    rows: arr(i.rows).map((x): InternalDiffRow => {
      const r = rec(x);
      return {
        code: text(r.code),
        kind: text(r.kind),
        sheetRows: readSide(r.sheetRows),
        journalRows: readSide(r.journalRows),
        nmckDeltaRub: num(r.nmckDeltaRub),
        priceDeltaRub: num(r.priceDeltaRub),
        joint: bool(r.joint),
        note: text(r.note),
      };
    }).filter((r) => r.code !== ''),
    counts,
  };
}

export interface MatchViewPayload {
  source: AnalyticsSource;
  /** Какие книги управлений прочитаны и сколько их строк несут код. */
  books: { read: string[]; rowsWithCode: number };
  summary: MatchSummary;
  matched: MatchedPair[];
  bookOnly: UnmatchedCode[];
  monitoringOnly: UnmatchedCode[];
  ambiguous: AmbiguousCode[];
  listCells: ListCellRow[];
  internal: InternalDiff;
  notes: string[];
}

export function normalizeMatchView(raw: unknown): MatchViewPayload {
  const r = rec(raw);
  const books = rec(r.books);
  return {
    source: readSource(r.source),
    books: { read: strList(books.read), rowsWithCode: count(books.rowsWithCode) },
    summary: readSummary(r.summary),
    matched: readMatched(r.matched),
    bookOnly: readBookOnly(r.bookOnly),
    monitoringOnly: readMonitoringOnly(r.monitoringOnly),
    ambiguous: readAmbiguous(r.ambiguous),
    listCells: readListCells(r.listCells),
    internal: readInternal(r.internal),
    notes: strList(r.notes),
  };
}

/**
 * Сверка отдельным запросом и отдельной судьбой: её роут может быть не поднят
 * либо книги управлений не прочитаны — и это не повод не показать аналитику.
 * Отказ возвращается словами, а не молчанием.
 */
export async function fetchMonitoringMatchView(): Promise<MatchViewPayload> {
  const raw = await fetchJSON<unknown>('/monitoring/match');
  return normalizeMatchView(raw);
}
