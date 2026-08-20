import { describe, it, expect, afterEach } from 'vitest';
import { DEPT_HEADER_ROWS } from '@aemr/shared';
import { diffBook, isSilent, setChangeAuthorResolver, MAX_ROW_EVENTS } from './live-diff.js';

/**
 * Страж сравнения двух чтений книги — материала живых событий.
 *
 * Главное, что здесь защищается, — честность: первое чтение НЕ объявляется
 * изменением всего листа, сдвиг строк не выдаётся за сотню правок, а автор
 * подставляется только тогда, когда журнал его знает.
 */

/** Лист книги: три строки шапки плюс названные строки данных. */
function sheet(...dataRows: unknown[][]) {
  const header = Array.from({ length: DEPT_HEADER_ROWS }, () => ['шапка']);
  return { values: [...header, ...dataRows] };
}

afterEach(() => {
  setChangeAuthorResolver(null);
});

describe('сравнение двух чтений книги', () => {
  it('первое чтение не объявляет изменением весь лист — тишина на старте', () => {
    const diff = diffBook('УО', null, sheet(['1', 'УО АЕМР'], ['2', 'УО АЕМР']));

    expect(isSilent(diff)).toBe(true);
    expect(diff.changedRows).toBe(0);
    expect(diff.rows).toEqual([]);
    expect(diff.rowsTotal).toBe(DEPT_HEADER_ROWS + 2);
  });

  it('совпавшие чтения — тишина, а не событие «книга обновилась»', () => {
    const before = sheet(['1', 'УО АЕМР', '', '', '', '', 'Ремонт']);
    const after = sheet(['1', 'УО АЕМР', '', '', '', '', 'Ремонт']);

    expect(isSilent(diffBook('УО', before, after))).toBe(true);
  });

  it('правка ячейки даёт адрес, название колонки по живой шапке и было → стало', () => {
    const before = sheet(['155', 'УО АЕМР', '', '', '', '', 'Опрессовка', '', '', '', '', 'ЕП']);
    const after = sheet(['155', 'УО АЕМР', '', '', '', '', 'Опрессовка', '', '', '', '', 'ЭА']);

    const diff = diffBook('УО', before, after);

    expect(diff.changedRows).toBe(1);
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0]).toMatchObject({
      kind: 'row-changed',
      book: 'УО',
      sheetRow: DEPT_HEADER_ROWS + 1,
      rowSeq: '155',
      column: 'L',
      before: 'ЕП',
      after: 'ЭА',
    });
    // Название колонки — из живой шапки, а не буква для посвящённых.
    expect(diff.rows[0].columnLabel).toContain('Способ определения поставщика');
  });

  it('шапка не сравнивается: её правка не выдаётся за правку закупки', () => {
    const before = { values: [['шапка'], ['шапка'], ['старая подпись'], ['1', 'УО АЕМР']] };
    const after = { values: [['шапка'], ['шапка'], ['новая подпись'], ['1', 'УО АЕМР']] };

    expect(isSilent(diffBook('УО', before, after))).toBe(true);
  });

  it('добавленные строки считаются, но построчных подробностей не дают — сдвиг не правка', () => {
    const before = sheet(['1', 'а'], ['2', 'б']);
    const after = sheet(['1', 'а'], ['новая', 'в'], ['2', 'б']);

    const diff = diffBook('УО', before, after);

    expect(diff.addedRows).toBe(1);
    expect(diff.removedRows).toBe(0);
    expect(diff.rows).toEqual([]);
    expect(isSilent(diff)).toBe(false);
  });

  it('удалённые строки видны счётчиком', () => {
    const diff = diffBook('УО', sheet(['1', 'а'], ['2', 'б']), sheet(['1', 'а']));

    expect(diff.removedRows).toBe(1);
    expect(diff.rowsTotal).toBe(DEPT_HEADER_ROWS + 1);
  });

  it('массовая правка не заваливает эфир: подробностей не больше потолка', () => {
    const before = sheet(...Array.from({ length: 40 }, (_, i) => [String(i), 'старое']));
    const after = sheet(...Array.from({ length: 40 }, (_, i) => [String(i), 'новое']));

    const diff = diffBook('УО', before, after);

    expect(diff.changedRows).toBe(40);
    expect(diff.rows).toHaveLength(MAX_ROW_EVENTS);
  });

  it('пустое значение и пробелы — одно и то же: мнимых правок нет', () => {
    const before = sheet(['1', 'УО АЕМР', '  ']);
    const after = sheet(['1', 'УО АЕМР', '']);

    expect(isSilent(diffBook('УО', before, after))).toBe(true);
  });

  it('автор подставляется из журнала по адресу ячейки', () => {
    setChangeAuthorResolver((book, cell) => (book === 'УО' && cell === 'L4' ? 'ivanova@example.ru' : undefined));

    const diff = diffBook(
      'УО',
      sheet(['155', '', '', '', '', '', '', '', '', '', '', 'ЕП']),
      sheet(['155', '', '', '', '', '', '', '', '', '', '', 'ЭА']),
    );

    expect(diff.rows[0].author).toBe('ivanova@example.ru');
  });

  it('журнал молчит — поле автора пустое, никого не назначаем', () => {
    setChangeAuthorResolver(() => undefined);

    const diff = diffBook('УО', sheet(['155', 'было']), sheet(['155', 'стало']));

    expect(diff.rows[0].author).toBeUndefined();
  });

  it('падение журнала не отнимает само событие о правке', () => {
    setChangeAuthorResolver(() => {
      throw new Error('база недоступна');
    });

    const diff = diffBook('УО', sheet(['155', 'было']), sheet(['155', 'стало']));

    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0].author).toBeUndefined();
  });
});
