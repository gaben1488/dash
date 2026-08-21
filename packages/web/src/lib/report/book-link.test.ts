import { describe, expect, it } from 'vitest';
import { DEPARTMENT_SPREADSHEET_IDS } from '@aemr/shared';
import { bookCellUrl, bookRowUrl, deptBookId } from './book-link';

describe('дверь от числа отчёта к строке книги управления', () => {
  it('ключ управления в любой форме сводится к книге реестра', () => {
    expect(deptBookId('УЭР')).toBe(DEPARTMENT_SPREADSHEET_IDS['УЭР']);
  });

  it('управления вне реестра книг не дают ссылку в никуда', () => {
    expect(deptBookId('Районное поселение без книги')).toBeNull();
    expect(bookRowUrl('Районное поселение без книги', 12)).toBeNull();
  });

  it('ссылка на строку несёт идентификатор книги и диапазон строки', () => {
    const url = bookRowUrl('УЭР', 128)!;
    expect(url).toContain(DEPARTMENT_SPREADSHEET_IDS['УЭР']);
    expect(url).toContain('range=A128');
  });

  it('номер строки не с листа ссылкой не становится', () => {
    expect(bookRowUrl('УЭР', 0)).toBeNull();
    expect(bookRowUrl('УЭР', -3)).toBeNull();
    expect(bookRowUrl('УЭР', 1.5)).toBeNull();
  });

  it('адрес ячейки проверяется на форму A1 — битую ссылку не строим', () => {
    expect(bookCellUrl('УЭР', 'W59')).toContain('range=W59');
    expect(bookCellUrl('УЭР', 'строка 59')).toBeNull();
    expect(bookCellUrl('УЭР', '')).toBeNull();
  });
});
