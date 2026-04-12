// ============================================================
// АЕМР — Единая система классификации сущностей
// Версия 1.0
//
// Цель: иерархическая, фильтруемая, агрегируемая система
// для ВСЕХ аналитических сущностей платформы.
// ============================================================

import type {
  DepartmentId,
  ProcurementMethod,
  IssueSeverity,
  IssueStatus,
  MetricOrigin,
  RuleScope,
  RowClassification,
  TrustGrade,
} from './types.js';

// ────────────────────────────────────────────────────────────
// 1. ИЕРАРХИЯ ГРУПП (IssueGroup)
// ────────────────────────────────────────────────────────────

/**
 * Корневые группы проверок — 7 аналитических доменов.
 * Каждая группа объединяет правила, сигналы и рекомендации
 * по единому домену контроля.
 */
export type IssueGroup =
  | 'data_integrity'        // Целостность данных (суммы, формулы)
  | 'formula_consistency'   // Формульные проверки СВОД
  | 'field_validation'      // Валидация полей (справочники)
  | 'temporal'              // Временные аномалии
  | 'financial'             // Финансовые аномалии
  | 'economy_control'       // Контроль экономии (AD + УФБП)
  | 'completeness';         // Полнота данных

/** Метаданные группы — для UI, фильтров и KB */
export interface IssueGroupMeta {
  id: IssueGroup;
  /** Русскоязычное название */
  label: string;
  /** Краткое описание */
  description: string;
  /** Иконка (Lucide) */
  icon: string;
  /** Цвет акцента (Tailwind класс) */
  color: string;
  /** Компонент доверия, на который влияет */
  trustComponent: TrustComponentId;
  /** Порядок отображения */
  order: number;
}

export const ISSUE_GROUP_META: Record<IssueGroup, IssueGroupMeta> = {
  data_integrity: {
    id: 'data_integrity',
    label: 'Целостность данных',
    description: 'Проверки арифметической корректности: суммы бюджетов, итоги, формулы',
    icon: 'shield-check',
    color: 'red',
    trustComponent: 'data_quality',
    order: 1,
  },
  formula_consistency: {
    id: 'formula_consistency',
    label: 'Формульная согласованность',
    description: 'Проверки формул СВОД: проценты исполнения, отклонения, Q1 <= Год',
    icon: 'calculator',
    color: 'orange',
    trustComponent: 'formula_integrity',
    order: 2,
  },
  field_validation: {
    id: 'field_validation',
    label: 'Валидация полей',
    description: 'Проверки корректности справочных значений: метод, тип закупки',
    icon: 'list-checks',
    color: 'amber',
    trustComponent: 'rule_compliance',
    order: 3,
  },
  temporal: {
    id: 'temporal',
    label: 'Временные аномалии',
    description: 'Просрочки, подвисшие контракты, раннее закрытие, некорректные даты',
    icon: 'clock',
    color: 'purple',
    trustComponent: 'operational_risk',
    order: 4,
  },
  financial: {
    id: 'financial',
    label: 'Финансовые аномалии',
    description: 'Превышение факта, антидемпинг, ЕП-риск, низкая конкуренция',
    icon: 'banknote',
    color: 'rose',
    trustComponent: 'operational_risk',
    order: 5,
  },
  economy_control: {
    id: 'economy_control',
    label: 'Контроль экономии',
    description: 'Флаг экономии AD, конфликт данных, скрытая экономия',
    icon: 'piggy-bank',
    color: 'emerald',
    trustComponent: 'rule_compliance',
    order: 6,
  },
  completeness: {
    id: 'completeness',
    label: 'Полнота данных',
    description: 'Недостающие даты, суммы, участники — пробелы в заполнении',
    icon: 'file-warning',
    color: 'slate',
    trustComponent: 'data_quality',
    order: 7,
  },
};

// ────────────────────────────────────────────────────────────
// 2. ТАКСОНОМИЯ СЕРЬЁЗНОСТИ (UnifiedSeverity)
// ────────────────────────────────────────────────────────────

/**
 * Единая 5-уровневая шкала серьёзности.
 * error > critical > significant > warning > info
 *
 * Правила распределения:
 *   error       — данные невалидны, формула сломана, результат ненадёжен
 *   critical    — требует немедленного вмешательства руководства
 *   significant — существенное отклонение, влияет на отчётность
 *   warning     — предупреждение, требует внимания аналитика
 *   info        — информационный сигнал, для полноты картины
 */
export type UnifiedSeverity = 'error' | 'critical' | 'significant' | 'warning' | 'info';

/** Числовой вес серьёзности (для сортировки и агрегации) */
export const SEVERITY_WEIGHT: Record<UnifiedSeverity, number> = {
  error: 5,
  critical: 4,
  significant: 3,
  warning: 2,
  info: 1,
};

/** UI-метки серьёзности */
export const SEVERITY_LABELS: Record<UnifiedSeverity, { label: string; color: string; icon: string }> = {
  error:       { label: 'Ошибка',       color: 'red',    icon: 'x-circle' },
  critical:    { label: 'Критично',     color: 'red',    icon: 'alert-octagon' },
  significant: { label: 'Существенно',  color: 'orange', icon: 'alert-triangle' },
  warning:     { label: 'Предупреждение', color: 'yellow', icon: 'alert-circle' },
  info:        { label: 'Информация',   color: 'blue',   icon: 'info' },
};

// ────────────────────────────────────────────────────────────
// 3. ПРОИСХОЖДЕНИЕ ПРОВЕРКИ (CheckOrigin)
// ────────────────────────────────────────────────────────────

/**
 * Откуда проверка: формула таблицы, BI-эвристика, требование 44-ФЗ.
 */
export type CheckOrigin =
  | 'spreadsheet_rule'   // Формула/структура СВОД ТД-ПМ
  | 'bi_heuristic'       // BI-аналитика (не формула, а бизнес-ожидание)
  | 'compliance_44fz';   // Требование 44-ФЗ (антидемпинг, ЕП-порог)

