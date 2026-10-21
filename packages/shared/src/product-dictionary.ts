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
 *   - Сигналы     → SIGNAL_CLASS_NAMES ЗДЕСЬ: это дом имён, а не зеркало
 *   - Метрики     → METRIC_LABELS здесь; движок и БЗ берут подписи из него
 *   - Статусы     → types.ts IssueStatus
 *   - _org_itself → ORG_ITSELF_SENTINEL
 *
 * ИМЕНА КЛАССОВ СТРОК — здесь и только здесь (консолидация 21.08.2026).
 * Прежняя оговорка «SIGNAL_LABELS скопированы из core/web, синхронизировать
 * руками» снята вместе с самим зеркалом: бейджи @aemr/core и заголовки
 * CHECK_REGISTRY теперь ЧИТАЮТ SIGNAL_CLASS_NAMES, а не держат свои строки.
 * Ручная синхронизация была ровно тем механизмом, которым разъехались
 * шестнадцать имён (инвентаризация сигналов 20.08.2026, раздел «Дубли»).
 *
 * METRIC_LABELS остаётся зеркалом core/calc-engine: @aemr/shared не может
 * импортировать @aemr/core (обратная зависимость), а метрики живут там.
 * При изменении подписи метрики в источнике — синхронизировать здесь.
 */

import { EP_REASON_CLUSTERS, EP_REASON_DICT } from './dictionaries/ep-reason-clusters.js';
import { DEPARTMENT_REGISTRY, findDept, getDept } from './department-registry.js';
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
// 2. Аналитические сигналы строки (RowSignals)
// ────────────────────────────────────────────────────────────

/**
 * Имя класса строки в двух формах — ЕДИНСТВЕННЫЙ дом имён (консолидация
 * 21.08.2026, поручение владельца «имя одинаково везде»).
 *
 * До этой правки одно явление носило до четырёх независимых подписей: бейдж
 * `getSignalBadges` (@aemr/core), словарь продукта здесь, имя проверки в
 * CHECK_REGISTRY и собственные формулировки экранов. Инвентаризация 20.08.2026
 * насчитала шестнадцать таких расхождений: «Флаг экономии» против «Конфликт
 * флага экономии», «Антидемпинговый сигнал» против «Высокой экономии», «Факт
 * без плана» против «Факта без планового бюджета». Читатель на двух вкладках
 * получал два имени одной строки и достраивал несуществующую разницу.
 *
 * Теперь пара живёт одной записью, и разъехаться формам физически негде:
 *   • `chip` — короткая подпись для чипа Реестра, карточки строки и бейджа API
 *     (её же отдаёт productLabel);
 *   • `card` — заголовок карточки проверки: именная группа, как требует канон
 *     заголовков (существительное, не глагол-команда). Отсутствует там, где
 *     класс до карточки не доезжает; тогда заголовком служит сам чип.
 *
 * Две формы — не два имени: слова в паре одни, меняется только грамматика
 * («Не обеспечено финансированием» на чипе, «Закупка, не обеспеченная
 * финансированием» в заголовке карточки, канон п.23).
 */
export interface SignalClassName {
  /** Короткая подпись: чип Реестра, карточка строки, бейдж API. */
  chip: string;
  /** Заголовок карточки проверки — именная группа. Нет — заголовком служит чип. */
  card?: string;
}

