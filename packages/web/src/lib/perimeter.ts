// ── Периметр числа: за что именно посчитана карточка ────────────────────────
//
//    Канон п.58 реестра интервью 14.08 (дословно владелец): «я всегда должен
//    точно понимать, что где считается, по любой карточке на любой вкладке, за
//    какой период; состояние без выбранных фильтров всегда однозначно даёт
//    именно то, что нужно». Правила оттуда, которые держит этот модуль:
//
//      (а) КАЖДАЯ карточка объявляет свой периметр собственной подписью —
//          год · период · органы · момент. Подпись строится из ДАННЫХ, по
//          которым посчитано число, а не из унаследованного бейджа шапки.
//      (б) бейдж, унаследованный от фильтра, которому числа не подчиняются,
//          запрещён (образец дефекта: пирог с бейджем «Нед. 3–9 авг»,
//          показывающий 2 823 закупки года). Для таких блоков есть флаг
//          `ignoresPeriodFilter` — периметр честно скажет «весь год» и
//          добавит пометку о неподчинении.
//      (в) дефолт без фильтров — «2026 · весь год · все управления · на
//          сейчас», ОДИН И ТОТ ЖЕ на всех вкладках (DEFAULT_PERIMETER).
//      (д) шаблон подписи один на всю систему — `perimeterLabel`, другого
//          способа собрать эту фразу в коде нет.
//
//    Механизм М1 атласа карточек (20.08) добавил к четырём осям две вещи,
//    которых им не хватало на живых вкладках:
//
//      (е) ПЯТАЯ ОСЬ — СРЕЗ: способ закупки, бюджет, вид деятельности. Болезнь
//          Н8 «Пульта»: под фильтром «только ЕП» числа сужены, а подпись об
//          этом молчит — читатель считает, что видит все закупки.
//      (ж) ПРИМЕНИМОСТЬ КАЖДОЙ ОСИ НАЗЫВАЕТСЯ ВСЛУХ. Выбор в шапке, который к
//          этому числу не применяется, объявляется словами — «фильтр способа
//          закупки к этому числу не применяется», — а не замалчивается.
//          Болезни: A1 «Аналитики» (баннер обещает одно поведение сразу всем
//          карточкам страницы, а половина из них ведёт себя иначе), Н2 и Н3
//          «Пульта» (плитка замечаний носит период, которому не подчиняется;
//          статическая подпись «Проверки всех строк книг» врёт под фильтром
//          управления), Н2/Н4 «Экономии и Конкуренции» (способ подписан как
//          применённый, бюджет не применяется и не оговаривается).
//      (з) ПРИ ВЫБОРЕ ПОДВЕДОВ ПЕРИМЕТР ГОВОРИТ ОБ ОРГАНИЗАЦИИ. Если фильтр
//          подведомственных к числу не применяется, ось органов честно
//          читается «УО целиком», а не «УО» — иначе читатель принимает сумму
//          управления за сумму выбранных им учреждений (идея усиления A1).
//
//    Момент чтения (ось «когда») вынесен в `reading-moment.ts`: незнание
//    момента там отличается от свежести — «момент чтения неизвестен» вместо
//    «на сейчас» (болезнь П0-1 карты «Реестра»).
//
//    Формулировки периода не сочиняются заново: фраза приходит из
//    `periodScopePhrase` (`period-label.ts`), где живёт канон владельца
//    «1 кв 2 кв 3 кв 4 кв» и названия месяцев из того же дома, что и фильтр
//    в шапке. Дублировать их здесь означало бы завести вторую подпись одного
//    периода на соседних экранах — ровно тот дефект, ради которого
//    `period-label.ts` и появился.

import { ALL_DEPT_IDS } from '@aemr/shared';
import { AVAILABLE_YEARS, type PeriodMode, type PeriodScope, type YearFilter } from '../store';
import { periodScopePhrase } from './period-label';
// Разрешение периода — то же самое, которым считает `useFilteredData`: месяцы
// одного квартала читаются кварталом. Второй такой разбор в подписи означал бы
// подпись, расходящуюся с расчётом (канон п.112 «брать готовое»).
import { resolvePeriodSelection } from './selectors/period-resolution';
import { pluralRu } from './economy-copy';
import { toCanonicalDeptId } from './dept-key';
import { subordinateLabel } from './subordinate-label';
import { readingMoment, type ReadingMoment, type ReadingMomentInput } from './reading-moment';
// Словарь семейств способа и видов деятельности — общий с FilterContext:
// два дома одной номенклатуры расходятся молча (канон п.112 «брать готовое»).
import type { MethodFamily } from './filter-context';

