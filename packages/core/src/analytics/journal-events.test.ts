import { describe, expect, it } from 'vitest';
import { classifyJournalEvents, sheetRowOfCell, type JournalEntry } from './journal-events.js';

/** Живой образец добавления: УКСиМП, строка 95, 09.04.2026 16:08, 7 ячеек. */
function addedRow(row: number, at: string, cols: string[]): JournalEntry[] {
  return cols.map((c) => ({ cell: `${c}${row}`, was: '', became: 'значение', at, author: 'оператор' }));
}

describe('три рода событий над строкой (канон п.105)', () => {
  it('заполнение пустой строки целиком — добавление закупки, не семь правок', () => {
    const s = classifyJournalEvents(addedRow(95, '09.04.2026 16:08', ['A', 'C', 'G', 'H', 'J', 'K', 'L']));
    expect(s.added).toBe(1);
    expect(s.edits).toBe(0);
    expect(s.events[0].kind).toBe('row-added');
    expect(s.events[0].cells).toBe(7);
    expect(s.events[0].sheetRow).toBe(95);
  });

  it('обнуление занятой строки — очистка, и она не выдаётся за удаление', () => {
    const entries: JournalEntry[] = ['C', 'G', 'H', 'J', 'K', 'L'].map((c) => ({
      cell: `${c}300`, was: 'было', became: '', at: '10.05.2026 11:00',
    }));
    const s = classifyJournalEvents(entries);
    expect(s.cleared).toBe(1);
    expect(s.events[0].kind).toBe('row-cleared');
    expect(s.added).toBe(0);
  });

  it('две-три ячейки за раз — обычные правки, а не событие строки', () => {
    const s = classifyJournalEvents([
      { cell: 'N155', was: '15.08.2026', became: '20.08.2026', at: '11.08.2026 09:00' },
      { cell: 'Q155', was: '', became: '11.08.2026', at: '11.08.2026 09:00' },
    ]);
    expect(s.added).toBe(0);
    expect(s.cleared).toBe(0);
    expect(s.edits).toBe(2);
  });

  it('события разных минут по одной строке не слипаются', () => {
    const s = classifyJournalEvents([
      ...addedRow(95, '09.04.2026 16:08', ['A', 'C', 'G', 'H', 'J']),
      ...addedRow(95, '09.04.2026 16:10', ['K', 'L', 'M', 'N', 'O']),
    ]);
    expect(s.added).toBe(2);
  });

  it('удаления строк объявлены ненаблюдаемыми — ноль не читается как «не было»', () => {
    const s = classifyJournalEvents(addedRow(1, '01.01.2026 10:00', ['A', 'C', 'G', 'H', 'J']));
    expect(s.deletionsUnobservable).toBe(true);
    expect(s.note).toContain('Удаление');
    expect(s.note).toContain('снимков');
  });

  it('мусорные адреса и пустой журнал не ломают разбор', () => {
    const s = classifyJournalEvents([
      { cell: 'не адрес', was: 'a', became: 'b', at: '01.01.2026' },
      { cell: '', was: '', became: '', at: '' },
    ]);
    expect(s.events).toEqual([]);
    expect(classifyJournalEvents([]).added).toBe(0);
  });

  it('номер строки читается из адреса, мусор даёт null', () => {
    expect(sheetRowOfCell('J96')).toBe(96);
    expect(sheetRowOfCell('AG1481')).toBe(1481);
    expect(sheetRowOfCell('строка 5')).toBeNull();
  });
});
