/**
 * Row-by-row Recalculation Engine
 * Independently recalculates metrics from department sheet rows,
 * producing values comparable to official summary cells in СВОД ТД-ПМ.
 *
 * Column mapping (0-indexed):
 *   A=0 (ID), B=1, C=2, D=3, E=4, F=5 (type), G=6 (subject),
 *   H=7 (FB plan), I=8 (KB plan), J=9 (MB plan), K=10 (total plan),
 *   L=11 (method), M=12, N=13 (plan date), O=14 (plan quarter),
 *   P=15, Q=16 (fact date), R=17 (fact quarter), S=18, T=19,
 *   U=20 (status), V=21 (FB fact), W=22 (KB fact), X=23 (MB fact),
 *   Y=24 (total fact), Z=25, AA=26, AB=27 (MB economy), AC=28,
 *   AD=29 (flag), AE=30 (comment GRBS), AF=31 (comment UER)
 */

import { DEPT_COLUMNS } from '@aemr/shared';

// Alias for brevity within this module
const COL = {
  A: DEPT_COLUMNS.ID,
  B: DEPT_COLUMNS.REG_NUMBER,
  C: DEPT_COLUMNS.SUBORDINATE,
  D: DEPT_COLUMNS.DESCRIPTION,
  E: DEPT_COLUMNS.PROGRAM_NAME,
  F: DEPT_COLUMNS.TYPE,
  G: DEPT_COLUMNS.SUBJECT,
  H: DEPT_COLUMNS.FB_PLAN,
  I: DEPT_COLUMNS.KB_PLAN,
  J: DEPT_COLUMNS.MB_PLAN,
  K: DEPT_COLUMNS.TOTAL_PLAN,
  L: DEPT_COLUMNS.METHOD,
  N: DEPT_COLUMNS.PLAN_DATE,
  O: DEPT_COLUMNS.PLAN_QUARTER,
  P: DEPT_COLUMNS.PLAN_YEAR,
  Q: DEPT_COLUMNS.FACT_DATE,
  R: DEPT_COLUMNS.FACT_QUARTER,
  S: DEPT_COLUMNS.FACT_YEAR,
  V: DEPT_COLUMNS.FB_FACT,
  W: DEPT_COLUMNS.KB_FACT,
  X: DEPT_COLUMNS.MB_FACT,
  Y: DEPT_COLUMNS.TOTAL_FACT,
  Z: DEPT_COLUMNS.ECONOMY_FB,
  AA: DEPT_COLUMNS.ECONOMY_KB,
  AB: DEPT_COLUMNS.ECONOMY_MB,
  AD: DEPT_COLUMNS.FLAG,
} as const;

// ── Interfaces ────────────────────────────────────────────────────

export interface QuarterMetrics {
  planCount: number;
  factCount: number;
  planFB: number;
  planKB: number;
  planMB: number;
  planTotal: number;
  factFB: number;
  factKB: number;
  factMB: number;
  factTotal: number;
  /** Economy total (ФБ+КБ+МБ) — formerly misnamed economyMB */
  economyTotal: number;
  /** Economy per-budget breakdown */
  economyFB: number;
  economyKB: number;
  economyMB: number;
  executionPct: number;
  /** Execution % by count: fact_count / plan_count (ГЛАВНЫЙ KPI — G-column СВОД) */
  execCountPct: number;
  /** Competitive execution by count: comp_fact_count / competitive_count */
  compExecCountPct: number;
  /** EP execution by count: ep_fact_count / ep_count */
  epExecCountPct: number;

  competitive: {
    plan: number; fact: number; planSum: number; factSum: number;
    planFB: number; planKB: number; planMB: number;
    factFB: number; factKB: number; factMB: number;
    economyTotal: number;
    economyFB: number; economyKB: number; economyMB: number;
  };
  ep: {
    plan: number; fact: number; planSum: number; factSum: number;
    planFB: number; planKB: number; planMB: number;
    factFB: number; factKB: number; factMB: number;
    economyTotal: number;
    economyFB: number; economyKB: number; economyMB: number;
  };
}

/** Per-activity metrics with per-budget breakdown */
export interface ActivityMetrics {
  planCount: number;
  factCount: number;
  planTotal: number;
  factTotal: number;
  planFB: number;
  planKB: number;
  planMB: number;
  factFB: number;
  factKB: number;
  factMB: number;
  economyFB: number;
  economyKB: number;
  economyMB: number;
  economyTotal: number;
  execCountPct: number;
}

