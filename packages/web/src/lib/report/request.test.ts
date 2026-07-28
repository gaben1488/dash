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
  it('дефолт — ЭФИР: asOf не задаётся даже при выбранной неделе', () => {
    // Канон 27.07: отчётные даты адресуют хранение, ситуацию видим на сейчас.
    expect(reportRequestParams(ctxWith({}), FRIDAY).asOf).toBeUndefined();
    expect(reportRequestParams(ctxWith({ weekStart: '2026-07-13' }), FRIDAY).asOf)
      .toBeUndefined();
  });

  it('архив без выбранной недели — последний прошедший четверг', () => {
    const p = reportRequestParams(ctxWith({}), FRIDAY, undefined, 'archive');
    expect(p.asOf).toBe('2026-07-23');
  });

  it('архив: понедельник недели + 3 = четверг среза', () => {
    const p = reportRequestParams(ctxWith({ weekStart: '2026-07-13' }), FRIDAY, undefined, 'archive');
    expect(p.asOf).toBe('2026-07-16');
  });

  it('архив: смена недели в колесе меняет asOf', () => {
    const w1 = reportRequestParams(ctxWith({ weekStart: '2026-07-06' }), FRIDAY, undefined, 'archive');
    const w2 = reportRequestParams(ctxWith({ weekStart: '2026-07-13' }), FRIDAY, undefined, 'archive');
    expect(w1.asOf).toBe('2026-07-09');
    expect(w2.asOf).toBe('2026-07-16');
  });

  it('архив: будущая неделя клампится к последнему четвергу ≤ сегодня', () => {
    const p = reportRequestParams(ctxWith({ weekStart: '2026-07-27' }), FRIDAY, undefined, 'archive');
    expect(p.asOf).toBe('2026-07-23');
  });

  it('архив: текущая неделя до её четверга — тоже кламп', () => {
    // Сегодня понедельник 20.07 — четверг этой недели (23.07) ещё впереди
    const monday = dayNumberOf('2026-07-20')!;
    const p = reportRequestParams(ctxWith({ weekStart: '2026-07-20' }), monday, undefined, 'archive');
    expect(p.asOf).toBe('2026-07-16');
  });

  it('архив: четверг сегодняшнего дня не клампится (сегодня и есть срез)', () => {
    const thursday = dayNumberOf('2026-07-23')!;
    const p = reportRequestParams(ctxWith({ weekStart: '2026-07-20' }), thursday, undefined, 'archive');
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
