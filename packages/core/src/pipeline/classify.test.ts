import { describe, it, expect } from 'vitest';
import { classifyRows } from './classify.js';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** Build a cells record from partial column data */
function makeCells(data: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...data };
}

function classify(
  sheetName: string,
  rows: Array<{ rowIndex: number; cells: Record<string, unknown> }>,
) {
  return classifyRows(sheetName, rows);
}

function classifySingle(
  rowIndex: number,
  cells: Record<string, unknown>,
  sheetName = 'Лист1',
) {
  const [result] = classify(sheetName, [{ rowIndex, cells }]);
  return result;
}

// ────────────────────────────────────────────────────────────
// 1. Header rows (rowIndex <= 3)
// ────────────────────────────────────────────────────────────

describe('classifyRows — header detection', () => {
  it('classifies row 1 as header regardless of content', () => {
    const r = classifySingle(1, makeCells({ A: '1', H: 1000000 }));
    expect(r.classification).toBe('header');
    expect(r.classificationConfidence).toBe(0.99);
  });

  it('classifies row 2 as header', () => {
    const r = classifySingle(2, makeCells());
    expect(r.classification).toBe('header');
  });

  it('classifies row 3 as header', () => {
    const r = classifySingle(3, makeCells({ C: 'Наименование' }));
    expect(r.classification).toBe('header');
  });

  it('does NOT classify row 4 as header by default', () => {
    const r = classifySingle(4, makeCells({ A: '1', H: 500000 }));
    expect(r.classification).not.toBe('header');
  });
});

// ────────────────────────────────────────────────────────────
// 2. Separator rows (all cells empty)
// ────────────────────────────────────────────────────────────

describe('classifyRows — separator detection', () => {
  it('classifies completely empty row as separator', () => {
    const r = classifySingle(10, makeCells());
    expect(r.classification).toBe('separator');
    expect(r.classificationConfidence).toBe(0.95);
  });

  it('classifies row with null/undefined/empty values as separator', () => {
    const r = classifySingle(10, makeCells({ A: null, B: undefined, C: '' }));
    expect(r.classification).toBe('separator');
  });

  it('does NOT treat row with any value as separator', () => {
    const r = classifySingle(10, makeCells({ C: 'some text' }));
    expect(r.classification).not.toBe('separator');
  });
});

// ────────────────────────────────────────────────────────────
// 3. Summary rows ("итого" / "всего")
// ────────────────────────────────────────────────────────────

describe('classifyRows — summary detection', () => {
  it('classifies "итого" with amounts as summary', () => {
    const r = classifySingle(15, makeCells({ C: 'Итого по разделу', H: 5000000 }));
    expect(r.classification).toBe('summary');
    expect(r.classificationConfidence).toBe(0.9);
  });

  it('classifies "ВСЕГО" (uppercase) with amounts as summary', () => {
    const r = classifySingle(20, makeCells({ C: 'ВСЕГО', I: 1000000 }));
    expect(r.classification).toBe('summary');
  });

  it('classifies "итого" WITHOUT amounts as header (not summary)', () => {
    const r = classifySingle(15, makeCells({ C: 'Итого' }));
    expect(r.classification).toBe('header');
    expect(r.classificationConfidence).toBe(0.7);
  });
});

// ────────────────────────────────────────────────────────────
// 4. Procurement rows (ID + amounts)
// ────────────────────────────────────────────────────────────

describe('classifyRows — procurement detection', () => {
  it('classifies row with numeric ID in A and amounts as procurement', () => {
    const r = classifySingle(5, makeCells({ A: '1', H: 500000, K: 500000 }));
    expect(r.classification).toBe('procurement');
    expect(r.classificationConfidence).toBe(0.9);
  });

  it('classifies row with numeric ID in B and amounts as procurement', () => {
    const r = classifySingle(5, makeCells({ B: '3', J: 250000 }));
    expect(r.classification).toBe('procurement');
  });

  it('classifies row with decimal amounts correctly', () => {
    const r = classifySingle(5, makeCells({ A: '2', H: '1500000.50' }));
    expect(r.classification).toBe('procurement');
  });

  it('classifies row with comma-decimal amounts', () => {
    const r = classifySingle(5, makeCells({ A: '2', H: '1500000,50' }));
    expect(r.classification).toBe('procurement');
  });
});

// ────────────────────────────────────────────────────────────
// 5. allSmallIntegers heuristic
// ────────────────────────────────────────────────────────────

describe('classifyRows — allSmallIntegers heuristic', () => {
  it('classifies row with all small integers in H-K as header (column numbers)', () => {
    const r = classifySingle(4, makeCells({ A: '1', H: 8, I: 9, J: 10, K: 11 }));
    expect(r.classification).toBe('header');
    expect(r.classificationConfidence).toBe(0.8);
    expect(r.classificationReasons[0]).toContain('малые целые');
  });

  it('does NOT trigger when amounts are >= 100', () => {
    const r = classifySingle(4, makeCells({ A: '1', H: 100, I: 200 }));
    expect(r.classification).toBe('procurement');
  });

  it('does NOT trigger when one value is large', () => {
    const r = classifySingle(4, makeCells({ A: '1', H: 5, I: 500000 }));
    expect(r.classification).toBe('procurement');
  });
});

