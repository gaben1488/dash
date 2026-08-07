import { describe, expect, it } from 'vitest';
import { journalPeriodRange } from './journal-period';

const noMonths = new Set<number>();

describe('journalPeriodRange (период Журнала → from/to запроса)', () => {
  it('год целиком: границы января и декабря по продуктовому календарю (+12)', () => {
    const r = journalPeriodRange({ year: 2026, period: 'year', activeMonths: noMonths });
    // 01.01.2026 00:00 на Камчатке = 31.12.2025 12:00 UTC.
    expect(r.from).toBe('2025-12-31T12:00:00.000Z');
    expect(r.to).toBe('2026-12-31T11:59:59.999Z');
    expect(r.rangeLabel).toBe('01.01.2026 — 31.12.2026');
    expect(r.widened).toBe(false);
  });

  it('квартал: интервал ровно по трём его месяцам', () => {
    const r = journalPeriodRange({ year: 2026, period: 'q2', activeMonths: noMonths });
    expect(r.from).toBe('2026-03-31T12:00:00.000Z');
    expect(r.to).toBe('2026-06-30T11:59:59.999Z');
    expect(r.rangeLabel).toBe('01.04.2026 — 30.06.2026');
    expect(r.label).toContain('2026');
    expect(r.widened).toBe(false);
  });

  it('смежные месяцы: интервал равен выбору, расширения нет', () => {
    const r = journalPeriodRange({ year: 2026, period: 'year', activeMonths: new Set([4, 5]) });
    expect(r.from).toBe('2026-03-31T12:00:00.000Z');
    expect(r.to).toBe('2026-05-31T11:59:59.999Z');
    expect(r.rangeLabel).toBe('01.04.2026 — 31.05.2026');
    expect(r.widened).toBe(false);
  });

  it('несмежные месяцы: интервал охватывающий, расширение объявлено (widened)', () => {
    const r = journalPeriodRange({ year: 2026, period: 'year', activeMonths: new Set([1, 12]) });
    expect(r.from).toBe('2025-12-31T12:00:00.000Z');
    expect(r.to).toBe('2026-12-31T11:59:59.999Z');
    expect(r.widened).toBe(true);
  });

  it('месяцы перекрывают квартал (тот же приоритет, что в resolvePeriodSelection)', () => {
    const r = journalPeriodRange({ year: 2026, period: 'q4', activeMonths: new Set([2]) });
    expect(r.rangeLabel).toBe('01.02.2026 — 28.02.2026');
    expect(r.widened).toBe(false);
  });

  it('високосный февраль: последний день — 29-е', () => {
    const r = journalPeriodRange({ year: 2028, period: 'year', activeMonths: new Set([2]) });
    expect(r.rangeLabel).toBe('01.02.2028 — 29.02.2028');
  });

  it('полная тройка месяцев схлопывается в квартал и даёт тот же интервал', () => {
    const byMonths = journalPeriodRange({ year: 2026, period: 'year', activeMonths: new Set([7, 8, 9]) });
    const byQuarter = journalPeriodRange({ year: 2026, period: 'q3', activeMonths: noMonths });
    expect(byMonths.from).toBe(byQuarter.from);
    expect(byMonths.to).toBe(byQuarter.to);
  });

  it('«все годы» без уточнения — границы нет (фильтр не сужает молча)', () => {
    const r = journalPeriodRange({ year: 'all', period: 'year', activeMonths: noMonths });
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
    expect(r.rangeLabel).toBeNull();
    expect(r.label).toBe('все годы');
  });

  it('декабрь: верхняя граница переходит через год', () => {
    const r = journalPeriodRange({ year: 2026, period: 'year', activeMonths: new Set([12]) });
    expect(r.from).toBe('2026-11-30T12:00:00.000Z');
    expect(r.to).toBe('2026-12-31T11:59:59.999Z');
  });
});
