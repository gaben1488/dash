import {
  PRODUCT_UTC_OFFSET_HOURS,
  resolveTimeSelection,
  type Month,
  type PeriodKey,
  type Quarter,
  type TimeSelection,
} from '@aemr/shared';
import type { PeriodScope } from '../../store';

/**
 * Период Журнала: глобальная ось времени → параметры `from`/`to` запроса
 * `/api/journal`.
 *
 * Почему это честная ось, а не имитация. У записи журнала есть ровно одно
 * временное поле — `timestamp`, момент СОБЫТИЯ (импорт, правка, смена статуса
 * замечания). Периода данных у события нет и быть не может, поэтому глобальный
 * период применяется к дате события, и интерфейс обязан это проговаривать
 * (`rangeLabel` ниже — для подписи).
 *
 * Границы месяца берутся по продуктовому календарю (+12, Камчатка): «апрель»
 * для пользователя начинается 1 апреля по местному времени, а не по UTC.
 * Сервер хранит и сравнивает ISO-моменты в UTC (`new Date().toISOString()`),
 * поэтому границу переводим в UTC здесь — сравнение строк ISO совпадает с
 * хронологическим только пока обе стороны в одном поясе.
 *
 * Ограничение контракта: `/api/journal` понимает ОДИН интервал (`from`/`to`),
 * а выбор месяцев может быть несмежным (январь + декабрь). В этом случае
 * интервал берётся охватывающий, а флаг `widened` заставляет интерфейс
 * назвать разницу вслух — молча показать лишние месяцы нельзя.
 */
export interface JournalPeriodRange {
  /** Нижняя граница (включительно) для query-параметра `from`; null = без границы. */
  from: string | null;
  /** Верхняя граница (включительно) для query-параметра `to`; null = без границы. */
  to: string | null;
  /** Подпись выбора — канон `resolveTimeSelection` («2026 · 2 кв.»). */
  label: string;
  /** Подпись применённого интервала по продуктовому календарю: «01.04.2026 — 30.06.2026». */
  rangeLabel: string | null;
  /** Выбор несмежный: интервал шире выбора, в списке будут «лишние» месяцы. */
  widened: boolean;
}

const MS_PER_HOUR = 3_600_000;

/** Абсолютный номер месяца (год × 12 + месяц−1) — общий порядок для min/max. */
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/** Момент UTC, соответствующий началу месяца по продуктовому календарю. */
function monthStartIso(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return new Date(Date.UTC(year, month, 1) - PRODUCT_UTC_OFFSET_HOURS * MS_PER_HOUR).toISOString();
}

/** Последний миллисекундный момент UTC, попадающий в месяц по продуктовому календарю. */
function monthEndIso(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return new Date(Date.UTC(year, month + 1, 1) - PRODUCT_UTC_OFFSET_HOURS * MS_PER_HOUR - 1).toISOString();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Первое число месяца в человеческом виде: «01.04.2026». */
function firstDayLabel(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return `01.${pad2(month + 1)}.${year}`;
}

/** Последнее число месяца в человеческом виде: «30.06.2026». */
function lastDayLabel(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${pad2(lastDay)}.${pad2(month + 1)}.${year}`;
}

/** Месяцы, покрытые одним разрешённым ключом периода. */
function monthsOfKey(key: PeriodKey): number[] {
  if (key.kind === 'year') {
    return Array.from({ length: 12 }, (_, i) => monthIndex(key.year, i + 1));
  }
  if (key.kind === 'quarter') {
    const first = (key.quarter - 1) * 3 + 1;
    return [0, 1, 2].map((i) => monthIndex(key.year, first + i));
  }
  return [monthIndex(key.year, key.month)];
}

/**
 * Легаси-поля store (`year` + `period` + `activeMonths`) → канонический
 * `TimeSelection`. Приоритет месяцев над кварталом — тот же, что в
 * `resolvePeriodSelection`: непустой `activeMonths` перекрывает скаляр
 * `period` (period-resolution.ts:41-57). Расхождение здесь дало бы Журналу
 * период, отличный от остальных вкладок при одном и том же выборе.
 */
function toTimeSelection(year: number, period: PeriodScope, activeMonths: ReadonlySet<number>): TimeSelection {
  const byYear = new Map<number, { quarters: ReadonlySet<Quarter>; months: ReadonlySet<Month> }>();
  if (activeMonths.size > 0) {
    byYear.set(year, {
      quarters: new Set<Quarter>(),
      months: new Set<Month>([...activeMonths] as Month[]),
    });
  } else if (period !== 'year') {
    const quarter = Number(period.slice(1)) as Quarter;
    byYear.set(year, { quarters: new Set<Quarter>([quarter]), months: new Set<Month>() });
  }
  return { years: new Set<number>([year]), byYear, weekStart: null };
}

export function journalPeriodRange(input: {
  year: number | 'all';
  period: PeriodScope;
  activeMonths: ReadonlySet<number>;
}): JournalPeriodRange {
  const { year, period, activeMonths } = input;

  // «Все годы» без уточнения внутри года — граница не нужна: любой интервал
  // здесь только сузил бы выдачу без запроса пользователя.
  if (year === 'all' && activeMonths.size === 0 && period === 'year') {
    return { from: null, to: null, label: 'все годы', rangeLabel: null, widened: false };
  }
  // «Все годы» с уточнением периода легаси-скаляром выразить нечем: год один.
  // Берём текущий календарный — иначе пришлось бы молча расширить выбор.
  const effectiveYear = year === 'all' ? new Date().getUTCFullYear() : year;

  const resolved = resolveTimeSelection(toTimeSelection(effectiveYear, period, activeMonths));
  const covered = new Set<number>();
  for (const key of resolved.keys) {
    for (const m of monthsOfKey(key)) covered.add(m);
  }
  if (covered.size === 0) {
    return { from: null, to: null, label: resolved.label, rangeLabel: null, widened: false };
  }

  const sorted = [...covered].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  return {
    from: monthStartIso(first),
    to: monthEndIso(last),
    label: resolved.label,
    rangeLabel: `${firstDayLabel(first)} — ${lastDayLabel(last)}`,
    // Интервал шире выбора ровно тогда, когда между крайними месяцами есть
    // невыбранные: «январь + декабрь» просят два месяца, интервал даёт двенадцать.
    widened: last - first + 1 !== sorted.length,
  };
}