// ────────────────────────────────────────────────────────────
// 4. ФИЛЬТРАЦИЯ — ЕДИНАЯ РАЗМЕРНОСТЬ
// ────────────────────────────────────────────────────────────

/**
 * Контекст фильтрации — КАЖДАЯ сущность системы несёт полный набор
 * аналитических координат. Это позволяет строить любые срезы.
 */
export interface FilterDimensions {
  /** Управление / ГРБС (null = СВОД-уровень) */
  departmentId: DepartmentId | null;
  /** Подведомственное учреждение (столбец C) */
  subordinate: string | null;
  /** Месяц (1-12, null = не привязан к месяцу) */
  month: number | null;
  /** Квартал (1-4, null = годовой) */
  quarter: number | null;
  /** Год */
  year: number;
  /** Способ закупки (null = не привязан к методу) */
  method: ProcurementMethod | null;
  /** Вид деятельности (null = не определён) */
  activityType: 'program' | 'current_program' | 'current_non_program' | null;
  /** Лист-источник */
  sheet: string;
  /** Строка в таблице (null = метрика уровня СВОД) */
  row: number | null;
  /** Ячейка (null = строковая проверка) */
  cell: string | null;
}

// ────────────────────────────────────────────────────────────
// 5. UNIFIED CHECK — единая проверка (замена Rule + Signal)
// ────────────────────────────────────────────────────────────

/**
 * Контекст выполнения проверки.
 * Расширяет текущий RuleCheckContext + добавляет фильтрацию.
 */
export interface UnifiedCheckContext {
  /** Значения ячеек строки (буква → значение) */
  cells: Record<string, unknown>;
  /** Индекс строки в таблице */
  rowIndex: number;
  /** Имя листа */
  sheet: string;
  /** Классификация строки */
  classification: RowClassification;
  /** Все строки листа (для cross-row проверок) */
  allRows?: Array<{ rowIndex: number; cells: Record<string, unknown> }>;
  /** Текущая дата (для unit-тестов) */
  today?: Date;
  /** Идентификатор управления */
  departmentId?: DepartmentId;
  /** Подведомственное (столбец C) */
  subordinate?: string;
  /** Год данных */
  year: number;
}

/**
 * Результат выполнения проверки.
 */
export interface UnifiedCheckResult {
  /** Проверка пройдена? */
  passed: boolean;
  /** Человекочитаемое описание (русский) */
  message?: string;
  /** Адрес ячейки с проблемой */
  cell?: string;
  /** Фактическое значение */
  actual?: unknown;
  /** Ожидаемое значение */
  expected?: unknown;
  /** Дополнительные данные для детализации */
  metadata?: Record<string, unknown>;
}

/**
 * UNIFIED CHECK — единая единица проверки.
 * Заменяет ValidationRule + Signal + SIGNAL_ISSUE_MAP.
 *
 * Каждая проверка:
 *   - принадлежит одной группе (group)
 *   - имеет фиксированную серьёзность (severity) с возможностью
 *     динамического повышения (severityOverride)
 *   - влияет на конкретный компонент доверия (trustComponent)
 *   - содержит KB-подсказку (kbHint) для базы знаний
 */
export interface UnifiedCheck {
  /** Уникальный ID проверки (snake_case) */
  id: string;
  /** Группа */
  group: IssueGroup;
  /** Русское название */
  name: string;
  /** Подробное описание проверки */
  description: string;
  /** Базовая серьёзность */
  severity: UnifiedSeverity;
  /** Происхождение */
  origin: CheckOrigin;
  /** Область применения */
  scope: RuleScope;
  /** Статья 44-ФЗ (если применимо) */
  article44fz?: string;
  /** KB-подсказка для tooltip */
  kbHint: string;
  /** Автоматическая рекомендация */
  recommendation: string;
  /** Компонент доверия, на который влияет */
  trustComponent: TrustComponentId;
  /** Параметры (пороги, допуски) */
  params: Record<string, unknown>;
  /** Функция проверки */
  check: (ctx: UnifiedCheckContext) => UnifiedCheckResult;
}

// ────────────────────────────────────────────────────────────
// 6. UNIFIED ISSUE — результат срабатывания проверки
// ────────────────────────────────────────────────────────────

/**
 * Замечание — результат срабатывания UnifiedCheck на конкретных данных.
 * Это «единица учёта» для dashboard, фильтров и агрегации.
 *
 * Цепочка: UnifiedCheck (шаблон) → UnifiedIssue (экземпляр) → Recommendation (действие)
 */
export interface UnifiedIssue {
  /** Уникальный ID экземпляра (nanoid) */
  id: string;

  // ── Привязка к проверке ──
  /** ID проверки из реестра (UnifiedCheck.id) */
  checkId: string;
  /** Группа (копия из check для быстрого доступа) */
  group: IssueGroup;
  /** Серьёзность (может быть повышена динамически) */
  severity: UnifiedSeverity;
  /** Происхождение (копия из check) */
  origin: CheckOrigin;

  // ── Содержание ──
  /** Заголовок (русский, для карточки) */
  title: string;
  /** Описание (подробное, для раскрытия) */
  description: string;
  /** Рекомендация (русский, actionable) */
  recommendation: string;
  /** KB-подсказка */
  kbHint: string;

  // ── Фильтрация (полный набор координат) ──
  dimensions: FilterDimensions;

  // ── Данные ──
  /** Фактическое значение */
  actual: unknown;
  /** Ожидаемое значение */
  expected: unknown;
  /** Метаданные (порог, формула, доп. контекст) */
  metadata: Record<string, unknown>;

  // ── Жизненный цикл ──
  status: IssueStatus;
  detectedAt: string;
  detectedBy: string;
  resolvedAt?: string;
  resolvedBy?: string;
  /** История изменений статуса */
  statusHistory?: StatusChange[];
}