// ── Оси периметра ───────────────────────────────────────────────────────────

/**
 * Вид периода. Отдельно от подписи: по нему потребитель решает, нужна ли
 * пометка о неподчинении, а сравнивать периметры по строке-подписи нельзя.
 */
export type PerimeterSpanKind = 'year' | 'quarter' | 'month' | 'months';

export interface PerimeterSpan {
  readonly kind: PerimeterSpanKind;
  /** «весь год», «3 кв», «май», «3 мес.» */
  readonly label: string;
}

/**
 * Кто попал в счёт. `whole` — выбраны учреждения, но число считается по
 * управлению целиком: правило (з), иначе сумма управления читается как сумма
 * выбранных подведов.
 */
export type PerimeterOrgsKind = 'all' | 'departments' | 'subordinates' | 'whole';

export interface PerimeterOrgs {
  readonly kind: PerimeterOrgsKind;
  /** «все управления», «УКСиМП», «3 управления», «УО · 2 учреждения», «УО целиком» */
  readonly label: string;
}

/** Короткие имена бюджетов и видов деятельности — словарь шапки (ФБ/КБ/МБ, ПМ/ТД). */
export type PerimeterBudgetShort = 'ФБ' | 'КБ' | 'МБ';
export type PerimeterActivityShort = 'ПМ' | 'ТД';

/**
 * Пятая ось — СРЕЗ (правило «е»): способ закупки, бюджет, вид деятельности.
 * Хранит не только подпись, но и сами значения: сравнивать периметры по строке
 * нельзя, а решать «этот график считает то же самое?» приходится в коде.
 */
export interface PerimeterSlice {
  readonly kind: 'all' | 'sliced';
  /** «все закупки» либо «ЕП · МБ · ТД» */
  readonly label: string;
  readonly methods: readonly MethodFamily[];
  readonly budgets: readonly PerimeterBudgetShort[];
  readonly activities: readonly PerimeterActivityShort[];
}

/**
 * Момент чтения. `live` — числа на текущее состояние книг (режим «Эфир»,
 * дефолт продукта); `snapshot` — архивный срез конкретной даты; `unknown` —
 * момент нам не назвали, и это отдельное состояние, а не свежесть.
 *
 * Канон п.64(г): обе стороны сверки обязаны быть из одного момента, поэтому
 * момент — полноправная ось периметра, а не украшение подписи. Правила и
 * формулировки живут в `reading-moment.ts`.
 */
export type PerimeterMoment = ReadingMoment;

/** Оси фильтра, применимость которых периметр объявляет вслух (правило «ж»). */
export type PerimeterFilterAxis =
  | 'period'
  | 'departments'
  | 'subordinates'
  | 'methods'
  | 'budgets'
  | 'activities';

/** Оси самого периметра — как они идут в подписи слева направо. */
export type PerimeterAxisId = 'year' | 'span' | 'orgs' | 'slice' | 'moment';

/** Разбор одной оси для подсказки, бейджа и решений в коде. */
export interface PerimeterAxis {
  readonly id: PerimeterAxisId;
  /** Имя оси человеку: «Период», «Органы», «Срез», «Момент». */
  readonly title: string;
  readonly label: string;
  /** Ось действительно сужает число — по ней его стоит показывать в бейдже. */
  readonly narrows: boolean;
  /** Фильтры этой оси к числу применяются. `false` — число шире выбора шапки. */
  readonly applies: boolean;
  /** Расхождение с шапкой словами; есть только когда читателю есть что терять. */
  readonly note?: string;
}

export interface Perimeter {
  /** Год ДАННЫХ (не год из шапки, если они разошлись); 'all' — все годы. */
  readonly year: YearFilter;
  readonly span: PerimeterSpan;
  readonly orgs: PerimeterOrgs;
  readonly slice: PerimeterSlice;
  readonly moment: PerimeterMoment;
  /** Применимость каждой оси фильтра к ЭТОМУ числу — правило (ж). */
  readonly applies: Readonly<Record<PerimeterFilterAxis, boolean>>;
  /**
   * Оси, по которым читатель что-то выбрал, а число этому выбору не подчинено.
   * Именно они порождают `notes`: неприменимая ось без выбора никого не вводит
   * в заблуждение и подписи не требует.
   */
  readonly conflicts: readonly PerimeterFilterAxis[];
  /** Разбор по осям в порядке подписи: год · период · органы · срез · момент. */
  readonly axes: readonly PerimeterAxis[];
  /**
   * Все расхождения с выбором шапки словами. Пусто — расхождений нет; молчание
   * о неприменимой оси здесь невозможно по построению.
   */
  readonly notes: readonly string[];
  /**
   * Первое расхождение — совместимость с прежним контрактом. Пустая строка не
   * используется: либо пометки нет, либо она называет, ЧЕМУ числа не
   * подчиняются («неделя выбрана, но числа за весь год»).
   */
  readonly note?: string;
}

