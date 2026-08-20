// ── Провал несёт периметр (механизм М14) ────────────────────────────────────
//
//    Болезнь, ради которой модуль появился, записана в атласе карточек 20.08
//    почти одними словами на трёх вкладках:
//
//      • «Клик по сектору круга уводит в Реестр по ОДНОЙ оси — управлению, —
//        роняя квартал, месяц и способ» (карта `pult.md`, П3);
//      • «На „Аналитике“ период не передаёт НИ ОДИН клик: провалился из
//        „3 кв“ — открылся весь год» (карта `analytics-timeline-system.md`,
//        «Чего не хватает» п.4);
//      • «Столбец „Экономии“ ведёт в Реестр без способа и бюджета, за которые
//        он посчитан» (карта `economy-competition.md`, Э6).
//
//    Причина у всех троих одна: цель перехода собиралась руками на месте
//    клика. Каждое место помнило про свою ось и забывало остальные, а забытая
//    ось молчала — читатель видел ДРУГИЕ строки и не знал об этом.
//
//    Отсюда обещание модуля: цель перехода строится из ТОЧКИ, по которой
//    щёлкнули, целиком — управление, период с кварталом и месяцем, способ,
//    бюджет, признак, — и ни одна ось не теряется молча.
//
//    ЧЕСТНЫЙ СЛУЧАЙ «ОСЬ К ЦЕЛИ НЕПРИМЕНИМА». Не всякую ось принимающая
//    страница умеет принять, и врать об этом нельзя. Такая ось не
//    передаётся и НАЗЫВАЕТСЯ словами (`dropped`), чтобы место клика могло
//    сказать читателю, чего он в цели не увидит. Три источника таких случаев,
//    и все три проверены по коду, а не по памяти:
//
//      (1) БЮДЖЕТ НЕ ПЕРЕДАЁТСЯ НИКУДА. `useFilteredData` (hooks:45) и Реестр
//          (`DataBrowser.tsx:294`) уровень бюджета читают и числа по нему
//          сужают — а `navigateTo` (`store.ts:528-612`) оси бюджета ПРОСТО НЕ
//          ИМЕЕТ: в его список обновляемых полей `selectedBudgets` не входит.
//          Значит, провал с бюджетной точки честно скажет «бюджет не
//          передаётся», а не притворится, что передал.
//      (2) МОНИТОРИНГ НЕ ЖИВЁТ ПОД ОТБОРОМ ШАПКИ. Из всего отбора он читает
//          одно `selectedDepartments` (`Monitoring.tsx:106`); год, квартал,
//          месяц и способ у него собственные — это его местный отбор
//          (`SliceState`). Поэтому в Мониторинг период и способ едут МЕСТНЫМ
//          отбором вкладки (`f.`-параметры механизма М7), а не отбором шапки:
//          отправить их шапкой значило бы отправить их в никуда.
//      (3) ПРИЗНАКИ СТРОК ПОТРЕБЛЯЕТ ТОЛЬКО РЕЕСТР — через затравку
//          `registrySignalSeed` (`store.ts:540`). Любой другой цели признаки
//          не передаются.
//
//    Квартал и месяц вместе не отправляются: `navigateTo` при переданных
//    месяцах кладёт `period: 'year'` (`store.ts:546-550`), и квартал сгорел бы
//    молча. Месяц ТОЧНЕЕ квартала и его собой заменяет, поэтому при известном
//    месяце едет месяц, а квартал отмечается как поглощённый, а не потерянный.
//
//    Второй схемы отбора шапки здесь нет: значения складываются ровно в тот
//    объект, который принимает `navigateTo`, а местный отбор — ровно в
//    параметры `view-state.ts` (канон п.112 «брать готовое»).

import type { BudgetLevel } from '@aemr/shared';
import type { ActivityKey, MethodFamily } from './filter-context';
import { periodScopePhrase } from './period-label';
import { serializeAddress, viewSpec, type ViewTab } from './view-state';

// ── Точка, по которой щёлкнули ──────────────────────────────────────────────

/**
 * Всё, за что стоит столбец, сектор или строка. Каждое поле необязательно:
 * точка называет ровно те оси, которые за ней действительно стоят, и молчание
 * поля значит «эта ось точку не сужает», а не «ось забыли».
 */
