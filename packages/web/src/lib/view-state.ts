// ── Состояние экрана в адресной строке (механизм М7) ────────────────────────
//
//    Болезнь, ради которой модуль появился, описана в атласе карточек 20.08
//    тремя одинаковыми фразами с трёх разных вкладок:
//
//      • «Ссылку „смотри, вот разрез УО за 2 квартал по ЭА“ послать коллеге
//        нельзя» — режим, срез, сортировка Мониторинга живут в `useState`
//        (`pages/Monitoring.tsx:80-84`, карта `monitoring.md` §1.5 п.5);
//      • «Ссылку на „Аналитику с раскрытым УО и выбранным показателем“
//        отправить нельзя» — измерение, показатель, стек разрезов круга и
//        раскрытия карточек умирают при уходе (карта
//        `analytics-timeline-system.md`, «Чего не хватает» п.2);
//      • «Сортировка таблицы, раскрытые управления, вид „управления/подведы“,
//        тумблер „как в листе/чистый“ — всё в локальном state страниц, при
//        переходе между вкладками и в URL теряется» (карта
//        `economy-competition.md`, §«Фильтры»; то же на Пульте — `pult.md:182`).
//
//    Отсюда два обещания модуля.
//
//    (1) СОСТОЯНИЕ ВИДА ЕЗДИТ В АДРЕСЕ. Вид — это как читатель смотрит на
//        данные: сортировка, направление, режим листа, раскрытия, измерение
//        круга, номер страницы. Вид не меняет набор строк, поэтому его
//        восстановление из адреса никого не может обмануть.
//
//    (2) ОТБОР — НЕ ВИД, И ПРАВИЛА У НЕГО ДРУГИЕ (канон п.134, дословно
//        владелец 20.08: «убери все проблемы рандомных непонятных включений
//        фильтров»). Отбор попадает на экран только явным действием человека —
//        клик, переход, открытая ссылка, — и всякий действующий отбор назван
//        чипом с крестиком. Поэтому:
//
//          • в списке полей ВИДА поле-отбор невозможно: `defineTabSpec`
//            падает при попытке завести его там (страж имени);
//          • местный отбор вкладки объявляется отдельным списком, и каждое
//            его поле ОБЯЗАНО уметь назвать себя чипом — тип не даст завести
//            отбор, который нечем показать;
//          • адрес без единого параметра отбора не превращается в отбор:
//            разбор честно возвращает `filters: null`, а не «дефолтный
//            фильтр» (иначе чистый вход сам себе включал бы год);
//          • в сохранённые настройки таблицы уезжает только вид —
//            `persistableView` физически не пропускает отбор (то же правило
//            держит страж `store.filter-hygiene.test.ts` со стороны store).
//
//    Глобальный отбор шапки модуль не переписывает: год, период, управления,
//    подведы, способы, виды, бюджеты и поиск сериализует `filter-context.ts`
//    (`serializeToUrl`/`parseFromUrl`), и второй схемы тех же осей здесь нет —
//    канон п.112 «брать готовое». Адрес просто складывается из трёх частей:
//    вкладка, отбор шапки, вид и местный отбор вкладки.
//
//    Мусор в адресе не роняет экран и не подменяет смысл: неизвестный
//    параметр отбрасывается, испорченное значение возвращается к своему
//    значению по умолчанию. Круговой прогон «состояние → адрес → состояние»
//    держит страж `view-state.test.ts`.

import { parseFromUrl, serializeToUrl, type FilterContext } from './filter-context';

// ── Вкладки, у которых есть объявленный вид ─────────────────────────────────

/**
 * Вкладки перечислены здесь, а не выводятся из `Page`: у половины страниц
 * (Настройки, СВОД, корзины Реестра) собственного вида нет, и заводить им
 * пустые списки значило бы обещать механизм, которого нет.
 */
export type ViewTab =
  | 'dashboard'
  | 'analytics'
  | 'monitoring'
  | 'data'
  | 'economy'
  | 'competition'
  | 'discipline'
  | 'quality'
  | 'report';

const VIEW_TABS: readonly ViewTab[] = [
  'dashboard', 'analytics', 'monitoring', 'data',
  'economy', 'competition', 'discipline', 'quality', 'report',
];

// ── Значения ────────────────────────────────────────────────────────────────

/** Что вообще может лежать в поле вида: одно значение либо список ключей. */
export type ViewValue = string | number | boolean | readonly string[];

