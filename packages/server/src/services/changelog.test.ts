/**
 * Разбор «_ChangeLog»: обе живые схемы, человеческий атрибут, срез по времени.
 * Примеры строк — дословно из аудита 30.07 (книги УД и УАГЗО).
 */
import { describe, expect, it } from 'vitest';
import { changeEntryIdentity, changesSince, parseChangeLog, parseChangeLogDetailed } from './changelog.js';

describe('parseChangeLog', () => {
  it('8-колоночная схема: пример УД из аудита, атрибут по живой шапке', () => {
    const rows = [
      ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'],
      ['ВСЕ', 'L178', '12', '177', 'ЕП', 'ЭА', '06.04.2026 17:39:02', 'sterhova341@gmail.com'],
    ];
    const [r] = parseChangeLog(rows, 'УД');
    expect(r).toMatchObject({
      dept: 'УД',
      sheet: 'ВСЕ',
      cell: 'L178',
      attribute: 'Способ определения поставщика (ЭА и аналоги/ЕП)',
      oldValue: 'ЕП',
      newValue: 'ЭА',
      author: 'sterhova341@gmail.com',
    });
    expect(new Date(r.atMs).toISOString()).toBe('2026-04-06T17:39:02.000Z');
  });

  it('6-колоночная схема УАГЗО распознаётся по строке, не по шапке', () => {
    const rows = [
      ['Q45', '', '15.07.2026', '10.07.2026 09:12', 'op@elizovomr.ru', 'pending'],
    ];
    const [r] = parseChangeLog(rows, 'УАГЗО');
    expect(r.cell).toBe('Q45');
    expect(r.attribute).toContain('Фактический');
    expect(r.newValue).toBe('15.07.2026');
    expect(r.author).toBe('op@elizovomr.ru');
  });

  it('шапка и мусор без времени пропускаются молча', () => {
    const rows = [
      ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'],
      ['', '', '', ''],
    ];
    expect(parseChangeLog(rows, 'УО')).toHaveLength(0);
  });

  it('неизвестная колонка даёт пустой атрибут, не выдуманный', () => {
    const rows = [
      ['ВСЕ', 'ZZ9', '', '', 'a', 'b', '01.07.2026 10:00:00', 'x@y'],
    ];
    expect(parseChangeLog(rows, 'УО')[0].attribute).toBe('');
  });
});


describe('live _ChangeLog timestamp and cell variants', () => {
  it('keeps two date-only changes of one cell as separate source events', () => {
    const rows = [
      ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'],
      ['ВСЕ', 'L178', '12', '177', 'ЕП', 'ЭА', '22.10.2026', 'operator'],
      ['ВСЕ', 'L178', '12', '177', 'ЭА', 'ЕП', '22.10.2026', 'operator'],
    ];
    const found = parseChangeLog(rows, 'УО');
    expect(found).toHaveLength(2);
    expect(found.map((r) => [r.timePrecision, r.sourceOccurrence])).toEqual([['day', 0], ['day', 0]]);
    expect(found[0].atMs).toBe(Date.UTC(2026, 9, 22));
    expect(found[1].oldValue).toBe('ЭА');
  });

  it('recognizes single-digit hours and comma-delimited timestamps', () => {
    const rows = [
      ['ВСЕ', 'K113', '11', '2156', '', '684', '08.04.2026 9:09:54', 'operator'],
      ['ВСЕ', 'K113', '11', '2156', '684', '685', '10.09.2026, 17:21:15', 'operator'],
    ];
    const found = parseChangeLog(rows, 'УО');
    expect(found).toHaveLength(2);
    expect(found[0].atMs).toBe(Date.UTC(2026, 3, 8, 9, 9, 54));
    expect(found[1].atMs).toBe(Date.UTC(2026, 8, 10, 17, 21, 15));
    expect(found.every((r) => r.timePrecision === undefined)).toBe(true);
  });

  it('reads prefixed six-column addresses without inventing row keys', () => {
    const [r] = parseChangeLog([
      ['УАГЗО!B48', 'old', 'new', '06.04.2026 12:58:16', 'operator', 'sent'],
    ], 'УАГЗО');
    expect(r).toMatchObject({ sheet: 'УАГЗО', cell: 'B48', oldValue: 'old', newValue: 'new' });
  });

  it('rejects impossible dates and does not invent per-cell edits for range events', () => {
    expect(parseChangeLog([
      ['ВСЕ', 'K113', '11', '2156', '', '684', '31.02.2026', 'operator'],
      ['Контроль', 'A1:C12', '(пакет)', '', '', '36 cells', '10.09.2026, 17:21:15', 'script'],
    ], 'УО')).toEqual([]);
  });
});


