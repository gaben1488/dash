import type { DepartmentId, IssueSeverity, TrustGrade } from './types.js';
import { ALL_DEPT_IDS } from './department-registry.js';

// ============================================================
// AEMR Platform — Constants
// ============================================================

// ────────────────────────────────────────────────────────────
// 1. Sheet names
// ────────────────────────────────────────────────────────────

/** ID основной таблицы СВОД_для_Google (единственный правильный!) */
export const SVOD_SPREADSHEET_ID = '1i692JdP-FqWMSfVgBjTmDCoUakacbJpZMq9tJhQlRhg';

/** Главный лист свода */
export const SVOD_SHEET_NAME = 'СВОД ТД-ПМ';

/** Проверяемый контур СВОДа заканчивается строкой 278; 279+ — эксперимент только в Google Sheets. */
export const SVOD_DASHBOARD_LAST_ROW = 278;

/** Листы управлений (для построчного пересчёта). Derived from DEPARTMENT_REGISTRY. */
export const DEPARTMENT_SHEETS: readonly DepartmentId[] = ALL_DEPT_IDS;

/** Все читаемые листы */
export const ALL_SHEETS = [SVOD_SHEET_NAME, ...DEPARTMENT_SHEETS] as const;

// ────────────────────────────────────────────────────────────
// 2. Column mapping
// ────────────────────────────────────────────────────────────

/** Столбцы суммы бюджетов */
export const BUDGET_COLUMNS = {
  FB: 'H',    // Федеральный бюджет
  KB: 'I',    // Краевой бюджет
  MB: 'J',    // Муниципальный бюджет
  TOTAL: 'K', // Итого
} as const;

/** Столбцы утверждённой экономии на листах управлений. */
export const ECONOMY_COLUMNS = {
  FB: 'Z',      // Экономия ФБ
  KB: 'AA',     // Экономия КБ
  MB: 'AB',     // Экономия МБ
  TOTAL: 'AC',  // Экономия итого
  FLAG: 'AD',   // Флаг/признак экономии
} as const;

// ────────────────────────────────────────────────────────────
// 3. Number formatting
// ────────────────────────────────────────────────────────────

export const NUMBER_FORMAT = {
  CURRENCY: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  PERCENT: { minimumFractionDigits: 1, maximumFractionDigits: 1, style: 'percent' as const },
  INTEGER: { minimumFractionDigits: 0, maximumFractionDigits: 0 },
} as const;

// ────────────────────────────────────────────────────────────
// 4. Thresholds
// ────────────────────────────────────────────────────────────

/**
 * Единицы: ВСЕ денежные пороги ниже — в ТЫСЯЧАХ рублей, как и денежные колонки
 * книг ГРБС (H/I/J/K, V/W/X/Y — канон @aemr/shared/report-map.ts:12 «Все суммы
 * в тыс. руб.»). Раньше пороги были литералами в рублях (600_000, 50_000_000 —
 * буквальные суммы из текста закона), а сравнивались с суммами в тысячах —
 * сравнение требовало контракта на 600 МЛН руб., чтобы сработать (недостижимо
 * на реальных данных). Найдено bug-hunt 2026-08-08 (docs/superpowers/audits/
 * 2026-08-08-bug-hunt-register.md, БАГ #1). Верный двойник уже существовал:
 * dictionaries/method-families.ts:95 thresholdKopUnit=600 (в тысячах).
 * Суффикс ThousandRub делает единицу видимой на месте использования.
 */
export const LAW_44FZ_THRESHOLDS = {
  /** 44-FZ art. 93 part 1 p.4: one small EP contract must not exceed this amount (тыс. руб. = 600 тыс. руб.). */
  epSmallPurchaseSingleContractLimitThousandRub: 600,
  /** 44-FZ art. 93 part 1 p.4: fixed annual small-purchase limit alternative (тыс. руб. = 2 млн руб.). */
  epSmallPurchaseAnnualFixedLimitThousandRub: 2_000,
  /** 44-FZ art. 93 part 1 p.4: annual SGOZ share alternative. */
  epSmallPurchaseAnnualShareLimit: 0.10,
  /** 44-FZ art. 93 part 1 p.4: annual absolute cap for the SGOZ-share alternative (тыс. руб. = 50 млн руб.). */
  epSmallPurchaseAnnualAbsoluteLimitThousandRub: 50_000,
  /** 44-FZ art. 93 part 1 p.5: one education/culture EP contract limit (тыс. руб. = 600 тыс. руб.).
   *  Сверено с текстом закона 24.07.2026: разовый — 600 тыс. (было ошибочно
   *  5 млн — это годовой фикс-вариант, не разовый лимит). */
  epEducationSingleContractLimitThousandRub: 600,
  /** 44-FZ art. 93 part 1 p.5: fixed annual alternative (5 млн ИЛИ 50% СГОЗ ≤ 30 млн; тыс. руб. = 5 млн руб.). */
  epEducationAnnualFixedLimitThousandRub: 5_000,
  /** 44-FZ art. 93 part 1 p.5: annual share cap for education/culture/sport EP. */
  epEducationAnnualShareLimit: 0.50,
  /** 44-FZ art. 93 part 1 p.5: annual absolute cap for the share alternative (тыс. руб. = 30 млн руб.). */
  epEducationAnnualAbsoluteLimitThousandRub: 30_000,
  /** Electronic-shop purchase limit used by source spreadsheets (тыс. руб. = 5 млн руб.). */
  eShopPurchaseLimitThousandRub: 5_000,
  /** Request-for-quotations limit (тыс. руб. = 10 млн руб.). */
  quotationPurchaseLimitThousandRub: 10_000,
  /** 44-FZ art. 37 threshold. Requires procurement prices and applicability; plan/economy is not a substitute. */
  antiDumpingSavingsShare: 0.25,
} as const;

