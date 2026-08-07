/**
 * Сквозная ось времени — канонический тип выбора и его резолвер.
 *
 * Дом по карте `docs/superpowers/specs/2026-08-07-time-axis-map.md` §3:
 * это чистая математика выбора без данных; потребителей три — web
 * (store/FilterContext/URL), server (разбор query) и core (скоуп compute /
 * sliceResults). Легаси-скаляры (PeriodScope, одиночный periodKey) в модель
 * не входят — они выводимые представления переходного периода.
 *
 * Сериализация здесь — серверная CSV-форма query-параметров
 * (`years=…&quarters=Y:Q,…&months=Y:M,…&week=YYYY-MM-DD`). Компактная
 * URL-схема страниц (y/p/m/w) живёт в web filter-context и адаптируется
 * на Фазе 4.
 */

import { floorToThursday, mondayOfDay, dayNumberOf, isoOfDayNumber } from './parse-sheet-date.js';

export type Quarter = 1 | 2 | 3 | 4;
export type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Продуктовый пояс по умолчанию — Камчатка, UTC+12 (DST нет). */
export const PRODUCT_UTC_OFFSET_HOURS = 12;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * Календарный день продукта (номер суток от 1970-01-01) для момента `instant`
 * при фиксированном смещении пояса. TZ машины не участвует: instant —
 * абсолютный момент, смещение — из конфига. Дополняет dayNumberOf, который
 * разбирает календарные ЗАПИСИ (строки/serial), а не абсолютные моменты.
 * Переехал из server/services/product-calendar.ts: клиент и сервер обязаны
 * считать четверг недели одинаково.
 */
export function productCalendarDay(instant: Date, utcOffsetHours: number): number {
  return Math.floor((instant.getTime() + utcOffsetHours * MS_PER_HOUR) / MS_PER_DAY);
}

/** Сырой выбор пользователя. Хранится в store, сериализуется в URL, парсится сервером. */
export interface TimeSelection {
  /** Выбранные годы. Пустое множество = все доступные годы. */
  readonly years: ReadonlySet<number>;
  /** Уточнение внутри года. Нет записи для года = год целиком. */
  readonly byYear: ReadonlyMap<number, {
    readonly quarters: ReadonlySet<Quarter>;
    readonly months: ReadonlySet<Month>;
  }>;
  /** Неделя-срез: ISO-понедельник (YYYY-MM-DD). null = живой эфир. */
  readonly weekStart: string | null;
}

/** Пустой выбор: все годы целиком, живой эфир. */
export const EMPTY_TIME_SELECTION: TimeSelection = {
  years: new Set<number>(),
  byYear: new Map(),
  weekStart: null,
};

export type PeriodKey =
  | { readonly kind: 'year'; readonly year: number }
  | { readonly kind: 'quarter'; readonly year: number; readonly quarter: Quarter }
  | { readonly kind: 'month'; readonly year: number; readonly month: Month };

export interface ResolvedTime {
  /** Дизъюнктное покрытие выбора — сумма по keys не даёт двойного счёта. [] = всё. */
  readonly keys: readonly PeriodKey[];
  /** Участвующие годы; [] = все. */
  readonly years: readonly number[];
  readonly granularity: 'year' | 'quarter' | 'month' | 'mixed';
  /** Продуктовый день среза из weekStart (клампнут к прошедшему четвергу); null = эфир. */
  readonly asOfDay: number | null;
  /** Единственный дом человекочитаемой подписи периода. */
  readonly label: string;
}

const QUARTER_MONTHS: Record<Quarter, readonly Month[]> = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
};

const MONTH_QUARTER: Record<Month, Quarter> = {
  1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4, 11: 4, 12: 4,
};

const MONTH_LABELS: Record<Month, string> = {
  1: 'янв', 2: 'фев', 3: 'мар', 4: 'апр', 5: 'май', 6: 'июн',
  7: 'июл', 8: 'авг', 9: 'сен', 10: 'окт', 11: 'ноя', 12: 'дек',
};

