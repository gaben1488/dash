/**
 * Из чего состоит ЕП и как он сокращается (канон п. 98ж, 18.08.2026).
 *
 * Идея руководства: «показывать, насколько меньше становится ЕП и особенно
 * НЕОБОСНОВАННОГО ЕП». Одна доля ЕП на это не отвечает — она смешивает
 * монополиста, которого конкурсом не заменить, и «сочли аукцион
 * нецелесообразным», который заменить можно. Модуль раскладывает объём
 * закупок у единственного поставщика на четыре степени обоснованности
 * (@aemr/shared/ep-justification-grade) и считает ту же раскладку по
 * кварталам — чтобы снижение было видно во времени, а не одной цифрой.
 *
 * Что здесь ЧЕСТНО, а что нет:
 *
 *   • Степень выводится ИЗ КЛАСТЕРА причины (колонка M через словарь
 *     ep-reason-clusters), а не из свободного текста (канон п. 27).
 *     Нераспознанная формулировка честно падает в «без обоснования»,
 *     а не угадывается.
 *   • Квартал строки берётся из столбца O (квартал ПЛАНА) — тем же
 *     правилом, каким кварталы считает расчётный движок (calc-engine,
 *     defaultQuarterExtractor). Иначе динамика этого блока спорила бы с
 *     долей ЕП соседнего блока той же вкладки. Строки с пустым O в
 *     динамику не попадают и считаются отдельно (`noQuarter`) — это
 *     оговорка методики, а не потеря.
 *   • Знаменатель доли ЕП — конкурентные строки того же периметра
 *     (счёт и деньги плана, колонка K). Строка без способа (L пуста) не
 *     идёт ни в числитель, ни в знаменатель: способ у неё не выбран.
 */

import {
  canonicalizeReasonEp,
  epGradeOfCluster,
  normalizeMethod,
  EP_REASON_DICT,
  type EpJustificationGrade,
  type EpReasonCluster,
} from '@aemr/shared';
import { sheetNumber } from '../timeline/row-timeline.js';

/** Строка книги ГРБС в том минимуме, который нужен разбору обоснований. */
export interface EpJustificationRow {
  /** Способ определения поставщика — сырая ячейка L. */
  method: unknown;
  /** Причина выбора ЕП — сырая ячейка M (толкуется только словарём). */
  reason: unknown;
  /** План итого, тыс. ₽ — ячейка K. */
  planTotal: number;
  /** Квартал плана 1..4 — ячейка O; null/вне диапазона = кварталa нет. */
  quarter: number | null;
}

/** Пара «строк и денег» — единица счёта всего модуля. */
export interface EpCell {
  rows: number;
  sum: number;
}

/** Свод одного периметра: ЕП по степеням + конкурентный знаменатель. */
export interface EpGradeBucket {
  byGrade: Record<EpJustificationGrade, EpCell>;
  /** Итог ЕП (сумма четырёх степеней). */
  ep: EpCell;
  /** Конкурентные закупки того же периметра — знаменатель доли ЕП. */
  competitive: EpCell;
}

/** Годовой свод управления: степени, кластеры и кварталы. */
export interface EpJustificationDept extends EpGradeBucket {
  /** Кластеры причин ЕП за год — «что именно писали» внутри степени. */
  byCluster: Record<string, EpCell>;
  /** Кварталы плана (O = 1..4). */
  quarters: Record<EpQuarterKey, EpGradeBucket>;
  /** Строки ЕП без квартала плана: в динамику не попадают, но в год входят. */
  noQuarter: EpCell;
}

export type EpQuarterKey = 'q1' | 'q2' | 'q3' | 'q4';

export const EP_QUARTER_KEYS: readonly EpQuarterKey[] = ['q1', 'q2', 'q3', 'q4'];

const GRADES: readonly EpJustificationGrade[] = [
  'lawful-exclusive',
  'verified-benefit',
  'discretionary',
  'unfounded',
];

const cell = (): EpCell => ({ rows: 0, sum: 0 });

const emptyByGrade = (): Record<EpJustificationGrade, EpCell> => ({
  'lawful-exclusive': cell(),
  'verified-benefit': cell(),
  discretionary: cell(),
  unfounded: cell(),
});

export function emptyEpGradeBucket(): EpGradeBucket {
  return { byGrade: emptyByGrade(), ep: cell(), competitive: cell() };
}

function emptyDept(): EpJustificationDept {
  return {
    ...emptyEpGradeBucket(),
    byCluster: {},
    quarters: {
      q1: emptyEpGradeBucket(),
      q2: emptyEpGradeBucket(),
      q3: emptyEpGradeBucket(),
      q4: emptyEpGradeBucket(),
    },
    noQuarter: cell(),
  };
}