export const SIGNAL_CLASS_NAMES: Readonly<Record<string, SignalClassName>> = {
  // ── Позитивные / состояния ──
  signed: { chip: 'Подписан' },
  hasFact: { chip: 'Есть факт' },
  economyFlag: { chip: 'Экономия' },
  planning: { chip: 'Планирование' },
  notDue: { chip: 'Срок не наступил' },
  canceled: { chip: 'Отменён' },
  // ── Критические ──
  overdue: { chip: 'Срок прошёл', card: 'Плановый срок прошёл — заключение не подтверждено' },
  epRisk: { chip: 'ЕП-риск', card: 'ЕП-риск свыше 600 тыс. рублей' },
  // Имя ведёт числом, а не статьёй закона: «Антидемпинговый сигнал» обещал
  // ст.37, которую по этим данным проверить нельзя (нужна НМЦК, её в книгах
  // нет). Оговорка про лимит вместо НМЦК живёт в описании проверки.
  highEconomy: { chip: 'Высокая экономия свыше 25%', card: 'Высокая экономия свыше 25%' },
  economyConflict: { chip: 'Конфликт флага экономии', card: 'Конфликт флага экономии' },
  factExceedsPlan: { chip: 'Факт больше плана', card: 'Факт превышает план' },
  // Канон п.98м + п.102 (18.08.2026): по ЕП план (K) — сумма договора и обязан
  // равняться факту (Y); расхождение называется вслух, включая «экономию»,
  // которой по ЕП не бывает (у конкурентных способов план = НМЦК, там норма).
  epFactDeviation: { chip: 'По ЕП факт не равен плану', card: 'По ЕП факт не равен плану' },
  formulaBroken: { chip: 'Ошибка формулы', card: 'Формула возвращает ошибку' },
  budgetMismatch: { chip: 'Расхождение бюджета' },
  // ── Предупреждения ──
  stalledContract: { chip: 'Подвисший контракт', card: 'Подвисший контракт' },
  earlyClosure: { chip: 'Проверьте даты', card: 'Необычное опережение плана — проверьте год и даты заключения' },
  financeDelay: { chip: 'Задержка финансирования', card: 'Задержка финансирования' },
  planSoon: { chip: 'Скоро срок' },
  lowCompetition: { chip: 'Низкая конкуренция ниже 2%', card: 'Низкая конкуренция ниже 2%' },
  singleParticipant: { chip: 'Единственный участник', card: 'Единственный участник' },
  dataQuality: { chip: 'Пустые обязательные поля', card: 'Пустые обязательные поля' },
  // «Факт дата» — калька разработчика; по-русски это «факт раньше плановой даты».
  factDateBeforePlan: { chip: 'Факт раньше плановой даты', card: 'Факт раньше плановой даты' },
  economyDecisionUpcoming: { chip: 'Подготовить решение после завершения', card: 'Подготовка решения по итогам позиции' },
  futureFactDate: { chip: 'Дата факта в будущем', card: 'Дата факта в будущем' },
  planWithoutExecution: { chip: 'План без исполнения', card: 'План без исполнения' },
  epJustificationMissing: { chip: 'ЕП без обоснования', card: 'ЕП без обоснования' },
  methodReasonMismatch: { chip: 'Метод не соответствует обоснованию ЕП' },
  // Решение владельца п.137(10) от 21.08.2026: класс остаётся сигналом
  // («сигнал важный по вопросу справочника»), но адресат меняется. Прежнее
  // имя «Обоснование ЕП не распознано» читалось претензией к управлению —
  // будто оно написало неправильно. На деле это заявка на пополнение
  // справочника оснований: формулировка может быть верной по существу и всё
  // равно не читаться словарём. Имя ведёт к справочнику, а не к вине.
  unmappedReasonEP: {
    chip: 'Обоснование ЕП вне справочника',
    card: 'Обоснование ЕП вне справочника оснований',
  },
  budgetUnderallocation: { chip: 'Факт без планового бюджета', card: 'Факт без планового бюджета' },
  budgetSourceMissing: { chip: 'Не указаны источники бюджета', card: 'Источники бюджета не указаны' },
  // Канон п.71 (интервью 14.08.2026): суммы факта при пустой дате заключения —
  // законная стадия «Закупки, проводимые в течение года», а не ошибка. Имя
  // класса называет стадию на обеих поверхностях — до 21.08.2026 карточка
  // Контроля звала ту же строку «Факт суммы без даты» и требовала исправления,
  // а Реестр называл её законной стадией; читатель получал два вердикта.
  factWithoutDate: {
    chip: 'Закупка, проводимая в течение года',
    card: 'Закупка, проводимая в течение года',
  },
  dateWithoutFact: { chip: 'Факт дата без сумм', card: 'Факт дата без сумм' },
  // Канон п.23: имя класса — «не обеспеченная финансированием» (P пуст).
  planYearMissing: {
    chip: 'Не обеспечено финансированием',
    card: 'Закупка, не обеспеченная финансированием',
  },
  // Канон п.93/45 + п.98а: рукописны только N и Q, кварталы/годы — формулы.
  // Дата есть, производная молчит (или наоборот) = стёртая формула листа.
  derivedFormulaBroken: { chip: 'Сломана формула даты' },
  factQuarterMissing: { chip: 'Факт без планового квартала', card: 'Факт без планового квартала' },
  // Консолидация 21.08.2026 (решение владельца 20.08). Одно явление — «в
  // строке есть числовая экономия, а решение по ней не принято» — считалось
  // тремя разными счётчиками под тремя именами: узкой полосой 15–25 % внутри
  // «Конфликта флага экономии», правилом листа «Статус (AD) на строках данных»
  // и мёртвой записью «Скрытая экономия». Теперь класс один, имя одно,
  // определение одно (см. economy-flag.ts).
  economyFlagUndetermined: { chip: 'Экономия без отметки', card: 'Экономия без отметки' },
  // Решение владельца п.137(4) от 21.08.2026: «вполне как норма, но отдельно,
  // чтобы можно было их все показать». Год факта не равен году плана при обоих
  // заполненных: договор заключён в новом году против плана прошлого. Годовой
  // срез решает по плановому году и графу года факта не спрашивает, поэтому
  // деньги, потраченные в текущем году, в его годовое число не входят — и до
  // этого признака положение дел не называлось нигде. Род информационный:
  // считать год по плановому году законно, признак объясняет разрыв, а не
  // требует правки книги.
  foreignYearExecution: {
    chip: 'Исполнение чужого года',
    card: 'Исполнение по плану другого года',
  },
  // Решение владельца п.137(3) от 21.08.2026: «отмечаться должны, но не в
  // риск-списки»; «хотелки как класс оставляем» (решение начальницы через
  // владельца). Маркер «хотелки» в примечании ГРБС (AF) — инициативная заявка
  // без подтверждённой потребности (канон п.76). До этой правки обещание
  // бейджа «в риск-списки не шумит» не выполнялось нигде: у признака не было
  // ни одного потребителя в конвейере.
  initiativeRequest: {
    chip: 'Инициативная заявка',
    card: 'Инициативная заявка без подтверждённой потребности',
  },
};

