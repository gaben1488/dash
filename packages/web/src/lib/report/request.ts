/**
 * Параметры запроса GET /api/report из FilterContext — чистая функция,
 * вынесенная из Report.tsx (волна R1 «Одна ось недели»).
 *
 * asOf — четверг выбранной недели (единая ось: колесо недель → срез-четверг),
 * но не будущий: сервер режет живой кэш по факту, и срез будущим четвергом
 * вернул бы сегодняшние данные под чужой датой. Поэтому клампим к последнему
 * четвергу ≤ сегодня (та же арифметика, что floorToThursday роута:
 * день 0 эпохи 1970-01-01 — четверг).
 */
import { dayNumberOf, floorToThursday, isoOfDayNumber } from '@aemr/shared';
import { AVAILABLE_YEARS } from '../../store';
import type { FilterContext } from '../filter-context';

export interface ReportRequest {
  year: number;
  quarter?: 1 | 2 | 3 | 4;
  asOf?: string;
}

export function reportRequestParams(
  ctx: FilterContext,
  todayDay: number,
  explicitQuarter?: 1 | 2 | 3 | 4,
): ReportRequest {
  // Год: 'all' роут отчёта не принимает — берём последний доступный
  const year = typeof ctx.year === 'number'
    ? ctx.year
    : AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1];

  const ctxQuarter = ctx.period.startsWith('q')
    ? (Number(ctx.period.slice(1)) as 1 | 2 | 3 | 4)
    : undefined;
  const quarter = explicitQuarter ?? ctxQuarter;

  const request: ReportRequest = { year };
  if (quarter !== undefined) request.quarter = quarter;

  if (ctx.weekStart !== null) {
    const monday = dayNumberOf(ctx.weekStart);
    if (monday !== null) {
      // Клампится только asOf; quarter (из авто-месяцев week-режима) — нет:
      // прокрутка в будущий квартал честно показывает его пустым под датой
      // последнего четверга (осознанно, ponytail-ревью R1 #10).
      request.asOf = isoOfDayNumber(Math.min(monday + 3, floorToThursday(todayDay)));
    }
  }
  return request;
}