function add(target: EpCell, sum: number): void {
  target.rows += 1;
  target.sum += sum;
}

/** Деньги строки: нечисло — ноль, счётчик строки всё равно засчитывается.
 * Разбор — единая коэрция ядра sheetNumber: прежний голый parseFloat не знал
 * пробелов-разрядов и запятой («1 234,5» → 1 — сумма худела в тысячу раз),
 * страж 29.08.2026. */
function money(v: unknown): number {
  return sheetNumber(v) ?? 0;
}

/** Квартал плана 1..4 либо null — тем же правилом, что у расчётного движка. */
export function epPlanQuarter(raw: unknown): number | null {
  const n = sheetNumber(raw);
  return n !== null && n >= 1 && n <= 4 ? Math.trunc(n) : null;
}

/**
 * Разбор строк ОДНОГО управления: степени, кластеры, кварталы.
 * Строка без опознанного способа (L пуста или мусор) не участвует ни в
 * числителе, ни в знаменателе — способа у неё нет, доля от неё не считается.
 */
export function buildEpJustificationDept(rows: readonly EpJustificationRow[]): EpJustificationDept {
  const out = emptyDept();
  for (const row of rows) {
    const method = normalizeMethod(row.method);
    if (method === undefined) continue;
    const sum = money(row.planTotal);
    const qk: EpQuarterKey | null = row.quarter !== null && row.quarter >= 1 && row.quarter <= 4
      ? (`q${Math.trunc(row.quarter)}` as EpQuarterKey)
      : null;

    if (method !== 'ЕП') {
      add(out.competitive, sum);
      if (qk) add(out.quarters[qk].competitive, sum);
      continue;
    }

    const cluster = canonicalizeReasonEp(row.reason).cluster;
    const { grade } = epGradeOfCluster(cluster);
    add(out.ep, sum);
    add(out.byGrade[grade], sum);
    if (!out.byCluster[cluster]) out.byCluster[cluster] = cell();
    add(out.byCluster[cluster]!, sum);
    if (qk) {
      add(out.quarters[qk].ep, sum);
      add(out.quarters[qk].byGrade[grade], sum);
    } else {
      add(out.noQuarter, sum);
    }
  }
  return out;
}

// ── Сложение периметров (управления, кварталы) ───────────────────

function mergeCell(a: EpCell, b: EpCell): EpCell {
  return { rows: a.rows + b.rows, sum: a.sum + b.sum };
}

/** Складывает своды нескольких периметров в один (ноль слагаемых → пустой). */
export function mergeEpGradeBuckets(parts: readonly EpGradeBucket[]): EpGradeBucket {
  const out = emptyEpGradeBucket();
  for (const p of parts) {
    for (const g of GRADES) out.byGrade[g] = mergeCell(out.byGrade[g], p.byGrade[g]);
    out.ep = mergeCell(out.ep, p.ep);
    out.competitive = mergeCell(out.competitive, p.competitive);
  }
  return out;
}

/** Складывает словари кластеров нескольких управлений. */
export function mergeEpClusters(parts: readonly Record<string, EpCell>[]): Record<string, EpCell> {
  const out: Record<string, EpCell> = {};
  for (const p of parts) {
    for (const [k, v] of Object.entries(p)) {
      out[k] = out[k] ? mergeCell(out[k]!, v) : { ...v };
    }
  }
  return out;
}

// ── Производные величины для экрана ──────────────────────────────

/** Процент с одним знаком; знаменатель ноль — null, а не ноль процентов. */
function pct(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 1000) / 10;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Строка степени для карточки: деньги, счёт и доли внутри ЕП. */
export interface EpGradeSlice {
  grade: EpJustificationGrade;
  rows: number;
  sum: number;
  /** Доля денег степени внутри ЕП периметра. */
  moneyShare: number | null;
  /** Доля процедур степени внутри ЕП периметра. */
  countShare: number | null;
}

/** Свод для экрана: степени, «сокращаемый ЕП», доли ЕП в общем объёме. */
export interface EpJustificationSummary {
  grades: EpGradeSlice[];
  ep: EpCell;
  competitive: EpCell;
  /** Сокращаемый ЕП — решение заказчика плюс без обоснования. */
  reducible: EpCell;
  /** Его доля в деньгах ЕП. */
  reducibleShareOfEp: number | null;
  /** Его доля в деньгах ВСЕХ закупок периметра (ЕП + конкурентные). */
  reducibleShareOfAll: number | null;
  /** Доля ЕП в общем объёме — деньги и счёт процедур. */
  epShareMoney: number | null;
  epShareCount: number | null;
  /** Есть ли вообще счётные строки: иначе на экране честная пустота. */
  hasData: boolean;
}