/**
 * Ключ сигнала → короткая человеческая фраза (чип/бейдж).
 * Выводится из SIGNAL_CLASS_NAMES — отдельного списка подписей больше нет.
 */
export const SIGNAL_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SIGNAL_CLASS_NAMES).map(([key, name]) => [key, name.chip]),
);

/**
 * Заголовок карточки проверки для класса строки: именная форма, если она
 * заведена, иначе сам чип. Неизвестный ключ возвращает сам ключ — тот же
 * честный фолбэк, что у productLabel.
 */
export function signalCardTitle(key: string): string {
  const name = SIGNAL_CLASS_NAMES[key];
  if (name === undefined) return key;
  return name.card ?? name.chip;
}

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
// 6. Метрики — канонические подписи metricKey → label
// ────────────────────────────────────────────────────────────

/** Ключ метрики → человеческая фраза для движка, БЗ и интерфейса. */
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
  // «Утверждённая» — не украшение, а различитель: в районе живут ДВЕ экономии.
  // Эта — утверждённая финансовым органом (флаг AD книг ГРБС), в тысячах рублей,
  // колонки R–U листа СВОД. Вторая — экономия торгов «НМЦК минус цена аукциона»
  // в рублях из книги «Ежедневный мониторинг» (monitoring_auction_savings,
  // подпись «Экономия на торгах»). Одно слово на два числа больше не выдаётся.
  economy_fb: 'Утверждённая экономия ФБ',
  economy_kb: 'Утверждённая экономия КБ',
  economy_mb: 'Утверждённая экономия МБ',
  comp_fact_count: 'Факт КП (кол-во)',
  ep_fact_count: 'Факт ЕП (кол-во)',
  comp_plan_total: 'Лимит КП ИТОГО',
  ep_plan_total: 'Лимит ЕП ИТОГО',
  // Знак — как на листе: ФАКТ минус ПЛАН (F5 «Отклонение, единиц» = `=E-D`,
  // P5 «Отклонение, тыс. руб» = `=O-K`). Недобор отрицателен. До 18.08.2026
  // счётное отклонение считалось в обратную сторону, и внутри продукта жили две
  // противоположные конвенции под одним словом; сведены к листовой.
  deviation: 'Отклонение, единиц',
  amount_deviation: 'Отклонение, тыс. руб.',
  // execution_pct и savings_pct — ОДНА колонка Q листа под двумя ключами
  // (оба записаны в персистентных снимках). Подписи разведены: у savings_pct
  // имя листа, у execution_pct — наше человеческое; число одно, и обе карточки
  // базы знаний это говорят прямо.
  execution_pct: 'Исполнение (сумма), %',
  // Колонка Q листа СВОД ТД-ПМ. Владелец переименовал её 18.08.2026:
  // «Потрачено, %» → «Законтрактовано, %». Расчёт не менялся (O/K = факт/план
  // в деньгах), поменялось только имя — технический ключ остаётся savings_pct,
  // потому что он записан в персистентных снимках.
  savings_pct: 'Законтрактовано, %',
  economy_total: 'Утверждённая экономия, ИТОГО',
  total_procedures: 'Всего процедур',
  ep_share_pct: 'Доля ЕП %',
  // Ярус листа поверх блоков (шапка K1:O2 и строки долей 31–32).
  // Периметр листа: формулы яруса привязаны к строке 14 «Итого ЭА 2026», то
  // есть остаток считается ТОЛЬКО по электронным аукционам и ТОЛЬКО за год этой
  // строки. Единственный поставщик в него не входит — имя обязано это назвать.
  remainder_to_conclude: 'Остаток к заключению (ЭА, год листа)',
  share_kp_money: 'Доля ЭА, ЭЗК, ЭК и аналоги',
  share_ep_money: 'Доля ЕП',
  exec_count_pct: '% исполнения (кол-во)',
  comp_exec_count_pct: '% исполнения КП (кол-во)',
  ep_exec_count_pct: '% исполнения ЕП (кол-во)',
  pending_count: 'Осталось процедур',
  pending_total: 'Осталось в плановых деньгах',
  // Этапность закупки (вид деятельности и стадия жизненного цикла)
  lifecycle_type_current: 'Текущая деятельность',
  lifecycle_type_program: 'Программные мероприятия',
  lifecycle_type_other: 'Иной вид деятельности',
  lifecycle_type_unknown: 'Вид деятельности не указан',
  lifecycle_stage_concluded: 'Контракт заключён',
  lifecycle_stage_in_work: 'В работе, срок не наступил',
  lifecycle_stage_overdue: 'Плановая дата прошла',
  // Канон имени класса — п.23 интервью 14.08.2026: «закупки, НЕ ОБЕСПЕЧЕННЫЕ
  // финансированием» (прежний лейбл «Без подтверждённого финансирования» снят).
  lifecycle_stage_no_funding: 'Не обеспечено финансированием',
  lifecycle_stage_unfunded: 'Без плановых денег',
  pending_fb: 'Остаток ФБ',
  pending_kb: 'Остаток КБ',
  pending_mb: 'Остаток МБ',
  api_read_available: 'Доступность API при последнем чтении',
  report_check_age_seconds: 'Возраст последней успешной проверки',
  worker_cycle_duration_seconds: 'Длительность последнего завершённого цикла',
  worker_last_failure: 'Последний зафиксированный отказ',
  calc_economy_remainder: 'Прогноз экономии по остатку ЭА',
  trust_overall: 'Общая надёжность',
  trust_data_quality: 'Качество данных',
  trust_formula_integrity: 'Целостность формул',
  trust_rule_compliance: 'Соблюдение правил',
  trust_mapping_consistency: 'Согласованность маппинга',
  trust_operational_risk: 'Операционный риск',
  critical_issues: 'Критические замечания',
  economy_rate: 'Экономия',
  trust_binary: 'Доверие к данным',
  fb_execution_pct: '% исполнения ФБ',
  dept_rank: '№ (ранг в рейтинге)',
  dept_name: 'ГРБС — главный распорядитель',
  dept_exec_count_pct: 'Исполнение по кол-ву (управление)',
  dept_exec_amount_pct: 'Исполнение по сумме (управление)',
  dept_fb_exec_pct: 'Исполнение ФБ (управление)',
  dept_fb_pct: 'Исполнение по ФБ (управление)',
  dept_trust: 'Уровень доверия (управление)',
  dept_issues: 'Количество замечаний (управление)',
  dept_delta_quarter: 'Δ кв (изменение исполнения к предыдущему кварталу)',
  dept_sparkline: 'Спарк (4 квартала)',
  total_economy: 'Утверждённая экономия района (сумма)',
  avg_reduction_pct: 'Средний % снижения от лимита',
  high_economy_count: 'Закупки со снижением факта > 25% от лимита',
  economy_conflicts: 'Конфликты флага экономии',
  plan_fact_quarterly: 'План/Факт по кварталам',
  execution_by_dept: 'Исполнение по управлениям (bar chart)',
  pie_procurement: 'Распределение по способу закупки',
  pie_budget: 'Распределение по бюджетам',
  signal_overdue: 'Просрочка',
  signal_economy_conflict: 'Экономия без флага AD',
  signal_high_economy: 'Снижение факта от лимита > 25% (конкурентные)',
  signal_stalled_contract: 'Подвисший контракт (проверка отключена)',
  signal_fact_exceeds_plan: 'Факт превышает план',
  signal_fact_date_before_plan: 'Дата факта раньше даты плана',
  signal_plan_without_execution: 'План без исполнения',
  signal_ep_justification_missing: 'ЕП без обоснования',
  signal_budget_underallocation: 'Факт без плана',
  scorecard_grade: 'Грейд управления',
  scorecard_discipline: 'Индекс дисциплины',
  recon_verdict: 'Вердикт сверки',
  recon_gap_plan: 'Разрыв по плану',
  recon_gap_fact: 'Разрыв по факту',
  monitoring_reduction_portfolio: 'Портфельное снижение на торгах',
  monitoring_reduction_rowmean: 'Среднее снижение по процедурам',
  monitoring_reduction_discounted: 'Среднее по снизившимся процедурам',
  ep_reducible: 'ЕП для разбора',
  refusal_cost: 'Цена отказа от конкурса',
  discipline_rows_pending: 'Строк ждут действия',
  discipline_money_pending: 'Деньги в строках дел',
  dept_economy_total: 'Экономия управления',
  dept_economy_rate: 'Доля экономии от лимита',
  analytics_top_kpi: 'Главные показатели периметра',
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
  return findDept(key)?.shortName ?? key;
}