/** Состояние вкладки: имя поля → значение. Всегда полное — см. `canonicalView`. */
export type ViewState = Readonly<Record<string, ViewValue>>;

/**
 * Разновидности полей.
 *
 *   `enum`  — закрытый словарь значений (направление сортировки, вид таблицы);
 *   `token` — открытый словарь: ид режима, ключ сортировки. Словарь живёт в
 *             своём доме (`monitoring/modes.ts`, `monitoring/slices.ts`), и
 *             переписывать его сюда значило бы завести второй, расходящийся;
 *   `int`   — число в границах (номер страницы, размер страницы);
 *   `bool`  — тумблер вида («показать разбивку по бюджетам»);
 *   `text`  — короткая строка;
 *   `ids`   — список ключей (раскрытые управления, стек разрезов круга).
 */
export type ViewFieldKind = 'enum' | 'token' | 'int' | 'bool' | 'text' | 'ids';

export interface ViewField {
  /** Короткое имя в адресе. */
  readonly key: string;
  /** Имя человеку — для чипа, подсказки и списка «что приехало ссылкой». */
  readonly title: string;
  readonly kind: ViewFieldKind;
  /** Значение по умолчанию: в адрес не пишется, из мусора восстанавливается. */
  readonly fallback: ViewValue;
  /** Словарь для `enum`. */
  readonly values?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly maxItems?: number;
  readonly maxLength?: number;
}

/**
 * Поле МЕСТНОГО ОТБОРА вкладки. Отличается от поля вида ровно одним, но
 * решающим: оно обязано уметь назвать себя чипом. Канон п.134 — «невидимых
 * отборов не бывает»; тип здесь и есть страж этого правила.
 */
export interface PickField extends ViewField {
  /** Текст чипа с крестиком: «Снижение: от 0 до 1 %». */
  readonly chip: (value: ViewValue) => string;
}

export interface TabViewSpec {
  readonly tab: ViewTab;
  /** Состояние ВИДА — ездит в адресе и в сохранённых настройках. */
  readonly view: readonly ViewField[];
  /** Местный ОТБОР вкладки — ездит в адресе, но только с чипом. */
  readonly pick: readonly PickField[];
}

// ── Страж имени: поле-отбор в списке вида ───────────────────────────────────

/**
 * Слова, по которым узнаётся ось ОТБОРА. Список намеренно грубый: он ловит не
 * смысл, а намерение — если поле вида называется `department` или `budget`,
 * его почти наверняка завели, чтобы что-то отобрать, и место ему в `pick`.
 *
 * Ложное срабатывание лечится переименованием поля вида: тумблер «показать
 * разбивку по бюджетам» — это `split`, а не `budgets`, и разница здесь не
 * косметическая, а ровно та, из-за которой п.134 вообще написан.
 */
const FILTER_WORDS: readonly string[] = [
  'year', 'period', 'quarter', 'month', 'week',
  'dept', 'department', 'grbs', 'sub', 'subordinate', 'unit', 'org',
  'method', 'procurement', 'budget', 'activity',
  'search', 'query', 'filter', 'signal', 'customer', 'winner',
];

/** Слово-нарушитель в имени поля вида; null — имя чистое. */
export function filterishWord(key: string): string | null {
  const lower = key.toLowerCase();
  return FILTER_WORDS.find((word) => lower.includes(word)) ?? null;
}

/** Нарушения правил списка полей — пусто, значит список законен. */
export function validateTabSpec(spec: TabViewSpec): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const field of spec.view) {
    const word = filterishWord(field.key);
    if (word !== null) {
      problems.push(
        `${spec.tab}: поле вида «${field.key}» названо как отбор («${word}») — ` +
        'отбор объявляется в списке pick и обязан нести чип (канон п.134)',
      );
    }
    if (seen.has(field.key)) problems.push(`${spec.tab}: ключ «${field.key}» объявлен дважды`);
    seen.add(field.key);
  }
  for (const field of spec.pick) {
    if (typeof field.chip !== 'function') {
      problems.push(`${spec.tab}: отбор «${field.key}» не умеет назвать себя чипом (канон п.134)`);
    }
    if (seen.has(field.key)) problems.push(`${spec.tab}: ключ «${field.key}» объявлен дважды`);
    seen.add(field.key);
  }
  for (const field of [...spec.view, ...spec.pick]) {
    if (field.kind === 'enum' && (field.values === undefined || field.values.length === 0)) {
      problems.push(`${spec.tab}: у поля «${field.key}» вид enum без словаря значений`);
    }
  }
  return problems;
}