export interface StatusChange {
  from: IssueStatus;
  to: IssueStatus;
  changedAt: string;
  changedBy: string;
  comment?: string;
}

// ────────────────────────────────────────────────────────────
// 7. КОМПОНЕНТЫ ДОВЕРИЯ (Trust Components)
// ────────────────────────────────────────────────────────────

/**
 * Идентификаторы 5 компонентов доверия.
 * Маппинг групп → компоненты позволяет автоматически
 * пересчитывать score при появлении/разрешении замечаний.
 */
export type TrustComponentId =
  | 'data_quality'          // 30% — качество данных
  | 'formula_integrity'     // 25% — целостность формул
  | 'rule_compliance'       // 20% — соответствие правилам
  | 'mapping_consistency'   // 15% — согласованность привязок
  | 'operational_risk';     // 10% — операционные риски

export interface TrustComponentConfig {
  id: TrustComponentId;
  label: string;
  weight: number;
  /** Группы замечаний, влияющие на этот компонент */
  issueGroups: IssueGroup[];
  /** Штрафные коэффициенты по серьёзности */
  penalties: Record<UnifiedSeverity, number>;
}

export const TRUST_COMPONENT_CONFIG: Record<TrustComponentId, TrustComponentConfig> = {
  data_quality: {
    id: 'data_quality',
    label: 'Качество данных',
    weight: 30,
    issueGroups: ['data_integrity', 'completeness'],
    penalties: { error: 15, critical: 10, significant: 5, warning: 2, info: 0 },
  },
  formula_integrity: {
    id: 'formula_integrity',
    label: 'Целостность формул',
    weight: 25,
    issueGroups: ['formula_consistency'],
    penalties: { error: 15, critical: 10, significant: 5, warning: 2, info: 0 },
  },
  rule_compliance: {
    id: 'rule_compliance',
    label: 'Соответствие правилам',
    weight: 20,
    issueGroups: ['field_validation'],
    penalties: { error: 12, critical: 8, significant: 4, warning: 1, info: 0 },
  },
  mapping_consistency: {
    id: 'mapping_consistency',
    label: 'Согласованность привязок',
    weight: 15,
    issueGroups: [], // Рассчитывается через DeltaResult, не через issues
    penalties: { error: 20, critical: 15, significant: 8, warning: 3, info: 0 },
  },
  operational_risk: {
    id: 'operational_risk',
    label: 'Операционные риски',
    weight: 10,
    issueGroups: ['temporal', 'financial', 'economy_control'],
    penalties: { error: 15, critical: 10, significant: 5, warning: 2, info: 0 },
  },
};

// ────────────────────────────────────────────────────────────
// 8. РЕЕСТР ПРОВЕРОК (CHECK_REGISTRY)
// ────────────────────────────────────────────────────────────

/**
 * Полный реестр всех проверок: 12 правил + 16 сигналов = 28 проверок.
 * Метаданные без функций check (те подключаются отдельно).
 *
 * Распределение серьёзности:
 *   error:       budget_sum_plan, budget_sum_fact, dept_fact_sum, dept_economy_sum,
 *                execution_percentage, deviation_calc, method_validation, type_validation,
 *                formula_broken
 *   critical:    overdue, stalled_contract
 *   significant: fact_exceeds_plan, anti_dumping, budget_mismatch, q1_leq_year
 *   warning:     economy_conflict, early_closure, fact_without_date, date_without_fact,
 *                data_quality, fact_date_before_plan, economy_sign_check,
 *                formula_continuity, fact_leq_plan
 *   info:        ep_risk, single_participant, status_on_data_rows, low_competition,
 *                economy_hidden
 */
export interface CheckRegistryEntry {
  id: string;
  group: IssueGroup;
  name: string;
  description: string;
  severity: UnifiedSeverity;
  origin: CheckOrigin;
  scope: RuleScope;
  article44fz?: string;
  kbHint: string;
  recommendation: string;
  trustComponent: TrustComponentId;
  /** Предыдущий ID (для миграции) */
  legacyId?: string;
  /** Тип источника: rule = из RULE_BOOK, signal = из signals.ts, new = новая */
  sourceType: 'rule' | 'signal' | 'new';
}