// ── Готовые куски подписи ───────────────────────────────────────────────────

const WHOLE_YEAR = 'весь год';
const ALL_ORGS = 'все управления';
const ALL_SLICE = 'все закупки';

/** Разделитель осей в подписи — тонкая точка, один на всю систему. */
const SEP = ' · ';

/** Имена осей человеку — для подсказки и списков «за что это число». */
const AXIS_TITLE: Readonly<Record<PerimeterAxisId, string>> = {
  year: 'Год',
  span: 'Период',
  orgs: 'Органы',
  slice: 'Срез',
  moment: 'Момент',
};

/**
 * Правило (ж) дословно: неприменимая ось НАЗЫВАЕТСЯ. Формулировки одинаковой
 * конструкции — читатель, встретив такую фразу на второй вкладке, узнаёт её
 * не перечитывая. Хвост после тире отвечает на «а как тогда посчитано».
 */
const NOT_APPLIED_PHRASE: Readonly<Record<Exclude<PerimeterFilterAxis, 'period'>, string>> = {
  departments: 'фильтр управлений к этому числу не применяется — оно посчитано по всему району',
  subordinates:
    'фильтр подведомственных к этому числу не применяется — оно посчитано по управлению целиком',
  methods: 'фильтр способа закупки к этому числу не применяется',
  budgets: 'фильтр бюджета к этому числу не применяется',
  activities: 'фильтр вида деятельности к этому числу не применяется',
};

/**
 * Период говорит о себе конкретнее остальных осей — «выбран 3 кв, но числа за
 * весь год». Общая формулировка здесь была бы шагом назад: читатель видит в
 * шапке именно квартал и должен узнать в пометке свой выбор.
 */
function periodNotAppliedPhrase(period: PeriodScope, months: Set<number>): string {
  return `выбран ${periodScopePhrase(period, months)}, но числа за весь год`;
}

/** Порядок перечисления осей в пометках — сверху вниз, как их читают. */
const AXIS_ORDER: readonly PerimeterFilterAxis[] = [
  'period', 'departments', 'subordinates', 'methods', 'budgets', 'activities',
];

/**
 * Год дефолтного периметра. Хардкод «2026» из формулировки канона здесь был бы
 * бомбой замедленного действия: 1 января подпись всей системы стала бы врать.
 * Правило то же, что у дефолта года в store — текущий год, если он вообще
 * заведён в системе, иначе последний заведённый.
 */
export function defaultPerimeterYear(now: Date = new Date()): number {
  const current = now.getFullYear();
  return AVAILABLE_YEARS.includes(current)
    ? current
    : (AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1] as number);
}

// ── Подпись ─────────────────────────────────────────────────────────────────

/** Год фразой: «2026» либо «все годы», когда фильтр года снят. */
function yearPhrase(year: YearFilter): string {
  return year === 'all' ? 'все годы' : String(year);
}

/**
 * ЕДИНСТВЕННЫЙ шаблон подписи периметра на всю систему (правило «д»).
 * «2026 · весь год · все управления · на сейчас».
 *
 * Ось среза (способ · бюджет · вид) вклинивается перед моментом только когда
 * реально сужает число: печатать «все закупки» в каждой подписи значит платить
 * строкой за отсутствие новости.
 *
 * Пометки о неподчинении (если есть) идут одним хвостом в скобках, чтобы оси
 * всегда читались на одном и том же месте.
 */
export function perimeterLabel(p: Perimeter): string {
  const parts = [yearPhrase(p.year), p.span.label, p.orgs.label];
  if (p.slice.kind === 'sliced') parts.push(p.slice.label);
  parts.push(p.moment.label);
  const base = parts.join(SEP);
  return p.notes.length > 0 ? `${base} (${p.notes.join('; ')})` : base;
}

/**
 * Короткая подпись бейджа: год и период всегда (без них число не читается),
 * остальные оси — только когда действительно сужают. «2026 · 3 кв · УО · ЕП».
 *
 * Бейдж не врёт по построению: он собран из ФАКТИЧЕСКИХ осей числа, а не
 * унаследован от шапки, — правило (б). Расхождения с шапкой объясняет
 * подсказка `perimeterHint`.
 */