/**
 * Объявление списка полей вкладки. Падает сразу — на загрузке модуля, а не в
 * проде через полгода: список полей это константа, и ошибка в ней обязана
 * убить сборку, а не тихо разрешить самовключение фильтра.
 */
function defineTabSpec(spec: TabViewSpec): TabViewSpec {
  const problems = validateTabSpec(spec);
  if (problems.length > 0) throw new Error(problems.join('; '));
  return spec;
}

// ── Готовые куски словарей ──────────────────────────────────────────────────

const SORT_DIRS = ['asc', 'desc'] as const;

/** Ключ сортировки — открытый словарь: у каждой таблицы он свой. */
const sortKeyField = (fallback: string): ViewField => ({
  key: 'sort', title: 'Сортировка', kind: 'token', fallback,
});
const sortDirField: ViewField = {
  key: 'dir', title: 'Направление', kind: 'enum', values: SORT_DIRS, fallback: 'desc',
};
/** Раскрытия: список ключей — управления, группы, даты. */
const openField = (title: string): ViewField => ({
  key: 'open', title, kind: 'ids', fallback: [], maxItems: 60,
});

// ── Списки полей по вкладкам ────────────────────────────────────────────────
//
// Каждое поле — из живой болезни атласа, а не «на будущее»: неиспользуемое
// поле в адресе это обещание, которое некому исполнить.

const MONITORING_SPEC = defineTabSpec({
  tab: 'monitoring',
  // Monitoring.tsx:80-84 — modeId, sortKey, sortDir, openCode.
  view: [
    { key: 'mode', title: 'Лист', kind: 'token', fallback: 'all' },
    sortKeyField('row'),
    { ...sortDirField, fallback: 'asc' },
    { key: 'open', title: 'Раскрытая процедура', kind: 'token', fallback: '' },
  ],
  // SliceState (lib/monitoring/slices.ts:82-103) — это ОТБОР: он режет строки,
  // и каждый его разрез уже показан крошкой с крестиком.
  pick: [
    { key: 'sdept', title: 'Управление листа', kind: 'token', fallback: '',
      chip: (v) => `Лист: ${String(v)}` },
    { key: 'stage', title: 'Этап', kind: 'token', fallback: '',
      chip: (v) => `Этап: ${String(v)}` },
    { key: 'smethod', title: 'Способ процедуры', kind: 'token', fallback: '',
      chip: (v) => `Способ: ${String(v)}` },
    { key: 'basis', title: 'Основание периода', kind: 'enum',
      values: ['publication', 'auction'], fallback: 'publication',
      chip: (v) => v === 'auction' ? 'Период: по дате торгов' : 'Период: по дате публикации' },
    { key: 'pyear', title: 'Год по дате', kind: 'int', min: 2000, max: 2100, fallback: 0,
      chip: (v) => `Год по дате: ${String(v)}` },
    { key: 'pq', title: 'Квартал по дате', kind: 'int', min: 1, max: 4, fallback: 0,
      chip: (v) => `${String(v)} кв по дате` },
    { key: 'pm', title: 'Месяц по дате', kind: 'int', min: 1, max: 12, fallback: 0,
      chip: (v) => `Месяц по дате: ${String(v)}` },
    { key: 'scust', title: 'Заказчик', kind: 'text', maxLength: 200, fallback: '',
      chip: (v) => `Заказчик: ${String(v)}` },
    { key: 'inn', title: 'Победитель (ИНН)', kind: 'token', fallback: '',
      chip: (v) => `Победитель ИНН ${String(v)}` },
    { key: 'nmck', title: 'Размер НМЦК', kind: 'token', fallback: '',
      chip: (v) => `НМЦК: ${String(v)}` },
    { key: 'red', title: 'Снижение', kind: 'token', fallback: '',
      chip: (v) => `Снижение: ${String(v)}` },
    { key: 'pcode', title: 'Год процедуры', kind: 'int', min: 2000, max: 2100, fallback: 0,
      chip: (v) => `Год процедуры: ${String(v)}` },
    { key: 'defects', title: 'Только с дефектами', kind: 'bool', fallback: false,
      chip: () => 'Только с дефектами' },
    { key: 'text', title: 'Поиск по реестру', kind: 'text', maxLength: 120, fallback: '',
      chip: (v) => `Поиск: ${String(v)}` },
  ],
});