/**
 * Подпись квартала на языке района: «1 кв», а не «1 кв».
 *
 * Единственный дом формата (канон пользователя 29.07: «окончательно перейти
 * на 1 кв 2 кв 3 кв 4 кв везде по всей текстовке»). Латинская «Q» остаётся
 * ТОЛЬКО в технических ключах — `competitive.q1.savings_pct`, колонка U листа
 * ШДЮ, тип сигнала `Q4_SPENDING_SPIKE`: это идентификаторы данных, их
 * переименование ломает разбор книг и сверку, а читателю они не показываются.
 */
export function quarterLabel(quarter: number): string {
  return `${quarter} кв`;
}

/** То же с годом — «3 кв 2026»; год опускается, когда он и так в контексте. */
export function quarterYearLabel(quarter: number, year: number): string {
  return `${quarterLabel(quarter)} ${year}`;
}

/**
 * Объединение всех известных сырых ключей (для guard-теста и покрытия).
 * Дедуплицировано (DEPT_FULLNAME_LABELS переиспользует те же ключи, что
 * DEPT_LABELS, поэтому в реестр не добавляется отдельно).
 */
export const RAW_KEY_SAMPLES: readonly string[] = Array.from(
  new Set(LOOKUP_MAPS.flatMap((map) => Object.keys(map))),
);