/** Activity-type breakdown: program / current_program / current_non_program */
export interface ActivityBreakdown {
  program: ActivityMetrics;
  current_program: ActivityMetrics;
  current_non_program: ActivityMetrics;
}

/** Period-level metrics for subordinate drill-down (quarter/month/method) */
export interface SubPeriodMetrics {
  planCount: number;
  factCount: number;
  planTotal: number;
  factTotal: number;
  planFB: number;
  planKB: number;
  planMB: number;
  factFB: number;
  factKB: number;
  factMB: number;
  economyTotal: number;
  economyFB: number;
  economyKB: number;
  economyMB: number;
  executionPct: number;
  execCountPct: number;
}

/** Subordinate organization summary metrics */
export interface SubordinateMetrics {
  name: string;
  rowCount: number;
  planTotal: number;
  factTotal: number;
  planFB: number;
  planKB: number;
  planMB: number;
  factFB: number;
  factKB: number;
  factMB: number;
  executionPct: number;
  /** Execution by count: fact_count / plan_count */
  execCountPct: number;
  competitiveCount: number;
  epCount: number;
  economyTotal: number;
  economyFB: number;
  economyKB: number;
  economyMB: number;
  /** Per-quarter breakdown (q1..q4) */
  quarters: Record<string, SubPeriodMetrics>;
  /** Per-month breakdown (1..12) */
  months: Record<number, SubPeriodMetrics>;
  /** By method (competitive / ep) */
  byMethod: { competitive: SubPeriodMetrics; ep: SubPeriodMetrics };
  /** By activity type */
  byActivity: { program: SubPeriodMetrics; current_program: SubPeriodMetrics; current_non_program: SubPeriodMetrics };
}

export interface RecalculatedMetrics {
  department: string;

  /** Competitive-method count (ЭА + ЭК + ЭЗК) for the year */
  totalCompetitive: number;
  /** Sole-source count (ЕП) for the year */
  totalEP: number;

  quarters: {
    q1: QuarterMetrics;
    q2: QuarterMetrics;
    q3: QuarterMetrics;
    q4: QuarterMetrics;
  };

  /** Monthly metrics (1-12). Derived from plan date (column N). */
  months: Record<number, QuarterMetrics>;

  year: {
    planCount: number;
    factCount: number;
    planFB: number;
    planKB: number;
    planMB: number;
    planTotal: number;
    factFB: number;
    factKB: number;
    factMB: number;
    factTotal: number;
    economyTotal: number;
    economyFB: number;
    economyKB: number;
    economyMB: number;
    executionPct: number;
    execCountPct: number;
    compExecCountPct: number;
    epExecCountPct: number;
  };

  /** ЕП share as % of total procedures */
  epSharePct: number;

  /** Number of data rows that passed the classification filter */
  dataRowCount: number;

  /** Breakdown by activity type (Программная / Текущая) per quarter */
  byActivity: Record<string, ActivityBreakdown>;

  /** Breakdown by subordinate organization (column C) */
  bySubordinate: SubordinateMetrics[];

  /** Economy conflict count: AD flag disagrees with actual economy data */
  conflicts: number;

  /** Mathematical economy (ungated by AD flag) for hybrid audit */
  economyTotalMath: number;
}

// ── Helpers ───────────────────────────────────────────────────────

function emptyQuarter(): QuarterMetrics {
  return {
    planCount: 0,
    factCount: 0,
    planFB: 0,
    planKB: 0,
    planMB: 0,
    planTotal: 0,
    factFB: 0,
    factKB: 0,
    factMB: 0,
    factTotal: 0,
    economyTotal: 0,
    economyFB: 0,
    economyKB: 0,
    economyMB: 0,
    executionPct: 0,
    execCountPct: 0,
    compExecCountPct: 0,
    epExecCountPct: 0,
    competitive: { plan: 0, fact: 0, planSum: 0, factSum: 0, planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0, economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0 },
    ep: { plan: 0, fact: 0, planSum: 0, factSum: 0, planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0, economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0 },
  };
}

/** Safely coerce an unknown cell value to a number (0 when not numeric). */
function num(v: unknown): number {
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}