const ANALYTICS_SPEC = defineTabSpec({
  tab: 'analytics',
  // DrillPieChart.tsx:302-304 (dimension/metric/scope) + раскрытия карточек
  // A5/A17 и вкладка S3 (карта analytics-timeline-system.md, «Чего не хватает» п.2).
  view: [
    { key: 'dim', title: 'Измерение круга', kind: 'enum',
      values: ['procurement', 'budget', 'department', 'execution'], fallback: 'department' },
    { key: 'metric', title: 'Показатель круга', kind: 'enum',
      values: ['plan', 'fact', 'economy', 'count'], fallback: 'plan' },
    openField('Раскрытые управления'),
    { key: 'card', title: 'Раскрытая карточка', kind: 'token', fallback: '' },
    { key: 'tab', title: 'Вкладка раздела', kind: 'token', fallback: '' },
    sortKeyField(''),
    sortDirField,
  ],
  // Стек разрезов круга — отбор: он режет данные до «УО → ЕП». Круг уже
  // показывает его крошкой внутри себя, поэтому правило п.134 соблюдено.
  pick: [
    { key: 'ring', title: 'Разрез круга', kind: 'ids', fallback: [], maxItems: 6,
      chip: (v) => `Круг: ${(v as readonly string[]).join(' → ')}` },
  ],
});

const DASHBOARD_SPEC = defineTabSpec({
  tab: 'dashboard',
  // pult.md:182 — стек разрезов и измерение круга не переживают навигацию;
  // pult.md P2 §17 — сортировка рейтинга и раскрытая плитка.
  view: [
    { key: 'dim', title: 'Измерение круга', kind: 'enum',
      values: ['procurement', 'budget', 'department', 'execution'], fallback: 'department' },
    { key: 'metric', title: 'Показатель круга', kind: 'enum',
      values: ['plan', 'fact', 'economy', 'count'], fallback: 'plan' },
    sortKeyField(''),
    sortDirField,
    openField('Раскрытые плитки'),
    { key: 'hero', title: 'Выбранная плитка', kind: 'token', fallback: '' },
  ],
  pick: [
    { key: 'ring', title: 'Разрез круга', kind: 'ids', fallback: [], maxItems: 6,
      chip: (v) => `Круг: ${(v as readonly string[]).join(' → ')}` },
  ],
});

const ECONOMY_SPEC = defineTabSpec({
  tab: 'economy',
  // Economy.tsx:105-115 — раскрытия, сортировка, разбивка, вид таблицы,
  // выбранная плитка (карта economy-competition.md, §«Фильтры»).
  view: [
    sortKeyField('economy'),
    sortDirField,
    openField('Раскрытые управления'),
    { key: 'table', title: 'Вид таблицы', kind: 'enum',
      values: ['departments', 'subordinates'], fallback: 'departments' },
    // Тумблер «показать разбивку» — вид, а не отбор бюджета: он ничего не
    // отсекает. Имя `split` вместо `budgets` — не косметика, см. FILTER_WORDS.
    { key: 'split', title: 'Разбивка по бюджетам', kind: 'bool', fallback: false },
    { key: 'hero', title: 'Выбранная плитка', kind: 'token', fallback: 'economy' },
    { key: 'sheet', title: 'Как в листе', kind: 'bool', fallback: false },
  ],
  pick: [],
});

const COMPETITION_SPEC = defineTabSpec({
  tab: 'competition',
  view: [sortKeyField(''), sortDirField, openField('Раскрытые группы')],
  pick: [],
});

const DATA_SPEC = defineTabSpec({
  tab: 'data',
  // DataBrowser.tsx:276-290 — вид, размер и номер страницы, сортировка.
  view: [
    { key: 'mode', title: 'Режим', kind: 'enum', values: ['browse', 'editor'], fallback: 'browse' },
    sortKeyField('id'),
    { ...sortDirField, fallback: 'asc' },
    { key: 'size', title: 'Строк на странице', kind: 'int', min: 10, max: 500, fallback: 25 },
    { key: 'page', title: 'Страница', kind: 'int', min: 1, max: 100000, fallback: 1 },
    openField('Раскрытые группы'),
  ],
  // Признаки строк — отбор (сегодня приезжает затравкой `registrySignalSeed`);
  // в адресе он живёт только вместе с чипом.
  pick: [
    { key: 'sig', title: 'Признаки строк', kind: 'ids', fallback: [], maxItems: 20,
      chip: (v) => `Признаки: ${(v as readonly string[]).length}` },
  ],
});

