/**
 * Разбор «_ChangeLog»: обе живые схемы, человеческий атрибут, срез по времени.
 * Примеры строк — дословно из аудита 30.07 (книги УД и УАГЗО).
 */
import { describe, expect, it } from 'vitest';
import { changesSince, parseChangeLog } from './changelog.js';

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

describe('changesSince', () => {
  it('фильтрует по моменту среза и сортирует свежие сверху', () => {
    const mk = (atMs: number) => ({
      dept: 'УО', sheet: 'ВСЕ', cell: 'L4', attribute: '', oldValue: '', newValue: '', atMs, author: '',
    });
    const out = changesSince([mk(100), mk(300), mk(200)], 150);
    expect(out.map((r) => r.atMs)).toEqual([300, 200]);
  });
});
