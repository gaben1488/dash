import { parseSheetDate } from '@aemr/shared';

/**
 * period-coverage.ts — покрытие периодов данными (недели, месяцы, годы).
 *
 * Слово владельца (проба линейки 22.08.2026): «недели, по которым есть данные
 * и нет данных, должны отличаться визуально. Так же периоды, месяцы и
 * кварталы». Видов ТРИ, и будущее — не пустота:
 *   - «есть данные» — период наступил и по нему есть хоть одна строка;
 *   - «данных нет» — период прошёл или идёт, а строк нет (приглушение);
 *   - «ещё не наступило» — период в будущем (свой вид).
 * БУДУЩЕЕ ПОБЕЖДАЕТ ДАННЫЕ (канон §12.3, дословно: «Это не „нет данных“,
 * а „ещё не наступило“»): сентябрь-декабрь 2026 несут план (146/42/41/101
 * строк), но пока не наступили — вид у них «ещё не наступило». Счёт плана
 * при этом жив (monthCountOf и т.п.) — подпись будущего месяца вправе его
 * показывать; побеждает только ВИД, не число.
 *
 * Границы «будущего» считаются по ПРОДУКТОВОМУ времени — календарю Камчатки
 * (PRODUCT_UTC_OFFSET ниже), а не по часам зрителя.
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
// Хвост после года разрешён («31.12.2026 г.» — живой формат из книг),
// но «31.12.20261» — не дата: за годом не может идти ещё цифра.
const RU_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/;

export interface DayParts { y: number; m: number; d: number }

/**
 * Год-месяц-день значения даты. DTO отдаёт ISO «YYYY-MM-DD», но хелпер, как и
 * monthOfDateValue (lib/sheet-date.ts), понимает «дд.мм.гггг» (в том числе
 * с хвостом « г.»), а всё нераспознанное отдаёт канону parseSheetDate
 * (@aemr/shared) — легаси-серийники и чужие формы не выпадают из покрытия
 * молча (находка 28.08: «31.12.2026 г.» ронялась в null).
 */
export function dayPartsOfDateValue(value: unknown): DayParts | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();

  const iso = s.match(ISO_RE);
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };

  const ru = s.match(RU_RE);
  if (ru) return { y: Number(ru[3]), m: Number(ru[2]), d: Number(ru[1]) };

  // Фоллбэк на канон. Сюда доходят только строки, не разобранные регулярками
  // выше, — у parseSheetDate для них остаются серийники (UTC-полночь) и общий
  // разбор Date, поэтому чтение UTC-компонент воспроизводит календарный день.
  const d = parseSheetDate(s);
  if (d) return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
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

/**
 * Продуктовое время — Камчатка, UTC+12 (часы к востоку от Гринвича). Книги
 * закупок живут по календарю края, поэтому границу «наступил / ещё не
 * наступило» задаёт камчатская полночь, а не часы зрителя: у смотрящего из
 * Москвы вечером 31 августа на Камчатке уже 1 сентября — сентябрь для
 * продукта наступил, хотя new Date() зрителя ещё в августе.
 */
export const PRODUCT_UTC_OFFSET = 12;

const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

/** Календарные сутки «сейчас» по продуктовому времени (Камчатка, UTC+12). */
export function productDayParts(now: Date = new Date()): DayParts {
  const shifted = new Date(now.getTime() + PRODUCT_UTC_OFFSET * MS_PER_HOUR);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/**
 * Месяц позже текущего? Текущий месяц будущим НЕ считается. `now` — момент
 * (часы зрителя любые), календарный день из него берётся по продуктовому
 * времени Камчатки.
 */
export function isFutureMonth(year: number, month: number, now: Date = new Date()): boolean {
  const t = productDayParts(now);
  return year > t.y || (year === t.y && month > t.m);
}

/**
 * Положение недели относительно «сегодня» по продуктовому времени. «current» —
 * камчатское сегодня внутри недели (прямой эфир), «past» — неделя закончилась
 * (срез), «future» — ещё не началась. `monday` — локальная дата понедельника
 * барабана (сравнение идёт по календарным дням, не по мгновениям).
 */
export function weekPosition(monday: Date, now: Date = new Date()): 'past' | 'current' | 'future' {
  const t = productDayParts(now);
  const today = Date.UTC(t.y, t.m - 1, t.d);
  const start = Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate());
  const end = start + 7 * MS_PER_DAY;
  if (today < start) return 'future';
  if (today >= end) return 'past';
  return 'current';
}

