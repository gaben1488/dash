import { describe, it, expect } from 'vitest';
import { computeDeltas } from './delta';
import type { NormalizedMetric, ReportMapEntry } from '@aemr/shared';

function makeEntry(key: string, tolerance = 0.01): ReportMapEntry {
  return {
    metricKey: key,
    label: key,
    originType: 'official',
    period: 'annual',
    valueType: 'number',
    sourceUnit: 'count',
    displayUnit: 'count',
    sourceSheet: 'СВОД ТД-ПМ',
    sourceCell: 'D14',
    group: 'test',
    fallbackPolicy: 'null',
    tolerance,
  };
}

function makeMetric(key: string, numericValue: number | null): NormalizedMetric {
  return {
    metricKey: key,
    value: numericValue,
    numericValue,
    displayValue: String(numericValue ?? '—'),
    origin: 'official',
    period: 'annual',
    unit: 'count',
    sourceSheet: 'СВОД ТД-ПМ',
    sourceCell: 'D14',
    formula: null,
    confidence: 1.0,
    readAt: new Date().toISOString(),
    warnings: [],
  };
}

describe('computeDeltas', () => {
  it('marks matching values as within tolerance', () => {
    const entry = makeEntry('m1');
    const official = new Map([['m1', makeMetric('m1', 100)]]);
    const calculated = new Map([['m1', makeMetric('m1', 100.5)]]);
    const results = computeDeltas(official, calculated, [entry]);
    expect(results).toHaveLength(1);
    expect(results[0].withinTolerance).toBe(true);
    expect(results[0].delta).toBeCloseTo(0.5);
  });

  it('marks diverging values as outside tolerance', () => {
    const entry = makeEntry('m1', 0.01); // 1% tolerance
    const official = new Map([['m1', makeMetric('m1', 100)]]);
    const calculated = new Map([['m1', makeMetric('m1', 120)]]);
    const results = computeDeltas(official, calculated, [entry]);
    expect(results[0].withinTolerance).toBe(false);
    expect(results[0].deltaPercent).toBeCloseTo(20);
  });

  it('handles one side null — official present, calculated missing', () => {
    const entry = makeEntry('m1');
    const official = new Map([['m1', makeMetric('m1', 100)]]);
    const calculated = new Map<string, NormalizedMetric>();
    const results = computeDeltas(official, calculated, [entry]);
    expect(results[0].withinTolerance).toBe(false);
    expect(results[0].explanation).toContain('отсутствует');
  });

  it('handles zero official with non-zero calculated', () => {
    const entry = makeEntry('m1');
    const official = new Map([['m1', makeMetric('m1', 0)]]);
    const calculated = new Map([['m1', makeMetric('m1', 50)]]);
    const results = computeDeltas(official, calculated, [entry]);
    expect(results[0].withinTolerance).toBe(false);
    expect(results[0].deltaPercent).toBe(100); // 100% divergence when official is 0
  });

  it('skips entries where both official and calculated are absent', () => {
    const entry = makeEntry('m1');
    const official = new Map<string, NormalizedMetric>();
    const calculated = new Map<string, NormalizedMetric>();
    const results = computeDeltas(official, calculated, [entry]);
    expect(results).toHaveLength(0);
  });
});

/**
 * Д21: сверка обязана знать периметр обеих сторон. Расчёт без года
 * суммирует все годы книги, лист СВОД считает строго свой — вычитание
 * таких величин выглядело измерением, но им не было.
 */
describe('computeDeltas — периметр сравнения', () => {
  const entry = makeEntry('grbs.uer.ep.year.total_plan');
  const official = new Map([[entry.metricKey, makeMetric(entry.metricKey, 3219.7)]]);
  const calculated = new Map([[entry.metricKey, makeMetric(entry.metricKey, 8058.24)]]);

  it('расчёт по всем годам против годового официала — дельта НЕ считается', () => {
    const [r] = computeDeltas(official, calculated, [entry], { officialYear: 2026 });
    expect(r.delta).toBeNull();
    expect(r.deltaPercent).toBeNull();
    // Это не расхождение данных: экран не должен краснеть там, где сверки не было.
    expect(r.withinTolerance).toBe(true);
    expect(r.explanation).toContain('по всем годам');
    expect(r.explanation).toContain('2026');
    // Обе величины остаются на месте — читатель видит, что именно несравнимо.
    expect(r.officialValue).toBe(3219.7);
    expect(r.calculatedValue).toBe(8058.24);
  });

  it('разные годы у сторон — тоже несравнимо, с обоими годами в объяснении', () => {
    const [r] = computeDeltas(official, calculated, [entry], { calcYear: 2025, officialYear: 2026 });
    expect(r.delta).toBeNull();
    expect(r.explanation).toContain('2025');
    expect(r.explanation).toContain('2026');
  });

  it('годы совпали — сверка идёт как раньше', () => {
    const [r] = computeDeltas(official, calculated, [entry], { calcYear: 2026, officialYear: 2026 });
    expect(r.delta).toBeCloseTo(4838.54);
    expect(r.withinTolerance).toBe(false);
  });

  it('год официала неизвестен — прежнее поведение, сверка не блокируется', () => {
    const [r] = computeDeltas(official, calculated, [entry], { calcYear: undefined });
    expect(r.delta).toBeCloseTo(4838.54);
  });

  it('несравнимость не мешает видеть одностороннее отсутствие значения', () => {
    const onlyOfficial = new Map([[entry.metricKey, makeMetric(entry.metricKey, 100)]]);
    const [r] = computeDeltas(onlyOfficial, new Map(), [entry], { officialYear: 2026 });
    expect(r.explanation).toBe('Пересчитанное значение отсутствует');
    expect(r.withinTolerance).toBe(false);
  });
});
