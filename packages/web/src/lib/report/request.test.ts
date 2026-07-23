import { describe, it, expect } from 'vitest';
import { dayNumberOf } from '@aemr/shared';
import { AVAILABLE_YEARS } from '../../store';
import { EMPTY_FILTER_CONTEXT, type FilterContext } from '../filter-context';
import { reportRequestParams } from './request';

// Пятница 24.07.2026: последний четверг ≤ сегодня — 23.07.2026
const FRIDAY = dayNumberOf('2026-07-24')!;

function ctxWith(patch: Partial<FilterContext>): FilterContext {
  return { ...EMPTY_FILTER_CONTEXT, year: 2026, ...patch };
}

describe('reportRequestParams — параметры GET /api/report из FilterContext', () => {
  it('без weekStart asOf не задаётся — дефолт среза выбирает сервер', () => {
    const p = reportRequestParams(ctxWith({}), FRIDAY);
    expect(p.asOf).toBeUndefined();
    expect(p.year).toBe(2026);
  });

  it('понедельник недели + 3 = четверг среза', () => {
    const p = reportRequestParams(ctxWith({ weekStart: '2026-07-13' }), FRIDAY);
    expect(p.asOf).toBe('2026-07-16');
  });

  it('смена недели в колесе меняет asOf', () => {
    const w1 = reportRequestParams(ctxWith({ weekStart: '2026-07-06' }), FRIDAY);
    const w2 = reportRequestParams(ctxWith({ weekStart: '2026-07-13' }), FRIDAY);
    expect(w1.asOf).toBe('2026-07-09');
    expect(w2.asOf).toBe('2026-07-16');
  });

  it('будущая неделя клампится к последнему четвергу ≤ сегодня', () => {
    const p = reportRequestParams(ctxWith({ weekStart: '2026-07-27' }), FRIDAY);
    expect(p.asOf).toBe('2026-07-23');
  });

  it('текущая неделя до её четверга — тоже кламп: будущий срез не запрашиваем', () => {
    // Сегодня понедельник 20.07 — четверг этой недели (23.07) ещё впереди
    const monday = dayNumberOf('2026-07-20')!;
    const p = reportRequestParams(ctxWith({ weekStart: '2026-07-20' }), monday);
    expect(p.asOf).toBe('2026-07-16');
  });

  it('четверг сегодняшнего дня не клампится (сегодня и есть срез)', () => {
    const thursday = dayNumberOf('2026-07-23')!;
    const p = reportRequestParams(ctxWith({ weekStart: '2026-07-20' }), thursday);
    expect(p.asOf).toBe('2026-07-23');
  });

  it('explicitQuarter побеждает ctx.period', () => {
    const p = reportRequestParams(ctxWith({ period: 'q1' }), FRIDAY, 3);
    expect(p.quarter).toBe(3);
  });

  it('quarter из ctx.period=qN; period=year — квартала нет', () => {
    expect(reportRequestParams(ctxWith({ period: 'q2' }), FRIDAY).quarter).toBe(2);
    expect(reportRequestParams(ctxWith({}), FRIDAY).quarter).toBeUndefined();
  });

  it('год: число контекста → оно; all → последний из AVAILABLE_YEARS', () => {
    expect(reportRequestParams(ctxWith({ year: 2025 }), FRIDAY).year).toBe(2025);
    expect(reportRequestParams(ctxWith({ year: 'all' }), FRIDAY).year)
      .toBe(AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1]);
  });
});
