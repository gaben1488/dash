import { parseSheetDate } from '@aemr/shared';

/**
 * period-coverage.ts — покрытие периодов данными (недели, месяцы, годы).
 *
 * Слово владельца (проба линейки 22.08.2026): «недели, по которым есть данные
 * и нет данных, должны отличаться визуально. Так же периоды, месяцы и
 * кварталы». Видов ТРИ, и будущее — не пустота:
 *   - «есть данные» — по периоду есть хоть одна строка (обычный вид);
 *   - «данных нет» — период прошёл или идёт, а строк нет (приглушение);
 *   - «ещё не наступило» — период в будущем и строк нет (свой вид).
 * Период в будущем СО строками (плановые даты) — это «есть данные»: план
 * на сентябрь — не пустота и не загадка, а обещание в книге.
 *
 * Дом чистый: сюда приходят уже загруженные строки (планDate/factDate из DTO
 * /api/rows), отсюда уходят счётчики по ключам периодов. Загрузку и кэш держит
 * hooks/usePeriodCoverage.ts; классификацию видов — classifyPeriod ниже.
 */

/** Счётчики строк по периодам. Ключ недели — «ISO-год-номер» (см. isoWeekKey). */
export interface CoverageIndex {
  /** `${isoYear}-${week}` → сколько строк касаются недели (план или факт). */
  weeks: Record<string, number>;
  /** `${year}-${month}` (месяц 1..12 без нуля) → сколько строк касаются месяца. */
  months: Record<string, number>;
  /** год → сколько строк касаются года. */
  years: Record<number, number>;
}

export const EMPTY_COVERAGE: CoverageIndex = { weeks: {}, months: {}, years: {} };

/** «Почти пусто»: 1..3 строки за месяц — месяц живой, но еле (точка снизу). */
export const SCARCE_MAX = 3;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const RU_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

interface DayParts { y: number; m: number; d: number }

/**
 * Год-месяц-день значения даты. DTO отдаёт ISO «YYYY-MM-DD», но хелпер, как и
 * monthOfDateValue (lib/sheet-date.ts), понимает «дд.мм.гггг» и легаси-серийники
 * через канон parseSheetDate — чтобы чужой формат не выпадал из покрытия молча.
 */
export function dayPartsOfDateValue(value: unknown): DayParts | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();

  const iso = s.match(ISO_RE);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };

  const ru = s.match(RU_RE);
  if (ru) return { y: Number(ru[3]), m: Number(ru[2]), d: Number(ru[1]) };

  const serial = Number(s);
  if (!isNaN(serial)) {
    const d = parseSheetDate(s);
    if (d) return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  return null;
}

/**
 * Ключ ISO-недели: «ISO-год-номер». Год берётся у НЕДЕЛИ, а не у даты:
 * 29.12.2025 (понедельник) принадлежит 1-й неделе 2026 года — календарный
 * год дал бы ключ «2025-1» и склеил бы её с январской неделей 2025-го.
 * Алгоритм номера — тот же четверг-якорь, что в lib/week-number.ts.
 */
export function isoWeekKeyOfParts(p: DayParts): string {
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-${week}`;
}

/** Ключ ISO-недели для локальной даты (понедельник барабана недель). */
export function isoWeekKeyOfDate(d: Date): string {
  return isoWeekKeyOfParts({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
}

/** Строка DTO /api/rows — покрытию нужны только даты. */
export interface CoverageRow {
  planDate?: unknown;
  factDate?: unknown;
}

/**
 * Индекс покрытия по загруженным строкам. Строка касается периода, если её
 * плановая ИЛИ фактическая дата попадает в него; один и тот же период у одной
 * строки считается один раз (план и факт в одном месяце — не две строки).
 */
export function buildCoverageIndex(rows: CoverageRow[]): CoverageIndex {
  const weeks: Record<string, number> = {};
  const months: Record<string, number> = {};
  const years: Record<number, number> = {};

  for (const row of rows) {
    const weekKeys = new Set<string>();
    const monthKeys = new Set<string>();
    const yearKeys = new Set<number>();
    for (const value of [row.planDate, row.factDate]) {
      const p = dayPartsOfDateValue(value);
      if (!p) continue;
      weekKeys.add(isoWeekKeyOfParts(p));
      monthKeys.add(`${p.y}-${p.m}`);
      yearKeys.add(p.y);
    }
    for (const k of weekKeys) weeks[k] = (weeks[k] ?? 0) + 1;
    for (const k of monthKeys) months[k] = (months[k] ?? 0) + 1;
    for (const y of yearKeys) years[y] = (years[y] ?? 0) + 1;
  }
  return { weeks, months, years };
}

export function weekCountOf(index: CoverageIndex, monday: Date): number {
  return index.weeks[isoWeekKeyOfDate(monday)] ?? 0;
}

export function monthCountOf(index: CoverageIndex, year: number, month: number): number {
  return index.months[`${year}-${month}`] ?? 0;
}

export function yearCountOf(index: CoverageIndex, year: number): number {
  return index.years[year] ?? 0;
}

/** Месяц позже сегодняшнего? Текущий месяц будущим НЕ считается. */
export function isFutureMonth(year: number, month: number, today: Date = new Date()): boolean {
  return year > today.getFullYear()
    || (year === today.getFullYear() && month > today.getMonth() + 1);
}

/**
 * Положение недели относительно сегодня. «current» — сегодня внутри недели
 * (прямой эфир), «past» — неделя закончилась (срез), «future» — ещё не началась.
 */
export function weekPosition(monday: Date, today: Date = new Date()): 'past' | 'current' | 'future' {
  const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  if (today.getTime() < start.getTime()) return 'future';
  if (today.getTime() >= end.getTime()) return 'past';
  return 'current';
}

/** Три вида покрытия плюс «мало» (месяцы) и «неизвестно» (индекс не готов). */
export type PeriodCoverageKind = 'has-data' | 'scarce' | 'empty' | 'future' | 'unknown';

/**
 * Классификация периода. ready=false — индекс ещё не загружен (или загрузка
 * сорвалась): честный ответ «неизвестно», а не «данных нет» — сбой сети не
 * должен красить весь барабан в пустоту.
 */
export function classifyPeriod(count: number, isFuture: boolean, ready: boolean): PeriodCoverageKind {
  if (!ready) return 'unknown';
  if (count > SCARCE_MAX) return 'has-data';
  if (count > 0) return 'scarce';
  return isFuture ? 'future' : 'empty';
}
