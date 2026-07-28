/**
 * product-dictionary.ts — SSOT человеческих лейблов продукта AEMR (фаза 1.1).
 *
 * Жёсткое требование (спека §6.3): ни один внутренний ключ не должен доходить
 * до глаз пользователя в UI. Здесь — единый источник «внутренний ключ →
 * человеческая русская фраза».
 *
 * Принцип: значения ПЕРЕИСПОЛЬЗУЮТ уже существующие русские лейблы реестров
 * (не изобретаются заново). Источники:
 *   - EP-причины  → dictionaries/ep-reason-clusters.ts (EP_REASON_DICT[*].label_ru), derive
 *   - ГРБС        → department-registry.ts (DEPARTMENT_REGISTRY shortName/fullName), derive
 *   - Сигналы     → web/DataBrowser.tsx SIGNAL_LABELS + core/signals.ts getSignalBadges
 *                   + check-registry.ts (зеркалятся: shared не зависит от core/web)
 *   - Метрики     → core/calc-engine.ts метрики .label (зеркалятся по той же причине)
 *   - Статусы     → types.ts IssueStatus
 *   - _org_itself → ORG_ITSELF_SENTINEL
 *
 * Проводка в компоненты — фазы 2/4. Сейчас только словарь + guard-тест.
 *
 * ВАЖНО про зеркала: SIGNAL_LABELS и METRIC_LABELS скопированы из core/web,
 * потому что @aemr/shared не может импортировать @aemr/core/@aemr/web (обратная
 * зависимость). При изменении лейбла в источнике синхронизировать здесь.
 * В фазах 2/4 источники начнут импортировать эти карты отсюда — дрейф исчезнет.
 */

import { EP_REASON_CLUSTERS, EP_REASON_DICT } from './dictionaries/ep-reason-clusters.js';
import { DEPARTMENT_REGISTRY } from './department-registry.js';
import { ORG_ITSELF_SENTINEL } from './dictionaries/subordinate-registry.js';

// ────────────────────────────────────────────────────────────
// 1. EP-причины (обоснование ЕП, колонка M) — derive из EP_REASON_DICT
// ────────────────────────────────────────────────────────────

/**
 * Часть registry-лейблов содержит кальку/жаргон, недопустимый для глаз
 * пользователя. Здесь — человеческие переформулировки поверх label_ru.
 */
const EP_CLUSTER_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  // label_ru = «Малая электронная закупка (процедурный мисматч)» — «мисматч»
  // это калька; для UI даём смысл без жаргона.
  EP_SMALL_EL_PURCH: 'Малая электронная закупка (процедура ЭА, не основание ЕП)',
};

/** Ключ обоснования ЕП → человеческая фраза. */
export const EP_REASON_LABELS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(EP_REASON_CLUSTERS.map((c) => [c, EP_REASON_DICT[c].label_ru])),
  ...EP_CLUSTER_LABEL_OVERRIDES,
  EMPTY: 'причина не указана',
  UNMAPPED: 'причина не распознана',
};

// ────────────────────────────────────────────────────────────
// 2. Аналитические сигналы строки (RowSignals, 29 флагов)
// ────────────────────────────────────────────────────────────

/**
 * Ключ сигнала → человеческая фраза.
 * Значения из web/DataBrowser.tsx SIGNAL_LABELS (что видит пользователь в
 * основном UI), недостающие — из core/signals.ts getSignalBadges и
 * check-registry.ts (canonical names).
 */
export const SIGNAL_LABELS: Readonly<Record<string, string>> = {
  // ── Позитивные / состояния ──
  signed: 'Подписан',
  hasFact: 'Есть факт',
  economyFlag: 'Экономия',
  planning: 'Планирование',
  notDue: 'Срок не наступил',
  canceled: 'Отменён',
  // ── Критические ──
  overdue: 'Просрочен',
  epRisk: 'ЕП-риск',
  highEconomy: 'Высокая экономия свыше 25%',
  economyConflict: 'Конфликт флага экономии',
  factExceedsPlan: 'Факт больше плана',
  formulaBroken: 'Ошибка формулы',
  budgetMismatch: 'Расхождение бюджета',
  // ── Предупреждения ──
  stalledContract: 'Подвисший контракт',
  earlyClosure: 'Раннее закрытие',
  financeDelay: 'Задержка финансирования',
  planSoon: 'Скоро срок',
  lowCompetition: 'Низкая конкуренция ниже 2%',
  singleParticipant: 'Единственный участник',
  dataQuality: 'Пустые обязательные поля',
  factDateBeforePlan: 'Факт раньше плановой даты',
  futureFactDate: 'Дата факта в будущем',
  planWithoutExecution: 'План без исполнения',
  epJustificationMissing: 'ЕП без обоснования',
  methodReasonMismatch: 'Метод не соответствует обоснованию ЕП',
  unmappedReasonEP: 'Обоснование ЕП не распознано',
  budgetUnderallocation: 'Факт без планового бюджета',
  budgetSourceMissing: 'Не указаны источники бюджета',
  factWithoutDate: 'Факт суммы без даты',
  dateWithoutFact: 'Факт дата без сумм',
};

// ────────────────────────────────────────────────────────────
// 3. ГРБС (управления) — derive из DEPARTMENT_REGISTRY
// ────────────────────────────────────────────────────────────