export const CHECK_REGISTRY: CheckRegistryEntry[] = [
  // ================================================================
  // ГРУППА: data_integrity — Целостность данных
  // ================================================================
  {
    id: 'budget_sum_plan',
    group: 'data_integrity',
    name: 'Консистентность плановых сумм бюджета',
    description: 'K (итого план) = H + I + J (ФБ + КБ + МБ). Допуск: 1 руб.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'both',
    kbHint: 'Итого плановой суммы должно точно совпадать с суммой компонент по бюджетам. Расхождение указывает на ошибку формулы или ручной ввод.',
    recommendation: 'Проверить формулу K = H + I + J, исправить расхождение',
    trustComponent: 'data_quality',
    legacyId: 'budget_sum_plan',
    sourceType: 'rule',
  },
  {
    id: 'budget_sum_fact',
    group: 'data_integrity',
    name: 'Консистентность фактических сумм бюджета (СВОД)',
    description: 'O (итого факт) = L + M + N (ФБ + КБ + МБ факт). Только СВОД.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'svod',
    kbHint: 'На листе СВОД ТД-ПМ столбцы L/M/N/O содержат фактические суммы по бюджетам.',
    recommendation: 'Проверить формулу O = L + M + N на листе СВОД',
    trustComponent: 'data_quality',
    legacyId: 'budget_sum_fact',
    sourceType: 'rule',
  },
  {
    id: 'dept_fact_sum',
    group: 'data_integrity',
    name: 'Консистентность фактических сумм (подразделения)',
    description: 'Y (итого факт) = V + W + X. Допуск: 1 руб.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'department',
    kbHint: 'На листах подразделений Y = итого факт, V/W/X = компоненты по бюджетам.',
    recommendation: 'Проверить формулу Y = V + W + X',
    trustComponent: 'data_quality',
    legacyId: 'dept_fact_sum',
    sourceType: 'rule',
  },
  {
    id: 'dept_economy_sum',
    group: 'data_integrity',
    name: 'Консистентность сумм экономии (подразделения)',
    description: 'AC (итого экономия) = Z + AA + AB. Допуск: 1 руб.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'department',
    kbHint: 'Итого экономии должно совпадать с суммой ФБ + КБ + МБ экономии.',
    recommendation: 'Проверить формулу AC = Z + AA + AB',
    trustComponent: 'data_quality',
    legacyId: 'dept_economy_sum',
    sourceType: 'rule',
  },
  {
    id: 'formula_broken',
    group: 'data_integrity',
    name: 'Формула возвращает ошибку',
    description: 'Ячейка содержит #REF, #VALUE, #N/A, #NAME, #DIV/0 и т.д.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'both',
    kbHint: 'Формульная ошибка означает, что ячейка не может рассчитать значение. Часто — из-за удалённой строки/столбца или некорректной ссылки.',
    recommendation: 'Исправить формулу в указанной ячейке Google Sheets',
    trustComponent: 'data_quality',
    legacyId: 'formulaBroken',
    sourceType: 'signal',
  },
  // УДАЛЁН: budgetMismatch (signal) — дубль budget_sum_plan

  // ================================================================
  // ГРУППА: formula_consistency — Формульная согласованность
  // ================================================================
  {
    id: 'execution_percentage',
    group: 'formula_consistency',
    name: 'Расчёт процента исполнения (СВОД)',
    description: 'G (% исполнения) = E / D * 100 при D > 0.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'svod',
    kbHint: 'Процент исполнения — ключевой KPI. Ошибка в формуле искажает отчётность перед руководством.',
    recommendation: 'Проверить формулу G = E/D*100 на указанной строке',
    trustComponent: 'formula_integrity',
    legacyId: 'execution_percentage',
    sourceType: 'rule',
  },
  {
    id: 'deviation_calc',
    group: 'formula_consistency',
    name: 'Расчёт отклонения количества (СВОД)',
    description: 'F (отклонение) = E - D (факт минус план).',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'svod',
    kbHint: 'Отклонение показывает разницу между фактическим и плановым количеством процедур. Положительное = перевыполнение.',
    recommendation: 'Проверить формулу F = E - D (факт − план)',
    trustComponent: 'formula_integrity',
    legacyId: 'deviation_calc',
    sourceType: 'rule',
  },
  {
    id: 'q1_leq_year',
    group: 'formula_consistency',
    name: 'Q1 не превышает Год',
    description: 'Квартальные значения D и K не должны превышать годовые.',
    severity: 'significant',
    origin: 'spreadsheet_rule',
    scope: 'svod',
    kbHint: 'Квартал — часть года. Превышение квартального значения над годовым логически невозможно.',
    recommendation: 'Проверить корректность данных в строках Q1 и Год',
    trustComponent: 'formula_integrity',
    legacyId: 'q1_leq_year',
    sourceType: 'rule',
  },
  {
    id: 'formula_continuity',
    group: 'formula_consistency',
    name: 'Непрерывность данных в столбцах',
    description: 'Пустое значение среди заполненных соседей — возможно удалённая формула.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Если 3+ соседних строк содержат данные, а текущая пуста — возможно, формула была случайно удалена.',
    recommendation: 'Проверить ячейку: восстановить формулу или подтвердить корректность пустого значения',
    trustComponent: 'formula_integrity',
    legacyId: 'formula_continuity',
    sourceType: 'rule',
  },

  // ================================================================
  // ГРУППА: field_validation — Валидация полей
  // ================================================================
  {
    id: 'method_validation',
    group: 'field_validation',
    name: 'Валидация метода закупки',
    description: 'Столбец L должен содержать ЭА, ЕП, ЭК или ЭЗК.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'department',
    kbHint: 'Метод закупки определяет правовой режим процедуры. Некорректное значение нарушает классификацию.',
    recommendation: 'Исправить значение L на одно из допустимых: ЭА, ЕП, ЭК, ЭЗК',
    trustComponent: 'rule_compliance',
    legacyId: 'method_validation',
    sourceType: 'rule',
  },
  {
    id: 'type_validation',
    group: 'field_validation',
    name: 'Валидация типа закупки',
    description: 'Столбец F должен содержать допустимый вид деятельности.',
    severity: 'error',
    origin: 'spreadsheet_rule',
    scope: 'department',
    kbHint: 'Тип закупки (текущая/программная) влияет на бюджетную классификацию.',
    recommendation: 'Исправить значение F на допустимое значение',
    trustComponent: 'rule_compliance',
    legacyId: 'type_validation',
    sourceType: 'rule',
  },
  {
    id: 'data_quality',
    group: 'completeness',
    name: 'Пустые обязательные поля',
    description: 'На строке закупки с фактом отсутствуют обязательные поля (D, K, L).',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Обязательные поля: предмет (D), плановая сумма (K), метод (L). Без них строка не поддаётся анализу.',
    recommendation: 'Заполнить недостающие данные в обязательных столбцах',
    trustComponent: 'data_quality',
    legacyId: 'dataQuality',
    sourceType: 'signal',
  },

  // ================================================================
  // ГРУППА: temporal — Временные аномалии
  // ================================================================
  {
    id: 'overdue',
    group: 'temporal',
    name: 'Просрочка закупки',
    description: 'Плановая дата прошла, факта нет, контракт не подписан, не отменён.',
    severity: 'critical',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Просрочка — ключевой индикатор для руководства. Требует немедленного анализа причин.',
    recommendation: 'Провести анализ причин просрочки и принять корректирующие меры',
    trustComponent: 'operational_risk',
    legacyId: 'overdue',
    sourceType: 'signal',
  },
  {
    id: 'stalled_contract',
    group: 'temporal',
    name: 'Подвисший контракт',
    description: 'Контракт подписан, но нет факт даты и план дата просрочена > 60 дней.',
    severity: 'critical',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Подвисший контракт = подписан, но не исполняется. Возможны проблемы с подрядчиком.',
    recommendation: 'Проверить статус исполнения контракта, связаться с подрядчиком',
    trustComponent: 'operational_risk',
    legacyId: 'stalledContract',
    sourceType: 'signal',
  },
  {
    id: 'early_closure',
    group: 'temporal',
    name: 'Раннее закрытие',
    description: 'Факт дата раньше плановой на > 30 дней.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Раннее закрытие может означать ошибку в дате или необычную ситуацию.',
    recommendation: 'Проверить фактическую дату завершения, возможна ошибка данных',
    trustComponent: 'operational_risk',
    legacyId: 'earlyClosure',
    sourceType: 'signal',
  },
  {
    id: 'finance_delay',
    group: 'temporal',
    name: 'Задержка финансирования',
    description: 'В комментариях ГРБС/УЭР обнаружено упоминание задержки финансирования.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Упоминание "финансирование" или "отсутствие финансирования" в AE/AF — индикатор задержки оплаты.',
    recommendation: 'Проверить статус финансирования, связаться с финансовым подразделением',
    trustComponent: 'operational_risk',
    legacyId: 'financeDelay',
    sourceType: 'signal',
  },
  {
    id: 'fact_date_before_plan',
    group: 'temporal',
    name: 'Факт дата раньше плана',
    description: 'Факт дата на 1-30 дней раньше плановой — возможная ошибка данных.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Контракт не может быть заключён до плановой даты публикации извещения.',
    recommendation: 'Проверить корректность дат: факт дата не может быть раньше плановой',
    trustComponent: 'operational_risk',
    legacyId: 'factDateBeforePlan',
    sourceType: 'signal',
  },

  // ================================================================
  // ГРУППА: financial — Финансовые аномалии
  // ================================================================
  {
    id: 'fact_vs_plan',
    group: 'financial',
    name: 'Факт превышает план',
    description: 'Фактическая сумма/количество превышает плановую на > 10%.',
    severity: 'significant',
    origin: 'bi_heuristic',
    scope: 'both',
    kbHint: 'Превышение факта над планом может означать дополнительные закупки или ошибку данных. Пороги: info >0%, warning >5%, significant >10%.',
    recommendation: 'Проверить обоснование превышения, провести бюджетную корректировку',
    trustComponent: 'operational_risk',
    // ОБЪЕДИНЯЕТ: Rule 5 (fact_leq_plan), Rule 12 (dept_fact_leq_plan), Signal (factExceedsPlan)
    legacyId: 'factExceedsPlan',
    sourceType: 'signal',
  },
  {
    id: 'anti_dumping',
    group: 'financial',
    name: 'Антидемпинговый сигнал (> 25%)',
    description: 'Высокая экономия (лимит−факт) > 25%. Внимание: это лимит−факт, НЕ НМЦ−факт. Антидемпинг по ст.37 44-ФЗ требует НМЦК, которой нет в данных.',
    severity: 'significant',
    origin: 'compliance_44fz',
    scope: 'department',
    article44fz: 'ст. 37',
    kbHint: 'При снижении цены > 25% от НМЦК заказчик обязан применить антидемпинговые меры (44-ФЗ ст.37).',
    recommendation: 'Запросить обоснование антидемпинговых мер по ст.37 44-ФЗ',
    trustComponent: 'operational_risk',
    legacyId: 'highEconomy',
    sourceType: 'signal',
  },
  {
    id: 'ep_risk',
    group: 'financial',
    name: 'ЕП-риск (> 600 тыс.)',
    description: 'Закупка у единственного поставщика с суммой > 600 000 руб. (п.4 ст.93 44-ФЗ).',
    severity: 'info',
    origin: 'compliance_44fz',
    scope: 'department',
    article44fz: 'п.4 ст.93',
    kbHint: 'По п.4 ст.93 44-ФЗ закупка у ЕП до 600 тыс. руб. не требует обоснования. Выше — требует.',
    recommendation: 'Проверить обоснование закупки у единственного поставщика по п.4 ст.93 44-ФЗ',
    trustComponent: 'operational_risk',
    legacyId: 'epRisk',
    sourceType: 'signal',
  },
  {
    id: 'low_competition',
    group: 'financial',
    name: 'Низкая конкуренция (< 2%)',
    description: 'Экономия менее 2% — возможен предопределённый победитель.',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Экономия < 2% при конкурентной процедуре — индикатор формальной конкуренции.',
    recommendation: 'Проверить условия обеспечения конкуренции',
    trustComponent: 'operational_risk',
    legacyId: 'lowCompetition',
    sourceType: 'signal',
  },
  {
    id: 'economy_sign_check',
    group: 'financial',
    name: 'Отрицательная экономия (СВОД)',
    description: 'U (экономия) < 0 — возможен перерасход.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'svod',
    kbHint: 'Отрицательная экономия означает, что фактическая стоимость превысила плановую.',
    recommendation: 'Проверить причину перерасхода',
    trustComponent: 'operational_risk',
    legacyId: 'economy_sign_check',
    sourceType: 'rule',
  },

  // ================================================================
  // ГРУППА: economy_control — Контроль экономии
  // ================================================================
  {
    id: 'economy_conflict',
    group: 'economy_control',
    name: 'Конфликт флага экономии',
    description: 'Два случая: (а) AD="экономия", но факт ≥ план — некорректный флаг; (б) экономия >15%, но финансовый орган не определил флаг экономии в столбце AD.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Случай А: AD="экономия" но факт ≥ план (некорректный флаг). Случай Б: экономия >15% но финансовый орган не определил флаг экономии (AD пуст).',
    recommendation: 'Случай А: убрать флаг экономии (факт ≥ план). Случай Б: финансовому органу необходимо установить флаг экономии в столбце AD.',
    trustComponent: 'operational_risk',
    legacyId: 'economyConflict',
    sourceType: 'signal',
  },
  {
    id: 'status_on_data_rows',
    group: 'economy_control',
    name: 'Статус (AD) на строках данных',
    description: 'Столбец AD должен быть заполнен на строках закупок с фактом.',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'AD (флаг) заполняется после фактического исполнения для контроля экономии.',
    recommendation: 'Заполнить статус в столбце AD',
    trustComponent: 'rule_compliance',
    legacyId: 'status_on_data_rows',
    sourceType: 'rule',
  },
  {
    id: 'economy_hidden',
    group: 'economy_control',
    name: 'Скрытая экономия (> 15% без AD)',
    description: 'Экономия > 15% без флага AD и без комментария — потенциально скрытые средства.',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Существенная экономия без флага и комментария может указывать на неучтённые средства.',
    recommendation: 'Проверить причину экономии, при необходимости установить флаг AD',
    trustComponent: 'rule_compliance',
    sourceType: 'new',
  },

  // ================================================================
  // ГРУППА: completeness — Полнота данных
  // ================================================================
  {
    id: 'fact_without_date',
    group: 'completeness',
    name: 'Факт суммы без даты',
    description: 'Есть фактические суммы (V/W/X/Y > 0), но нет факт даты (Q).',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Без даты факта невозможно корректно отнести исполнение к периоду.',
    recommendation: 'Заполнить дату факта (столбец Q) для корректного учёта',
    trustComponent: 'data_quality',
    legacyId: 'factWithoutDate',
    sourceType: 'signal',
  },
  {
    id: 'date_without_fact',
    group: 'completeness',
    name: 'Факт дата без сумм',
    description: 'Есть факт дата (Q), но нет факт сумм — неполные данные.',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Дата факта указана, но суммы не заполнены — возможно, данные введены частично.',
    recommendation: 'Заполнить фактические суммы (V/W/X) или удалить некорректную дату',
    trustComponent: 'data_quality',
    legacyId: 'dateWithoutFact',
    sourceType: 'signal',
  },
  {
    id: 'single_participant',
    group: 'financial',
    name: 'Единственный участник',
    description: 'Конкурентная процедура с одним участником — формальная конкуренция.',
    severity: 'info',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Единственный участник — индикатор проблемы с формированием ТЗ или ограничением конкуренции.',
    recommendation: 'Проверить условия обеспечения конкуренции',
    trustComponent: 'operational_risk',
    legacyId: 'singleParticipant',
    sourceType: 'signal',
  },

  // ================================================================
  // P1: НОВЫЕ СИГНАЛЫ (из аудита 2026-04-13)
  // ================================================================
  {
    id: 'plan_without_execution',
    group: 'temporal',
    name: 'План без исполнения',
    description: 'План существует (K > 0), но нет факта, хотя год уже идёт (апрель+).',
    severity: 'warning',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Закупка запланирована и бюджет выделен, но исполнение не начато. При прогрессировании года это требует внимания.',
    recommendation: 'Уточнить статус закупки: планируется ли размещение, требуется ли корректировка плана',
    trustComponent: 'operational_risk',
    legacyId: 'planWithoutExecution',
    sourceType: 'signal',
  },
  {
    id: 'ep_justification_missing',
    group: 'completeness',
    name: 'ЕП без обоснования',
    description: 'Метод закупки — ЕП (единственный поставщик), но столбец M (обоснование) пуст.',
    severity: 'significant',
    origin: 'compliance_44fz',
    scope: 'department',
    article44fz: 'ст.93',
    kbHint: 'По 44-ФЗ (ст.93) закупка у единственного поставщика требует обоснования. Отсутствие обоснования — нарушение.',
    recommendation: 'Заполнить обоснование ЕП в столбце M с указанием пункта ст.93 44-ФЗ',
    trustComponent: 'rule_compliance',
    legacyId: 'epJustificationMissing',
    sourceType: 'signal',
  },
  {
    id: 'budget_underallocation',
    group: 'data_integrity',
    name: 'Факт без планового бюджета',
    description: 'Фактические суммы (Y > 0) при отсутствии планового бюджета (K = 0).',
    severity: 'significant',
    origin: 'bi_heuristic',
    scope: 'department',
    kbHint: 'Исполнение без планового бюджета — аномалия данных. Либо план не внесён, либо закупка внеплановая.',
    recommendation: 'Проверить: внести плановые суммы или обосновать внеплановую закупку',
    trustComponent: 'data_quality',
    legacyId: 'budgetUnderallocation',
    sourceType: 'signal',
  },
];