export interface DrillPoint {
  /** ГРБС — любая форма ключа; канон наводит `navigateTo` (`toCanonicalDeptId`). */
  readonly dept?: string;
  /** Подведомственное учреждение — displayName, как в отборе шапки. */
  readonly subordinate?: string;
  readonly year?: number;
  readonly quarter?: number;
  readonly month?: number;
  readonly method?: MethodFamily;
  readonly budget?: BudgetLevel;
  readonly activity?: ActivityKey;
  /** Признаки строк — ключи, которые понимает Реестр. */
  readonly signals?: readonly string[];
  readonly search?: string;
  /** Раскрываемая процедура Мониторинга — реестровый номер. */
  readonly procedure?: string;
}

// ── Оси и их применимость ───────────────────────────────────────────────────

export type DrillAxis =
  | 'dept' | 'subordinate'
  | 'year' | 'quarter' | 'month'
  | 'method' | 'budget' | 'activity'
  | 'signals' | 'search' | 'procedure';

/**
 * Как ось доезжает до цели:
 *
 *   `head`  — отбором шапки, через `navigateTo`;
 *   `local` — местным отбором вкладки, `f.`-параметром адреса (М7);
 *   `none`  — не доезжает никак; ось обязана быть НАЗВАНА в `dropped`.
 */
export type DrillCarrier = 'head' | 'local' | 'none';

/** Куда можно провалиться. Совпадает с вкладками, у которых объявлен вид. */
export type DrillPage = ViewTab;

/** Имя оси человеку — для фразы «чего в цели не будет». */
const AXIS_TITLE: Readonly<Record<DrillAxis, string>> = {
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
};

/**
 * Причина, по которой ось до цели не доезжает. Формулировка отвечает на
 * вопрос читателя «а почему?», а не отделывается словом «неприменимо».
 */
const NO_BUDGET_AXIS =
  'переход не умеет передавать уровень бюджета — в цели будут все бюджеты';
const NOT_ON_PAGE = (what: string): string => `${what} на этой вкладке не показывается`;
const SIGNALS_ONLY_REGISTRY =
  'признаки строк понимает только Реестр — в другой цели они ничего не сузят';
const PROCEDURE_ONLY_MONITORING =
  'номер процедуры раскрывает только Мониторинг';

/**
 * Что каждая вкладка умеет принять. Таблица не сочинена: она снята с кода
 * принимающих страниц — `useFilteredData` для вкладок под отбором шапки,
 * `Monitoring.tsx` и `DataBrowser.tsx` для двух особых.
 */
type PageCarriers = Readonly<Record<DrillAxis, DrillCarrier>>;

/** Вкладка под отбором шапки: всё, кроме бюджета, признаков и процедуры. */
const HEAD_DRIVEN: PageCarriers = {
  dept: 'head',
  subordinate: 'head',
  year: 'head',
  quarter: 'head',
  month: 'head',
  method: 'head',
  activity: 'head',
  budget: 'none',
  signals: 'none',
  search: 'head',
  procedure: 'none',
};

/**
 * Реестр — единственный, кто принимает признаки строк (затравкой). Бюджет он
 * читает, но передать его нечем: оси нет у самого перехода.
 */
const REGISTRY: PageCarriers = { ...HEAD_DRIVEN, signals: 'head' };

/**
 * Мониторинг из отбора шапки читает ОДНИ управления. Период и способ у него
 * собственные — они едут местным отбором вкладки.
 */
const MONITORING: PageCarriers = {
  dept: 'head',
  subordinate: 'none',
  year: 'local',
  quarter: 'local',
  month: 'local',
  method: 'local',
  activity: 'none',
  budget: 'none',
  signals: 'none',
  search: 'local',
  procedure: 'local',
};

const CARRIERS: Readonly<Record<DrillPage, PageCarriers>> = {
  dashboard: HEAD_DRIVEN,
  analytics: HEAD_DRIVEN,
  economy: HEAD_DRIVEN,
  competition: HEAD_DRIVEN,
  discipline: HEAD_DRIVEN,
  quality: HEAD_DRIVEN,
  report: HEAD_DRIVEN,
  data: REGISTRY,
  monitoring: MONITORING,
};