/** Латинский id управления → краткое кириллическое имя (напр. 'uo' → 'УО'). */
export const DEPT_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  DEPARTMENT_REGISTRY.map((d) => [d.latinId, d.shortName]),
);

/** Латинский id управления → полное наименование. */
export const DEPT_FULLNAME_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  DEPARTMENT_REGISTRY.map((d) => [d.latinId, d.fullName]),
);

// ────────────────────────────────────────────────────────────
// 4. Статусы замечаний (IssueStatus)
// ────────────────────────────────────────────────────────────

/** Статус замечания → человеческая фраза. */
export const ISSUE_STATUS_LABELS: Readonly<Record<string, string>> = {
  open: 'Открыто',
  acknowledged: 'Принято',
  in_progress: 'В работе',
  resolved: 'Исправлено',
  wont_fix: 'Не будет исправляться',
  false_positive: 'Ложное срабатывание',
};

// ────────────────────────────────────────────────────────────
// 5. Способы закупки (внутренние ключи семейств)
// ────────────────────────────────────────────────────────────

/**
 * Внутренний ключ способа/семейства → человеческая фраза.
 * Кириллические коды (ЭА/ЕП/ЭК/ЭЗК) уже человекочитаемы и остаются как есть;
 * здесь переводятся именно латинские внутренние ключи, утекающие в UI.
 */
export const METHOD_LABELS: Readonly<Record<string, string>> = {
  competitive: 'Конкурентные',
  kp: 'Конкурентные',
  single: 'Единственный поставщик',
  ep: 'Единственный поставщик',
};

// ────────────────────────────────────────────────────────────
// 6. Метрики (calc-engine) — зеркало metricKey → label
// ────────────────────────────────────────────────────────────

/** Ключ метрики → человеческая фраза (зеркало core/calc-engine.ts). */
export const METRIC_LABELS: Readonly<Record<string, string>> = {
  plan_count: 'План (кол-во)',
  fact_count: 'Факт (кол-во)',
  competitive_count: 'КП (кол-во)',
  ep_count: 'ЕП (кол-во)',
  plan_fb: 'Лимит ФБ',
  plan_kb: 'Лимит КБ',
  plan_mb: 'Лимит МБ',
  plan_total: 'Лимит ИТОГО',
  fact_fb: 'Факт ФБ',
  fact_kb: 'Факт КБ',
  fact_mb: 'Факт МБ',
  fact_total: 'Факт ИТОГО',
  economy_fb: 'Экономия ФБ',
  economy_kb: 'Экономия КБ',
  economy_mb: 'Экономия МБ',
  comp_fact_count: 'Факт КП (кол-во)',
  ep_fact_count: 'Факт ЕП (кол-во)',
  comp_plan_total: 'Лимит КП ИТОГО',
  ep_plan_total: 'Лимит ЕП ИТОГО',
  deviation: 'Отклонение',
  execution_pct: '% исполнения',
  amount_deviation: 'Отклонение сумм',
  savings_pct: 'Потрачено, %',
  economy_total: 'Экономия ИТОГО',
  total_procedures: 'Всего процедур',
  ep_share_pct: 'Доля ЕП %',
  exec_count_pct: '% исполнения (кол-во)',
  comp_exec_count_pct: '% исполнения КП (кол-во)',
  ep_exec_count_pct: '% исполнения ЕП (кол-во)',
};

// ────────────────────────────────────────────────────────────
// 7. Прочие сырые артефакты (спека §6.3, QA D15)
// ────────────────────────────────────────────────────────────

/** Прочие сырые ключи-сентинелы → человеческая фраза. */
export const MISC_LABELS: Readonly<Record<string, string>> = {
  [ORG_ITSELF_SENTINEL]: 'Аппарат',
};

// ────────────────────────────────────────────────────────────
// 8. Единая функция productLabel + реестр ключей
// ────────────────────────────────────────────────────────────

/**
 * Карты, по которым ищет productLabel, в порядке приоритета.
 * Между категориями коллизий ключей нет (проверено guard-тестом), поэтому
 * порядок влияет только на теоретические будущие пересечения.
 */
const LOOKUP_MAPS: ReadonlyArray<Readonly<Record<string, string>>> = [
  EP_REASON_LABELS,
  SIGNAL_LABELS,
  DEPT_LABELS,
  ISSUE_STATUS_LABELS,
  METHOD_LABELS,
  METRIC_LABELS,
  MISC_LABELS,
];

/**
 * Внутренний ключ → человеческая русская фраза.
 * Если ключ неизвестен, возвращает сам ключ (фолбэк, чтобы UI не падал) —
 * это сигнал разработчику дополнить словарь. Никогда не бросает.
 */
export function productLabel(key: string): string {
  for (const map of LOOKUP_MAPS) {
    const label = map[key];
    if (label !== undefined) return label;
  }
  return key;
}

/**
 * Объединение всех известных сырых ключей (для guard-теста и покрытия).
 * Дедуплицировано (DEPT_FULLNAME_LABELS переиспользует те же ключи, что
 * DEPT_LABELS, поэтому в реестр не добавляется отдельно).
 */
export const RAW_KEY_SAMPLES: readonly string[] = Array.from(
  new Set(LOOKUP_MAPS.flatMap((map) => Object.keys(map))),
);