export function perimeterBadge(p: Perimeter): string {
  const parts = [yearPhrase(p.year), p.span.label];
  for (const axis of p.axes) {
    if ((axis.id === 'orgs' || axis.id === 'slice' || axis.id === 'moment') && axis.narrows) {
      parts.push(axis.label);
    }
  }
  return parts.join(SEP);
}

/**
 * Полная фраза подсказки: за что посчитано число, чем оно НЕ сужено вопреки
 * шапке и когда прочитаны книги. Три абзаца через перевод строки — в `title`
 * и в `aria-label` они читаются одинаково.
 */
export function perimeterHint(p: Perimeter): string {
  const scope = [yearPhrase(p.year), p.span.label, p.orgs.label];
  if (p.slice.kind === 'sliced') scope.push(p.slice.label);

  const lines = [`Считается за: ${scope.join(SEP)}.`];
  for (const note of p.notes) lines.push(`${note[0]?.toUpperCase() ?? ''}${note.slice(1)}.`);
  lines.push(`Момент чтения: ${p.moment.phrase}.`);
  return lines.join('\n');
}

/**
 * Оси, которыми число НЕ сужается, хотя в шапке по ним что-то выбрано. Пустой
 * список — периметр числа совпадает с выбором читателя.
 */
export function perimeterConflicts(p: Perimeter): readonly PerimeterFilterAxis[] {
  return p.conflicts;
}

/** Сужает ли число эта ось фильтра. Короткий вопрос из кода, без разбора строк. */
export function perimeterApplies(p: Perimeter, axis: PerimeterFilterAxis): boolean {
  return p.applies[axis];
}

/**
 * Два числа посчитаны за одно и то же. Вопрос возникает там, где одна подпись
 * накрывает группу чисел: печатать её над блоком можно, только если периметр у
 * всех действительно общий, — иначе одна фраза начинает отвечать за числа,
 * которые считаются по-разному (болезнь A1 «Аналитики» ровно этой природы:
 * баннер обещает поведение сразу всей странице).
 *
 * Сравниваются ЗНАЧЕНИЯ осей, а не подписи: одинаковая строка ещё не значит
 * одинаковый расчёт (у «весь год» по неподчинению периоду и у настоящего года
 * подпись одна, а природа разная).
 */
export function samePerimeter(a: Perimeter, b: Perimeter): boolean {
  const sameList = <T>(x: readonly T[], y: readonly T[]): boolean =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    a.year === b.year
    && a.span.kind === b.span.kind
    && a.span.label === b.span.label
    && a.orgs.kind === b.orgs.kind
    && a.orgs.label === b.orgs.label
    && sameList(a.slice.methods, b.slice.methods)
    && sameList(a.slice.budgets, b.slice.budgets)
    && sameList(a.slice.activities, b.slice.activities)
    && a.moment.kind === b.moment.kind
    && a.moment.iso === b.moment.iso
    && AXIS_ORDER.every((axis) => a.applies[axis] === b.applies[axis])
  );
}

// ── Сборка из состояния фильтров ────────────────────────────────────────────

/**
 * Состояние, из которого собирается периметр. Поля называют то, чему числа
 * ФАКТИЧЕСКИ подчиняются, — поэтому здесь `year` данных и эффективный
 * `period`, а не сырой выбор шапки.
 */