const QUALITY_SPEC = defineTabSpec({
  tab: 'quality',
  view: [
    { key: 'tab', title: 'Раздел контроля', kind: 'enum',
      values: ['trust', 'recon', 'issues', 'recs', 'journal', 'scorecard'], fallback: 'recon' },
    sortKeyField(''),
    sortDirField,
    openField('Раскрытые управления'),
  ],
  pick: [
    { key: 'cat', title: 'Механизм замечания', kind: 'token', fallback: '',
      chip: (v) => `Механизм: ${String(v)}` },
  ],
});

const DISCIPLINE_SPEC = defineTabSpec({
  tab: 'discipline',
  view: [sortKeyField(''), sortDirField, openField('Раскрытые управления'),
    { key: 'tab', title: 'Раздел', kind: 'token', fallback: '' }],
  pick: [],
});

const REPORT_SPEC = defineTabSpec({
  tab: 'report',
  view: [openField('Раскрытые разделы'), sortKeyField(''), sortDirField],
  pick: [],
});

const SPECS: Readonly<Record<ViewTab, TabViewSpec>> = {
  dashboard: DASHBOARD_SPEC,
  analytics: ANALYTICS_SPEC,
  monitoring: MONITORING_SPEC,
  data: DATA_SPEC,
  economy: ECONOMY_SPEC,
  competition: COMPETITION_SPEC,
  discipline: DISCIPLINE_SPEC,
  quality: QUALITY_SPEC,
  report: REPORT_SPEC,
};

/** Список полей вкладки. Другого способа узнать разрешённые поля нет. */
export function viewSpec(tab: ViewTab): TabViewSpec {
  return SPECS[tab];
}

/** Все объявленные вкладки — для стражей и обходов. */
export function allViewTabs(): readonly ViewTab[] {
  return VIEW_TABS;
}

/** Известна ли строка как вкладка с объявленным видом. */
export function isViewTab(value: unknown): value is ViewTab {
  return typeof value === 'string' && VIEW_TABS.includes(value as ViewTab);
}

// ── Приведение значений к канону ────────────────────────────────────────────

const TOKEN_MAX = 64;
const IDS_MAX_DEFAULT = 40;
const TEXT_MAX_DEFAULT = 120;

