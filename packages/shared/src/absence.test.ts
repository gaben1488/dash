import { describe, it, expect } from 'vitest';
import { isAbsentCell, cellTextOrNull } from './absence';

// Страж канона п.62 (интервью 14.08): «X/x/Х/х» в любой ячейке — маркер
// отсутствия, принятый владельцами книг. Провал теста = канон разъехался.
describe('канон маркера отсутствия', () => {
  it('латиница и кириллица, оба регистра, тире и пустота — отсутствие', () => {
    for (const v of ['X', 'x', 'Х', 'х', ' X ', '-', '—', '–', '', '   ', null, undefined]) {
      expect(isAbsentCell(v)).toBe(true);
    }
  });

  it('настоящее содержимое — не отсутствие', () => {
    for (const v of ['XX', 'x5', 'Программа X', '0', '05.П.1', 'МБУ ДО «ЕДМШ»']) {
      expect(isAbsentCell(v)).toBe(false);
    }
  });

  it('cellTextOrNull: маркер не доходит до показа, текст обрезается', () => {
    expect(cellTextOrNull('Х')).toBeNull();
    expect(cellTextOrNull('  Развитие культуры  ')).toBe('Развитие культуры');
  });
});