/** Как ось доедет до этой цели. Другого способа узнать применимость нет. */
export function axisCarrier(page: DrillPage, axis: DrillAxis): DrillCarrier {
  return CARRIERS[page][axis];
}

/** Причина, по которой ось до цели не доезжает; null — доезжает. */
function dropReason(page: DrillPage, axis: DrillAxis): string | null {
  if (axisCarrier(page, axis) !== 'none') return null;
  switch (axis) {
    case 'budget': return NO_BUDGET_AXIS;
    case 'signals': return SIGNALS_ONLY_REGISTRY;
    case 'procedure': return PROCEDURE_ONLY_MONITORING;
    case 'subordinate': return NOT_ON_PAGE('разрез по учреждениям');
    case 'activity': return NOT_ON_PAGE('вид деятельности');
    default: return NOT_ON_PAGE(AXIS_TITLE[axis]);
  }
}

// ── Значения осей словами ───────────────────────────────────────────────────

/**
 * Короткие имена бюджетов. Тот же словарь живёт в `perimeter.ts`, но наружу
 * он там не выведен, а сам файл сейчас в правке соседней волны — забирать его
 * экспортом надо отдельным швом (см. отчёт), а не расширением файла на ходу.
 */
const BUDGET_SHORT: Readonly<Record<BudgetLevel, string>> = {
  fb: 'ФБ', kb: 'КБ', mb: 'МБ',
};

const ACTIVITY_TITLE: Readonly<Record<ActivityKey, string>> = {
  program: 'программная',
  current_program: 'текущая программная',
  current_non_program: 'текущая непрограммная',
};

/** Значение оси словами — для чипа, подсказки и фразы «чего не будет». */
function axisLabel(point: DrillPoint, axis: DrillAxis): string | null {
  switch (axis) {
    case 'dept': return point.dept ?? null;
    case 'subordinate': return point.subordinate ?? null;
    case 'year': return point.year === undefined ? null : String(point.year);
    case 'quarter':
      return point.quarter === undefined ? null : periodScopePhrase(`q${point.quarter}` as never, new Set());
    case 'month':
      return point.month === undefined ? null : periodScopePhrase('year', new Set([point.month]));
    case 'method': return point.method ?? null;
    case 'budget': return point.budget === undefined ? null : BUDGET_SHORT[point.budget];
    case 'activity': return point.activity === undefined ? null : ACTIVITY_TITLE[point.activity];
    case 'signals': {
      const count = point.signals?.length ?? 0;
      return count > 0 ? `${count}` : null;
    }
    case 'search': return point.search?.trim() ? point.search.trim() : null;
    case 'procedure': return point.procedure ?? null;
  }
}

// ── Приведение точки к канону ───────────────────────────────────────────────

const METHODS: readonly MethodFamily[] = ['КП', 'ЕП'];
const BUDGETS: readonly BudgetLevel[] = ['fb', 'kb', 'mb'];
const ACTIVITIES: readonly ActivityKey[] = ['program', 'current_program', 'current_non_program'];

/**
 * Мусор в точке не едет дальше. Точка приходит из обработчика клика, где
 * значение легко приходит из чужих данных: неверный месяц или выдуманный
 * способ обязаны исчезнуть здесь, а не сузить цель наугад.
 */
export function canonicalPoint(point: DrillPoint): DrillPoint {
  const out: {
    -readonly [K in keyof DrillPoint]: DrillPoint[K];
  } = {};

  const dept = point.dept?.trim();
  if (dept) out.dept = dept;
  const sub = point.subordinate?.trim();
  if (sub) out.subordinate = sub;

  if (Number.isInteger(point.year) && point.year! >= 2000 && point.year! <= 2100) out.year = point.year;
  if (Number.isInteger(point.quarter) && point.quarter! >= 1 && point.quarter! <= 4) out.quarter = point.quarter;
  if (Number.isInteger(point.month) && point.month! >= 1 && point.month! <= 12) out.month = point.month;

  if (point.method !== undefined && METHODS.includes(point.method)) out.method = point.method;
  if (point.budget !== undefined && BUDGETS.includes(point.budget)) out.budget = point.budget;
  if (point.activity !== undefined && ACTIVITIES.includes(point.activity)) out.activity = point.activity;

  const signals = (point.signals ?? []).map((s) => s.trim()).filter(Boolean);
  if (signals.length > 0) out.signals = [...new Set(signals)];

  const search = point.search?.trim();
  if (search) out.search = search;
  const procedure = point.procedure?.trim();
  if (procedure) out.procedure = procedure;

  // Месяц вне названного квартала — противоречие внутри самой точки. Побеждает
  // месяц как более точный, квартал отбрасывается: тащить оба значило бы
  // отправить цель, которой не соответствует ни одна строка.
  if (out.month !== undefined && out.quarter !== undefined) {
    if (Math.ceil(out.month / 3) !== out.quarter) delete out.quarter;
  }
  return out;
}