export interface PerimeterInput {
  /** Год ДАННЫХ. При расхождении с выбором шапки сюда идёт год данных. */
  year: YearFilter;
  /** Эффективный квартальный скоуп (после resolvePeriodSelection). */
  period: PeriodScope;
  /** Активные месяцы 1..12; пусто — период не сужен месяцами. */
  activeMonths?: Iterable<number>;
  /** Выбранные управления; пусто — все. */
  departments?: Iterable<string>;
  /** Выбранные учреждения; пусто — все. */
  subordinates?: Iterable<string>;
  /** Выбранные способы закупки — любая форма ключа («ЕП», 'single', 'ep'). */
  methods?: Iterable<string>;
  /** Выбранные бюджеты — 'fb'/'kb'/'mb' либо уже «ФБ»/«КБ»/«МБ». */
  budgets?: Iterable<string>;
  /** Выбранные виды деятельности — ключи 'program'/'current_*' либо «ПМ»/«ТД». */
  activities?: Iterable<string>;
  /**
   * Дата архивного среза (Date либо ISO «ГГГГ-ММ-ДД»). Не задана — режим
   * «Эфир», числа на сейчас.
   */
  asOf?: Date | string | null;
  /**
   * Момент чтения книг. `null` — сервер его не назвал, и периметр скажет
   * «момент чтения неизвестен»; ключ не передан — ось не заявлена, остаётся
   * прежнее «на сейчас» (см. `reading-moment.ts`).
   */
  readAt?: Date | string | null;
  /** Порог остывания чисел в минутах; по умолчанию час. */
  staleAfterMinutes?: number;
  /** Точка отсчёта относительной фразы — тесты задают явно. */
  now?: number;
  /**
   * Оси, которыми это число НЕ сужается, хотя фильтр в шапке есть — правило
   * (ж). Периметр посчитает число по всей оси и объявит расхождение словами.
   */
  notApplicable?: Iterable<PerimeterFilterAxis>;
  /**
   * Блок не подчиняется выбору периода — правило (б). Прежнее имя того же
   * заявления, что `notApplicable: ['period']`; оставлено ради вызовов,
   * написанных до появления остальных осей.
   */
  ignoresPeriodFilter?: boolean;
  /** Готовая пометка о неподчинении; перекрывает автоматические. */
  note?: string;
}

/** Вид периода по эффективному выбору. */
function spanKindOf(period: PeriodScope, months: number[]): PerimeterSpanKind {
  if (months.length === 1) return 'month';
  if (period !== 'year') return 'quarter';
  return months.length > 0 && months.length < 12 ? 'months' : 'year';
}

/** Месяцы: только валидные 1..12, дедуп, по возрастанию (как в FilterContext). */
function canonMonths(raw: Iterable<number> | undefined): number[] {
  const valid = new Set<number>();
  for (const m of raw ?? []) {
    if (Number.isInteger(m) && m >= 1 && m <= 12) valid.add(m);
  }
  return [...valid].sort((a, b) => a - b);
}

/** Управления: любая форма ключа → кириллический канон, порядок реестра. */
function canonDepartments(raw: Iterable<string> | undefined): string[] {
  const canon = new Set<string>();
  for (const key of raw ?? []) canon.add(toCanonicalDeptId(key));
  return ALL_DEPT_IDS.filter((id) => canon.has(id));
}

/**
 * Подпись органов — правило (з). Одно управление называется по имени: «3
 * управления» вместо «УКСиМП» скрывает от читателя ровно то, что он выбрал сам.
 *
 * Когда фильтр подведов к числу не применяется, а учреждения выбраны, ось
 * читается «УО целиком»: слово «целиком» — единственное, что отличает сумму
 * управления от суммы двух выбранных школ, и молчать о нём нельзя (A1).
 */
function orgsOf(
  departments: string[],
  subordinates: string[],
  deptApplies: boolean,
  subApplies: boolean,
): PerimeterOrgs {
  const shownDepts = deptApplies ? departments : [];
  const deptPart = shownDepts.length === 0
    ? ALL_ORGS
    : shownDepts.length <= 2
      ? shownDepts.join(', ')
      : `${shownDepts.length} ${pluralRu(shownDepts.length, 'управление', 'управления', 'управлений')}`;

  if (!subApplies) {
    // Учреждения выбраны, но числа их не знают — говорим об организации целиком.
    if (subordinates.length > 0 && shownDepts.length > 0) {
      return { kind: 'whole', label: `${deptPart} целиком` };
    }
    return { kind: shownDepts.length === 0 ? 'all' : 'departments', label: deptPart };
  }

  if (subordinates.length === 0) {
    return { kind: shownDepts.length === 0 ? 'all' : 'departments', label: deptPart };
  }

  const subPart = subordinates.length === 1
    ? subordinates[0] as string
    : `${subordinates.length} ${pluralRu(subordinates.length, 'учреждение', 'учреждения', 'учреждений')}`;
  return { kind: 'subordinates', label: `${deptPart}${SEP}${subPart}` };
}

// ── Ось среза: способ · бюджет · вид деятельности ───────────────────────────

/**
 * Ключи среза в store живут в нескольких формах (латинские коды фильтра и уже
 * канонические кириллические). Подпись обязана быть одна — та же, что на
 * кнопках шапки: КП/ЕП, ФБ/КБ/МБ, ПМ/ТД.
 */