describe('source identity, completeness and calendar precision', () => {
  const header = ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'];
  const a = ['ВСЕ', 'L178', '12', '177', 'ЕП', 'ЭА', '22.10.2026', 'operator'];
  const b = ['ВСЕ', 'L178', '12', '177', 'ЭА', 'ЕП', '22.10.2026', 'operator'];
  const c = ['ВСЕ', 'L179', '12', '178', '', 'ЕП', '22.10.2026', 'operator'];

  it('keeps date-only IDs invariant when unrelated rows are inserted or reordered', () => {
    const original = parseChangeLog([header, a, b, c], 'УО');
    const shuffled = parseChangeLog([header, c, b, ['ВСЕ', 'K1', '', '', '1', '2', '21.10.2026', 'other'], a], 'УО');
    const ids = (records: typeof original) => new Map(records.map(r => [r.cell + ':' + r.oldValue, changeEntryIdentity(r)]));
    const left = ids(original);
    const right = ids(shuffled);
    for (const [label, id] of left) expect(right.get(label)).toBe(id);
    expect(new Set(left.values()).size).toBe(3);
  });

  it('distinguishes repeated identical day-only edits by content occurrence', () => {
    const parsed = parseChangeLog([header, a, c, a], 'УО');
    expect(parsed.map(x => x.sourceOccurrence)).toEqual([0, 0, 1]);
    expect(new Set(parsed.map(changeEntryIdentity)).size).toBe(3);
    const moved = parseChangeLog([header, a, a, c], 'УО');
    expect(parsed.map(changeEntryIdentity).sort()).toEqual(moved.map(changeEntryIdentity).sort());
  });

  it('does not expose private old/new values as plaintext in new IDs', () => {
    const [first] = parseChangeLog([header, a], 'УО');
    const key = changeEntryIdentity(first);
    expect(key).toMatch(/^journal-day-v2:[a-f0-9]{64}:0$/);
    expect(key).not.toContain('operator');
    expect(key).not.toContain('ЕП');
  });

  it('preserves exact-time legacy IDs, including the source clock encoding', () => {
    const [first] = parseChangeLog([
      header,
      ['ВСЕ', 'K113', '11', '2156', '', '684', '08.04.2026 9:09:54', 'operator'],
    ], 'УО');
    expect(changeEntryIdentity(first)).toBe(
      ['УО', 'ВСЕ', 'K113', Date.UTC(2026, 3, 8, 9, 9, 54), 'operator'].join('|'),
    );
    expect(first.timePrecision).toBeUndefined();
  });

  it('surfaces bulk operations and unreadable times as coverage gaps', () => {
    const { records, coverage } = parseChangeLogDetailed([
      header, a,
      ['Контроль', 'A1:C12', '(пакет)', '36', '', 'batchUpdate', '10.09.2026, 17:21:15', 'script'],
      ['ВСЕ', 'L179', '12', '177', 'old', 'new', '31.02.2026', 'operator'],
      [],
    ], 'УО');
    expect(records).toHaveLength(1);
    expect(coverage).toEqual({
      rawRows: 5, parsed: 1, dayOnly: 1, unparsed: 2, nonCell: 1, invalidTime: 1,
    });
  });

  it('does not invent an event time when source only supplies a date', () => {
    const [record] = parseChangeLog([header, a], 'УО');
    expect(record.timePrecision).toBe('day');
    expect(record.atMs).toBe(Date.UTC(2026, 9, 22));
    expect(record.sourceOccurrence).toBe(0);
  });
});

describe('changesSince', () => {
  it('фильтрует по моменту среза и сортирует свежие сверху', () => {
    const mk = (atMs: number) => ({
      dept: 'УО', sheet: 'ВСЕ', cell: 'L4', attribute: '', oldValue: '', newValue: '', atMs, author: '',
    });
    const out = changesSince([mk(100), mk(300), mk(200)], 150);
    expect(out.map((r) => r.atMs)).toEqual([300, 200]);
  });
});