// ── Цель перехода ───────────────────────────────────────────────────────────

/** Ровно тот объект, который принимает `navigateTo` вторым доводом. */
export interface DrillFilters {
  period?: 'year' | 'q1' | 'q2' | 'q3' | 'q4';
  department?: string;
  procurement?: 'all' | 'competitive' | 'single';
  // Тот же словарь, что у `ActivityType` в `@aemr/shared`: строкой пошире
  // здесь означало бы вид деятельности, которого фильтр не узнает.
  activity?: ActivityKey;
  subordinate?: string;
  year?: number;
  search?: string;
  months?: number[];
  signals?: string[];
}

export interface DrillAxisNote {
  readonly axis: DrillAxis;
  /** Имя оси человеку: «Способ закупки». */
  readonly title: string;
  /** Значение словами: «ЕП», «3 кв», «УО». */
  readonly label: string;
  readonly carrier: DrillCarrier;
  /** Почему не доехала. Есть только у `dropped`. */
  readonly reason?: string;
}

export interface DrillTarget {
  readonly page: DrillPage;
  /** Отбор шапки — как есть в `navigateTo(page, filters)`. */
  readonly filters: DrillFilters;
  /**
   * Параметры адреса для механизма М7: вкладка и её МЕСТНЫЙ отбор. Пусто,
   * если местным отбором ничего не едет.
   */
  readonly address: string;
  /** Оси, которые доехали. */
  readonly carried: readonly DrillAxisNote[];
  /** Оси, которые до цели не доезжают — названы, а не замолчаны. */
  readonly dropped: readonly DrillAxisNote[];
  /** Фраза для подсказки: «Откроется: УО · 3 кв · ЕП». */
  readonly summary: string;
  /** Фраза про потери: «Бюджет ФБ не передаётся…»; пусто — терять нечего. */
  readonly warning: string;
}

/** Способ закупки → ключ, который понимает `navigateTo`. */
const PROCUREMENT_OF: Readonly<Record<MethodFamily, 'competitive' | 'single'>> = {
  'КП': 'competitive',
  'ЕП': 'single',
};

/** Оси в порядке, в котором их называют читателю: кто, когда, что. */
const AXIS_ORDER: readonly DrillAxis[] = [
  'dept', 'subordinate', 'year', 'quarter', 'month',
  'method', 'budget', 'activity', 'signals', 'search', 'procedure',
];

/** Ключи местного отбора Мониторинга — те же, что объявлены в `view-state.ts`. */
const MONITORING_PICK: Partial<Record<DrillAxis, string>> = {
  year: 'pyear',
  quarter: 'pq',
  month: 'pm',
  method: 'smethod',
  search: 'text',
};

/**
 * Цель перехода из точки. Ни одна ось не пропадает молча: каждая либо
 * доезжает (`carried`), либо названа непринятой (`dropped`).
 */
