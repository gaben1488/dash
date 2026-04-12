import type { DepartmentId, IssueSeverity, ControlIssueSeverity, TrustGrade } from './types.js';

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

/** Листы управлений (для построчного пересчёта) */
export const DEPARTMENT_SHEETS: readonly DepartmentId[] = [
  'УЭР', 'УИО', 'УАГЗО', 'УФБП', 'УД', 'УДТХ', 'УКСиМП', 'УО',
] as const;

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

/** Столбцы экономии */
export const ECONOMY_COLUMNS = {
  V: 'V',    // Экономия ФБ
  W: 'W',    // Экономия КБ
  X: 'X',    // Экономия МБ
  AD: 'AD',  // Флаг/признак экономии
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

export const UI_LABELS = {
  // Навигация
  'nav.dashboard': 'Сводная панель',
  'nav.analytics': 'Аналитика',
  'nav.control': 'Контроль качества',
  'nav.audit': 'Аудит данных',
  'nav.settings': 'Настройки',
  'nav.grbs': 'По управлениям',
  'nav.economy': 'Экономия',
  'nav.rows': 'Построчные данные',

  // KPI
  'kpi.execution': 'Исполнение',
  'kpi.plan': 'План',
  'kpi.fact': 'Факт',
  'kpi.deviation': 'Отклонение',
  'kpi.economy': 'Экономия',
  'kpi.procedures_count': 'Количество процедур',
  'kpi.competitive': 'Конкурентные процедуры',
  'kpi.sole_supplier': 'Единственный поставщик',
  'kpi.ep_share': 'Доля ЕП',

  // Периоды
  'period.q1': '1 квартал',
  'period.q2': '2 квартал',
  'period.q3': '3 квартал',
  'period.q4': '4 квартал',
  'period.year': 'Год',

  // Бюджет
  'budget.fb': 'Федеральный бюджет',
  'budget.kb': 'Краевой бюджет',
  'budget.mb': 'Муниципальный бюджет',
  'budget.total': 'Итого',

  // Способы закупки
  'method.ea': 'Электронный аукцион',
  'method.ep': 'Единственный поставщик',
  'method.ek': 'Электронный конкурс',
  'method.ezk': 'Электронный запрос котировок',

  // Типы деятельности (виды деятельности)
  'type.current': 'Текущая деятельность',
  'type.current_program': 'ТД в рамках программного мероприятия',
  'type.current_non_program': 'ТД вне рамок программного мероприятия',
  'type.program': 'Программное мероприятие',

  // Статусы
  'status.normal': 'В норме',
  'status.warning': 'Требует внимания',
  'status.critical': 'Критично',

  // Сигналы строк
  'signal.signed': 'Подписано',
  'signal.planning': 'Планирование',
  'signal.not_due': 'Срок не наступил',
  'signal.finance_delay': 'Задержка финансирования',
  'signal.canceled': 'Отменено',
  'signal.overdue': 'Просрочено',
  'signal.has_fact': 'Есть факт',
  'signal.plan_past': 'Срок прошёл',
  'signal.plan_soon': 'Скоро срок',
  'signal.inconsistent': 'Несогласованность',

  // Контроль
  'control.issue': 'Замечание',
  'control.spreadsheet_rule': 'Нарушение правила таблицы',
  'control.bi_heuristic': 'Аналитическое наблюдение',
  'control.error': 'Ошибка',
  'control.warning': 'Предупреждение',
  'control.info': 'Информация',

  // Доверие
  'trust.overall': 'Общая оценка достоверности',
  'trust.data_quality': 'Качество данных',
  'trust.formula_integrity': 'Целостность формул',
  'trust.rule_compliance': 'Соответствие правилам',
  'trust.mapping_consistency': 'Согласованность привязок',
  'trust.operational_risk': 'Операционные риски',
  'trust.grade_a': 'Отличная достоверность',
  'trust.grade_b': 'Хорошая достоверность',
  'trust.grade_c': 'Удовлетворительная достоверность',
  'trust.grade_d': 'Низкая достоверность',
  'trust.grade_f': 'Критически низкая достоверность',

  // Источники
  'origin.official': 'Официальный источник',
  'origin.calculated': 'Независимый пересчёт',
  'origin.hybrid': 'Комбинированный',

  // Единицы
  'unit.thousand_rubles': 'тыс. руб.',
  'unit.million_rubles': 'млн руб.',
  'unit.billion_rubles': 'млрд руб.',
  'unit.rubles': 'руб.',
  'unit.count': 'шт.',
  'unit.percent': '%',
  'unit.days': 'дн.',

  // Управления (полные названия)
  'dept.УЭР': 'Управление экономического развития',
  'dept.УИО': 'Управление имущественных отношений',
  'dept.УАГЗО': 'Управление автоматизации и ГЗО',
  'dept.УФБП': 'Управление финансово-бюджетной политики',
  'dept.УД': 'Управление делами',
  'dept.УДТХ': 'Управление дорожно-транспортного хозяйства',
  'dept.УКСиМП': 'Управление капитального строительства и МП',
  'dept.УО': 'Управление образования',

  // Общие действия
  'action.refresh': 'Обновить данные',
  'action.export': 'Экспорт',
  'action.filter': 'Фильтр',
  'action.details': 'Подробнее',
  'action.back': 'Назад',
} as const;

export type UILabelKey = keyof typeof UI_LABELS;

/** Получить русский текст для UI */
export function t(key: UILabelKey): string {
  return UI_LABELS[key];
}

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
