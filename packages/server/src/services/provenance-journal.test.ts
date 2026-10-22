import { describe, expect, it } from 'vitest';
import { parseProvenanceJournal } from './provenance-journal.js';

describe('shared _ChangeLog coverage for provenance and change story', () => {
  it('reads sheet-qualified six-column entries without inventing procurement keys', () => {
    const { records, rowKeyless } = parseProvenanceJournal([
      ['Ячейка', 'Было', 'Стало', 'Время', 'Автор', 'Статус'],
      ['УАГЗО!B48', 'old', 'new', '06.04.2026 12:58:16', 'editor', 'sent'],
    ]);
    expect(rowKeyless).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sheet: 'УАГЗО', cell: 'B48', row: '', was: 'old', became: 'new',
      at: '06.04.2026 12:58:16', author: 'editor',
    });
  });

  it('keeps the full eight-column business row key unchanged', () => {
    const { records, rowKeyless } = parseProvenanceJournal([
      ['ВСЕ', 'L178', '12', '177', 'ЕП', 'ЭА', '06.04.2026 17:39:02', 'editor'],
    ]);
    expect(rowKeyless).toBe(0);
    expect(records[0]).toMatchObject({ sheet: 'ВСЕ', cell: 'L178', row: '177' });
  });

  it('never converts range deletion or bulk operations into fabricated cell edits', () => {
    const { records } = parseProvenanceJournal([
      ['Контроль', 'A1:C12', '(пакет)', '36', '', 'batch update', '10.09.2026, 17:21:15', 'script'],
      ['GOOGLE_ФОРМУЛЫ', '—', '', '', '', 'deleteSheet×1', '10.09.2026, 19:37:12', 'script'],
    ]);
    expect(records).toHaveLength(0);
  });
});
