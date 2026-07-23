/**
 * FilterContext — единый объект-значение фильтров (дуга-3, фундамент A).
 *
 * Канон: спека filter-system-target-2026-07-16 §3.3. Вместо девяти разрозненных
 * полей store страницы (и «Отчёт 2.0») получают один readonly-контекст плюс
 * пару serialize/parse для шэрабельной ссылки. Строится РЯДОМ со старым
 * механизмом (store + useFilteredData) и не подключён к страницам — миграция
 * следующими волнами.
 *
 * Переходное отличие от TS-эскиза спеки: период здесь ещё две оси
 * (`period` PeriodScope + `months`), как в store, — discriminated union PeriodSel
 * появится при смерти legacy-полей. Эффективный период при сборке уже
 * согласован через resolvePeriodSelection (месяцы одного квартала → квартал).
 */
import {
  ALL_DEPT_IDS,
  ORG_ITSELF_SENTINEL,
  dayNumberOf,
  isoOfDayNumber,
  mondayOfDay,
  type BudgetLevel,
  type DepartmentId,
} from '@aemr/shared';
import type { PeriodMode, PeriodScope, YearFilter } from '../store';
import { toCanonicalDeptId } from './dept-key';
import { resolvePeriodSelection } from './selectors/period-resolution';

// ── Оси-словари ─────────────────────────────────────────────

/** Семейство способа закупки (канон продукта — кириллические коды). */
export type MethodFamily = 'КП' | 'ЕП';

/** Вид деятельности — канонические web-ключи (см. ALL_ACTIVITY_KEYS дуги-2). */
export type ActivityKey = 'program' | 'current_program' | 'current_non_program';

const METHOD_FAMILIES: readonly MethodFamily[] = ['КП', 'ЕП'];
const ACTIVITY_KEYS: readonly ActivityKey[] = ['program', 'current_program', 'current_non_program'];
const BUDGET_KEYS: readonly BudgetLevel[] = ['fb', 'kb', 'mb'];
const PERIOD_KEYS: readonly PeriodScope[] = ['year', 'q1', 'q2', 'q3', 'q4'];

/** store-ключи способов (competitive/single и уже-канонические формы) → семейство. */
const METHOD_FAMILY_BY_KEY: Readonly<Record<string, MethodFamily>> = {
  competitive: 'КП', kp: 'КП', 'КП': 'КП',
  single: 'ЕП', ep: 'ЕП', 'ЕП': 'ЕП',
};

// ── Контракт ────────────────────────────────────────────────

export interface FilterContext {
  /** Год данных; 'all' = двухлетний срез */
  readonly year: YearFilter;
  /** Эффективный квартальный скоуп (согласован с months при сборке) */
  readonly period: PeriodScope;
  /** Активные месяцы 1..12, отсортированы; [] = не выбраны */
  readonly months: readonly number[];
  /** ГРБС — кириллический канон DepartmentId, порядок реестра; [] = все */
  readonly grbs: readonly DepartmentId[];
  /** Подведы (displayName; аппарат = ORG_ITSELF_SENTINEL, всегда первым); [] = все */
  readonly subordinates: readonly string[];
  /** Виды деятельности; [] = все */
  readonly activities: readonly ActivityKey[];
  /** Семейства способов закупки; [] = все */
  readonly methods: readonly MethodFamily[];
  /** Уровни бюджета; [] = все */
  readonly budgets: readonly BudgetLevel[];
  /** Текстовый поиск (trimmed); '' = нет */
  readonly search: string;
  /**
   * ISO «YYYY-MM-DD» ПОНЕДЕЛЬНИКА выбранной недели (единая ось периодичности:
   * колесо недель → отчёт-на-четверг); null — store не в week-режиме.
   */
  readonly weekStart: string | null;
}

/** Нейтральный контекст: ни одного активного фильтра, все годы. */
export const EMPTY_FILTER_CONTEXT: FilterContext = {
  year: 'all',
  period: 'year',
  months: [],
  grbs: [],
  subordinates: [],
  activities: [],
  methods: [],
  budgets: [],
  search: '',
  weekStart: null,
};

