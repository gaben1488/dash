/**
 * budget-sources.ts — Уровни бюджетного финансирования АЕМР.
 *
 * Источник: constants.ts BUDGET_COLUMNS, types.ts BudgetLevel,
 *           UI_LABELS (budget.*), COLOR_PALETTE.budget.
 *
 * Три уровня:
 *   ФБ — Федеральный бюджет  (колонка H план, L факт)
 *   КБ — Краевой бюджет      (колонка I план, M факт)
 *   МБ — Муниципальный бюджет (колонка J план, N факт)
 *   Итого (K план, O факт) — сумма трёх уровней, НЕ является независимым уровнем.
 *
 * Правило сигнала budgetSourceMissing:
 *   H/I/J все пусты/нули, но K > 0 → бюджетный источник не указан (аномалия данных).
 */

// ────────────────────────────────────────────────────────────
// 1. Тип уровня бюджета
// ────────────────────────────────────────────────────────────

export const BUDGET_SOURCE_CODES = ['fb', 'kb', 'mb'] as const;
export type BudgetSourceCode = typeof BUDGET_SOURCE_CODES[number];

// ────────────────────────────────────────────────────────────
// 2. Метаданные уровней
// ────────────────────────────────────────────────────────────

export interface BudgetSourceMeta {
  code: BudgetSourceCode;
  /** Аббревиатура (ФБ / КБ / МБ) */
  abbr: 'ФБ' | 'КБ' | 'МБ';
  /** Полное русское название */
  label: string;
  /** Краткое для compact-таблиц */
  labelShort: string;
  /** Столбец плановых сумм в СВОД (буква) */
  planColumn: 'H' | 'I' | 'J';
  /** Столбец фактических сумм в СВОД (буква) */
  factColumn: 'L' | 'M' | 'N';
  /** Цвет в Recharts/chart-компонентах (hex) */
  chartColor: string;
  /** Цвет бейджа в UI (Tailwind-классы bg + text) */
  badgeBg: string;
  badgeText: string;
  /** Уровень финансирования: 1=федеральный (выше), 2=региональный, 3=муниципальный */
  level: 1 | 2 | 3;
}

export const BUDGET_SOURCE_META: Record<BudgetSourceCode, BudgetSourceMeta> = {
  fb: {
    code: 'fb',
    abbr: 'ФБ',
    label: 'Федеральный бюджет',
    labelShort: 'ФБ',
    planColumn: 'H',
    factColumn: 'L',
    chartColor: '#6366F1',   // indigo — из COLOR_PALETTE.budget.fb
    badgeBg: 'bg-indigo-100',
    badgeText: 'text-indigo-800',
    level: 1,
  },
  kb: {
    code: 'kb',
    abbr: 'КБ',
    label: 'Краевой бюджет',
    labelShort: 'КБ',
    planColumn: 'I',
    factColumn: 'M',
    chartColor: '#8B5CF6',   // violet — из COLOR_PALETTE.budget.kb
    badgeBg: 'bg-violet-100',
    badgeText: 'text-violet-800',
    level: 2,
  },
  mb: {
    code: 'mb',
    abbr: 'МБ',
    label: 'Муниципальный бюджет',
    labelShort: 'МБ',
    planColumn: 'J',
    factColumn: 'N',
    chartColor: '#EC4899',   // pink — из COLOR_PALETTE.budget.mb
    badgeBg: 'bg-pink-100',
    badgeText: 'text-pink-800',
    level: 3,
  },
} as const;

// ────────────────────────────────────────────────────────────
// 3. Итоговые колонки (не являются независимым источником)
// ────────────────────────────────────────────────────────────

/** Итоговые колонки СВОД (K = H+I+J, O = L+M+N) */
export const BUDGET_TOTAL_COLUMNS = {
  PLAN: 'K',
  FACT: 'O',
} as const;

/** Цвет итоговых столбцов (dark) */
export const BUDGET_TOTAL_COLOR = '#1F2937';

// ────────────────────────────────────────────────────────────
// 4. Правило сигнала budgetSourceMissing
// ────────────────────────────────────────────────────────────

/**
 * Имена колонок плановых бюджетных источников для проверки.
 * Если все три равны 0 / null, а K > 0 — сигнал budgetSourceMissing.
 */
export const PLAN_SOURCE_COLUMNS = BUDGET_SOURCE_CODES.map(c => BUDGET_SOURCE_META[c].planColumn);
export const FACT_SOURCE_COLUMNS = BUDGET_SOURCE_CODES.map(c => BUDGET_SOURCE_META[c].factColumn);

// ────────────────────────────────────────────────────────────
// 5. Helpers
// ────────────────────────────────────────────────────────────

/** Сумма по всем трём уровням (проверка = K-столбец) */
export function sumBudgetSources(breakdown: Record<BudgetSourceCode, number>): number {
  return BUDGET_SOURCE_CODES.reduce((acc, code) => acc + (breakdown[code] ?? 0), 0);
}

/** Строки для табличного заголовка в порядке уровней */
export const BUDGET_SOURCE_ORDERED: readonly BudgetSourceCode[] = ['fb', 'kb', 'mb'];