// ────────────────────────────────────────────────────────────
// 9. АГРЕГАЦИЯ — модели для dashboard
// ────────────────────────────────────────────────────────────

/** Агрегат замечаний по группе */
export interface IssueGroupAggregate {
  group: IssueGroup;
  label: string;
  total: number;
  bySeverity: Record<UnifiedSeverity, number>;
  topCheckIds: string[];    // Топ-3 проверки с наибольшим числом срабатываний
  trend?: 'up' | 'down' | 'stable';
}

/** Агрегат замечаний по управлению */
export interface DepartmentIssueAggregate {
  departmentId: DepartmentId;
  total: number;
  bySeverity: Record<UnifiedSeverity, number>;
  byGroup: Record<IssueGroup, number>;
  trustScore: number;
  trustGrade: TrustGrade;
}

/** Агрегат сигналов по управлению (для тепловой карты) */
export interface DepartmentSignalHeatmap {
  departmentId: DepartmentId;
  /** Счётчики по каждому сигналу */
  signalCounts: Record<string, number>;
  /** Общее количество строк данных */
  totalDataRows: number;
  /** Процент строк с хотя бы одним сигналом */
  signalCoverage: number;
}

/** Полный пакет агрегации для dashboard */
export interface AggregatedIssueData {
  /** Агрегаты по группам */
  byGroup: IssueGroupAggregate[];
  /** Агрегаты по управлениям */
  byDepartment: DepartmentIssueAggregate[];
  /** Тепловая карта сигналов */
  signalHeatmap: DepartmentSignalHeatmap[];
  /** Общие итоги */
  totals: {
    issues: number;
    bySeverity: Record<UnifiedSeverity, number>;
    byOrigin: Record<CheckOrigin, number>;
    resolvedLastWeek: number;
    newLastWeek: number;
  };
  /** Время расчёта */
  computedAt: string;
}