const METHOD_BY_KEY: Readonly<Record<string, MethodFamily>> = {
  competitive: 'КП', kp: 'КП', 'кп': 'КП',
  single: 'ЕП', ep: 'ЕП', 'еп': 'ЕП',
};
const METHOD_ORDER: readonly MethodFamily[] = ['КП', 'ЕП'];

const BUDGET_BY_KEY: Readonly<Record<string, PerimeterBudgetShort>> = {
  fb: 'ФБ', 'фб': 'ФБ',
  kb: 'КБ', 'кб': 'КБ',
  mb: 'МБ', 'мб': 'МБ',
};
const BUDGET_ORDER: readonly PerimeterBudgetShort[] = ['ФБ', 'КБ', 'МБ'];

/**
 * Видов деятельности в словаре три, живых аббревиатуры две: `current_program`
 * — легаси старых снимков и подписывается как обычная ТД (канон п.30). Отсюда
 * дедуп: выбор обоих текущих ключей не должен печататься «ТД · ТД».
 */
const ACTIVITY_BY_KEY: Readonly<Record<string, PerimeterActivityShort>> = {
  program: 'ПМ', 'пм': 'ПМ',
  current_program: 'ТД', current_non_program: 'ТД', 'тд': 'ТД',
};
const ACTIVITY_ORDER: readonly PerimeterActivityShort[] = ['ПМ', 'ТД'];

/** Любая форма ключа → канон словаря, порядок словаря, чужое — отброшено. */
function canonSlicePart<T extends string>(
  raw: Iterable<string> | undefined,
  dictionary: Readonly<Record<string, T>>,
  order: readonly T[],
): T[] {
  const chosen = new Set<T>();
  for (const key of raw ?? []) {
    const canon = dictionary[String(key).trim().toLowerCase()] ?? dictionary[String(key).trim()];
    if (canon) chosen.add(canon);
  }
  return order.filter((value) => chosen.has(value));
}

/** Срез одной подписью: «ЕП · МБ · ТД». Пустой выбор — «все закупки». */
function sliceOf(
  methods: MethodFamily[],
  budgets: PerimeterBudgetShort[],
  activities: PerimeterActivityShort[],
): PerimeterSlice {
  const parts = [...methods, ...budgets, ...activities];
  return {
    kind: parts.length === 0 ? 'all' : 'sliced',
    label: parts.length === 0 ? ALL_SLICE : parts.join(SEP),
    methods,
    budgets,
    activities,
  };
}

// ── Сборка ──────────────────────────────────────────────────────────────────

/**
 * ЕДИНСТВЕННЫЙ источник периметра для всех вкладок. Вкладка не собирает объект
 * руками и не сочиняет подпись — она отдаёт сюда своё состояние фильтров,
 * называет оси, которыми её число не сужается, и печатает результат через
 * `perimeterBadge` / `perimeterHint` (или через `FigureView`).
 */
