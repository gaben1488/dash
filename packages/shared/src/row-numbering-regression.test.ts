import { describe, expect, it } from 'vitest';
import type { ClassifiedRow } from './types.js';
import { RULE_BOOK } from './rule-book.js';

const rule = RULE_BOOK.find(item => item.id === 'row_numbering');
if (!rule) throw new Error('row_numbering отсутствует в RULE_BOOK');

function entry(rowIndex: number, label: string, kind: ClassifiedRow['classification'] = 'procurement'): ClassifiedRow {
  return {
    rowIndex, sheet: 'УО', classification: kind, classificationConfidence: 1,
    classificationReasons: [], cells: { A: label, G: kind === 'service' ? '' : 'Реальная закупка', L: kind === 'service' ? '' : 'ЭА', K: kind === 'service' ? 0 : 10 },
  };
}
function verify(rows: ClassifiedRow[]) {
  return rule!.check({ rowIndex: rows[0].rowIndex, cells: rows[0].cells, sheet: 'УО', classification: rows[0].classification, allRows: rows });
}

describe('знаки / в номере позиции и формульные хвосты', () => {
  it('не считает 173, 173/1 и 173/2 одинаковыми', () => {
    expect(verify([entry(4,'173'), entry(5,'173/1'), entry(6,'173/2')]).passed).toBe(true);
  });
  it('называет настоящие дубли составной метки', () => {
    const outcome = verify([entry(4,'173/18'), entry(5,'173/18')]);
    expect(outcome.passed).toBe(false);
    expect(outcome.message).toContain('173/18');
  });
  it('не требует номера у нулевой формулы в пустом резерве', () => {
    expect(verify([entry(4,'1'), entry(5,'','service')]).passed).toBe(true);
  });
  it('по-прежнему сообщает об отсутствии A у заполненной позиции', () => {
    const row = entry(5,'','service');
    row.cells.G = 'Поставка расходных материалов';
    row.cells.L = 'ЭА';
    const outcome = verify([entry(4,'1'),row]);
    expect(outcome.passed).toBe(false);
    expect(outcome.message).toContain('5');
  });
});