// ────────────────────────────────────────────────────────────
// 10. РЕКОМЕНДАЦИИ — связь Issue → Action
// ────────────────────────────────────────────────────────────

/**
 * Рекомендация — actionable действие, порождённое замечанием.
 * Цепочка: UnifiedCheck → UnifiedIssue → Recommendation
 */
export interface Recommendation {
  id: string;
  /** ID замечания-источника */
  issueId: string;
  /** ID проверки (для группировки похожих рекомендаций) */
  checkId: string;
  /** Текст рекомендации (русский) */
  text: string;
  /** Приоритет (наследуется от severity) */
  priority: UnifiedSeverity;
  /** Ответственный (управление) */
  departmentId: DepartmentId | null;
  /** Статус */
  status: 'pending' | 'in_progress' | 'done' | 'dismissed';
  /** Статья 44-ФЗ (если применимо) */
  article44fz?: string;
  /** Дедлайн (если есть) */
  dueDate?: string;
}

// ────────────────────────────────────────────────────────────
// 11. МАППИНГ LEGACY → UNIFIED
// ────────────────────────────────────────────────────────────

/**
 * Маппинг старых ID сигналов → новые ID проверок.
 * Для обратной совместимости при миграции.
 */
export const LEGACY_SIGNAL_TO_CHECK: Record<string, string> = {
  // Сигналы из SIGNAL_ISSUE_MAP
  overdue: 'overdue',
  stalledContract: 'stalled_contract',
  factExceedsPlan: 'fact_vs_plan',
  earlyClosure: 'early_closure',
  highEconomy: 'anti_dumping',
  epRisk: 'ep_risk',
  // budgetMismatch: УДАЛЁН — дубль Rule 1a (budget_sum_plan). Signal всегда false.
  economyConflict: 'economy_conflict',
  factWithoutDate: 'fact_without_date',
  dateWithoutFact: 'date_without_fact',
  dataQuality: 'data_quality',
  singleParticipant: 'single_participant',
  factDateBeforePlan: 'fact_date_before_plan',
  financeDelay: 'finance_delay',
  // Дополнительные сигналы (без Issue, только badge)
  lowCompetition: 'low_competition',
  formulaBroken: 'formula_broken',
  // P1: Новые сигналы (аудит 2026-04-13)
  planWithoutExecution: 'plan_without_execution',
  epJustificationMissing: 'ep_justification_missing',
  budgetUnderallocation: 'budget_underallocation',
};

