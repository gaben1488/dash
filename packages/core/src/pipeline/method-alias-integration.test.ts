/**
 * method-alias-integration.test.ts
 *
 * Verifies that calc-engine's method extraction goes through
 * packages/shared/src/dictionaries/method-families.ts normalization,
 * not a hardcoded `method === 'ЕП'` string comparison.
 *
 * Regression guard for the "dictionaries dead code" fix (2026-04-19):
 * previously shared/dictionaries/ existed but no pipeline imported it.
 * Now `normalizeMethod()` is used inside defaultMethodExtractor().
 *
 * When a new method alias appears in source Sheets (e.g. 'ЕП (ст.93)'),
 * we should NOT need to patch calc-engine — just extend METHOD_ALIAS_MAP.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS, normalizeMethod, isCompetitive, PROCUREMENT_METHODS } from '@aemr/shared';
import { CalcEngine } from './calc-engine.js';
import { recalculateFromRows } from './recalculate.js';

const COL = DEPT_COLUMNS;

/** Build a RawRow (unknown[]) for a single procurement with the given method. */
function makeRow(method: string, overrides: Partial<Record<number, unknown>> = {}): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = '1';
  row[COL.SUBORDINATE] = 'МКУ Тест';
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.SUBJECT] = 'Закупка канцтоваров';
  row[COL.METHOD] = method;
  row[COL.FB_PLAN] = 100;
  row[COL.KB_PLAN] = 0;
  row[COL.MB_PLAN] = 0;
  row[COL.TOTAL_PLAN] = 100;
  row[COL.PLAN_DATE] = '15.01.2025';
  row[COL.PLAN_QUARTER] = 1;
  row[COL.PLAN_YEAR] = 2025;
  for (const [k, v] of Object.entries(overrides)) {
    row[Number(k)] = v;
  }
  return row;
}

function buildSheet(dataRows: unknown[][]): unknown[][] {
  return [
    new Array(32).fill('Header1'),
    new Array(32).fill('Header2'),
    new Array(32).fill('Header3'),
    ...dataRows,
  ];
}