export const THRESHOLDS = {
  EXECUTION: {
    GOOD: 0.9,
    WARNING: 0.7,
    CRITICAL: 0.5,
  },
  TRUST: {
    A: 90,
    B: 75,
    C: 60,
    D: 40,
  },
  DELTA: {
    TOLERANCE_PERCENT: 1,
  },
} as const;

// ────────────────────────────────────────────────────────────
// 5. UI Labels — Russian management terminology
// ────────────────────────────────────────────────────────────

export { UI_LABELS, t, type UILabelKey } from './product-dictionary.js';

// ────────────────────────────────────────────────────────────
// 6. Color palette for charts (Recharts-compatible hex values)
// ────────────────────────────────────────────────────────────

export const COLOR_PALETTE = {
  /** Primary blues for main data series */
  primary: ['#2563EB', '#3B82F6', '#60A5FA', '#93C5FD'],
  /** Secondary greens for positive / success */
  success: ['#059669', '#10B981', '#34D399', '#6EE7B7'],
  /** Warm reds/oranges for negative / alerts */
  danger: ['#DC2626', '#EF4444', '#F87171', '#FCA5A5'],
  /** Amber for warnings */
  warning: ['#D97706', '#F59E0B', '#FBBF24', '#FDE68A'],
  /** Neutral grays */
  neutral: ['#374151', '#6B7280', '#9CA3AF', '#D1D5DB'],
  /** Budget level colors (fb / kb / mb) */
  budget: {
    fb: '#6366F1', // indigo — federal
    kb: '#8B5CF6', // violet — regional
    mb: '#EC4899', // pink — municipal
    total: '#1F2937', // dark gray
  },
} as const;

// ────────────────────────────────────────────────────────────
// 7. Severity colors
// ────────────────────────────────────────────────────────────

export const SEVERITY_COLORS: Record<IssueSeverity, { bg: string; text: string; border: string }> = {
  error: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
  warning: { bg: '#FFFBEB', text: '#92400E', border: '#FDE68A' },
  info: { bg: '#EFF6FF', text: '#1E40AF', border: '#BFDBFE' },
  // Legacy severity levels (mapped to nearest equivalent)
  critical: { bg: '#FEF2F2', text: '#991B1B', border: '#FECACA' },
  significant: { bg: '#FFF7ED', text: '#9A3412', border: '#FED7AA' },
} as const;

// ────────────────────────────────────────────────────────────
// 8. Trust grade colors
// ────────────────────────────────────────────────────────────

export const TRUST_GRADE_COLORS: Record<TrustGrade, { bg: string; text: string }> = {
  A: { bg: '#ECFDF5', text: '#065F46' },
  B: { bg: '#F0FDF4', text: '#166534' },
  C: { bg: '#FFFBEB', text: '#92400E' },
  D: { bg: '#FFF7ED', text: '#9A3412' },
  F: { bg: '#FEF2F2', text: '#991B1B' },
} as const;

// ────────────────────────────────────────────────────────────
// 9. Department colors (one per department, for chart legends)
// ────────────────────────────────────────────────────────────

export const DEPARTMENT_COLORS: Record<DepartmentId, string> = {
  'УЭР':    '#2563EB', // blue
  'УИО':    '#7C3AED', // violet
  'УАГЗО':  '#059669', // emerald
  'УФБП':   '#D97706', // amber
  'УД':     '#DC2626', // red
  'УДТХ':   '#0891B2', // cyan
  'УКСиМП': '#4F46E5', // indigo
  'УО':     '#DB2777', // pink
} as const;

// ────────────────────────────────────────────────────────────
// 10. Trust component weights
// ────────────────────────────────────────────────────────────

export const TRUST_WEIGHTS = {
  DATA_QUALITY: 0.30,
  FORMULA_INTEGRITY: 0.25,
  RULE_COMPLIANCE: 0.20,
  MAPPING_CONSISTENCY: 0.15,
  OPERATIONAL_RISK: 0.10,
} as const;

// ────────────────────────────────────────────────────────────
// 11. Google Sheets URL builder
// ────────────────────────────────────────────────────────────

/** Build a direct link to a cell in Google Sheets */
export function buildSheetUrl(spreadsheetId: string, cell?: string, sheetName?: string): string {
  let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  if (sheetName) url += `#gid=0`; // default sheet; real gid needs lookup
  if (cell) url += (url.includes('#') ? '&' : '#') + `range=${cell}`;
  return url;
}

/** Forecast policy; does not change source facts or AD-approved economy. */
export const ECONOMY_FORECAST_NORM_PCT = 8;