// ────────────────────────────────────────────────────────────
// 6. Derived / service / note classifications
// ────────────────────────────────────────────────────────────

describe('classifyRows — other classifications', () => {
  it('classifies ID without amounts as procurement_derived', () => {
    // Must have non-empty C to avoid isHeaderMarker (empty C + no amounts = header)
    const r = classifySingle(5, makeCells({ A: '7', C: 'Описание закупки' }));
    expect(r.classification).toBe('procurement_derived');
    expect(r.classificationConfidence).toBe(0.6);
  });

  it('classifies amounts without ID as service', () => {
    const r = classifySingle(5, makeCells({ H: 300000 }));
    expect(r.classification).toBe('service');
    expect(r.classificationConfidence).toBe(0.5);
  });

  it('classifies text-only row as note', () => {
    const r = classifySingle(5, makeCells({ C: 'Примечание к закупке' }));
    expect(r.classification).toBe('note');
    expect(r.classificationConfidence).toBe(0.4);
  });

  it('classifies row with no ID, no amounts, no text as separator', () => {
    const r = classifySingle(5, makeCells({ D: null, E: '' }));
    expect(r.classification).toBe('separator');
  });
});

// ────────────────────────────────────────────────────────────
// 7. "раздел" / "блок" header markers
// ────────────────────────────────────────────────────────────

describe('classifyRows — section header markers', () => {
  it('classifies row with "раздел" in C as header', () => {
    const r = classifySingle(5, makeCells({ C: 'Раздел 1. Конкурентные закупки' }));
    expect(r.classification).toBe('header');
    expect(r.classificationConfidence).toBe(0.6);
  });

  it('classifies row with "блок" in C as header', () => {
    const r = classifySingle(5, makeCells({ C: 'Блок А' }));
    expect(r.classification).toBe('header');
  });
});

// ────────────────────────────────────────────────────────────
// 8. Multi-row classification
// ────────────────────────────────────────────────────────────

describe('classifyRows — batch processing', () => {
  it('processes multiple rows and preserves order', () => {
    const rows = [
      { rowIndex: 1, cells: makeCells({ C: 'Заголовок' }) },
      { rowIndex: 5, cells: makeCells({ A: '1', H: 500000 }) },
      { rowIndex: 10, cells: makeCells({}) },
      { rowIndex: 15, cells: makeCells({ C: 'Итого', K: 1000000 }) },
    ];
    const result = classify('Лист1', rows);
    expect(result).toHaveLength(4);
    expect(result[0].classification).toBe('header');
    expect(result[1].classification).toBe('procurement');
    expect(result[2].classification).toBe('separator');
    expect(result[3].classification).toBe('summary');
  });

  it('returns empty array for empty input', () => {
    const result = classify('Лист1', []);
    expect(result).toEqual([]);
  });

  it('preserves sheet name in all results', () => {
    const rows = [
      { rowIndex: 5, cells: makeCells({ A: '1', H: 100000 }) },
      { rowIndex: 6, cells: makeCells({ A: '2', H: 200000 }) },
    ];
    const result = classify('СВОД ТД-ПМ', rows);
    expect(result.every(r => r.sheet === 'СВОД ТД-ПМ')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// 9. Edge cases
// ────────────────────────────────────────────────────────────

describe('classifyRows — edge cases', () => {
  it('handles row with all zeros', () => {
    const r = classifySingle(5, makeCells({ A: 0, B: 0, H: 0, I: 0, J: 0, K: 0 }));
    // 0 is numeric but isNumeric('0') should be true via typeof number check
    // A=0 is numeric, but H/I/J/K=0 are also numeric → hasAmounts true
    // allSmallIntegers → all <100 and >=0 → header
    expect(r.classification).toBe('header');
  });

  it('handles minimal row with ID and name but no amounts', () => {
    // A=42 (numeric ID) + C has text → procurement_derived (no amounts)
    const r = classifySingle(5, makeCells({ A: '42', C: 'Закупка' }));
    expect(r.classification).toBe('procurement_derived');
  });

  it('handles minimal row with only ID (no name, no amounts) as header', () => {
    // A=42 but C empty and no amounts → isHeaderMarker fires (empty C + !hasAmounts)
    const r = classifySingle(5, makeCells({ A: '42' }));
    expect(r.classification).toBe('header');
  });

  it('handles row where only C has data', () => {
    const r = classifySingle(5, makeCells({ C: 'Описание' }));
    expect(r.classification).toBe('note');
  });

  it('classificationReasons is always a non-empty array for non-header early-exit', () => {
    const r = classifySingle(5, makeCells({ A: '1', H: 500000 }));
    expect(r.classificationReasons.length).toBeGreaterThan(0);
  });
});