const COMPETITIVE_METHODS = new Set(['ЭА', 'ЭК', 'ЭЗК']);
const ALL_METHODS = new Set(['ЭА', 'ЕП', 'ЭК', 'ЭЗК']);

type QuarterKey = 'q1' | 'q2' | 'q3' | 'q4';

function getQuarterKey(quarterValue: unknown): QuarterKey | null {
  const q = num(quarterValue);
  if (q === 1) return 'q1';
  if (q === 2) return 'q2';
  if (q === 3) return 'q3';
  if (q === 4) return 'q4';
  return null;
}

/** Summary / header rows to skip — matched by lowercased subject prefix. */
const SKIP_PREFIXES = ['итого', 'всего', 'справочно'] as const;

function isSummaryRow(subject: string): boolean {
  const low = subject.toLowerCase();
  return SKIP_PREFIXES.some((p) => low.startsWith(p));
}

function cellPresent(v: unknown): boolean {
  return v != null && String(v).trim() !== '';
}

/**
 * Strict date presence check for fact date column (Q).
 * Returns true only if the value looks like a real date:
 * - Date objects, numeric serials (>1000), or strings matching dd.mm.yyyy / yyyy-mm-dd patterns.
 * Rejects placeholder text like "—", "Х", "н/д", "не определена".
 */
function isDatePresent(v: unknown): boolean {
  if (v == null) return false;
  if (v instanceof Date) return !isNaN(v.getTime());
  if (typeof v === 'number') return v > 1000; // Excel date serial
  const s = String(v).trim();
  if (s === '' || s.length < 6) return false;
  // dd.mm.yyyy, dd/mm/yyyy, yyyy-mm-dd
  if (/\d{2}[.\/]\d{2}[.\/]\d{4}/.test(s)) return true;
  if (/\d{4}-\d{2}-\d{2}/.test(s)) return true;
  // Try parsing as date
  const d = new Date(s);
  return !isNaN(d.getTime()) && d.getFullYear() > 2000;
}

/**
 * Compute planTotal from individual budget columns.
 * Uses K (total plan) if available, otherwise sums H+I+J.
 */
function planTotalFor(kVal: number, hVal: number, iVal: number, jVal: number): number {
  return kVal !== 0 ? kVal : hVal + iVal + jVal;
}

/**
 * Compute factTotal from individual budget columns.
 * Uses Y (total fact) if available, otherwise sums V+W+X.
 */
function factTotalFor(yVal: number, vVal: number, wVal: number, xVal: number): number {
  return yVal !== 0 ? yVal : vVal + wVal + xVal;
}

/** Returns ratio as decimal (0.316 = 31.6%). Consistent with normalize.ts numericValue scale. */
function pct(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

/**
 * Extract month (1-12) from a date cell value.
 * Handles: Date objects, "DD.MM.YYYY" strings, ISO strings, Excel serial numbers.
 */
function getMonthFromDate(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const m = v.getMonth() + 1;
    return m >= 1 && m <= 12 ? m : null;
  }
  const s = String(v).trim();
  // DD.MM.YYYY or DD/MM/YYYY
  const dotMatch = s.match(/^\d{1,2}[./](\d{1,2})[./]\d{2,4}$/);
  if (dotMatch) {
    const m = parseInt(dotMatch[1], 10);
    return m >= 1 && m <= 12 ? m : null;
  }
  // ISO: YYYY-MM-DD
  const isoMatch = s.match(/^\d{4}-(\d{2})/);
  if (isoMatch) {
    const m = parseInt(isoMatch[1], 10);
    return m >= 1 && m <= 12 ? m : null;
  }
  // Excel serial date (number > 40000)
  const n = parseFloat(s);
  if (!isNaN(n) && n > 40000 && n < 60000) {
    const date = new Date((n - 25569) * 86400000);
    const m = date.getMonth() + 1;
    return m >= 1 && m <= 12 ? m : null;
  }
  return null;
}

/** Initialize months map with empty metrics for 1-12 */
function emptyMonths(): Record<number, QuarterMetrics> {
  const m: Record<number, QuarterMetrics> = {};
  for (let i = 1; i <= 12; i++) m[i] = emptyQuarter();
  return m;
}

// ── Row classification ────────────────────────────────────────────

/**
 * Heuristic score to decide whether a row is a real procurement data row.
 *
 * Points:
 *   +3  known procurement method in column L
 *   +2  known activity type in column F
 *   +2  plan amounts > 0.009
 *   +1  plan date present (N)
 *   +1  has ID (A) or subject (G)
 *
 * Threshold: score >= 3 qualifies as a data row.
 */