/**
 * Канонизация выбора одного года в дизъюнктные ключи.
 *
 * Правила §3.3 карты: квартал поглощает свои три месяца; полная тройка
 * месяцев квартала схлопывается в квартал; четыре квартала — в год целиком;
 * пустые quarters и months — год целиком.
 */
function canonYearKeys(year: number, sel?: { quarters: ReadonlySet<Quarter>; months: ReadonlySet<Month> }): PeriodKey[] {
  if (!sel || (sel.quarters.size === 0 && sel.months.size === 0)) {
    return [{ kind: 'year', year }];
  }
  const quarters = new Set<Quarter>(sel.quarters);
  // Месяцы, не покрытые выбранными кварталами.
  const looseMonths = [...sel.months].filter((m) => !quarters.has(MONTH_QUARTER[m]));
  // Полная тройка свободных месяцев = её квартал.
  for (const q of [1, 2, 3, 4] as const) {
    if (quarters.has(q)) continue;
    if (QUARTER_MONTHS[q].every((m) => looseMonths.includes(m))) quarters.add(q);
  }
  const restMonths = looseMonths.filter((m) => !quarters.has(MONTH_QUARTER[m]));
  if (quarters.size === 4 && restMonths.length === 0) {
    return [{ kind: 'year', year }];
  }
  const keys: PeriodKey[] = [];
  for (const q of [...quarters].sort((a, b) => a - b)) keys.push({ kind: 'quarter', year, quarter: q });
  for (const m of restMonths.sort((a, b) => a - b)) keys.push({ kind: 'month', year, month: m });
  return keys;
}

/** Подпись выбора одного года (без самого года). */
function yearSuffixLabel(keys: readonly PeriodKey[]): string {
  if (keys.length === 1 && keys[0].kind === 'year') return 'весь год';
  const qs = keys.filter((k): k is Extract<PeriodKey, { kind: 'quarter' }> => k.kind === 'quarter');
  const ms = keys.filter((k): k is Extract<PeriodKey, { kind: 'month' }> => k.kind === 'month');
  const parts: string[] = [];
  if (qs.length > 0) parts.push(`${qs.map((k) => k.quarter).join(',')} кв.`);
  if (ms.length > 0) parts.push(ms.map((k) => MONTH_LABELS[k.month]).join(', '));
  return parts.join(' + ');
}

/**
 * Резолвер: сырой выбор → дизъюнктные ключи + годы + гранулярность +
 * asOfDay + подпись. Единственный дом этой математики для web/server/core.
 */
export function resolveTimeSelection(
  sel: TimeSelection,
  opts?: {
    readonly now?: Date;
    readonly availableYears?: readonly number[];
    readonly utcOffsetHours?: number;
  },
): ResolvedTime {
  // Годы выбора: явные ∪ уточнённые; пусто = все доступные (или честно []).
  const explicit = new Set<number>(sel.years);
  for (const y of sel.byYear.keys()) explicit.add(y);
  const years = explicit.size > 0
    ? [...explicit].sort((a, b) => a - b)
    : [...(opts?.availableYears ?? [])].sort((a, b) => a - b);

  const keys: PeriodKey[] = [];
  for (const y of years) keys.push(...canonYearKeys(y, sel.byYear.get(y)));

  const kinds = new Set(keys.map((k) => k.kind));
  const granularity: ResolvedTime['granularity'] =
    kinds.size === 0 ? 'year' : kinds.size > 1 ? 'mixed' : ([...kinds][0] as ResolvedTime['granularity']);

  // Неделя-срез: продуктовый четверг выбранной недели, клампнутый к
  // последнему ПРОШЕДШЕМУ четвергу (будущая неделя не адресуема).
  let asOfDay: number | null = null;
  if (sel.weekStart !== null) {
    const monday = dayNumberOf(sel.weekStart);
    if (monday !== null) {
      const offset = opts?.utcOffsetHours ?? PRODUCT_UTC_OFFSET_HOURS;
      const lastThursday = floorToThursday(productCalendarDay(opts?.now ?? new Date(), offset));
      asOfDay = Math.min(mondayOfDay(monday) + 3, lastThursday);
    }
  }

  // Подпись: единственный дом человекочитаемого периода.
  let label: string;
  if (keys.length === 0) {
    label = 'все годы';
  } else {
    const byYearParts: string[] = [];
    for (const y of years) {
      const yearKeys = keys.filter((k) => k.year === y);
      byYearParts.push(`${y} · ${yearSuffixLabel(yearKeys)}`);
    }
    label = byYearParts.join('; ');
  }
  if (asOfDay !== null) {
    label += ` · срез ${isoOfDayNumber(asOfDay)}`;
  }

  return { keys, years, granularity, asOfDay, label };
}

