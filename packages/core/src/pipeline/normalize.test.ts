import { describe, it, expect } from 'vitest';
import { normalizeMetrics } from './normalize';
import type { RawCellValue, ReportMapEntry } from '@aemr/shared';

function makeEntry(overrides: Partial<ReportMapEntry> = {}): ReportMapEntry {
  return {
    metricKey: 'test.metric',
    label: 'Test',
    originType: 'official',
    period: 'annual',
    valueType: 'number',
    sourceUnit: 'count',
    displayUnit: 'count',
    sourceSheet: 'СВОД ТД-ПМ',
    sourceCell: 'D14',
    group: 'test',
    fallbackPolicy: 'null',
    ...overrides,
  };
}

function makeRaw(rawValue: unknown, overrides: Partial<RawCellValue> = {}): RawCellValue {
  return {
    sheet: 'СВОД ТД-ПМ',
    cell: 'D14',
    rawValue,
    formattedValue: String(rawValue),
    formula: null,
    valueType: 'number',
    readAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('normalizeMetrics', () => {
  it('returns null metric for missing cell', () => {
    const entry = makeEntry();
    const cells = new Map<string, RawCellValue>();
    const result = normalizeMetrics(cells, [entry]);
    const metric = result.get('test.metric')!;
    expect(metric.numericValue).toBeNull();
    expect(metric.displayValue).toBe('—');
    expect(metric.confidence).toBe(0);
  });

  it('normalizes numeric value correctly', () => {
    const entry = makeEntry();
    const cells = new Map([['СВОД ТД-ПМ!D14', makeRaw(42)]]);
    const result = normalizeMetrics(cells, [entry]);
    const metric = result.get('test.metric')!;
    expect(metric.numericValue).toBe(42);
    expect(metric.confidence).toBe(1.0);
  });
  it('does not turn invalid or nonfinite source money into a numeric result', () => {
    const entry = makeEntry({ valueType: 'currency', sourceUnit: 'thousand_rubles', displayUnit: 'thousand_rubles' });
    for (const raw of ['123abc', Infinity, true]) {
      const metric = normalizeMetrics(new Map([['СВОД ТД-ПМ!D14', makeRaw(raw)]]), [entry]).get('test.metric')!;
      expect(metric.numericValue, String(raw)).toBeNull();
      expect(metric.warnings.length).toBeGreaterThan(0);
    }
  });
  it('uses the declared percent encoding rather than a magnitude heuristic', () => {
    const points = makeEntry({ valueType: 'percent', percentEncoding: 'points' });
    const fraction = makeEntry({ valueType: 'percent', percentEncoding: 'fraction' });
    expect(normalizeMetrics(new Map([['СВОД ТД-ПМ!D14', makeRaw(1.5)]]), [points]).get('test.metric')!.numericValue).toBe(0.015);
    expect(normalizeMetrics(new Map([['СВОД ТД-ПМ!D14', makeRaw(2.5)]]), [fraction]).get('test.metric')!.numericValue).toBe(2.5);
    expect(normalizeMetrics(new Map([['СВОД ТД-ПМ!D14', makeRaw('1,5%')]]), [fraction]).get('test.metric')!.numericValue).toBe(0.015);
  });
  it('keeps numeric money in canonical thousand rubles and converts only its display', () => {
    const entry = makeEntry({ valueType: 'currency', sourceUnit: 'thousand_rubles', displayUnit: 'million_rubles' });
    const metric = normalizeMetrics(new Map([['СВОД ТД-ПМ!D14', makeRaw('-20 000')]]), [entry]).get('test.metric')!;
    expect(metric.numericValue).toBe(-20000);
    expect(metric.unit).toBe('thousand_rubles');
    expect(metric.displayValue).toBe('-20,00 млн руб.');
  });

  it('keeps small percent values as fractions (e.g. 0.08 for 8%)', () => {
    const entry = makeEntry({ valueType: 'percent', displayUnit: 'percent' });
    const cells = new Map([['СВОД ТД-ПМ!D14', makeRaw(0.08)]]);
    const result = normalizeMetrics(cells, [entry]);
    const metric = result.get('test.metric')!;
    expect(metric.numericValue).toBe(0.08);
    expect(metric.displayValue).toContain('8.0%');
  });

  it('converts percent points only when the profile declares points (85 → 0.85)', () => {
    const entry = makeEntry({ valueType: 'percent', percentEncoding: 'points', displayUnit: 'percent' });
    const cells = new Map([['СВОД ТД-ПМ!D14', makeRaw(85)]]);
    const result = normalizeMetrics(cells, [entry]);
    const metric = result.get('test.metric')!;
    expect(metric.numericValue).toBe(0.85);
    expect(metric.confidence).toBe(1);
  });

  it('parses Russian-formatted string "1 234,56" to number', () => {
    const entry = makeEntry({ valueType: 'currency', sourceUnit: 'thousand_rubles', displayUnit: 'thousand_rubles' });
    const cells = new Map([['СВОД ТД-ПМ!D14', makeRaw('1 234,56')]]);
    const result = normalizeMetrics(cells, [entry]);
    const metric = result.get('test.metric')!;
    expect(metric.numericValue).toBeCloseTo(1234.56);
  });

  it('parses string percent "8%" correctly', () => {
    const entry = makeEntry({ valueType: 'percent', displayUnit: 'percent' });
    const cells = new Map([['СВОД ТД-ПМ!D14', makeRaw('8%')]]);
    const result = normalizeMetrics(cells, [entry]);
    const metric = result.get('test.metric')!;
    expect(metric.numericValue).toBeCloseTo(0.08);
  });

  it('converts boolean to 0/1', () => {
    const entry = makeEntry({ valueType: 'boolean' });
    const cells = new Map([['СВОД ТД-ПМ!D14', makeRaw(true)]]);
    const result = normalizeMetrics(cells, [entry]);
    const metric = result.get('test.metric')!;
    expect(metric.numericValue).toBe(1);
  });

  it('uses fallbackPolicy zero for empty cells', () => {
    const entry = makeEntry({ fallbackPolicy: 'zero' });
    const cells = new Map([['СВОД ТД-ПМ!D14', makeRaw('')]]);
    const result = normalizeMetrics(cells, [entry]);
    const metric = result.get('test.metric')!;
    expect(metric.numericValue).toBe(0);
    expect(metric.confidence).toBe(0.3);
  });
});
