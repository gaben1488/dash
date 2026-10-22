import { describe, it, expect } from 'vitest';
import { DEPT_HEADER_ROWS } from '@aemr/shared';
import { diffBook, isSilent, MAX_ROW_EVENTS } from './live-diff.js';

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

describe('сравнение двух чтений книги', () => {
  it('не объявляет датную строку и Google serial разными событиями; настоящая смена дня остаётся', () => {
    const before = ['23/1', '', '', '', '', '', 'Предмет', '', '', '', 100, 'ЕП', '', '24.02.2026', '', '', '24.02.2026'];
    const after = [...before];
    after[13] = 46077; after[16] = 46077;
    expect(isSilent(diffBook('УД', sheet(before), sheet(after)))).toBe(true);
    after[13] = 46078;
    expect(diffBook('УД', sheet(before), sheet(after)).rows).toMatchObject([{ column: 'N', after: '46078' }]);
    expect(before[0]).toBe('23/1');
  });
  it('полные значения эфира не обрезаются до одинаковых 60 символов', () => {
    const prefix = 'Описание '.repeat(15);
    const diff = diffBook('УО', sheet(['155', '', '', '', '', '', 'Предмет', '', '', '', '', '', prefix + 'А']),
      sheet(['155', '', '', '', '', '', 'Предмет', '', '', '', '', '', prefix + 'Б']));
    expect(diff.rows[0].before).toBe(prefix + 'А');
    expect(diff.rows[0].after).toBe(prefix + 'Б');
  });
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

  it('адрес и совпавший переход старого журнала не доказывают автора свежего наблюдения', () => {
    const diff = diffBook(
      'УО',
      sheet(['155', '', '', '', '', '', '', '', '', '', '', 'ЕП']),
      sheet(['155', '', '', '', '', '', '', '', '', '', '', 'ЭА']),
    );

    expect(diff.rows[0].author).toBeUndefined();
  });

  it('журнал молчит — поле автора пустое, никого не назначаем', () => {
    const diff = diffBook('УО', sheet(['155', 'было']), sheet(['155', 'стало']));

    expect(diff.rows[0].author).toBeUndefined();
  });

});


describe('идентичность при очистке и сдвиге', () => {
  it('очистка и уплотнение: одна пропажа, ноль ложных правок сохранившихся номеров', () => {
    const first = ['173/1', 'УО', '', '', '', '', 'Первый'];
    const second = ['173/18', 'УО', '', '', '', '', 'Второй'];
    const third = ['177/13', 'УО', '', '', '', '', 'Третий'];
    const before = sheet(first, second, third, []);
    for (const after of [sheet(first, [], third, []), sheet(first, third, [], [])]) {
      const diff = diffBook('УО', before, after);
      expect(diff.removedRows).toBe(1);
      expect(diff.addedRows).toBe(0);
      expect(diff.changedRows).toBe(0);
      expect(diff.rows).toEqual([]);
    }
  });
  it('настоящая правка после сдвига сохраняет номер и новый физический адрес', () => {
    const before = sheet(['1', 'Первый'], ['2', 'Второй'], ['3', 'Третий']);
    const diff = diffBook('УО', before, sheet(['1', 'Первый'], ['3', 'Исправлен'], []));
    expect(diff.removedRows).toBe(1);
    expect(diff.changedRows).toBe(1);
    expect(diff.rows[0]).toMatchObject({ rowSeq: '3', sheetRow: 5, column: 'B', before: 'Третий', after: 'Исправлен' });
  });
  it('смена номера не объявляется изменением чужого номера', () => {
    const diff = diffBook('УО', sheet(['173/1', 'Один']), sheet(['173/18', 'Один']));
    expect(diff.removedRows).toBe(1);
    expect(diff.addedRows).toBe(1);
    expect(diff.changedRows).toBe(0);
    expect(diff.rows).toEqual([]);
  });
});

it('повторный или переиспользованный номер не связывает закупки автоматически', () => {
  const old = ['173/1', 'УО', 'Школа', '', '', '', 'Ремонт кровли'];
  const reused = ['173/1', 'УО', 'Школа', '', '', '', 'Молоко'];
  expect(diffBook('УО', sheet(old), sheet(reused)).rows).toEqual([]);
  expect(diffBook('УО', sheet(old, old), sheet(old)).rows).toEqual([]);
});
it('сдвиг адреса не приписывает прежнего автора ячейки другой закупке', () => {
  const diff = diffBook('УО', sheet(['1', 'Первый'], ['2', 'Второй']), sheet(['2', 'Исправлено'], []));
  expect(diff.rows[0]?.author).toBeUndefined();
});