export function buildPerimeter(input: PerimeterInput): Perimeter {
  const months = canonMonths(input.activeMonths);
  // Ключи управлений в store живут в двух формах (латинской и кириллической);
  // подпись обязана быть одна — канон продукта, порядок реестра. Латиница в
  // видимом тексте запрещена (дефект Д12, он же «uagzo» из тултипа scatter).
  const departments = canonDepartments(input.departments);
  // Подведы приходят дословным значением колонки C; сентинел аппарата
  // разворачивается в «Аппарат управления» тем же домом, что и фильтры.
  const subordinates = [...(input.subordinates ?? [])].map(subordinateLabel);
  const methods = canonSlicePart(input.methods, METHOD_BY_KEY, METHOD_ORDER);
  const budgets = canonSlicePart(input.budgets, BUDGET_BY_KEY, BUDGET_ORDER);
  const activities = canonSlicePart(input.activities, ACTIVITY_BY_KEY, ACTIVITY_ORDER);

  // Что читатель выбрал в шапке и что из этого к числу применяется.
  const declared = new Set<PerimeterFilterAxis>(input.notApplicable ?? []);
  if (input.ignoresPeriodFilter === true) declared.add('period');
  const applies: Record<PerimeterFilterAxis, boolean> = {
    period: !declared.has('period'),
    departments: !declared.has('departments'),
    subordinates: !declared.has('subordinates'),
    methods: !declared.has('methods'),
    budgets: !declared.has('budgets'),
    activities: !declared.has('activities'),
  };
  const monthSet = new Set(months);
  const chosen: Record<PerimeterFilterAxis, boolean> = {
    period: input.period !== 'year' || months.length > 0,
    departments: departments.length > 0,
    subordinates: subordinates.length > 0,
    methods: methods.length > 0,
    budgets: budgets.length > 0,
    activities: activities.length > 0,
  };

  // Расхождение существует только там, где читатель что-то выбрал: неприменимая
  // ось без выбора никого не вводит в заблуждение и подписи не требует.
  const conflicts = AXIS_ORDER.filter((axis) => !applies[axis] && chosen[axis]);
  const autoNotes = conflicts.map((axis) => axis === 'period'
    ? periodNotAppliedPhrase(input.period, monthSet)
    : NOT_APPLIED_PHRASE[axis]);
  const notes = input.note ? [input.note] : autoNotes;

  // Правило (б): числа не подчиняются периоду → подпись говорит правду о
  // числах («весь год»), а расхождение с шапкой названо выше вслух.
  const span: PerimeterSpan = applies.period
    ? { kind: spanKindOf(input.period, months), label: periodScopePhrase(input.period, monthSet) }
    : { kind: 'year', label: WHOLE_YEAR };

  const orgs = orgsOf(departments, subordinates, applies.departments, applies.subordinates);
  const slice = sliceOf(
    applies.methods ? methods : [],
    applies.budgets ? budgets : [],
    applies.activities ? activities : [],
  );

  const momentInput: ReadingMomentInput = {
    asOf: input.asOf,
    staleAfterMinutes: input.staleAfterMinutes,
    now: input.now,
  };
  // Ключ переносится только если он был заявлен: «не спрашивали» и «сервер
  // промолчал» — разные состояния, и второе обязано звучать иначе.
  if ('readAt' in input) momentInput.readAt = input.readAt;
  const moment = readingMoment(momentInput);

  const noteFor = (...axesOfInterest: PerimeterFilterAxis[]): string | undefined => {
    const own = conflicts
      .filter((axis) => axesOfInterest.includes(axis))
      .map((axis) => axis === 'period' ? periodNotAppliedPhrase(input.period, monthSet) : NOT_APPLIED_PHRASE[axis]);
    return own.length > 0 ? own.join('; ') : undefined;
  };

  const axes: readonly PerimeterAxis[] = [
    {
      id: 'year',
      title: AXIS_TITLE.year,
      label: yearPhrase(input.year),
      narrows: input.year !== 'all',
      applies: true,
    },
    {
      id: 'span',
      title: AXIS_TITLE.span,
      label: span.label,
      narrows: span.kind !== 'year',
      applies: applies.period,
      note: noteFor('period'),
    },
    {
      id: 'orgs',
      title: AXIS_TITLE.orgs,
      label: orgs.label,
      narrows: orgs.kind !== 'all',
      applies: applies.departments && applies.subordinates,
      note: noteFor('departments', 'subordinates'),
    },
    {
      id: 'slice',
      title: AXIS_TITLE.slice,
      label: slice.label,
      narrows: slice.kind === 'sliced',
      applies: applies.methods && applies.budgets && applies.activities,
      note: noteFor('methods', 'budgets', 'activities'),
    },
    {
      id: 'moment',
      title: AXIS_TITLE.moment,
      label: moment.label,
      // Незнание момента — тоже новость для читателя, и бейдж обязан её нести.
      narrows: moment.kind !== 'live' || moment.stale,
      applies: true,
    },
  ];

  return {
    year: input.year,
    span,
    orgs,
    slice,
    moment,
    applies,
    conflicts,
    axes,
    notes,
    note: notes[0],
  };
}

// ── Сборка прямо из состояния шапки ─────────────────────────────────────────

/**
 * Срез хранилища, из которого собирается периметр. Поля названы ровно так, как
 * они лежат в store, — вкладка отдаёт сюда своё состояние целиком
 * (`useStore.getState()` подходит по форме) и ничего не перекладывает руками.
 *
 * Ради этого адаптер и появился: пока каждая вкладка пересобирала пять осей
 * сама, три правила — год данных вместо года шапки, недельный режим без
 * месяцев, момент чтения из `lastRefreshed` — жили в стольких копиях, сколько
 * вкладок, и расходились по одной. Болезнь A12 карты «Аналитики» и есть такое
 * расхождение подписей соседних экранов.
 */