function classifyRow(row: unknown[]): boolean {
  const method = String(row[COL.L] ?? '').trim();
  const typeText = String(row[COL.F] ?? '').trim().toLowerCase();

  const hasMethod = ALL_METHODS.has(method);
  const hasType =
    typeText === 'текущая деятельность' || typeText === 'программное мероприятие';

  const hVal = num(row[COL.H]);
  const iVal = num(row[COL.I]);
  const jVal = num(row[COL.J]);
  const planMoney = hVal + iVal + jVal;

  const hasDate = cellPresent(row[COL.N]);
  const hasIdOrSubject = cellPresent(row[COL.A]) || cellPresent(row[COL.G]);

  const score =
    (hasMethod ? 3 : 0) +
    (hasType ? 2 : 0) +
    (planMoney > 0.009 ? 2 : 0) +
    (hasDate ? 1 : 0) +
    (hasIdOrSubject ? 1 : 0);

  return score >= 3;
}

// ── Main recalculation ────────────────────────────────────────────

/**
 * Recalculate metrics from raw sheet rows for a single department.
 *
 * @param sheetData  Full 2-D array as returned by the Sheets API (values[][]).
 * @param department Human-readable department name (e.g. "УЭР").
 * @param startRow   First data row index (0-based). Default 3 skips typical headers.
 * @param targetYear If set, only count rows where column P (plan year) matches this year.
 *                   СВОД computes year totals per-year via COUNTIFS, so multi-year sheets
 *                   need filtering.
 */