/** Экранные словари. Ключ = контекст:имя; значения редактируются только здесь. */
export const PRODUCT_COPY = {
  "components/analytics-extra/contract:SCALE_TITLE": {
  typo: 'Похоже на опечатку',
  fitted: 'Похоже на подгон',
},
  "components/DiagnosticCards:SEVERITY_TEXT": {
  critical: 'Критическое',
  error: 'Ошибка',
  significant: 'Существенное',
  warning: 'Предупреждение',
  info: 'Информация',
},
  "components/RatingTableV2:NO_PLAN_HINT": 'За выбранный период плана нет — исполнять нечего',
  "components/TableEditor:EMPTY_CELL_HINT": 'В книге значение не заполнено',
  "components/TableEditor:COPY_REFUSED_NOTE": 'Браузер не дал доступ к буферу обмена — скопируйте выделение вручную.',
  "components/text-hygiene/TextHygieneSection:SPELLING_LABEL": 'орфография',
  "components/ui/chart-frame:MONEY_SCALE_HINT": {
  'руб': 'суммы читаются в рублях — так их ведёт книга мониторинга',
  'тыс': 'суммы читаются в тысячах рублей — так их ведут свод и отчёт',
  'млн': 'суммы читаются в миллионах рублей',
  'млрд': 'суммы читаются в миллиардах рублей',
},
  "lib/dataset-analyses:BENFORD_LABELS": {
  close: { label: 'соответствует', hint: 'MAD ≤ 0.006 — распределение первых цифр естественное', tone: 'ok' },
  acceptable: { label: 'приемлемо', hint: 'MAD ≤ 0.012 — отклонение в допустимых пределах', tone: 'ok' },
  marginal: { label: 'на грани', hint: 'MAD ≤ 0.015 — отклонение заметное, стоит присмотреться', tone: 'warn' },
  nonconforming: { label: 'не соответствует', hint: 'MAD > 0.015 — возможна манипуляция суммами', tone: 'bad' },
},
  "lib/diagnostics/mechanism-groups:MECHANISM_FALLBACK_LABEL": 'Проверка без подписи в словаре',
  "lib/drill:AXIS_TITLE": {
  dept: 'Управление',
  subordinate: 'Учреждение',
  year: 'Год',
  quarter: 'Квартал',
  month: 'Месяц',
  method: 'Способ закупки',
  budget: 'Бюджет',
  activity: 'Вид деятельности',
  signals: 'Признаки строк',
  search: 'Поиск',
  procedure: 'Процедура',
},
  "lib/drill:ACTIVITY_TITLE": {
  program: 'программная',
  current_program: 'текущая программная',
  current_non_program: 'текущая непрограммная',
},
  "lib/economy-copy:ECONOMY_EMPTY_STATE_COPY": {
  title: 'Нет данных по экономии',
  body: 'Экономия считается только по утвержденным строкам: факт-дата заполнена, AD="да", сумма Z+AA+AB. Данные появятся после загрузки из Google Sheets.',
} as const,
  "lib/figure:UNIT_TEXT": {
  'шт': 'шт.',
  'тыс.руб': 'тыс. руб.',
  '%': '%',
  'дн': 'дн.',
},
  "lib/formulas/formula-defects:FORMULA_INTEGRITY_TITLE": 'Целостность формул книг',
  "lib/formulas/formula-defects:ETALON_LABEL": 'Эталон графы: ',
  "lib/help/help-content:HELP_TITLE": 'Как читать этот дэш',
  "lib/help/help-content:HELP_SUBTITLE": 'Четыре вещи, которые стоит знать до первого числа на экране.',
  "lib/monitoring/bi:BUDGET_LABELS": {
  mb: { short: 'МБ', label: 'местный бюджет' },
  kb: { short: 'КБ', label: 'краевой бюджет' },
  fb: { short: 'ФБ', label: 'федеральный бюджет' },
},
  "lib/monitoring/contract:ANCESTOR_SHEET_NAMES": [
  'Отчет по процедурам Свод', 'СВОД', 'ГРБС',
],
  "lib/perimeter:AXIS_TITLE": {
  year: 'Год',
  span: 'Период',
  orgs: 'Органы',
  slice: 'Срез',
  moment: 'Момент',
},
  "lib/reading-moment:LIVE_MOMENT_LABEL": 'на сейчас',
  "lib/reading-moment:UNKNOWN_MOMENT_LABEL": 'момент чтения неизвестен',
  "lib/recon/monthly:NO_CALC_NOTE": 'расчёт не построен',
  "lib/recon/monthly:BUDGET_CELL_LABELS": [
  ['план ФБ', 'planFB'], ['план КБ', 'planKB'], ['план МБ', 'planMB'],
  ['факт ФБ', 'factFB'], ['факт КБ', 'factKB'], ['факт МБ', 'factMB'],
  ['эконом. ФБ', 'economyFB'], ['эконом. КБ', 'economyKB'], ['эконом. МБ', 'economyMB'],
],
  "lib/subordinate-label:ORG_ITSELF_LABEL": 'Аппарат управления',
  "lib/svod/activity:ACTIVITY_HINT": {
  pm: 'Программные мероприятия — строки с видом деятельности «Программное мероприятие»',
  td: 'Текущая деятельность целиком — включая строки с заполненной графой программы (канон п.30)',
},
  "lib/svod/order:SVOD_ORDER_HINT": {
  registry: 'Порядок справочника управлений — тот же, что в официальном листе.',
  execution: 'Сверху отстающие: наименьший процент исполнения (столбец G) первым.',
  plan: 'Сверху крупные: наибольший плановый лимит (столбец K) первым.',
  economy: 'Сверху наибольшая экономия по итогу управления.',
},
  "department.unknown": 'Управление не указано',
  "store:STAVKA_SCOPE_NOTE": 'Ставка меняет прогноз по остатку ЭА в Отчёте. Факт экономии и данные книг от неё не меняются.',
  "components/analytics-extra/contract:LEVEL_LABEL": {
  row: 'строка книги',
  behaviour: 'видно сравнением с прошлым чтением',
  book: 'признак всей книги',
},
  "components/charts/DrillPieChart:DRILL_DIMENSION_LABELS": {
  procurement: 'Способ закупки',
  budget: 'Бюджеты',
  department: 'Управления',
  execution: 'Исполнение',
},
  "components/charts/DrillPieChart:METRIC_LABELS": {
  plan: 'План',
  fact: 'Факт',
  economy: 'Экономия',
  count: 'Закупки, шт.',
},
  "components/charts/DrillPieChart:VIEW_LEVEL_LABELS": {
  grbs: 'ГРБС',
  orgs: 'Организации',
},
  "components/competition/EpShare:MODE_LABELS": {
  sheet: 'как в листе',
  clean: 'без выплат и платежей',
},
  "components/IssueList:ORIGIN_LABELS": {
  spreadsheet_rule: 'Правило таблицы',
  bi_heuristic: 'Аналитика',
  delta_mismatch: 'Расхождение',
  mapping_error: 'Привязка',
  runtime_error: 'Ошибка системы',
  language_defect: 'Язык',
},
  "components/monitoring/SignalCards:SEVERITY_LABEL": {
  high: 'Меняет числа',
  medium: 'Искажает разрезы',
  low: 'Мешает читать',
},
  "components/RatingTableV2:SORT_LABELS": {
  execCountPct: 'исполнению по количеству',
  execAmountPct: 'исполнению по сумме',
  fbExecPct: 'исполнению федерального бюджета',
  fbPct: 'исполнению федерального бюджета',
  trustScore: 'доверию к данным',
  issueCount: 'числу замечаний',
},
  "components/scorecard/contract:MODE_LABEL": {
  'ПОХВАЛА': 'идёт с опережением',
  'ШТАТНЫЙ': 'штатный ход',
  'ВНИМАНИЕ': 'требует внимания',
  'ТРЕВОГА': 'тревожно',
  'КОНТЕКСТНЫЙ': 'есть пояснение исполнителя',
},
  "components/scorecard/contract:FACTOR_LABEL": {
  'КОНТЕКСТ': 'пояснение исполнителя',
  'АНОМАЛИЯ': 'аномалии в суммах',
  'ИСПОЛНЕНИЕ': 'исполнение плана',
  'ЕП': 'доля единственного поставщика',
  'ДИНАМИКА': 'динамика к ожиданию',
  'ЭКОНОМИЯ': 'экономия',
},
  "components/scorecard/contract:ROLE_LABEL": {
  'ОПЕРАЦИОННЫЙ': 'операционное',
  'ИНВЕСТИЦИОННЫЙ': 'инвестиционное',
  'СМЕШАННЫЙ': 'смешанное',
},
  "components/scorecard/contract:INDICATOR_LABEL": {
  splitting: 'дробление закупок',
  zero_competition: 'торги без снижения цены',
  price_inflation: 'цена выше типичной по предмету',
  ep_over_limit: 'ЕП свыше разового лимита',
  ep_annual_share: 'годовая доля ЕП выше ориентира роли',
  supplier_concentration: 'закупки сходятся на одном поставщике',
},
  "components/ui/chart-frame:MONEY_SCALE_LABEL": {
  'руб': '₽',
  'тыс': 'тыс ₽',
  'млн': 'млн ₽',
  'млрд': 'млрд ₽',
},
  "components/workload/contract:OBSERVABILITY_LABEL": {
  rich: 'журнал живой',
  thin: 'журнал редкий',
  blind: 'журнал слепой',
},
  "lib/analytics/anomaly-addresses:SEASONAL_LABELS": {
  SCHOOL_REPAIR_OUTSIDE_HOLIDAYS: 'Ремонт школы в учебное время',
  LATE_SCHOOL_FOOD_CONTRACT: 'Школьное питание без контракта к 15 августа',
  WINTER_ROAD_WORK: 'Дорожные работы в зимние месяцы',
  LATE_FUEL_PROCUREMENT: 'Топливо не закуплено к отопительному сезону',
  BOILER_REPAIR_HEATING_SEASON: 'Ремонт теплоснабжения в отопительный сезон',
  Q4_SPENDING_SPIKE: 'Заключения смещены в IV квартал',
  DECEMBER_RUSH_CONTRACT: 'Декабрьское заключение в короткий срок',
},
  "lib/chart-colors:EXECUTION_BAND_LABELS": {
  over: 'больше 100 %: факт выше плана',
  good: 'больше 80 %',
  watch: 'от 50 до 80 %',
  bad: 'меньше 50 %',
},
  "lib/chart-colors:SERIES_PATTERN_LABELS": {
  solid: 'сплошная заливка',
  diagonal: 'косая штриховка',
  dots: 'точки',
  grid: 'клетка',
},
  "lib/monitoring/money-flow:MONEY_CATEGORY_LABELS": {
  realized: 'Учтённые результаты',
  work: 'В работе и ожидании даты',
  unrealized: 'Не состоялись и отменены',
  reissued: 'Переоформлены · история',
  unknown: 'Стадия требует уточнения',
},
  "lib/monitoring/stage-labels:STAGE_LABELS": {
  application: 'Заявка в уполномоченном органе',
  published: 'Объявлена, итога нет',
  bidding: 'Итог не внесён',
  awarded: 'Состоялась',
  no_result: 'Без результата',
  reissued: 'Переоформлена',
  unknown: 'Проверить стадию',
},
  "lib/monitoring/stage-labels:METHOD_LABELS": {
  ЭА: 'электронный аукцион',
  ЭК: 'электронный конкурс',
  ЭАС: 'совместный электронный аукцион',
  ЭЗК: 'запрос котировок в электронной форме',
  ЭЕП: 'закупка у единственного поставщика',
},
  "lib/monitoring/triple-contract:SIDE_LABELS": {
  book: 'книга ГРБС',
  sheet: 'лист управления мониторинга',
  journal: 'переходящий реестр «25-26»',
},
  "lib/monitoring/triple-contract:FINDING_LABELS": {
  'no-pair-in-monitoring': 'Нет пары в книге мониторинга',
  'no-pair-in-books': 'Нет строки в книгах ГРБС',
  'no-journal-record': 'Нет записи в переходящем реестре',
  'no-sheet-record': 'Не перенесена на лист управления',
  'plan-differs': 'Начальные цены разошлись',
  'fact-differs': 'Факт и цена победителя разошлись',
  'savings-differ': 'Экономия разошлась',
  'savings-not-difference': 'Экономия не равна разности',
  'winner-price-missing': 'Цена победителя не проставлена',
  'code-distorted': 'Код процедуры с опечаткой',
  'subject-mismatch': 'Предметы сторон описаны по-разному',
  'duplicate-in-book': 'Код дважды в одной книге',
  'joint-shares': 'Доли совместной закупки',
  'duplicate-in-monitoring': 'Код дважды на одном листе мониторинга',
},
  "lib/rows/registry-view:ACTIVITY_FILTER_LABELS": {
  program: 'программные мероприятия',
  // Канон п.30 (интервью 14.08.2026): срез «ТД-ПМ» упразднён — заполненная
  // графа программы у ТД норма, подписи «в рамках/вне программ» лгали бы:
  // classifyActivity теперь всю ТД отдаёт ключом current_non_program, а
  // current_program остаётся только в старых снимках — обе подписи «ТД».
  current_program: 'текущая деятельность',
  current_non_program: 'текущая деятельность',
},
  "lib/rows/registry-view:PROCUREMENT_FILTER_LABELS": {
  competitive: 'конкурентные способы',
  single: 'единственный поставщик',
},
  "lib/selectors/journal-display:ACTOR_LABELS": {
  Pipeline: 'Обновление данных',
  pipeline: 'Обновление данных',
  System: 'Система',
  system: 'Система',
},
  "lib/semantic-color:STATE_LABELS": {
  'норма': 'в норме',
  'внимание': 'требует внимания',
  'нарушение': 'нарушение',
  'не оценено': 'не оценено — базы для счёта нет',
},
  "lib/svod/order:SVOD_ORDER_LABEL": {
  registry: 'как в реестре',
  execution: 'по исполнению',
  plan: 'по лимиту',
  economy: 'по экономии',
},
  "lib/svod/recon:FIELD_LABEL": {
  count: 'количество',
  total_plan: 'план',
  total_fact: 'факт',
  economy_total: 'экономия',
},
  "pages/Analytics:TREND_LABELS": {
  accelerating: 'Ускорение', decelerating: 'Замедление', stable: 'Стабильно', insufficient_data: 'Мало данных',
},
  "pages/Dashboard:BREAKDOWN_EMPTY_LABELS": {
  critical_issues: 'не посчитано',
  trust_binary: 'не оценено',
},
  "pages/Trust:COMPONENT_SHORT_LABELS": {
  data_quality: 'Данные',
  formula_integrity: 'Формулы',
  rule_compliance: 'Правила',
  mapping_consistency: 'Сверка',
  operational_risk: 'Риски',
},
  "pages/Trust:CHECK_SCOPE_LABELS": {
  svod: 'Лист «СВОД ТД-ПМ»',
  department: 'Листы управлений',
  both: 'Общие для всех листов',
},
} as const;

