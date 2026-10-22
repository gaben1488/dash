import { describe, expect, it } from 'vitest';
import type { BookFormulaVerdict } from './formula-sink.js';
import type { FormulaDeliveryNote } from './source-refresh.js';
import { assessFormulaResults } from './formula-assessment.js';

const FIRST = '2026-10-22T01:00:00.000Z';
const NEXT = '2026-10-22T02:00:00.000Z';
function delivery(book: string, at = FIRST): FormulaDeliveryNote {
  return { book, at, handled: true, persisted: true, formulasRead: true, cells: 11 };
}
function verdict(book: string, at = FIRST, expected = 11, checked = 11, failed = 0): BookFormulaVerdict {
  return {
    book, at, rowsJudged: 1, checks: { expected, checked, failed },
    defects: Array.from({ length: failed }, (_, n) => ({
      book, kind: 'formula_overwritten' as const, column: 'K' as const, row: n + 4,
      cell: `K${n + 4}`, rowSeq: String(n + 1), actual: '0', etalon: '=H4+I4', etalonRow: 4,
    })),
  };
}

describe('assessment after independent formula reading', () => {
  it('shows the weighted check score when every expected book was fully analyzed and persisted', () => {
    const assessment = assessFormulaResults(['УО', 'УИО'], [delivery('УО'), delivery('УИО')],
      [verdict('УО', FIRST, 110, 110, 11), verdict('УИО')]);
    expect(assessment).toMatchObject({
      expectedBooks: 2, checkedBooks: 2,
      score: 91, checks: { expected: 121, checked: 121, failed: 11 },
    });
  });

  it('updates from the latest manual or nightly recheck even when book values are unchanged', () => {
    const before = assessFormulaResults(['УО'], [delivery('УО')], [verdict('УО')]);
    const after = assessFormulaResults(['УО'], [delivery('УО', NEXT)], [verdict('УО', NEXT, 11, 11, 2)]);
    expect(before.score).toBe(100);
    expect(after.score).toBe(82);
    expect(after.checkedAt).toBe(NEXT);
  });

  it('never revives a previous clean verdict after a later failed read', () => {
    const assessment = assessFormulaResults(['УО'], [{ ...delivery('УО', NEXT), handled: false, formulasRead: false }],
      [verdict('УО', FIRST)]);
    expect(assessment.score).toBeNull();
    expect(assessment.checkedBooks).toBe(0);
    expect(assessment.books[0].checkedAt).toBeNull();
  });

  it('holds back the total if a book is missing, the parser is unpersisted, or the columns are incomplete', () => {
    const missing = assessFormulaResults(['УО', 'УИО'], [delivery('УО')], [verdict('УО')]);
    expect(missing).toMatchObject({ checkedBooks: 1, expectedBooks: 2, score: null });

    const unpersisted = assessFormulaResults(['УО'], [{ ...delivery('УО'), persisted: false }], [verdict('УО')]);
    expect(unpersisted.score).toBeNull();

    const partial = assessFormulaResults(['УО'], [delivery('УО')], [verdict('УО', FIRST, 11, 8)]);
    expect(partial.score).toBeNull();

    const previousVersion = assessFormulaResults(['УО'], [delivery('УО')],
      [{ book: 'УО', at: FIRST, rowsJudged: 1, defects: [] }]);
    expect(previousVersion.score).toBeNull();
  });

  it('invalidates last good grade after a later changed-source values-only read', () => {
    const good = assessFormulaResults(['УО'], [delivery('УО')], [verdict('УО')], { 'УО': true });
    const changed = assessFormulaResults(['УО'], [delivery('УО')], [verdict('УО')], { 'УО': false });
    expect(good.score).toBe(100);
    expect(changed.score).toBeNull();
    expect(changed.checkedBooks).toBe(0);
  });

  it('does not invent a clean score for an empty book set', () => {
    expect(assessFormulaResults([], [], [])).toMatchObject({
      expectedBooks: 0, checkedBooks: 0, score: null,
    });
  });
});