export function buildDrill(rawPoint: DrillPoint, page: DrillPage): DrillTarget {
  const point = canonicalPoint(rawPoint);
  const filters: DrillFilters = {};
  const pick: Record<string, string | number | readonly string[]> = {};
  const carried: DrillAxisNote[] = [];
  const dropped: DrillAxisNote[] = [];
  /** Раскрываемая процедура — единственное поле ВИДА, которым едет провал. */
  let openProcedure: string | undefined;

  // Месяц точнее квартала и заменяет его собой: `navigateTo` при переданных
  // месяцах кладёт period: 'year', и отправить оба значило бы сжечь квартал.
  const monthWins = point.month !== undefined && axisCarrier(page, 'month') !== 'none';

  for (const axis of AXIS_ORDER) {
    const label = axisLabel(point, axis);
    if (label === null) continue;

    if (axis === 'quarter' && monthWins) {
      // Не потеря: месяц лежит внутри этого квартала, цель окажется уже.
      continue;
    }

    const carrier = axisCarrier(page, axis);
    if (carrier === 'none') {
      dropped.push({ axis, title: AXIS_TITLE[axis], label, carrier, reason: dropReason(page, axis)! });
      continue;
    }

    if (carrier === 'local') {
      // Раскрытая процедура — это ВИД, а не отбор: она не режет строки, а
      // разворачивает одну. Поэтому у неё нет ключа в списке местного отбора
      // и едет она `v.`-параметром (поле `open` в `view-state.ts`).
      if (axis === 'procedure') {
        openProcedure = point.procedure!;
        carried.push({ axis, title: AXIS_TITLE[axis], label, carrier });
        continue;
      }
      const key = MONITORING_PICK[axis];
      if (key === undefined) {
        dropped.push({ axis, title: AXIS_TITLE[axis], label, carrier: 'none', reason: dropReason(page, axis) ?? NOT_ON_PAGE(AXIS_TITLE[axis]) });
        continue;
      }
      if (axis === 'year') pick[key] = point.year!;
      else if (axis === 'quarter') pick[key] = point.quarter!;
      else if (axis === 'month') pick[key] = point.month!;
      else if (axis === 'method') pick[key] = point.method!;
      else if (axis === 'search') pick[key] = point.search!;
      carried.push({ axis, title: AXIS_TITLE[axis], label, carrier });
      continue;
    }

    switch (axis) {
      case 'dept': filters.department = point.dept; break;
      case 'subordinate': filters.subordinate = point.subordinate; break;
      case 'year': filters.year = point.year; break;
      case 'quarter': filters.period = `q${point.quarter}` as DrillFilters['period']; break;
      case 'month': filters.months = [point.month!]; break;
      case 'method': filters.procurement = PROCUREMENT_OF[point.method!]; break;
      case 'activity': filters.activity = point.activity; break;
      case 'signals': filters.signals = [...point.signals!]; break;
      case 'search': filters.search = point.search; break;
      default: break;
    }
    carried.push({ axis, title: AXIS_TITLE[axis], label, carrier });
  }

  const address = (Object.keys(pick).length > 0 || openProcedure !== undefined)
    ? serializeAddress({
      tab: page,
      view: openProcedure !== undefined ? { open: openProcedure } : undefined,
      pick,
    })
    : '';

  return {
    page,
    filters,
    address,
    carried,
    dropped,
    summary: summaryOf(carried),
    warning: warningOf(dropped),
  };
}

/** «Откроется: УО · 3 кв · ЕП»; без осей — «Откроется всё без сужения». */
function summaryOf(carried: readonly DrillAxisNote[]): string {
  if (carried.length === 0) return 'Откроется всё без сужения';
  return `Откроется: ${carried.map((n) => n.label).join(' · ')}`;
}

/**
 * Потери словами. Каждая непринятая ось названа со своим значением и
 * причиной — читателю должно хватить фразы, чтобы не поверить в лишнее.
 */
function warningOf(dropped: readonly DrillAxisNote[]): string {
  if (dropped.length === 0) return '';
  return dropped
    .map((n) => `${n.title} ${n.label}: ${n.reason ?? 'не передаётся'}`)
    .join('; ');
}

/**
 * Полный адрес цели одной строкой — для ссылки «открыть в новой вкладке».
 * Отбор шапки в него не входит: его ставит `navigateTo`, и вторая копия тех
 * же осей в адресе разошлась бы с состоянием (канон п.112).
 */
export function drillHref(pathname: string, target: DrillTarget): string {
  return target.address ? `${pathname}?${target.address}` : pathname;
}

/**
 * Страж на список ключей местного отбора: каждый ключ, которым модуль
 * собирается ехать, обязан быть объявлен в `view-state.ts`. Иначе параметр
 * тихо потеряется при разборе, и ось снова начнёт исчезать молча.
 */
export function unknownPickKeys(): readonly string[] {
  const spec = viewSpec('monitoring');
  const declared = new Set([...spec.pick.map((f) => f.key), ...spec.view.map((f) => f.key)]);
  return Object.values(MONITORING_PICK).filter((key) => !declared.has(key));
}