/** Три вида покрытия плюс «мало» (месяцы) и «неизвестно» (индекс не готов). */
export type PeriodCoverageKind = 'has-data' | 'scarce' | 'empty' | 'future' | 'unknown';

/**
 * Классификация периода. ready=false — индекс ещё не загружен (или загрузка
 * сорвалась): честный ответ «неизвестно», а не «данных нет» — сбой сети не
 * должен красить весь барабан в пустоту.
 *
 * БУДУЩЕЕ ПОБЕЖДАЕТ СЧЁТ (канон §12.3): период, который ещё не наступил, несёт
 * вид «ещё не наступило» даже при живом плане — «Это не „нет данных“, а „ещё
 * не наступило“». План при этом не прячется: подпись будущего месяца вправе
 * показывать его счёт, побеждает только вид.
 */
export function classifyPeriod(count: number, isFuture: boolean, ready: boolean): PeriodCoverageKind {
  if (!ready) return 'unknown';
  if (isFuture) return 'future';
  if (count > SCARCE_MAX) return 'has-data';
  if (count > 0) return 'scarce';
  return 'empty';
}

/**
 * Вид КВАРТАЛА — агрегат трёх его месяцев (для барабана кварталов в шапке):
 *   - все три месяца в будущем → «ещё не наступило» (даже при плановых
 *     строках — будущее побеждает, как и у месяца);
 *   - квартал начался → правило трёх видов по СУММЕ строк его месяцев:
 *     «есть данные» / «почти пусто» / «данных нет» (все месяцы пустые и
 *     прошли → «данных нет»);
 *   - индекс не готов (ready=false) → «неизвестно».
 */
export function classifyQuarter(
  year: number,
  quarter: number,
  index: CoverageIndex,
  ready: boolean,
  now: Date = new Date(),
): PeriodCoverageKind {
  const first = (quarter - 1) * 3 + 1;
  const months = [first, first + 1, first + 2];
  const total = months.reduce((sum, m) => sum + monthCountOf(index, year, m), 0);
  const allFuture = months.every((m) => isFutureMonth(year, m, now));
  return classifyPeriod(total, allFuture, ready);
}

// ── Честность по-книжно ──────────────────────────────────────────────

/** Статусы индекса покрытия (дом типа — здесь; хук покрытия переиспользует). */
export type CoverageStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'failed';

/** Итог загрузки одной книги: доехала ли ЦЕЛИКОМ и какие строки довезла. */
export interface BookLoadResult {
  /** true — все страницы книги доехали; false — хоть одна потерялась. */
  ok: boolean;
  rows: CoverageRow[];
}

/**
 * Статус индекса по итогам всех книг (находка 28.08: отказ книги глотался как
 * пустота — упади 7 книг из 8, статус был 'ready', и живая книга красила чужие
 * периоды «данных нет»):
 *   - все книги целиком и строки есть → 'ready';
 *   - ни одной строки ниоткуда → 'failed' (сбой сети или сервера — не пустой
 *     год; ноль строк из ВСЕХ книг даже без явных ошибок считается сбоем);
 *   - иначе → 'partial': что доехало — в индекс, но отсутствие строк по
 *     периоду ничем не доказано — их могла держать недоехавшая книга.
 */
export function summarizeBookLoads(
  books: BookLoadResult[],
): { status: 'ready' | 'partial' | 'failed'; rows: CoverageRow[] } {
  const rows = books.flatMap((b) => b.rows);
  if (rows.length === 0) return { status: 'failed', rows };
  const allWhole = books.every((b) => b.ok);
  return { status: allWhole ? 'ready' : 'partial', rows };
}

/**
 * Классификация с учётом СТАТУСА индекса — для потребителей барабанов.
 * Отличие от classifyPeriod — честность при 'partial': доехавшие строки красят
 * период как обычно, но пустота НЕ доказана (строки могла держать недоехавшая
 * книга) → «неизвестно», не приглушение. Будущее остаётся будущим: календарю
 * недоезд книги не указ.
 */
export function classifyPeriodByStatus(
  count: number,
  isFuture: boolean,
  status: CoverageStatus,
): PeriodCoverageKind {
  if (status === 'partial') {
    if (isFuture) return 'future';
    return count > 0 ? classifyPeriod(count, false, true) : 'unknown';
  }
  return classifyPeriod(count, isFuture, status === 'ready');
}