/**
 * Маппинг старых rule ID → новые check ID.
 */
export const LEGACY_RULE_TO_CHECK: Record<string, string> = {
  budget_sum_plan: 'budget_sum_plan',
  budget_sum_fact: 'budget_sum_fact',
  execution_percentage: 'execution_percentage',
  deviation_calc: 'deviation_calc',
  q1_leq_year: 'q1_leq_year',
  fact_leq_plan: 'fact_vs_plan',          // ОБЪЕДИНЁН
  method_validation: 'method_validation',
  type_validation: 'type_validation',
  status_on_data_rows: 'status_on_data_rows',
  economy_sign_check: 'economy_sign_check',
  dept_fact_sum: 'dept_fact_sum',
  dept_economy_sum: 'dept_economy_sum',
  dept_fact_leq_plan: 'fact_vs_plan',     // ОБЪЕДИНЁН
  formula_continuity: 'formula_continuity',
};

// ────────────────────────────────────────────────────────────
// 12. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────
// 13. КОНВЕРТЕР Legacy Issue → UnifiedIssue
// ────────────────────────────────────────────────────────────

/**
 * Конвертирует legacy Issue (из validateData/detectSignalsToIssues)
 * в UnifiedIssue с полным набором координат и привязкой к реестру.
 */
export function convertLegacyIssue(
  issue: {
    id: string;
    severity: string;
    origin: string;
    category: string;
    title: string;
    description: string;
    sheet?: string;
    cell?: string;
    row?: number;
    departmentId?: string;
    recommendation?: string;
    activityType?: string;
    signal?: string;
    status: string;
    detectedAt: string;
    detectedBy: string;
  },
  year: number = 2026,
): UnifiedIssue {
  // Resolve check ID from signal or rule
  let checkId: string;
  if (issue.signal && LEGACY_SIGNAL_TO_CHECK[issue.signal as keyof typeof LEGACY_SIGNAL_TO_CHECK]) {
    checkId = LEGACY_SIGNAL_TO_CHECK[issue.signal as keyof typeof LEGACY_SIGNAL_TO_CHECK];
  } else if (LEGACY_RULE_TO_CHECK[issue.category]) {
    checkId = LEGACY_RULE_TO_CHECK[issue.category];
  } else {
    checkId = issue.category || 'unknown';
  }

  const check = CHECK_REGISTRY.find(c => c.id === checkId);

  // Map legacy severity to unified
  const severityMap: Record<string, UnifiedSeverity> = {
    error: 'error', critical: 'critical', significant: 'significant',
    warning: 'warning', info: 'info',
  };

  const severity = check?.severity ?? severityMap[issue.severity] ?? 'info';
  const group = check?.group ?? resolveGroupFromCategory(issue.category);

  // Extract month/quarter from description or cell reference
  const monthMatch = issue.description?.match(/месяц\s*(\d+)|m(\d+)|строка/i);
  const month = monthMatch ? parseInt(monthMatch[1] || monthMatch[2]) || null : null;

  return {
    id: issue.id,
    checkId,
    group,
    severity,
    origin: (check?.origin ?? issue.origin ?? 'bi_heuristic') as CheckOrigin,
    title: issue.title,
    description: issue.description,
    recommendation: check?.recommendation ?? issue.recommendation ?? '',
    kbHint: check?.kbHint ?? '',
    dimensions: {
      departmentId: (issue.departmentId as DepartmentId) ?? null,
      subordinate: null,
      month,
      quarter: null,
      year,
      method: null,
      activityType: (issue.activityType as FilterDimensions['activityType']) ?? null,
      sheet: issue.sheet ?? '',
      row: issue.row ?? null,
      cell: issue.cell ?? null,
    },
    actual: undefined,
    expected: undefined,
    metadata: {},
    status: issue.status as IssueStatus,
    detectedAt: issue.detectedAt,
    detectedBy: issue.detectedBy,
  };
}