/** Срез zustand-store, из которого собирается контекст (только читаемые поля). */
export interface FilterStoreSlice {
  year: YearFilter;
  period: PeriodScope;
  activeMonths: Set<number>;
  selectedDepartments: Set<string>;
  selectedSubordinates: Set<string>;
  selectedActivities: Set<string>;
  selectedMethods: Set<string>;
  selectedBudgets: Set<string>;
  searchQuery: string;
  periodMode: PeriodMode;
  focusedWeekStart: Date;
}

// ── Сборка из store ─────────────────────────────────────────

/** Месяцы: валидные 1..12, дедуп, по возрастанию. */
function canonMonths(raw: Iterable<number>): number[] {
  const valid = new Set<number>();
  for (const m of raw) {
    if (Number.isInteger(m) && m >= 1 && m <= 12) valid.add(m);
  }
  return [...valid].sort((a, b) => a - b);
}

/** ГРБС: любая форма → кириллический канон, порядок реестра, чужое — отброшено. */
function canonGrbs(raw: Iterable<string>): DepartmentId[] {
  const canon = new Set<string>();
  for (const key of raw) canon.add(toCanonicalDeptId(key));
  return ALL_DEPT_IDS.filter((id) => canon.has(id));
}

/** Подведы: сентинел аппарата первым, остальные по русскому алфавиту. */
function canonSubordinates(raw: Iterable<string>): string[] {
  const subs = [...new Set(raw)];
  subs.sort((a, b) => {
    if (a === ORG_ITSELF_SENTINEL) return -1;
    if (b === ORG_ITSELF_SENTINEL) return 1;
    return a.localeCompare(b, 'ru');
  });
  return subs;
}

/** Мульти-ось по словарю: пересечение с каноном, канонический порядок. */
function canonAxis<T extends string>(raw: Iterable<string>, dictionary: readonly T[]): T[] {
  const picked = new Set(raw);
  return dictionary.filter((k) => picked.has(k));
}

// ── Неделя: номер суток ↔ ISO (арифметика — @aemr/shared) ───

/**
 * focusedWeekStart → ISO понедельника ЕГО недели. Date читается локальными
 * компонентами (dayNumberOf: store создаёт локальный Date; toISOString на
 * восточных поясах сдвинул бы день на −1) и нормализуется к понедельнику:
 * store обещает понедельник, но DST-переход при миллисекундной арифметике
 * колеса мог сдать дату в воскресенье 23:xx — контракт поля чинится здесь.
 */
function isoOfWeekMonday(focusedWeekStart: Date): string | null {
  const day = dayNumberOf(focusedWeekStart);
  return day === null ? null : isoOfDayNumber(mondayOfDay(day));
}

/** Способы: store-ключи (competitive/single/kp/ep/КП/ЕП) → семейства, канонический порядок. */
function canonMethods(raw: Iterable<string>): MethodFamily[] {
  const families = new Set<MethodFamily>();
  for (const key of raw) {
    const fam = METHOD_FAMILY_BY_KEY[key];
    if (fam) families.add(fam);
  }
  return METHOD_FAMILIES.filter((f) => families.has(f));
}

/**
 * Чистая сборка FilterContext из полей store. Эффективный период — через
 * resolvePeriodSelection (дуга-2): месяцы, покрывающие ровно один квартал,
 * перекрывают legacy-`period` (то же правило, что в useFilteredData).
 */
export function buildFilterContext(slice: FilterStoreSlice): FilterContext {
  const months = canonMonths(slice.activeMonths);
  const { periodKey } = resolvePeriodSelection(slice.period, new Set(months), false);
  return {
    year: slice.year,
    period: periodKey,
    months,
    grbs: canonGrbs(slice.selectedDepartments),
    subordinates: canonSubordinates(slice.selectedSubordinates),
    activities: canonAxis(slice.selectedActivities, ACTIVITY_KEYS),
    methods: canonMethods(slice.selectedMethods),
    budgets: canonAxis(slice.selectedBudgets, BUDGET_KEYS),
    search: slice.searchQuery.trim(),
    weekStart: slice.periodMode === 'week' ? isoOfWeekMonday(slice.focusedWeekStart) : null,
  };
}

