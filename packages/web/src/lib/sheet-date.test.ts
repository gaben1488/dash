import { describe, expect, it } from 'vitest';
import { formatDateCell, monthOfDateValue } from './sheet-date';

describe('formatDateCell — рендер даты из DTO (ISO-канон) в дд.мм.гггг', () => {
  it('ISO 2026-01-12 → 12.01.2026', () => {
    expect(formatDateCell('2026-01-12')).toBe('12.01.2026');
  });

  it('дд.мм.гггг проходит как есть (пользовательский ввод в редакторе)', () => {
    expect(formatDateCell('15.03.2026')).toBe('15.03.2026');
  });

  it('legacy-серийник 46034 НЕ рендерится как «01.01.46034», а конвертируется', () => {
    expect(formatDateCell(46034)).toBe('12.01.2026');
    expect(formatDateCell('46034')).toBe('12.01.2026');
  });

  it('пусто/null → пустая строка', () => {
    expect(formatDateCell('')).toBe('');
    expect(formatDateCell(null)).toBe('');
    expect(formatDateCell(undefined)).toBe('');
  });

  it('нераспознаваемое значение возвращается как есть (не терять данные)', () => {
    expect(formatDateCell('не дата')).toBe('не дата');
  });
});

describe('monthOfDateValue — месяц для квартальных/месячных фильтров', () => {
  it('ISO: 2026-04-01 → 4', () => {
    expect(monthOfDateValue('2026-04-01')).toBe(4);
  });

  it('дд.мм.гггг: 15.03.2026 → 3', () => {
    expect(monthOfDateValue('15.03.2026')).toBe(3);
  });

  it('серийник 46034 → 1 (январь 2026), а НЕ январь-1970 от new Date(мс)', () => {
    expect(monthOfDateValue(46034)).toBe(1);
    expect(monthOfDateValue(46100)).toBe(3); // 19.03.2026
  });

  it('пусто и мусор → null (строка не классифицируется ложно)', () => {
    expect(monthOfDateValue('')).toBeNull();
    expect(monthOfDateValue(null)).toBeNull();
    expect(monthOfDateValue('не дата')).toBeNull();
  });
});
