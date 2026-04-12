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
