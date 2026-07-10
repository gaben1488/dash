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
  IssueStatus,
  RuleScope,
  RowClassification,
  TrustGrade,
} from './types.js';
import { CHECK_REGISTRY, type CheckRegistryEntry } from './check-registry.js';

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
// CHECK_REGISTRY + CheckRegistryEntry вынесены в ./check-registry.ts (чанк G)
export { CHECK_REGISTRY, type CheckRegistryEntry } from './check-registry.js';
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
// Конвертация legacy-issue вынесена в ./issue-conversion.ts (чанк G, шаг 2)
export { LEGACY_SIGNAL_TO_CHECK, LEGACY_RULE_TO_CHECK, convertLegacyIssue, convertAllIssues } from './issue-conversion.js';
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
