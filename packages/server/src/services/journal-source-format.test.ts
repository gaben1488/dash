import { describe, expect, it } from 'vitest';
import { decodeSourceJournal, sourceTimestampPrecision } from './journal-source-format.js';

describe('single _ChangeLog source grammar', () => {
  it('decodes real mixed 8/6 layouts without dropping row provenance', () => {
    const eight = ['ВСЕ', 'L178', 12, '№ 177', 'ЕП', 'ЭА', '06.04.2026 17:39:02', 'editor'];
    const six = ['УАГЗО!B48', 'old', 'new', '06.04.2026 12:58:16', null, 'sent'];
    const data = decodeSourceJournal([
      ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'],
      [], eight, ['Ячейка', 'Было', 'Стало', 'Время', 'Автор', 'Статус'], six,
    ]);
    expect(data).toMatchObject({ rawRows: 5, nonCell: 0, emptyOrHeader: 3, rowKeyless: 1 });
    expect(data.cells).toHaveLength(2);
    expect(data.cells[0]).toMatchObject({
      schema: 'eight', journalRow: 3, sheet: 'ВСЕ', cell: 'L178',
      rowKey: '№ 177', was: 'ЕП', became: 'ЭА', author: 'editor',
    });
    expect(data.cells[1]).toMatchObject({
      schema: 'six', journalRow: 5, sheet: 'УАГЗО', cell: 'B48',
      rowKey: '', was: 'old', became: 'new',
    });
  });

  it('never mistakes a six-column old value resembling an address for the edited cell', () => {
    const [event] = decodeSourceJournal([
      ['УАГЗО!B48', 'C12', 'replacement', '22.10.2026', 'operator', 'sent'],
    ]).cells;
    expect(event).toMatchObject({
      schema: 'six', sheet: 'УАГЗО', cell: 'B48', was: 'C12',
      became: 'replacement', rowKey: '',
    });
  });

  it('cannot invent cell events for a range write or a sheet deletion', () => {
    const rows = [
      ['Контроль', 'A1:C12', '(пакет)', '', '', 'values.batchUpdate', '10.09.2026, 17:21:15'],
      ['GOOGLE_ФОРМУЛЫ', '—', '(пакет)', '', '', 'deleteSheet×1', '10.09.2026, 19:37:12'],
      ['ВСЕ', 'L0', '', '', '', 'x', '22.10.2026'],
    ];
    const result = decodeSourceJournal(rows);
    expect(result).toMatchObject({ nonCell: 3, rowKeyless: 0 });
    expect(result.cells).toEqual([]);
  });

  it('keeps raw money and time values unchanged for downstream parsers', () => {
    const raw = [['ВСЕ', 'H7', 8, 173, { n: 5 }, 123.45, 46315.70350991898, null]];
    const value = decodeSourceJournal(raw).cells[0];
    expect(value.was).toBe(raw[0][4]);
    expect(value.at).toBe(raw[0][6]);
    expect(sourceTimestampPrecision(value.at)).toBe('exact');
    expect(raw[0][4]).toEqual({ n: 5 });
  });

  it('separates date-only calendar anchors from observed clock instants', () => {
    expect(sourceTimestampPrecision('22.10.2026')).toBe('day');
    expect(sourceTimestampPrecision('2026-10-22')).toBe('day');
    expect(sourceTimestampPrecision(46315)).toBe('day');
    expect(sourceTimestampPrecision('08.04.2026 9:09:54')).toBe('exact');
    expect(sourceTimestampPrecision('10.09.2026, 17:21:15')).toBe('exact');
    expect(sourceTimestampPrecision(46315.7035)).toBe('exact');
  });
});
