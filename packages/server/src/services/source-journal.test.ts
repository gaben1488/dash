import { describe, expect, it } from 'vitest';
import { normalizeSourceJournal } from './source-journal.js';
import { changeRecordsFromJournal, changesSinceLocalClock } from './changelog.js';
import { provenanceFromJournal } from './provenance-journal.js';

describe('one source normalization for journal, provenance and change story', () => {
  const mixed = [
    ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'],
    ['ВСЕ', 'L178', 'Способ', '№ 175', 'ЕП', 'ЭА', '08.04.2026 9:09:54', 'a@example.test'],
    ['Ячейка', 'Было', 'Стало', 'Время', 'Автор', 'Статус'],
    ['УАГЗО!B48', 'old', 'new', '10.09.2026, 17:21:15', 'b@example.test', 'sent'],
    ['ВСЕ', 'K22', 'Сумма', '№ 22', 1, 2, '22.10.2026', 'b@example.test'],
    ['ВСЕ', 'K22', 'Сумма', '№ 22', 2, 3, '31.02.2026', 'b@example.test'],
    ['Контроль', 'A1:C12', '(пакет)', 'диапазонов: 1', '', '', '10.09.2026, 17:21:15', 'script'],
    [],
  ] as const;

  it('captures each live schema and every gap without treating bulk edits as individual cells', () => {
    const parsed = normalizeSourceJournal(mixed);
    expect(parsed.coverage).toMatchObject({
      rawRows: 8, headers: 2, blanks: 1, cellRows: 4, sixColumn: 1,
      eightColumn: 3, exactTime: 2, dayOnly: 1, invalidTime: 1, nonCell: 1,
      deliveryUnverified: true,
    });
    expect(parsed.cells[0]).toMatchObject({
      sheet: 'ВСЕ', cell: 'L178', rowKey: '№ 175', journalRow: 2,
    });
    expect(parsed.cells[1]).toMatchObject({
      sheet: 'УАГЗО', cell: 'B48', rowKey: '', journalRow: 4,
    });
    expect(parsed.cells[2].instant?.precision).toBe('day');
  });

  it('projects a single acquisition into the two existing consumers with no invented business row key', () => {
    const normalized = normalizeSourceJournal(mixed);
    const changes = changeRecordsFromJournal(normalized, 'УО');
    const plan = provenanceFromJournal(normalized, { spreadsheetId: 'book-uo', at: 1000 });
    expect(changes.records).toHaveLength(3); // invalid source date is not a timed change
    expect(plan.records).toHaveLength(4); // provenance retains the raw erroneous source record
    expect(plan.rowKeyless).toBe(1);
    expect(plan.records[0].row).toBe('№ 175');
    expect(plan.records[1].row).toBe('');
    expect(plan.records[1].source).toMatchObject({ journalSheet: '_ChangeLog', journalRow: 4 });
    expect(changes.coverage.invalidTime).toBe(1);
    expect(changes.records[1]).toMatchObject({ sheet: 'УАГЗО', cell: 'B48' });
  });

  it('preserves distinct same-day cell transitions and stable identities after unrelated row inserts', () => {
    const header = ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'];
    const a = ['ВСЕ', 'N5', 'Дата', '№ 2', 'Х', '01.11.2026', '22.10.2026', 'operator'];
    const b = ['ВСЕ', 'N5', 'Дата', '№ 2', '01.11.2026', '02.11.2026', '22.10.2026', 'operator'];
    const signature = (rows: unknown[][]) =>
      changeRecordsFromJournal(normalizeSourceJournal(rows), 'УО').records
        .filter(r => r.cell === 'N5').map(r => r.eventId);
    const original = signature([header, a, b, a]);
    const shifted = signature([header, ['ВСЕ', 'Y42', '', '', '', '', '22.10.2026', 'x'], b, a, a]);
    expect(original).toHaveLength(3);
    expect(new Set(original).size).toBe(3);
    expect(shifted.filter(x => x === original[1])).toHaveLength(1);
    expect(shifted.filter(x => x === original[0] || x === original[2])).toHaveLength(2);
    expect(original.every(id => id?.startsWith('journal-clock-v3:'))).toBe(true);
  });

  it('does not assign 00:00 to undated boundary events or exclude them with fabricated precision', () => {
    const dayStart = Date.UTC(2026, 9, 22);
    const cutoff = dayStart + 18 * 3600_000;
    const mk = (atMs: number, timePrecision: 'day' | 'second') => ({
      dept: 'УО', sheet: 'ВСЕ', cell: 'N5', attribute: '',
      oldValue: '', newValue: '', atMs, author: 'x', timePrecision,
    });
    const rows = changesSinceLocalClock([
      mk(dayStart, 'day'), mk(dayStart + 10 * 3600_000, 'second'),
      mk(dayStart + 19 * 3600_000, 'second'),
    ], dayStart, cutoff);
    expect(rows).toHaveLength(2);
    expect(rows.some(r => r.timePrecision === 'day')).toBe(true);
    expect(rows.some(r => r.atMs === dayStart + 10 * 3600_000)).toBe(false);
  });
});