/** Resolve group from legacy category string */
function resolveGroupFromCategory(category: string): IssueGroup {
  if (!category) return 'completeness';
  const cat = category.toLowerCase();
  if (cat.includes('budget') || cat.includes('sum')) return 'data_integrity';
  if (cat.includes('formula') || cat.includes('execution') || cat.includes('deviation')) return 'formula_consistency';
  if (cat.includes('method') || cat.includes('type') || cat.includes('validation')) return 'field_validation';
  if (cat.includes('overdue') || cat.includes('stalled') || cat.includes('early') || cat.includes('date')) return 'temporal';
  if (cat.includes('fact') || cat.includes('anti') || cat.includes('ep_risk') || cat.includes('dump')) return 'financial';
  if (cat.includes('economy') || cat.includes('status_on') || cat.includes('flag')) return 'economy_control';
  if (cat.includes('signal:overdue') || cat.includes('signal:stalled')) return 'temporal';
  if (cat.includes('signal:economy') || cat.includes('signal:anti')) return 'financial';
  if (cat.includes('signal:fact') || cat.includes('signal:date')) return 'completeness';
  return 'completeness';
}

/**
 * Batch convert all legacy issues to unified.
 */
export function convertAllIssues(
  issues: Array<{
    id: string; severity: string; origin: string; category: string;
    title: string; description: string; sheet?: string; cell?: string;
    row?: number; departmentId?: string; recommendation?: string;
    activityType?: string; signal?: string; status: string;
    detectedAt: string; detectedBy: string;
  }>,
  year?: number,
): UnifiedIssue[] {
  return issues.map(i => convertLegacyIssue(i, year));
}

// ────────────────────────────────────────────────────────────
// 14. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ────────────────────────────────────────────────────────────

/** Получить метаданные проверки по ID */
export function getCheckById(id: string): CheckRegistryEntry | undefined {
  return CHECK_REGISTRY.find(c => c.id === id);
}

/** Получить все проверки группы */
export function getChecksByGroup(group: IssueGroup): CheckRegistryEntry[] {
  return CHECK_REGISTRY.filter(c => c.group === group);
}

/** Получить все проверки для scope */
export function getChecksByScope(scope: RuleScope): CheckRegistryEntry[] {
  return CHECK_REGISTRY.filter(c => c.scope === scope || c.scope === 'both');
}

/** Сравнить серьёзность (для сортировки: от худшей к лучшей) */
export function compareSeverity(a: UnifiedSeverity, b: UnifiedSeverity): number {
  return SEVERITY_WEIGHT[b] - SEVERITY_WEIGHT[a];
}

/** Пустая запись агрегации по серьёзности */
export function emptySeverityCount(): Record<UnifiedSeverity, number> {
  return { error: 0, critical: 0, significant: 0, warning: 0, info: 0 };
}

/** Рассчитать агрегат замечаний по группам */
export function aggregateByGroup(issues: UnifiedIssue[]): IssueGroupAggregate[] {
  const groups = Object.keys(ISSUE_GROUP_META) as IssueGroup[];
  return groups.map(group => {
    const groupIssues = issues.filter(i => i.group === group);
    const bySeverity = emptySeverityCount();
    for (const issue of groupIssues) {
      bySeverity[issue.severity]++;
    }

    // Топ-3 проверки
    const checkCounts = new Map<string, number>();
    for (const issue of groupIssues) {
      checkCounts.set(issue.checkId, (checkCounts.get(issue.checkId) ?? 0) + 1);
    }
    const topCheckIds = [...checkCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);

    return {
      group,
      label: ISSUE_GROUP_META[group].label,
      total: groupIssues.length,
      bySeverity,
      topCheckIds,
    };
  });
}

/** Рассчитать агрегат замечаний по управлениям */
export function aggregateByDepartment(
  issues: UnifiedIssue[],
  departmentIds: DepartmentId[],
): DepartmentIssueAggregate[] {
  return departmentIds.map(deptId => {
    const deptIssues = issues.filter(i => i.dimensions.departmentId === deptId);
    const bySeverity = emptySeverityCount();
    const byGroup: Record<string, number> = {};
    const groups = Object.keys(ISSUE_GROUP_META) as IssueGroup[];
    for (const g of groups) byGroup[g] = 0;

    for (const issue of deptIssues) {
      bySeverity[issue.severity]++;
      byGroup[issue.group] = (byGroup[issue.group] ?? 0) + 1;
    }

    return {
      departmentId: deptId,
      total: deptIssues.length,
      bySeverity,
      byGroup: byGroup as Record<IssueGroup, number>,
      trustScore: 0,    // рассчитывается отдельно через TrustComponentConfig
      trustGrade: 'C' as TrustGrade,
    };
  });
}