export function summarizeEpGrades(bucket: EpGradeBucket): EpJustificationSummary {
  const epSum = bucket.ep.sum;
  const epRows = bucket.ep.rows;
  const allSum = epSum + bucket.competitive.sum;
  const allRows = epRows + bucket.competitive.rows;
  const reducible: EpCell = {
    rows: bucket.byGrade.discretionary.rows + bucket.byGrade.unfounded.rows,
    sum: round2(bucket.byGrade.discretionary.sum + bucket.byGrade.unfounded.sum),
  };
  return {
    grades: GRADES.map((grade) => ({
      grade,
      rows: bucket.byGrade[grade].rows,
      sum: round2(bucket.byGrade[grade].sum),
      moneyShare: pct(bucket.byGrade[grade].sum, epSum),
      countShare: pct(bucket.byGrade[grade].rows, epRows),
    })),
    ep: { rows: epRows, sum: round2(epSum) },
    competitive: { rows: bucket.competitive.rows, sum: round2(bucket.competitive.sum) },
    reducible,
    reducibleShareOfEp: pct(reducible.sum, epSum),
    reducibleShareOfAll: pct(reducible.sum, allSum),
    epShareMoney: pct(epSum, allSum),
    epShareCount: pct(epRows, allRows),
    hasData: allRows > 0,
  };
}

/** Точка динамики: квартал, доля ЕП и доля НЕобоснованного ЕП внутри него. */
export interface EpQuarterPoint {
  quarter: EpQuarterKey;
  /** 1..4 — для подписи «I квартал» на стороне экрана. */
  index: number;
  ep: EpCell;
  competitive: EpCell;
  reducible: EpCell;
  epShareMoney: number | null;
  epShareCount: number | null;
  /** Доля сокращаемого ЕП в ОБЩЕМ объёме квартала — главная линия снижения. */
  reducibleShareOfAll: number | null;
  /** Доля сокращаемого внутри ЕП квартала — качество самого ЕП. */
  reducibleShareOfEp: number | null;
  hasData: boolean;
}

export function epQuarterDynamics(
  quarters: Record<EpQuarterKey, EpGradeBucket>,
): EpQuarterPoint[] {
  return EP_QUARTER_KEYS.map((qk, i) => {
    const s = summarizeEpGrades(quarters[qk]);
    return {
      quarter: qk,
      index: i + 1,
      ep: s.ep,
      competitive: s.competitive,
      reducible: s.reducible,
      epShareMoney: s.epShareMoney,
      epShareCount: s.epShareCount,
      reducibleShareOfAll: s.reducibleShareOfAll,
      reducibleShareOfEp: s.reducibleShareOfEp,
      hasData: s.hasData,
    };
  });
}

/** Частая формулировка внутри степени — «что именно писали исполнители». */
export interface EpClusterSlice {
  cluster: string;
  /** Русская подпись кластера; неизвестный кластер объясняется словами. */
  label: string;
  grade: EpJustificationGrade;
  evidence: string;
  rows: number;
  sum: number;
}

/** Подпись нераспознанных и пустых причин — на экране нет латинских ключей. */
const SPECIAL_CLUSTER_LABELS: Readonly<Record<string, string>> = {
  EMPTY: 'Графа обоснования пуста',
  UNMAPPED: 'Формулировка не распознана справочником',
};

export function epClusterLabel(cluster: string): string {
  const special = SPECIAL_CLUSTER_LABELS[cluster];
  if (special) return special;
  const entry = EP_REASON_DICT[cluster as EpReasonCluster];
  return entry ? entry.label_ru : 'Формулировка не распознана справочником';
}

/**
 * Формулировки одной степени по убыванию денег. `limit` ограничивает список
 * на экране; итог степени берётся из свода, а не из этого среза.
 */
export function topClustersOfGrade(
  byCluster: Record<string, EpCell>,
  grade: EpJustificationGrade,
  limit = 4,
): EpClusterSlice[] {
  const out: EpClusterSlice[] = [];
  for (const [cluster, c] of Object.entries(byCluster)) {
    const g = epGradeOfCluster(cluster);
    if (g.grade !== grade) continue;
    out.push({
      cluster,
      label: epClusterLabel(cluster),
      grade,
      evidence: g.evidence,
      rows: c.rows,
      sum: round2(c.sum),
    });
  }
  out.sort((a, b) => b.sum - a.sum || b.rows - a.rows);
  return out.slice(0, limit);
}