/** Месяцы: единый справочник для фильтров, графиков и отчётов. */
export const MONTHS = [
  { id: 1, short: 'Янв', full: 'Январь' },
  { id: 2, short: 'Фев', full: 'Февраль' },
  { id: 3, short: 'Мар', full: 'Март' },
  { id: 4, short: 'Апр', full: 'Апрель' },
  { id: 5, short: 'Май', full: 'Май' },
  { id: 6, short: 'Июн', full: 'Июнь' },
  { id: 7, short: 'Июл', full: 'Июль' },
  { id: 8, short: 'Авг', full: 'Август' },
  { id: 9, short: 'Сен', full: 'Сентябрь' },
  { id: 10, short: 'Окт', full: 'Октябрь' },
  { id: 11, short: 'Ноя', full: 'Ноябрь' },
  { id: 12, short: 'Дек', full: 'Декабрь' },
] as const;

/** Общие тексты навигации, действий и единиц. */
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

  // Типы деятельности (виды деятельности).
  // Канон п.30 (интервью 14.08.2026): срез «ТД-ПМ» упразднён — подкатегорий
  // ТД нет, оба легаси-ключа подписываются «Текущая деятельность»
  // (current_program живёт только в старых снимках).
  'type.current': 'Текущая деятельность',
  'type.current_program': 'Текущая деятельность',
  'type.current_non_program': 'Текущая деятельность',
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
  'dept.УЭР': getDept('УЭР').fullName,
  'dept.УИО': getDept('УИО').fullName,
  'dept.УАГЗО': getDept('УАГЗО').fullName,
  'dept.УФБП': getDept('УФБП').fullName,
  'dept.УД': getDept('УД').fullName,
  'dept.УДТХ': getDept('УДТХ').fullName,
  'dept.УКСиМП': getDept('УКСиМП').fullName,
  'dept.УО': getDept('УО').fullName,

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

/** Единый формат переключателя периода. */
export const PERIOD_LABELS: Readonly<Record<string, string>> = {
  year: 'Год', ...Object.fromEntries([1, 2, 3, 4].map(q => [`q${q}`, quarterLabel(q)])),
};

/** Наблюдение сервиса отделено от исходного события удаления. */
export const SOURCE_ROW_OBSERVATION_LABEL = 'Зафиксировано отсутствие прежней позиции';
export function sourceRowObservationDetails(row: { rowSeq: string | null; sheetRow: number | null; subject: string | null }): string {
  return `№ п/п ${row.rowSeq ?? 'не указан'} · прежняя строка ${row.sheetRow ?? 'не установлена'}. ${row.subject ?? ''} `
    + 'Прежняя позиция не найдена при повторном чтении. Причина, автор и точное время удаления не установлены.';
}

export function sourceRowObservationMoment(moment: string): string {
  return `Обнаружено сервисом ${moment} · точное время и автор исходного изменения не установлены`;
}

export const SOURCE_ROW_OBSERVATION_ORIGIN = 'из сравнения принятых чтений книги';