// ── URL-схема (спека §3.3) ──────────────────────────────────
// Пример: ?y=2026&p=q1&m=7,8&grbs=УЭР,УО&unit=_org_itself&mtd=kp&act=pm,tdpm&bud=fb,kb&q=шкаф&w=2026-07-20
// Латиница живёт только в URL-кодах (mtd/act); в контексте — канон продукта.

const ACTIVITY_TO_URL: Readonly<Record<ActivityKey, string>> = {
  program: 'pm',
  current_program: 'tdpm',
  current_non_program: 'td',
};
const URL_TO_ACTIVITY: Readonly<Record<string, ActivityKey>> = Object.fromEntries(
  (Object.entries(ACTIVITY_TO_URL) as [ActivityKey, string][]).map(([k, v]) => [v, k]),
);

const METHOD_TO_URL: Readonly<Record<MethodFamily, string>> = { 'КП': 'kp', 'ЕП': 'ep' };

/**
 * Компактная сериализация в query-строку (без ведущего '?').
 * Дефолты опускаются; год пишется всегда — ссылка без года двусмысленна.
 * Подведы — повторяющимся параметром `unit` (displayName может содержать запятую).
 */
export function serializeToUrl(ctx: FilterContext): string {
  const params = new URLSearchParams();
  params.set('y', String(ctx.year));
  if (ctx.period !== 'year') params.set('p', ctx.period);
  if (ctx.months.length > 0) params.set('m', ctx.months.join(','));
  if (ctx.grbs.length > 0) params.set('grbs', ctx.grbs.join(','));
  for (const sub of ctx.subordinates) params.append('unit', sub);
  if (ctx.methods.length > 0) params.set('mtd', ctx.methods.map((m) => METHOD_TO_URL[m]).join(','));
  if (ctx.activities.length > 0) params.set('act', ctx.activities.map((a) => ACTIVITY_TO_URL[a]).join(','));
  if (ctx.budgets.length > 0) params.set('bud', ctx.budgets.join(','));
  if (ctx.search) params.set('q', ctx.search);
  if (ctx.weekStart !== null) params.set('w', ctx.weekStart);
  return params.toString();
}

function splitCsv(value: string | null): string[] {
  return value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * Разбор query-строки (с '?' или без) в канонический FilterContext.
 * Мусорные значения молча отбрасываются — восстановление ссылки не должно падать.
 * Roundtrip-гарантия: parseFromUrl(serializeToUrl(ctx)) === ctx для канонического ctx.
 */
export function parseFromUrl(qs: string): FilterContext {
  const params = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);

  const rawYear = params.get('y');
  const yearNum = rawYear === null ? NaN : Number(rawYear);
  const year: YearFilter = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100
    ? yearNum
    : 'all';

  const rawPeriod = params.get('p');
  const period: PeriodScope = PERIOD_KEYS.includes(rawPeriod as PeriodScope)
    ? (rawPeriod as PeriodScope)
    : 'year';

  // Неделя: валидная дата нормализуется к понедельнику ЕЁ недели (roundtrip:
  // канонический weekStart — всегда понедельник, понедельник неподвижен).
  // Обратная сверка ISO ловит календарный rollover (2026-02-30 → мусор).
  const rawWeek = params.get('w');
  let weekStart: string | null = null;
  if (rawWeek !== null && /^\d{4}-\d{2}-\d{2}$/.test(rawWeek)) {
    const day = dayNumberOf(rawWeek);
    if (day !== null && isoOfDayNumber(day) === rawWeek) {
      weekStart = isoOfDayNumber(mondayOfDay(day));
    }
  }

  return {
    year,
    period,
    months: canonMonths(splitCsv(params.get('m')).map(Number)),
    grbs: canonGrbs(splitCsv(params.get('grbs'))),
    subordinates: canonSubordinates(params.getAll('unit')),
    activities: canonAxis(
      splitCsv(params.get('act')).map((code) => URL_TO_ACTIVITY[code] ?? code),
      ACTIVITY_KEYS,
    ),
    methods: canonMethods(splitCsv(params.get('mtd'))),
    budgets: canonAxis(splitCsv(params.get('bud')), BUDGET_KEYS),
    search: (params.get('q') ?? '').trim(),
    weekStart,
  };
}
