/**
 * registry-view.ts — счёт строк и словарь признаков для «Реестра строк».
 *
 * Зачем отдельный дом. Страница реестра считала три разных вещи одним
 * предложением («фильтры отсеяли N из M») и держала при себе два обрывка
 * списка критических признаков, разъезжавшихся с оформлением чипов. Оба
 * места — про смысл, а не про вёрстку, поэтому живут здесь и покрыты
 * тестом: подпись под таблицей — это утверждение о данных, и оно обязано
 * быть проверяемым.
 *
 * Главный инвариант счёта: фильтрация двухступенчатая, и ступени нельзя
 * складывать в одно число. Часть отбора делает сервер ещё до ответа (ГРБС,
 * подведы, вид деятельности, способ, год — они уезжают в запрос), часть —
 * экран уже над полученными строками (период, месяцы, поиск, признаки,
 * бюджеты). Фраза «отсеяли N из M», где M — это только доехавшие строки,
 * выдавала часть реестра за весь реестр.
 */
import { SIGNAL_LABELS, classifyActivity, productLabel } from '@aemr/shared';
import { pluralRu } from '../economy-copy';
import { monthOfDateValue } from '../sheet-date';

// ────────────────────────────────────────────────────────────
// 1. Тяжесть признака строки
// ────────────────────────────────────────────────────────────

/**
 * Градация признака. Повторяет палитру бейджей getSignalBadges (@aemr/core):
 * красный — критическое, янтарный — предупреждение, серый — пробел в данных,
 * синий — информационное, зелёный — благополучное, приглушённый — снятая
 * строка.
 *
 * Оттенков намеренно шесть, а не одиннадцать, как было в чипах реестра:
 * читатель не различает «жёлтый против оранжевого против янтарного» и
 * достраивает несуществующий смысл. Реестр проверок (@aemr/shared
 * CHECK_REGISTRY) местами оценивает те же признаки иначе (например, «ЕП-риск»
 * там info); расхождение оставлено владельцу — здесь сохранена та тяжесть,
 * которую страница показывала пользователю до правки.
 */
export type SignalSeverity = 'critical' | 'warning' | 'gap' | 'info' | 'good' | 'muted';

/**
 * Ключ признака → тяжесть. Карта обязана покрывать ВСЕ ключи SIGNAL_LABELS —
 * это проверяет тест: новый признак в словаре без строки здесь означал бы
 * серый чип без объяснения и молчаливое выпадение из счёта «критических».
 */
export const SIGNAL_SEVERITY: Readonly<Record<string, SignalSeverity>> = {
  // ── Благополучные состояния ──
  signed: 'good',
  hasFact: 'good',
  economyFlag: 'good',
  // ── Информационные ──
  planning: 'info',
  notDue: 'info',
  // ── Снятая строка ──
  canceled: 'muted',
  // ── Критические ──
  overdue: 'critical',
  epRisk: 'critical',
  highEconomy: 'critical',
  economyConflict: 'critical',
  factExceedsPlan: 'critical',
  formulaBroken: 'critical',
  futureFactDate: 'critical',
  epJustificationMissing: 'critical',
  budgetUnderallocation: 'critical',
  budgetMismatch: 'critical',
  // ── Предупреждения ──
  stalledContract: 'warning',
  earlyClosure: 'warning',
  financeDelay: 'warning',
  planSoon: 'warning',
  lowCompetition: 'warning',
  singleParticipant: 'warning',
  factDateBeforePlan: 'warning',
  planWithoutExecution: 'warning',
  budgetSourceMissing: 'warning',
  methodReasonMismatch: 'warning',
  unmappedReasonEP: 'warning',
  // Канон п.98м + п.102 (18.08.2026): по ЕП план обязан равняться факту;
  // расхождение — ошибка заполнения либо «экономия», которой по ЕП не бывает.
  // Тон warning, не critical: чаще всего это ошибка ввода, а не нарушение.
  epFactDeviation: 'warning',
  // ── Пробелы в данных ──
  dataQuality: 'gap',
  // Канон п.71 (14.08.2026): суммы факта без даты заключения — законная стадия
  // «Закупки, проводимые в течение года», не ошибка → информационный тон.
  factWithoutDate: 'info',
  dateWithoutFact: 'gap',
  // Структурные классы волны 0 (P пуст / квартал O пуст при факте).
  planYearMissing: 'warning',
  factQuarterMissing: 'warning',
  // Канон п.98а: дата рукописная есть, формульная производная молчит —
  // поломка листа, чинится восстановлением формулы, не вводом данных.
  derivedFormulaBroken: 'critical',
};