// ── Серверная CSV-сериализация (query-параметры) ─────────────────────

/**
 * Выбор → query-параметры серверной формы:
 * `years=2025,2026&quarters=2026:1,2026:2&months=2025:11&week=2026-07-20`.
 * Дефолты опускаются; пустой выбор → пустая строка.
 */
export function serializeTimeSelection(sel: TimeSelection): string {
  // Без URLSearchParams: shared платформо-нейтрален (нет DOM-типов), а все
  // значения формата — числа, двоеточия, запятые и ISO-даты, экранирование
  // не требуется.
  const parts: string[] = [];
  if (sel.years.size > 0) parts.push(`years=${[...sel.years].sort((a, b) => a - b).join(',')}`);
  const quarters: string[] = [];
  const months: string[] = [];
  for (const [y, v] of [...sel.byYear.entries()].sort((a, b) => a[0] - b[0])) {
    for (const q of [...v.quarters].sort((a, b) => a - b)) quarters.push(`${y}:${q}`);
    for (const m of [...v.months].sort((a, b) => a - b)) months.push(`${y}:${m}`);
  }
  if (quarters.length > 0) parts.push(`quarters=${quarters.join(',')}`);
  if (months.length > 0) parts.push(`months=${months.join(',')}`);
  if (sel.weekStart !== null) parts.push(`week=${sel.weekStart}`);
  return parts.join('&');
}

/**
 * Разбор серверной формы. Мусор молча отбрасывается — восстановление
 * ссылки/запроса не должно падать. Неделя нормализуется к понедельнику.
 */
export function parseTimeSelection(qs: string): TimeSelection {
  const text = qs.startsWith('?') ? qs.slice(1) : qs;
  const params = new Map<string, string>();
  for (const pair of text.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    // Последнее вхождение ключа побеждает — как у URLSearchParams.get нет,
    // но для нашего формата дубликаты ключей — мусор, берём последний.
    params.set(decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1)));
  }
  const years = new Set<number>();
  for (const raw of (params.get('years') ?? '').split(',')) {
    const y = Number(raw.trim());
    if (Number.isInteger(y) && y >= 2000 && y <= 2100) years.add(y);
  }
  const byYear = new Map<number, { quarters: Set<Quarter>; months: Set<Month> }>();
  const entry = (y: number) => {
    let e = byYear.get(y);
    if (!e) {
      e = { quarters: new Set<Quarter>(), months: new Set<Month>() };
      byYear.set(y, e);
    }
    return e;
  };
  for (const raw of (params.get('quarters') ?? '').split(',')) {
    const m = raw.trim().match(/^(\d{4}):([1-4])$/);
    if (m) entry(Number(m[1])).quarters.add(Number(m[2]) as Quarter);
  }
  for (const raw of (params.get('months') ?? '').split(',')) {
    const m = raw.trim().match(/^(\d{4}):(\d{1,2})$/);
    if (m) {
      const month = Number(m[2]);
      if (month >= 1 && month <= 12) entry(Number(m[1])).months.add(month as Month);
    }
  }
  let weekStart: string | null = null;
  const rawWeek = params.get('week') ?? null;
  if (rawWeek !== null && /^\d{4}-\d{2}-\d{2}$/.test(rawWeek)) {
    const day = dayNumberOf(rawWeek);
    if (day !== null && isoOfDayNumber(day) === rawWeek) {
      weekStart = isoOfDayNumber(mondayOfDay(day));
    }
  }
  return { years, byYear, weekStart };
}