describe('method alias integration — dictionaries → calc-engine', () => {
  describe('normalizeMethod() helper (pure dictionary)', () => {
    it('canonicalizes exact codes unchanged', () => {
      expect(normalizeMethod('ЭА')).toBe('ЭА');
      expect(normalizeMethod('ЕП')).toBe('ЕП');
      expect(normalizeMethod('ЭК')).toBe('ЭК');
      expect(normalizeMethod('ЭЗК')).toBe('ЭЗК');
    });

    it('handles lowercase aliases', () => {
      expect(normalizeMethod('эа')).toBe('ЭА');
      expect(normalizeMethod('еп')).toBe('ЕП');
    });

    it('handles variants with specification', () => {
      expect(normalizeMethod('ЭА (МЭП)')).toBe('ЭА');
      expect(normalizeMethod('ЭЕП')).toBe('ЕП');
      expect(normalizeMethod('ЕП (ст.93)')).toBe('ЕП');
      expect(normalizeMethod('Ед. поставщик')).toBe('ЕП');
    });

    it('returns undefined for empty / unknown', () => {
      expect(normalizeMethod('')).toBeUndefined();
      expect(normalizeMethod(null)).toBeUndefined();
      expect(normalizeMethod('ГАРБАЖ')).toBeUndefined();
    });
  });

  describe('isCompetitive() / PROCUREMENT_METHODS canonical list', () => {
    it('classifies canonical codes correctly', () => {
      expect(isCompetitive('ЭА')).toBe(true);
      expect(isCompetitive('ЭК')).toBe(true);
      expect(isCompetitive('ЭЗК')).toBe(true);
      expect(isCompetitive('ЕП')).toBe(false);
    });

    it('PROCUREMENT_METHODS contains exactly the 4 canonical codes', () => {
      expect(new Set(PROCUREMENT_METHODS)).toEqual(new Set(['ЭА', 'ЕП', 'ЭК', 'ЭЗК']));
    });
  });

  describe('CalcEngine method grouping and count metrics via aliases (end-to-end)', () => {
    const engine = new CalcEngine();
    const acceptAll = () => true;

    function bucketFor(method: string): 'ep' | 'competitive' | null {
      const res = engine.compute([makeRow(method)], acceptAll);
      if (res.byMethod.has('ep')) return 'ep';
      if (res.byMethod.has('competitive')) return 'competitive';
      return null;
    }

    function metricFor(method: string, key: string, overrides: Partial<Record<number, unknown>> = {}): number {
      const res = engine.compute([makeRow(method, overrides)], acceptAll);
      return res.total.get(key)?.value ?? 0;
    }

    it('"ЕП" → ep bucket', () => {
      expect(bucketFor('ЕП')).toBe('ep');
    });

    it('"Ед. поставщик" → ep bucket (alias resolution)', () => {
      expect(bucketFor('Ед. поставщик')).toBe('ep');
    });

    it('"ЭЕП" → ep bucket (УО-специфичный вариант)', () => {
      expect(bucketFor('ЭЕП')).toBe('ep');
    });

    it('"ЕП (ст.93)" → ep bucket', () => {
      expect(bucketFor('ЕП (ст.93)')).toBe('ep');
    });

    it('"ЭА (МЭП)" → competitive bucket (малый аукцион)', () => {
      expect(bucketFor('ЭА (МЭП)')).toBe('competitive');
    });

    it('lowercase "еп" → ep bucket', () => {
      expect(bucketFor('еп')).toBe('ep');
    });

    it('empty method → competitive (legacy СВОД FILTER L<>"ЕП")', () => {
      expect(bucketFor('')).toBe('competitive');
    });

    it('unknown non-empty method → no method bucket', () => {
      expect(bucketFor('ГАРБАЖ')).toBeNull();
      expect(metricFor('ГАРБАЖ', 'competitive_count')).toBe(0);
      expect(metricFor('ГАРБАЖ', 'ep_count')).toBe(0);
    });

    it('EP aliases contribute to EP count metrics, not only to byMethod buckets', () => {
      for (const method of ['ЕП', 'Ед. поставщик', 'ЭЕП', 'ЕП (ст.93)', 'еп']) {
        expect(metricFor(method, 'ep_count')).toBe(1);
        expect(metricFor(method, 'competitive_count')).toBe(0);
        expect(metricFor(method, 'ep_share_pct')).toBe(1);
      }
    });

    it('competitive aliases contribute to competitive count metrics', () => {
      for (const method of ['ЭА', 'ЭА (МЭП)', 'эа']) {
        expect(metricFor(method, 'competitive_count')).toBe(1);
        expect(metricFor(method, 'ep_count')).toBe(0);
        expect(metricFor(method, 'ep_share_pct')).toBe(0);
      }
    });

    it('method aliases are honored by fact-count metrics', () => {
      const factDate = { [COL.FACT_DATE]: '20.02.2025', [COL.TOTAL_FACT]: 90 };

      expect(metricFor('Ед. поставщик', 'ep_fact_count', factDate)).toBe(1);
      expect(metricFor('Ед. поставщик', 'comp_fact_count', factDate)).toBe(0);

      expect(metricFor('ЭА (МЭП)', 'comp_fact_count', factDate)).toBe(1);
      expect(metricFor('ЭА (МЭП)', 'ep_fact_count', factDate)).toBe(0);
    });
  });

  describe('legacy recalculateFromRows method counts via aliases', () => {
    it('normalizes EP and competitive aliases before counting method totals', () => {
      const rows = buildSheet([
        makeRow('Ед. поставщик', { [COL.FACT_DATE]: '20.02.2025', [COL.TOTAL_FACT]: 90 }),
        makeRow('ЭА (МЭП)', { [COL.FACT_DATE]: '21.02.2025', [COL.TOTAL_FACT]: 95 }),
        makeRow('еп'),
        makeRow('эа'),
        makeRow('ГАРБАЖ'),
      ]);

      const result = recalculateFromRows(rows, 'УЭР', 3, 2025);

      expect(result.totalEP).toBe(2);
      expect(result.totalCompetitive).toBe(2);
      expect(result.year.epExecCountPct).toBeCloseTo(0.5, 3);
      expect(result.year.compExecCountPct).toBeCloseTo(0.5, 3);
      expect(result.epSharePct).toBeCloseTo(0.5, 3);
    });
  });
});