/** Печатаемый однострочный ключ без управляющих символов. */
function cleanToken(raw: string, limit: number): string | null {
  const value = raw.trim();
  if (value === '' || value.length > limit) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

/**
 * Одно значение к канону поля. `null` — значение не годится, и звать его
 * место должно значение по умолчанию: испорченный адрес обязан открыть
 * вкладку, а не белый экран.
 */
function coerce(field: ViewField, raw: readonly string[]): ViewValue | null {
  const first = raw[0];
  switch (field.kind) {
    case 'enum': {
      if (first === undefined) return null;
      const value = first.trim();
      return (field.values ?? []).includes(value) ? value : null;
    }
    case 'token': {
      if (first === undefined) return null;
      return cleanToken(first, TOKEN_MAX);
    }
    case 'text': {
      if (first === undefined) return null;
      const value = first.trim();
      if (value === '') return null;
      return value.slice(0, field.maxLength ?? TEXT_MAX_DEFAULT);
    }
    case 'int': {
      if (first === undefined) return null;
      const value = Number(first.trim());
      if (!Number.isInteger(value)) return null;
      if (field.min !== undefined && value < field.min) return null;
      if (field.max !== undefined && value > field.max) return null;
      return value;
    }
    case 'bool': {
      if (first === undefined) return null;
      const value = first.trim();
      if (value === '1' || value === 'true') return true;
      if (value === '0' || value === 'false') return false;
      return null;
    }
    case 'ids': {
      const limit = field.maxItems ?? IDS_MAX_DEFAULT;
      const out: string[] = [];
      for (const item of raw) {
        const token = cleanToken(item, TOKEN_MAX);
        if (token !== null && !out.includes(token)) out.push(token);
        if (out.length >= limit) break;
      }
      return out.length > 0 ? out : null;
    }
  }
}

/** То же приведение, но для значения, пришедшего из памяти страницы. */
function coerceValue(field: ViewField, value: ViewValue | undefined): ViewValue {
  if (value === undefined) return field.fallback;
  if (Array.isArray(value)) return coerce(field, value.map(String)) ?? field.fallback;
  if (typeof value === 'boolean') return field.kind === 'bool' ? value : field.fallback;
  return coerce(field, [String(value)]) ?? field.fallback;
}

/** Совпадает ли значение со значением по умолчанию (списки — по составу). */
function isFallback(field: ViewField, value: ViewValue): boolean {
  if (Array.isArray(field.fallback) || Array.isArray(value)) {
    const a = Array.isArray(value) ? value : [];
    const b = Array.isArray(field.fallback) ? field.fallback : [];
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return value === field.fallback;
}

/**
 * Полное каноническое состояние: каждое объявленное поле на месте, мусор
 * заменён значением по умолчанию, незнакомые поля отброшены. Именно это
 * состояние страница кладёт в свои `useState` — читать «сырое» не нужно.
 */
export function canonicalView(tab: ViewTab, raw?: Partial<Record<string, ViewValue>>): ViewState {
  const spec = viewSpec(tab);
  const out: Record<string, ViewValue> = {};
  for (const field of spec.view) out[field.key] = coerceValue(field, raw?.[field.key]);
  return out;
}

/** То же для местного отбора вкладки. */
export function canonicalPick(tab: ViewTab, raw?: Partial<Record<string, ViewValue>>): ViewState {
  const spec = viewSpec(tab);
  const out: Record<string, ViewValue> = {};
  for (const field of spec.pick) out[field.key] = coerceValue(field, raw?.[field.key]);
  return out;
}

// ── Типизированное чтение ───────────────────────────────────────────────────

export function viewEnum<T extends string>(state: ViewState, key: string, values: readonly T[], fallback: T): T {
  const value = state[key];
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : fallback;
}

export function viewToken(state: ViewState, key: string, fallback = ''): string {
  const value = state[key];
  return typeof value === 'string' ? value : fallback;
}

export function viewInt(state: ViewState, key: string, fallback: number): number {
  const value = state[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

export function viewBool(state: ViewState, key: string, fallback = false): boolean {
  const value = state[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function viewIds(state: ViewState, key: string): readonly string[] {
  const value = state[key];
  return Array.isArray(value) ? value : [];
}

// ── Адрес ───────────────────────────────────────────────────────────────────

/** Имя параметра вкладки в адресе. */
export const TAB_PARAM = 'tab';
/** Приставка полей вида. */
export const VIEW_PREFIX = 'v.';
/** Приставка полей местного отбора — по ней страница узнаёт, что показать чипом. */
export const PICK_PREFIX = 'f.';

/** Ключи, по которым узнаётся отбор шапки (схема `filter-context.ts`). */
const HEAD_FILTER_KEYS: readonly string[] = ['y', 'p', 'm', 'grbs', 'unit', 'mtd', 'act', 'bud', 'q', 'w'];

export interface Address {
  readonly tab: ViewTab;
  /** Отбор шапки; не задан — адрес его не несёт и не должен включать. */
  readonly filters?: FilterContext | null;
  readonly view?: Partial<Record<string, ViewValue>>;
  readonly pick?: Partial<Record<string, ViewValue>>;
}

export interface ArrivedPick {
  readonly key: string;
  readonly title: string;
  readonly value: ViewValue;
  /** Текст чипа с крестиком — вкладка ОБЯЗАНА его показать (канон п.134). */
  readonly chip: string;
}

export interface ParsedAddress {
  /** null — адрес не назвал вкладку; вид и отбор тогда пусты. */
  readonly tab: ViewTab | null;
  /**
   * null — в адресе НЕТ ни одного параметра отбора шапки. Это не «фильтр по
   * умолчанию», а «отбора не передавали»: подставить сюда что-либо значило бы
   * включить фильтр без руки человека (канон п.134).
   */
  readonly filters: FilterContext | null;
  readonly view: ViewState;
  readonly pick: ViewState;
  /** Приехавший местный отбор словами — чипы, без которых показывать его нельзя. */
  readonly picks: readonly ArrivedPick[];
}

function writeGroup(
  params: URLSearchParams,
  fields: readonly ViewField[],
  prefix: string,
  raw: Partial<Record<string, ViewValue>> | undefined,
): void {
  for (const field of fields) {
    const value = coerceValue(field, raw?.[field.key]);
    // Значение по умолчанию в адрес не пишется: ссылка обязана называть
    // отличия, а не пересказывать весь экран.
    if (isFallback(field, value)) continue;
    const name = prefix + field.key;
    if (Array.isArray(value)) {
      for (const item of value) params.append(name, item);
    } else if (typeof value === 'boolean') {
      params.set(name, value ? '1' : '0');
    } else {
      params.set(name, String(value));
    }
  }
}

/**
 * Состояние вкладки → строка параметров адреса (без ведущего «?»).
 * Отбор шапки сериализует `filter-context.ts` — второй схемы тех же осей нет.
 */
export function serializeAddress(address: Address): string {
  const params = new URLSearchParams();
  params.set(TAB_PARAM, address.tab);
  if (address.filters) {
    const head = new URLSearchParams(serializeToUrl(address.filters));
    for (const [key, value] of head) params.append(key, value);
  }
  const spec = viewSpec(address.tab);
  writeGroup(params, spec.view, VIEW_PREFIX, address.view);
  writeGroup(params, spec.pick, PICK_PREFIX, address.pick);
  return params.toString();
}

function readGroup(
  params: URLSearchParams,
  fields: readonly ViewField[],
  prefix: string,
): Record<string, ViewValue> {
  const out: Record<string, ViewValue> = {};
  for (const field of fields) {
    const raw = params.getAll(prefix + field.key);
    out[field.key] = raw.length > 0 ? (coerce(field, raw) ?? field.fallback) : field.fallback;
  }
  return out;
}

/**
 * Строка параметров → состояние вкладки. Мусор не роняет разбор: неизвестные
 * параметры отбрасываются, испорченные значения возвращаются к умолчанию,
 * чужие поля другой вкладки не просачиваются.
 */
export function parseAddress(qs: string): ParsedAddress {
  const params = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
  const rawTab = params.get(TAB_PARAM);
  const tab = isViewTab(rawTab) ? rawTab : null;

  const carriesFilters = HEAD_FILTER_KEYS.some((key) => params.has(key));
  const filters = carriesFilters ? parseFromUrl(params.toString()) : null;

  if (tab === null) {
    return { tab: null, filters, view: {}, pick: {}, picks: [] };
  }

  const spec = viewSpec(tab);
  const view = readGroup(params, spec.view, VIEW_PREFIX);
  const pick = readGroup(params, spec.pick, PICK_PREFIX);
  return { tab, filters, view, pick, picks: arrivedPicks(tab, pick) };
}

/**
 * Местный отбор, который действует прямо сейчас, — списком чипов. Пустой
 * список значит, что показывать нечего; непустой — что вкладка обязана
 * показать каждый чип с крестиком, иначе отбор становится невидимым.
 */
export function arrivedPicks(tab: ViewTab, pick: ViewState): readonly ArrivedPick[] {
  const spec = viewSpec(tab);
  const out: ArrivedPick[] = [];
  for (const field of spec.pick) {
    const value = coerceValue(field, pick[field.key]);
    if (isFallback(field, value)) continue;
    out.push({ key: field.key, title: field.title, value, chip: field.chip(value) });
  }
  return out;
}

/** Готовая ссылка: путь плюс параметры. Пустых «?» не оставляет. */
export function addressHref(pathname: string, address: Address): string {
  const qs = serializeAddress(address);
  return qs ? `${pathname}?${qs}` : pathname;
}

// ── Сохранённые настройки: только вид ───────────────────────────────────────

/**
 * Что вкладке позволено положить в сохранённые настройки (localStorage):
 * ТОЛЬКО вид. Отбор сюда не попадает физически — иначе фильтр молча
 * возвращался бы после перезагрузки, а это ровно то самовключение, которое
 * канон п.134 велит искоренить.
 */
export function persistableView(tab: ViewTab, state: ViewState): ViewState {
  const spec = viewSpec(tab);
  const out: Record<string, ViewValue> = {};
  for (const field of spec.view) {
    const value = coerceValue(field, state[field.key]);
    if (isFallback(field, value)) continue;
    out[field.key] = value;
  }
  return out;
}
