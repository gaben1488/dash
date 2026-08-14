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
//    Формулировки периода не сочиняются заново: фраза приходит из
//    `periodScopePhrase` (`period-label.ts`), где живёт канон владельца
//    «1 кв 2 кв 3 кв 4 кв» и названия месяцев из того же дома, что и фильтр
//    в шапке. Дублировать их здесь означало бы завести вторую подпись одного
//    периода на соседних экранах — ровно тот дефект, ради которого
//    `period-label.ts` и появился.

import { ALL_DEPT_IDS } from '@aemr/shared';
import { AVAILABLE_YEARS, type PeriodScope, type YearFilter } from '../store';
import { periodScopePhrase } from './period-label';
import { pluralRu } from './economy-copy';
import { toCanonicalDeptId } from './dept-key';
import { subordinateLabel } from './subordinate-label';

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

/** Кто попал в счёт: все управления, часть управлений, часть учреждений. */
export type PerimeterOrgsKind = 'all' | 'departments' | 'subordinates';

export interface PerimeterOrgs {
  readonly kind: PerimeterOrgsKind;
  /** «все управления», «УКСиМП», «3 управления», «УО · 2 учреждения» */
  readonly label: string;
}

/**
 * Момент чтения. `live` — числа на текущее состояние книг (режим «Эфир»,
 * дефолт продукта); `snapshot` — архивный срез конкретной даты.
 *
 * Канон п.64(г): обе стороны сверки обязаны быть из одного момента, поэтому
 * момент — полноправная ось периметра, а не украшение подписи.
 */
export interface PerimeterMoment {
  readonly kind: 'live' | 'snapshot';
  /** «на сейчас» либо «срез на 14.08.2026» */
  readonly label: string;
}

export interface Perimeter {
  /** Год ДАННЫХ (не год из шапки, если они разошлись); 'all' — все годы. */
  readonly year: YearFilter;
  readonly span: PerimeterSpan;
  readonly orgs: PerimeterOrgs;
  readonly moment: PerimeterMoment;
  /**
   * Пометка о неподчинении глобальному фильтру — правило (б). Пустая строка не
   * используется: либо пометки нет, либо она называет, ЧЕМУ числа не
   * подчиняются («неделя выбрана, но числа за весь год»).
   */
  readonly note?: string;
}

// ── Готовые куски подписи ───────────────────────────────────────────────────

const WHOLE_YEAR = 'весь год';
const ALL_ORGS = 'все управления';
const LIVE_LABEL = 'на сейчас';

/** Разделитель осей в подписи — тонкая точка, один на всю систему. */
const SEP = ' · ';

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

/**
 * Правило (в): состояние без единого выбранного фильтра. Один и тот же объект
 * на всех вкладках — «2026 · весь год · все управления · на сейчас».
 */
export const DEFAULT_PERIMETER: Perimeter = {
  year: defaultPerimeterYear(),
  span: { kind: 'year', label: WHOLE_YEAR },
  orgs: { kind: 'all', label: ALL_ORGS },
  moment: { kind: 'live', label: LIVE_LABEL },
};

// ── Подпись ─────────────────────────────────────────────────────────────────

/** Год фразой: «2026» либо «все годы», когда фильтр года снят. */
function yearPhrase(year: YearFilter): string {
  return year === 'all' ? 'все годы' : String(year);
}

/**
 * ЕДИНСТВЕННЫЙ шаблон подписи периметра на всю систему (правило «д»).
 * «2026 · весь год · все управления · на сейчас».
 *
 * Пометка о неподчинении (если есть) идёт отдельным хвостом в скобках, чтобы
 * четыре оси всегда читались на одном и том же месте.
 */
export function perimeterLabel(p: Perimeter): string {
  const base = [yearPhrase(p.year), p.span.label, p.orgs.label, p.moment.label].join(SEP);
  return p.note ? `${base} (${p.note})` : base;
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
  /**
   * Дата архивного среза (Date либо ISO «ГГГГ-ММ-ДД»). Не задана — режим
   * «Эфир», числа на сейчас.
   */
  asOf?: Date | string | null;
  /**
   * Блок не подчиняется выбору периода — правило (б). Периметр честно
   * покажет «весь год» и назовёт причину расхождения с шапкой.
   */
  ignoresPeriodFilter?: boolean;
  /** Готовая пометка о неподчинении; перекрывает автоматическую. */
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
 * Подпись органов. Одно управление называется по имени: «3 управления» вместо
 * «УКСиМП» скрывает от читателя ровно то, что он выбрал сам.
 */
function orgsOf(departments: string[], subordinates: string[]): PerimeterOrgs {
  const deptPart = departments.length === 0
    ? ALL_ORGS
    : departments.length <= 2
      ? departments.join(', ')
      : `${departments.length} ${pluralRu(departments.length, 'управление', 'управления', 'управлений')}`;

  if (subordinates.length === 0) {
    return { kind: departments.length === 0 ? 'all' : 'departments', label: deptPart };
  }

  const subPart = subordinates.length === 1
    ? subordinates[0] as string
    : `${subordinates.length} ${pluralRu(subordinates.length, 'учреждение', 'учреждения', 'учреждений')}`;
  return { kind: 'subordinates', label: `${deptPart}${SEP}${subPart}` };
}

/** Дата среза человеку: «срез на 14.08.2026». Нечитаемая дата — не срез. */
function momentOf(asOf: Date | string | null | undefined): PerimeterMoment {
  if (asOf == null || asOf === '') return { kind: 'live', label: LIVE_LABEL };
  const date = asOf instanceof Date ? asOf : new Date(`${asOf}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { kind: 'live', label: LIVE_LABEL };
  const human = date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return { kind: 'snapshot', label: `срез на ${human}` };
}

/**
 * ЕДИНСТВЕННЫЙ источник периметра для всех вкладок. Вкладка не собирает объект
 * руками и не сочиняет подпись — она отдаёт сюда своё состояние фильтров и
 * печатает результат через `perimeterLabel` (или через `FigureView`).
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

  // Правило (б): числа не подчиняются периоду → подпись говорит правду о
  // числах («весь год»), а расхождение с шапкой называется вслух.
  const ignores = input.ignoresPeriodFilter === true;
  const span: PerimeterSpan = ignores
    ? { kind: 'year', label: WHOLE_YEAR }
    : { kind: spanKindOf(input.period, months), label: periodScopePhrase(input.period, new Set(months)) };

  const autoNote = ignores && (input.period !== 'year' || months.length > 0)
    ? `выбран ${periodScopePhrase(input.period, new Set(months))}, но числа за весь год`
    : undefined;

  return {
    year: input.year,
    span,
    orgs: orgsOf(departments, subordinates),
    moment: momentOf(input.asOf),
    note: input.note ?? autoNote,
  };
}
