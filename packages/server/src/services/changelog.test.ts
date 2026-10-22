/**
 * Разбор «_ChangeLog»: обе живые схемы, человеческий атрибут, срез по времени.
 * Примеры строк — дословно из аудита 30.07 (книги УД и УАГЗО).
 */
import { describe, expect, it } from 'vitest';
import { changeEntryIdentity, changesSince, parseChangeLog, parseChangeLogDetailed } from './changelog.js';

describe('parseChangeLog', () => {
  it('keeps actual seconds from a live date-only formatted timestamp', () => {
    const [entry] = parseChangeLog([['ВСЕ', 'A2853', 1, 3209, '', 3209, 46315.70350991898, 'Автор']], 'УО');
    expect(new Date(entry.atMs).toISOString()).toBe('2026-10-20T16:53:03.000Z');
  });
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


describe('source-wide journal contract: precision, coverage and identity', () => {
  const header = ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'];
  const first = ['ВСЕ', 'L178', '12', '177', 'ЕП', 'ЭА', '22.10.2026', 'operator'];
  const second = ['ВСЕ', 'L178', '12', '177', 'ЭА', 'ЕП', '22.10.2026', 'operator'];

  it('accepts date-only / unpadded / comma time and sheet-qualified legacy addresses', () => {
    const data = parseChangeLogDetailed([header,
      first,
      ['ВСЕ', 'K100', '', '', '1', '2', '08.04.2026 9:09:54', 'operator'],
      ['ВСЕ', 'K100', '', '', '2', '3', '10.09.2026, 17:21:15', 'operator'],
      ['УАГЗО!B48', 'old', 'new', '06.04.2026 12:58:16', null, 'sent'],
    ], 'УО');
    expect(data.coverage).toMatchObject({ parsed: 4, dayOnly: 1, unparsed: 0 });
    expect(data.records[0]).toMatchObject({ cell: 'L178', timePrecision: 'day', sourceOccurrence: 0 });
    expect(data.records[1].atMs).toBe(Date.UTC(2026, 3, 8, 9, 9, 54));
    expect(data.records[2].atMs).toBe(Date.UTC(2026, 8, 10, 17, 21, 15));
    expect(data.records[3]).toMatchObject({ sheet: 'УАГЗО', cell: 'B48' });
  });

  it('preserves existing exact-time IDs and stable day-only content multisets', () => {
    const a = parseChangeLog([header, first, second, first], 'УО');
    const b = parseChangeLog([second, first, first, header], 'УО');
    expect(a.map(changeEntryIdentity).sort()).toEqual(b.map(changeEntryIdentity).sort());
    expect(new Set(a.map(changeEntryIdentity)).size).toBe(3);
    expect(a.map(e => e.sourceOccurrence)).toEqual([0, 0, 1]);
    expect(a[0].timePrecision).toBe('day');
    const [precise] = parseChangeLog([['ВСЕ', 'L178', 12, 177, 'ЕП', 'ЭА', '22.10.2026 9:01:05', 'op']], 'УО');
    expect(changeEntryIdentity(precise)).toMatch(/^УО\|ВСЕ\|L178\|\d+\|op\|values:[a-f0-9]{64}$/);
  });

  it('does not hide failed timestamps or pretend bulk operations are cell edits', () => {
    const data = parseChangeLogDetailed([
      header, first,
      ['ВСЕ', 'L179', '', '', 'old', 'new', '31.02.2026', 'op'],
      ['Контроль', 'A1:C12', '(пакет)', '36', '', 'values.batchUpdate', '10.09.2026, 17:21:15', 'script'],
      [],
    ], 'УД');
    expect(data.records).toHaveLength(1);
    expect(data.coverage).toEqual({
      rawRows: 5, parsed: 1, dayOnly: 1, unparsed: 2,
      nonCell: 1, invalidTime: 1, indistinguishableDuplicates: 0,
    });
  });

  it('includes uncertain same-day edits at a 18:00 cutoff without claiming their hour', () => {
    const day = Date.UTC(2026, 9, 22);
    const rows = parseChangeLog([header, first,
      ['ВСЕ', 'L180', '', '', 'a', 'b', '22.10.2026 17:59:59', 'op'],
      ['ВСЕ', 'L181', '', '', 'a', 'b', '22.10.2026 18:00:01', 'op'],
    ], 'УО');
    const after = changesSince(rows, day + 18 * 3600000);
    expect(after.map(r => r.cell)).toEqual(['L181', 'L178']);
    expect(after[1].timePrecision).toBe('day');
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