export interface PerimeterFilterState {
  /** Год из шапки. */
  readonly year: YearFilter;
  /** Год, за который РЕАЛЬНО пришли данные. */
  readonly dataYear?: number;
  /**
   * Данные приехали не за тот год, что выбран в шапке. Тогда подпись обязана
   * назвать год ДАННЫХ: числа посчитаны по ним, а не по выбору читателя.
   */
  readonly yearMismatch?: boolean;
  readonly period: PeriodScope;
  /**
   * Недельный режим: месяцы недели в `activeMonths` не записываются, и период
   * ими не сужается. Правило держится здесь, а не в каждой вкладке заново.
   */
  readonly periodMode?: PeriodMode;
  readonly activeMonths?: Iterable<number>;
  readonly selectedDepartments?: Iterable<string>;
  readonly selectedSubordinates?: Iterable<string>;
  readonly selectedMethods?: Iterable<string>;
  readonly selectedBudgets?: Iterable<string>;
  readonly selectedActivities?: Iterable<string>;
  /**
   * Момент последнего чтения книг. `null` — сервер его не назвал, и периметр
   * скажет «момент чтения неизвестен» (правило М2), а не выдаст молчание за
   * свежесть. Ключа нет вовсе — ось не заявлена, остаётся «на сейчас».
   */
  readonly lastRefreshed?: string | null;
}

/**
 * Заявление КАРТОЧКИ о себе: чем её число не сужается вопреки шапке и на какой
 * день оно показано. Всё, что зависит не от состояния фильтров, а от самого
 * числа, живёт здесь, — поэтому состояние можно передать как есть.
 */
export interface PerimeterDeclaration {
  /** Оси, которыми ЭТО число не сужается, — правило (ж). */
  readonly notApplicable?: Iterable<PerimeterFilterAxis>;
  /** Готовая пометка вместо автоматических (редко: когда причина своя). */
  readonly note?: string;
  /** День архивного среза, если карточка показывает архив, а не эфир. */
  readonly asOf?: Date | string | null;
  /** Порог остывания в минутах; по умолчанию час. */
  readonly staleAfterMinutes?: number;
  /** Точка отсчёта относительной фразы — тесты задают явно. */
  readonly now?: number;
}

/**
 * Периметр прямо из состояния шапки. Вкладке остаётся назвать оси, которыми её
 * число не сужается:
 *
 *     const perimeter = perimeterFromFilters(state, { notApplicable: ['methods'] });
 *
 * Три правила, которые адаптер держит за все вкладки сразу:
 *   • год берётся у ДАННЫХ, когда они разошлись с выбором шапки;
 *   • в недельном режиме месяцы период не сужают;
 *   • момент чтения приходит из `lastRefreshed`, и его отсутствие звучит как
 *     незнание, а не как свежесть.
 */
export function perimeterFromFilters(
  state: PerimeterFilterState,
  declaration: PerimeterDeclaration = {},
): Perimeter {
  const months = state.periodMode === 'week' ? [] : canonMonths(state.activeMonths);
  // Месяцы, покрывающие ровно один квартал, читаются кварталом — тем же
  // разрешением, каким считает `useFilteredData`. Иначе подпись назвала бы
  // «весь год» там, где числа посчитаны за квартал.
  const { periodKey } = resolvePeriodSelection(state.period, new Set(months), false);

  const input: PerimeterInput = {
    year: state.yearMismatch === true && typeof state.dataYear === 'number'
      ? state.dataYear
      : state.year,
    period: periodKey,
    activeMonths: months,
    departments: state.selectedDepartments,
    subordinates: state.selectedSubordinates,
    methods: state.selectedMethods,
    budgets: state.selectedBudgets,
    activities: state.selectedActivities,
    asOf: declaration.asOf ?? null,
    notApplicable: declaration.notApplicable,
    staleAfterMinutes: declaration.staleAfterMinutes,
    now: declaration.now,
  };
  // Ось момента заявляется, только если состояние о ней говорит: «не
  // спрашивали» и «сервер промолчал» — разные состояния (см. reading-moment).
  if ('lastRefreshed' in state) input.readAt = state.lastRefreshed;
  if (declaration.note !== undefined) input.note = declaration.note;

  return buildPerimeter(input);
}

/**
 * Правило (в): состояние без единого выбранного фильтра. Один и тот же объект
 * на всех вкладках — «2026 · весь год · все управления · на сейчас».
 *
 * Собран тем же `buildPerimeter`, что и любой другой периметр: второй способ
 * собрать дефолт означал бы, что он однажды разойдётся с первым. Стоит в конце
 * файла намеренно — вызов на инициализации модуля требует, чтобы словари
 * сборки были уже созданы.
 */
export const DEFAULT_PERIMETER: Perimeter = buildPerimeter({
  year: defaultPerimeterYear(),
  period: 'year',
});
