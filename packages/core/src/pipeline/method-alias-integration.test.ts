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

  describe('CalcEngine.byMethod grouping via aliases (end-to-end)', () => {
    const engine = new CalcEngine();
    const acceptAll = () => true;

    // byMethod группировка пользуется extractors.method(row), которая теперь
    // проходит через normalizeMethod() из dictionaries. Проверяем что alias-строки
    // попадают в правильный бакет ('ep' | 'competitive').
    //
    // Метрики competitive_count / ep_count имеют GATE_METHOD_{EP|COMPETITIVE} с
    // сырым сравнением row[COL.METHOD] === 'ЕП', поэтому test не через них, а
    // через наличие ключа в byMethod Map (что и доказывает — extractor отработал).
    function bucketFor(method: string): 'ep' | 'competitive' | null {
      const res = engine.compute([makeRow(method)], acceptAll);
      if (res.byMethod.has('ep')) return 'ep';
      if (res.byMethod.has('competitive')) return 'competitive';
      return null;
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
  });
});