export function recalculateFromRows(
  sheetData: unknown[][],
  department: string,
  startRow: number = 3,
  targetYear?: number,
): RecalculatedMetrics {
  const result: RecalculatedMetrics = {
    department,
    totalCompetitive: 0,
    totalEP: 0,
    quarters: {
      q1: emptyQuarter(),
      q2: emptyQuarter(),
      q3: emptyQuarter(),
      q4: emptyQuarter(),
    },
    months: emptyMonths(),
    year: {
      planCount: 0,
      factCount: 0,
      planFB: 0,
      planKB: 0,
      planMB: 0,
      planTotal: 0,
      factFB: 0,
      factKB: 0,
      factMB: 0,
      factTotal: 0,
      economyTotal: 0,
      economyFB: 0,
      economyKB: 0,
      economyMB: 0,
      executionPct: 0,
      execCountPct: 0,
      compExecCountPct: 0,
      epExecCountPct: 0,
    },
    epSharePct: 0,
    dataRowCount: 0,
    byActivity: {},
    bySubordinate: [],
    conflicts: 0,
    economyTotalMath: 0,
  };

  // Accumulators for per-subordinate and per-activity data
  const subMap = new Map<string, {
    rowCount: number; planTotal: number; factTotal: number;
    planFB: number; planKB: number; planMB: number;
    factFB: number; factKB: number; factMB: number;
    competitiveCount: number; epCount: number;
    economyTotal: number; economyFB: number; economyKB: number; economyMB: number;
  }>();

  const emptyActMetrics = (): ActivityMetrics => ({
    planCount: 0, factCount: 0, planTotal: 0, factTotal: 0,
    planFB: 0, planKB: 0, planMB: 0,
    factFB: 0, factKB: 0, factMB: 0,
    economyFB: 0, economyKB: 0, economyMB: 0, economyTotal: 0,
    execCountPct: 0,
  });
  const emptyActivityBreakdown = (): ActivityBreakdown => ({
    program: emptyActMetrics(),
    current_program: emptyActMetrics(),
    current_non_program: emptyActMetrics(),
  });

  // Per-quarter activity breakdown
  const actQ: Record<string, ActivityBreakdown> = {
    q1: emptyActivityBreakdown(), q2: emptyActivityBreakdown(),
    q3: emptyActivityBreakdown(), q4: emptyActivityBreakdown(),
    year: emptyActivityBreakdown(),
  };

  for (let r = startRow; r < sheetData.length; r++) {
    const row = sheetData[r];
    if (!row) continue;

    // Skip rows with no ID and no subject
    if (!cellPresent(row[COL.A]) && !cellPresent(row[COL.G])) continue;

    // Skip summary / header rows
    const subject = String(row[COL.G] ?? '').trim();
    if (isSummaryRow(subject)) continue;

    // Classification filter
    if (!classifyRow(row)) continue;

    // Year filter: if targetYear is set, skip rows from other years.
    // Column P (index 15) holds the plan year (e.g. 2025, 2026).
    if (targetYear) {
      const rowYear = num(row[COL.P]);
      if (rowYear > 0 && rowYear !== targetYear) continue;
    }

    result.dataRowCount++;

    // ── Extract values ────────────────────────────────────────────
    const method = String(row[COL.L] ?? '').trim();
    const isCompetitive = COMPETITIVE_METHODS.has(method);
    const isEP = method === 'ЕП';

    if (isCompetitive) result.totalCompetitive++;
    if (isEP) result.totalEP++;

    // ── Activity type (column F + column D/E program name) ──────────
    // F = "Программное мероприятие" → program
    // F = "Текущая деятельность" + реальный текст ПМ в D/E → ТД в рамках ПМ
    // F = "Текущая деятельность" + X/x/Х/х/пусто → ТД вне рамок ПМ
    const typeText = String(row[COL.F] ?? '').trim().toLowerCase();
    const pmVal = String(row[COL.E] ?? '').trim();
    const hasPM = pmVal.length > 0 && !/^[XxХх]$/u.test(pmVal);
    const isProgram = typeText.includes('программное мероприятие');
    const isCurrentActivity = typeText.includes('текущая');
    const actKey: 'program' | 'current_program' | 'current_non_program' =
      isProgram ? 'program'
        : isCurrentActivity ? (hasPM ? 'current_program' : 'current_non_program')
        : 'current_program';

    // ── Subordinate org (column C) ───────────────────────────────
    const subName = String(row[COL.C] ?? '').trim();

    const hVal = num(row[COL.H]);
    const iVal = num(row[COL.I]);
    const jVal = num(row[COL.J]);
    const kVal = num(row[COL.K]);
    const vVal = num(row[COL.V]);
    const wVal = num(row[COL.W]);
    const xVal = num(row[COL.X]);
    const yVal = num(row[COL.Y]);

    const rowPlanTotal = planTotalFor(kVal, hVal, iVal, jVal);
    const rowFactTotal = factTotalFor(yVal, vVal, wVal, xVal);

    const factMoney = vVal + wVal + xVal;

    // Fact detection: primarily based on fact date (column Q),
    // matching СВОД COUNTIFS logic which gates on fact date presence.
    // Fallback: if no fact date but fact quarter (column R) is filled
    // and significant fact money exists — count as fact.
    // Fact detection: use cellPresent for column Q (fact date) to match СВОД COUNTIFS
    // which gates on non-empty cells. But exclude known placeholders (Х, X, -, н/д)
    // that mean "no fact date yet".
    const qRaw = String(row[COL.Q] ?? '').trim();
    const PLACEHOLDERS = new Set(['х', 'x', '-', '—', '–', 'н/д', 'нет', 'не определена']);
    const factDatePresent = qRaw !== '' && !PLACEHOLDERS.has(qRaw.toLowerCase());
    const factQuarterPresent = cellPresent(row[COL.R]);
    // СВОД uses COUNTIFS gated on column Q (fact date) only.
    // The previous fallback (factQuarterPresent && factMoney > 0.009) was too
    // permissive because column R is often pre-populated for planned rows,
    // which caused year fact counts ≈ year plan counts.
    const hasFact = factDatePresent;

    // ── Quarter assignment ────────────────────────────────────────
    const planQ = getQuarterKey(row[COL.O]);

    if (planQ) {
      const q = result.quarters[planQ];
      q.planCount++;
      q.planFB += hVal;
      q.planKB += iVal;
      q.planMB += jVal;
      q.planTotal += rowPlanTotal;

      if (isCompetitive) {
        q.competitive.plan++;
        q.competitive.planSum += rowPlanTotal;
        q.competitive.planFB += hVal;
        q.competitive.planKB += iVal;
        q.competitive.planMB += jVal;
      }
      if (isEP) {
        q.ep.plan++;
        q.ep.planSum += rowPlanTotal;
        q.ep.planFB += hVal;
        q.ep.planKB += iVal;
        q.ep.planMB += jVal;
      }

      if (hasFact) {
        q.factCount++;
        q.factFB += vVal;
        q.factKB += wVal;
        q.factMB += xVal;
        q.factTotal += rowFactTotal;

        if (isCompetitive) {
          q.competitive.fact++;
          q.competitive.factSum += rowFactTotal;
          q.competitive.factFB += vVal;
          q.competitive.factKB += wVal;
          q.competitive.factMB += xVal;
        }
        if (isEP) {
          q.ep.fact++;
          q.ep.factSum += rowFactTotal;
          q.ep.factFB += vVal;
          q.ep.factKB += wVal;
          q.ep.factMB += xVal;
        }
      }
    }

    // ── Month assignment (from plan date column N) ───────────────
    const planMonth = getMonthFromDate(row[COL.N]);
    if (planMonth) {
      const m = result.months[planMonth];
      m.planCount++;
      m.planFB += hVal;
      m.planKB += iVal;
      m.planMB += jVal;
      m.planTotal += rowPlanTotal;
      if (isCompetitive) {
        m.competitive.plan++; m.competitive.planSum += rowPlanTotal;
        m.competitive.planFB += hVal; m.competitive.planKB += iVal; m.competitive.planMB += jVal;
      }
      if (isEP) {
        m.ep.plan++; m.ep.planSum += rowPlanTotal;
        m.ep.planFB += hVal; m.ep.planKB += iVal; m.ep.planMB += jVal;
      }
      if (hasFact) {
        m.factCount++;
        m.factFB += vVal;
        m.factKB += wVal;
        m.factMB += xVal;
        m.factTotal += rowFactTotal;
        if (isCompetitive) {
          m.competitive.fact++; m.competitive.factSum += rowFactTotal;
          m.competitive.factFB += vVal; m.competitive.factKB += wVal; m.competitive.factMB += xVal;
        }
        if (isEP) {
          m.ep.fact++; m.ep.factSum += rowFactTotal;
          m.ep.factFB += vVal; m.ep.factKB += wVal; m.ep.factMB += xVal;
        }
      }
    }

    // ── Year plan totals (only rows with a plan quarter) ──────────
    // СВОД uses COUNTIFS on planQuarter column, so rows without planQ
    // should NOT inflate the year plan count or budget.
    if (planQ) {
      result.year.planCount++;
      result.year.planFB += hVal;
      result.year.planKB += iVal;
      result.year.planMB += jVal;
      result.year.planTotal += rowPlanTotal;
    }

    // NOTE: Year fact totals are derived from quarter sums AFTER the loop
    // to match СВОД logic (which sums quarter-level COUNTIFS).
    // We still accumulate fact money at year level for rows without a plan quarter.
    if (hasFact && !planQ) {
      // Row has fact but no plan quarter — add to year directly
      result.year.factCount++;
      result.year.factFB += vVal;
      result.year.factKB += wVal;
      result.year.factMB += xVal;
      result.year.factTotal += rowFactTotal;
    }

    // ── Economy (from dedicated economy columns Z+AA+AB, gated on AD="да") ─
    // СВОД: R=SUMIFS('DEPT'!Z, AD="да",...), S=SUMIFS(AA,...), T=SUMIFS(AB,...)
    // Economy columns contain actual savings entered by departments, NOT plan-fact diff.
    const adFlag = String(row[COL.AD] ?? '').trim().toLowerCase();
    const isEconomyApproved = adFlag === 'да' || adFlag === 'yes';

    const ecoFB = num(row[COL.Z]);   // Z — economy ФБ
    const ecoKB = num(row[COL.AA]);  // AA — economy КБ
    const ecoMB = num(row[COL.AB]);  // AB — economy МБ
    const ecoTotal = ecoFB + ecoKB + ecoMB;

    let rowEconomy = 0;
    // СВОД formula: SUMIFS(dept!Z, dept!AD, "да", dept!Q, "<>""",...)
    // Gates: AD="да" AND fact date present. No ecoTotal>0 guard in СВОД.
    if (hasFact && isEconomyApproved) {
      rowEconomy = ecoTotal;
      result.year.economyTotal += ecoTotal;
      result.year.economyFB += ecoFB;
      result.year.economyKB += ecoKB;
      result.year.economyMB += ecoMB;
      if (planQ) {
        result.quarters[planQ].economyTotal += ecoTotal;
        result.quarters[planQ].economyFB += ecoFB;
        result.quarters[planQ].economyKB += ecoKB;
        result.quarters[planQ].economyMB += ecoMB;
        if (isCompetitive) {
          result.quarters[planQ].competitive.economyTotal += ecoTotal;
          result.quarters[planQ].competitive.economyFB += ecoFB;
          result.quarters[planQ].competitive.economyKB += ecoKB;
          result.quarters[planQ].competitive.economyMB += ecoMB;
        }
        if (isEP) {
          result.quarters[planQ].ep.economyTotal += ecoTotal;
          result.quarters[planQ].ep.economyFB += ecoFB;
          result.quarters[planQ].ep.economyKB += ecoKB;
          result.quarters[planQ].ep.economyMB += ecoMB;
        }
      }
      if (planMonth) {
        result.months[planMonth].economyTotal += ecoTotal;
        result.months[planMonth].economyFB += ecoFB;
        result.months[planMonth].economyKB += ecoKB;
        result.months[planMonth].economyMB += ecoMB;
        if (isCompetitive) {
          result.months[planMonth].competitive.economyTotal += ecoTotal;
          result.months[planMonth].competitive.economyFB += ecoFB;
          result.months[planMonth].competitive.economyKB += ecoKB;
          result.months[planMonth].competitive.economyMB += ecoMB;
        }
        if (isEP) {
          result.months[planMonth].ep.economyTotal += ecoTotal;
          result.months[planMonth].ep.economyFB += ecoFB;
          result.months[planMonth].ep.economyKB += ecoKB;
          result.months[planMonth].ep.economyMB += ecoMB;
        }
      }
    }

    // ── Mathematical economy (ungated, for hybrid audit) ────────────
    // Sum of economy columns regardless of AD flag — shows total potential savings
    const mathEconomy = hasFact ? Math.max(0, ecoTotal) : 0;
    if (mathEconomy > 0) {
      result.economyTotalMath += mathEconomy;
    }

    // ── Economy conflict detection (AD flag vs actual economy values) ─
    // Conflict: flag says "да" but no economy values, or has economy but no flag
    if ((isEconomyApproved && ecoTotal === 0 && hasFact) ||
        (!isEconomyApproved && ecoTotal > 0 && hasFact)) {
      result.conflicts++;
    }

    // ── Activity accumulation (with per-budget) ───────────────────
    const yearAct = actQ['year'][actKey];
    yearAct.planCount++;
    yearAct.planTotal += rowPlanTotal;
    yearAct.planFB += hVal; yearAct.planKB += iVal; yearAct.planMB += jVal;
    if (hasFact) {
      yearAct.factCount++; yearAct.factTotal += rowFactTotal;
      yearAct.factFB += vVal; yearAct.factKB += wVal; yearAct.factMB += xVal;
    }
    if (hasFact && isEconomyApproved) {
      yearAct.economyFB += ecoFB; yearAct.economyKB += ecoKB; yearAct.economyMB += ecoMB;
      yearAct.economyTotal += ecoTotal;
    }

    if (planQ) {
      const qAct = actQ[planQ][actKey];
      qAct.planCount++;
      qAct.planTotal += rowPlanTotal;
      qAct.planFB += hVal; qAct.planKB += iVal; qAct.planMB += jVal;
      if (hasFact) {
        qAct.factCount++; qAct.factTotal += rowFactTotal;
        qAct.factFB += vVal; qAct.factKB += wVal; qAct.factMB += xVal;
      }
      if (hasFact && isEconomyApproved) {
        qAct.economyFB += ecoFB; qAct.economyKB += ecoKB; qAct.economyMB += ecoMB;
        qAct.economyTotal += ecoTotal;
      }
    }

    // ── Subordinate accumulation ──────────────────────────────────
    // Always track: empty col C → "_org_itself" (org's own rows), otherwise subordinate name
    const subKey = subName || '_org_itself';
    {
      let sub = subMap.get(subKey);
      if (!sub) {
        sub = { rowCount: 0, planTotal: 0, factTotal: 0, planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0, competitiveCount: 0, epCount: 0, economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0 };
        subMap.set(subKey, sub);
      }
      sub.rowCount++;
      sub.planTotal += rowPlanTotal;
      sub.planFB += hVal; sub.planKB += iVal; sub.planMB += jVal;
      if (hasFact) {
        sub.factTotal += rowFactTotal;
        sub.factFB += vVal; sub.factKB += wVal; sub.factMB += xVal;
      }
      if (isCompetitive) sub.competitiveCount++;
      if (isEP) sub.epCount++;
      sub.economyTotal += rowEconomy;
      if (hasFact && isEconomyApproved) {
        sub.economyFB += ecoFB;
        sub.economyKB += ecoKB;
        sub.economyMB += ecoMB;
      }
    }
  }

  // ── Derive year fact totals from quarter sums ─────────────────────
  // This matches СВОД logic where year = Σ quarters.
  // Any facts from rows without a plan quarter were already added directly.
  for (const qk of ['q1', 'q2', 'q3', 'q4'] as const) {
    const q = result.quarters[qk];
    result.year.factCount += q.factCount;
    result.year.factFB += q.factFB;
    result.year.factKB += q.factKB;
    result.year.factMB += q.factMB;
    result.year.factTotal += q.factTotal;
  }

  // ── Derived percentages ───────────────────────────────────────────
  const totalProc = result.totalCompetitive + result.totalEP;
  result.epSharePct = pct(result.totalEP, totalProc);
  result.year.executionPct = pct(result.year.factTotal, result.year.planTotal);
  result.year.execCountPct = pct(result.year.factCount, result.year.planCount);
  result.year.compExecCountPct = pct(
    ['q1', 'q2', 'q3', 'q4'].reduce((s, qk) => s + result.quarters[qk as QuarterKey].competitive.fact, 0),
    result.totalCompetitive,
  );
  result.year.epExecCountPct = pct(
    ['q1', 'q2', 'q3', 'q4'].reduce((s, qk) => s + result.quarters[qk as QuarterKey].ep.fact, 0),
    result.totalEP,
  );

  for (const qk of ['q1', 'q2', 'q3', 'q4'] as const) {
    const q = result.quarters[qk];
    q.executionPct = pct(q.factTotal, q.planTotal);
    q.execCountPct = pct(q.factCount, q.planCount);
    q.compExecCountPct = pct(q.competitive.fact, q.competitive.plan);
    q.epExecCountPct = pct(q.ep.fact, q.ep.plan);
  }

  for (let mi = 1; mi <= 12; mi++) {
    const m = result.months[mi];
    m.executionPct = pct(m.factTotal, m.planTotal);
    m.execCountPct = pct(m.factCount, m.planCount);
    m.compExecCountPct = pct(m.competitive.fact, m.competitive.plan);
    m.epExecCountPct = pct(m.ep.fact, m.ep.plan);
  }

  // ── Finalize byActivity (derive execCountPct) ──────────────────
  for (const periodKey of Object.keys(actQ)) {
    for (const actKey of ['program', 'current_program', 'current_non_program'] as const) {
      const a = actQ[periodKey][actKey];
      a.execCountPct = pct(a.factCount, a.planCount);
    }
  }
  result.byActivity = actQ;

  // ── Finalize bySubordinate ──────────────────────────────────────
  const emptySubPeriodLegacy = (): SubPeriodMetrics => ({
    planCount: 0, factCount: 0, planTotal: 0, factTotal: 0,
    planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0,
    economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0,
    executionPct: 0, execCountPct: 0,
  });
  result.bySubordinate = Array.from(subMap.entries())
    .map(([name, s]) => ({
      name,
      rowCount: s.rowCount,
      planTotal: s.planTotal,
      factTotal: s.factTotal,
      planFB: s.planFB,
      planKB: s.planKB,
      planMB: s.planMB,
      factFB: s.factFB,
      factKB: s.factKB,
      factMB: s.factMB,
      executionPct: pct(s.factTotal, s.planTotal),
      execCountPct: pct(s.rowCount > 0 ? s.factTotal : 0, s.planTotal),
      competitiveCount: s.competitiveCount,
      epCount: s.epCount,
      economyTotal: s.economyTotal,
      economyFB: s.economyFB,
      economyKB: s.economyKB,
      economyMB: s.economyMB,
      quarters: {},
      months: {},
      byMethod: {
        competitive: emptySubPeriodLegacy(),
        ep: emptySubPeriodLegacy(),
      },
      byActivity: {
        program: emptySubPeriodLegacy(),
        current_program: emptySubPeriodLegacy(),
        current_non_program: emptySubPeriodLegacy(),
      },
    }))
    .sort((a, b) => b.planTotal - a.planTotal);

  return result;
}