/** Тяжесть незнакомого признака: серый пробел, а не тишина. */
export function signalSeverity(key: string): SignalSeverity {
  return SIGNAL_SEVERITY[key] ?? 'gap';
}

/** Классы оформления чипа по тяжести (светлая и тёмная темы). */
export const SEVERITY_TONE: Readonly<Record<SignalSeverity, { bg: string; text: string }>> = {
  critical: { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  warning: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400' },
  gap: { bg: 'bg-zinc-100 dark:bg-zinc-700/50', text: 'text-zinc-600 dark:text-zinc-400' },
  info: { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400' },
  good: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' },
  muted: { bg: 'bg-zinc-100 dark:bg-zinc-700/50', text: 'text-zinc-500 dark:text-zinc-400' },
};

/** Оформление чипа признака. */
export function signalTone(key: string): { bg: string; text: string } {
  return SEVERITY_TONE[signalSeverity(key)];
}

/** Подпись признака плюс подсказка, если словарь его не знает. */
export interface SignalChipText {
  /** Русская фраза для глаз — никогда не внутренний ключ. */
  text: string;
  /** Подсказка при наведении; есть только у неописанных признаков. */
  hint?: string;
}

/**
 * Подпись признака строго из словаря продукта. productLabel возвращает сам
 * ключ, если фразы нет, — латиница в этом случае до экрана дойти не должна,
 * поэтому неизвестный признак называется честно, а ключ уходит в подсказку
 * для разработчика.
 */
export function signalChipText(key: string): SignalChipText {
  const label = productLabel(key);
  if (label !== key) return { text: label };
  return {
    text: 'Признак без описания',
    hint: `Признак ещё не описан в словаре продукта (служебное имя: ${key})`,
  };
}

/** Строка реестра глазами счётчиков: нужны только признаки и даты. */
export interface CountableRow {
  signals?: string[];
  planDate?: unknown;
  factDate?: unknown;
  date?: unknown;
  planYear?: number;
}

/** Сколько строк несёт хотя бы один критический признак и хотя бы одно предупреждение. */
export function countBySeverity(rows: readonly CountableRow[]): {
  critical: number;
  warning: number;
} {
  let critical = 0;
  let warning = 0;
  for (const row of rows) {
    const signals = row.signals ?? [];
    if (signals.some((s) => signalSeverity(s) === 'critical')) critical += 1;
    else if (signals.some((s) => signalSeverity(s) === 'warning')) warning += 1;
  }
  return { critical, warning };
}

// ────────────────────────────────────────────────────────────
// 2. Двухступенчатый счёт строк
// ────────────────────────────────────────────────────────────

export interface RegistryCounts {
  /** Строк на текущей странице. */
  shown: number;
  /** Строк в выборке после фильтров экрана. */
  inSelection: number;
  /** Строк, доехавших с сервера (после фильтров запроса). */
  loaded: number;
  /** Названия фильтров экрана, которые сейчас что-то отсекают. */
  screenFilters: readonly string[];
  /** Названия фильтров, ушедших в запрос к серверу. */
  requestFilters: readonly string[];
}

export interface RegistryCountsText {
  /** «Показано 25 из 128 строк выборки». */
  shown: string;
  /** «Ещё 40 строк скрыто на экране: период, поиск» — либо null, если ничего не скрыто. */
  hiddenOnScreen: string | null;
  /** «Загружено 168 строк по фильтрам: год, ГРБС» — что вообще доехало и почему столько. */
  loaded: string;
}

/** Перечисление через запятую; пустой список зовущий обрабатывает сам. */
function enumerate(items: readonly string[]): string {
  return items.join(', ');
}

/**
 * Три честных предложения вместо одного лукавого. Ни одно из них не выдаёт
 * загруженную часть за весь реестр: ступень запроса названа отдельно от
 * ступени экрана, и у каждой перечислены свои фильтры.
 */
export function describeRegistryCounts(counts: RegistryCounts): RegistryCountsText {
  const { shown, inSelection, loaded, screenFilters, requestFilters } = counts;
  const hidden = Math.max(0, loaded - inSelection);

  const shownText = `Показано ${shown} ${pluralRu(shown, 'строка', 'строки', 'строк')} из ${inSelection}`;

  const hiddenOnScreen =
    hidden > 0
      ? `На экране скрыто ${hidden} ${pluralRu(hidden, 'строка', 'строки', 'строк')}` +
        (screenFilters.length > 0 ? ` фильтрами: ${enumerate(screenFilters)}` : '')
      : null;

  const loadedText =
    requestFilters.length > 0
      ? `Загружено ${loaded} ${pluralRu(loaded, 'строка', 'строки', 'строк')} по запросу с фильтрами: ${enumerate(requestFilters)}`
      : `Загружено ${loaded} ${pluralRu(loaded, 'строка', 'строки', 'строк')} — весь реестр выбранных управлений`;

  return { shown: shownText, hiddenOnScreen, loaded: loadedText };
}

// ────────────────────────────────────────────────────────────
// 3. Строки, которых фильтр периода не касался
// ────────────────────────────────────────────────────────────

export interface UncheckedByPeriod {
  /** Строк без распознанной даты плана и факта — квартал и месяцы их не проверяли. */
  noDate: number;
  /** Строк без года плана — годовой фильтр их не проверял. */
  noYear: number;
}

/**
 * Строка без даты проходит фильтр периода молча: спрятать её нельзя (данные
 * есть, срок не проставлен), но и утверждать, что она относится к выбранному
 * кварталу, тоже нельзя. Год плана ведёт себя так же на стороне сервера —
 * applyYearFilter пропускает planYear === 0. Обе дыры считаются здесь, чтобы
 * подпись под таблицей могла их назвать вслух.
 */
export function countUncheckedByPeriod(rows: readonly CountableRow[]): UncheckedByPeriod {
  let noDate = 0;
  let noYear = 0;
  for (const row of rows) {
    if (monthOfDateValue(row.planDate ?? row.factDate ?? row.date) === null) noDate += 1;
    if (!row.planYear) noYear += 1;
  }
  return { noDate, noYear };
}

/** Есть ли у строки дата, по которой её вообще можно отнести к периоду. */
export function rowHasPeriodDate(row: CountableRow): boolean {
  return monthOfDateValue(row.planDate ?? row.factDate ?? row.date) !== null;
}

/**
 * Фраза про непроверенные строки — только когда соответствующий фильтр
 * действительно включён: без выбранного периода прятать нечего, и оговорка
 * превратилась бы в шум.
 */
export function describeUncheckedByPeriod(
  counts: UncheckedByPeriod,
  active: { period: boolean; year: boolean },
): string | null {
  const parts: string[] = [];
  if (active.period && counts.noDate > 0) {
    parts.push(`${counts.noDate} без даты плана и факта`);
  }
  if (active.year && counts.noYear > 0) {
    parts.push(`${counts.noYear} без года плана`);
  }
  if (parts.length === 0) return null;
  return `Период не проверял ${enumerate(parts)}: в книге эти поля не заполнены, поэтому строки показаны, а не спрятаны`;
}

// ────────────────────────────────────────────────────────────
// 4. Названия действующих фильтров
// ────────────────────────────────────────────────────────────

/**
 * Человеческие названия видов деятельности. Ключи — те же, что возвращает
 * classifyActivity (@aemr/shared) и что принимает серверный фильтр
 * applyActivityFilter, поэтому подпись фильтра и подпись строки не могут
 * разойтись: дом у них один.
 */
const ACTIVITY_FILTER_LABELS: Readonly<Record<string, string>> = {
  program: 'программные мероприятия',
  // Канон п.30 (интервью 14.08.2026): срез «ТД-ПМ» упразднён — заполненная
  // графа программы у ТД норма, подписи «в рамках/вне программ» лгали бы:
  // classifyActivity теперь всю ТД отдаёт ключом current_non_program, а
  // current_program остаётся только в старых снимках — обе подписи «ТД».
  current_program: 'текущая деятельность',
  current_non_program: 'текущая деятельность',
};

/**
 * Подпись вида деятельности строки по столбцам «вид деятельности» и
 * «наименование программы». Нераспознанный вид называется вслух: в книге поле
 * пустое или заполнено произвольным текстом, и молча зачислять такую строку в
 * программные нельзя (тот же урок, что у classifyActivity).
 */
export function activityRowLabel(type: unknown, programName?: unknown): string {
  const kind = classifyActivity(type, programName);
  return kind ? ACTIVITY_FILTER_LABELS[kind] : 'вид деятельности не указан';
}

/** Человеческие названия способов закупки (те же семейства, что METHOD_LABELS). */
const PROCUREMENT_FILTER_LABELS: Readonly<Record<string, string>> = {
  competitive: 'конкурентные способы',
  single: 'единственный поставщик',
};

/** Состояние шапки, влияющее на запрос к серверу. */
export interface RequestFilterState {
  /** Сколько ГРБС выбрано явно; 0 — все. */
  departments: number;
  /** Сколько подведов выбрано явно; 0 — все. */
  subordinates: number;
  activity: string;
  procurement: string;
  year: number | 'all';
}

/** Названия фильтров, уехавших в запрос: их результат — это состав загруженных строк. */
export function requestFilterNames(state: RequestFilterState): string[] {
  const names: string[] = [];
  if (typeof state.year === 'number') names.push(`год ${state.year}`);
  if (state.departments > 0) {
    names.push(`управления (${state.departments})`);
  }
  if (state.subordinates > 0) {
    names.push(`подведомственные учреждения (${state.subordinates})`);
  }
  const activity = ACTIVITY_FILTER_LABELS[state.activity];
  if (activity) names.push(activity);
  const procurement = PROCUREMENT_FILTER_LABELS[state.procurement];
  if (procurement) names.push(procurement);
  return names;
}

/** Состояние фильтров, которые режут уже загруженные строки на экране. */
export interface ScreenFilterState {
  period: string;
  months: number;
  search: string;
  signals: number;
  budgets: number;
  /** Фильтр «только инициативные заявки» (маркер «хотелки» в примечании, п.76). */
  initiative?: boolean;
}

/** Названия фильтров экрана — ровно тех, что сейчас включены. */
export function screenFilterNames(state: ScreenFilterState): string[] {
  const names: string[] = [];
  if (state.period !== 'year') names.push('квартал');
  if (state.months > 0) names.push('месяцы');
  if (state.search.trim()) names.push('поиск по тексту');
  if (state.signals > 0) names.push(`признаки строк (${state.signals})`);
  if (state.budgets > 0) names.push('источники финансирования');
  if (state.initiative) names.push('инициативные заявки');
  return names;
}

/** Сколько строк несёт каждый признак — для подписи «сколько найдётся» в фильтре. */
export function signalOccurrences(rows: readonly CountableRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const signal of row.signals ?? []) {
      counts[signal] = (counts[signal] ?? 0) + 1;
    }
  }
  return counts;
}

/** Все ключи признаков словаря — порядок словаря, он осмысленный (от хороших к пробелам). */
export const ALL_SIGNAL_KEYS: readonly string[] = Object.keys(SIGNAL_LABELS);
