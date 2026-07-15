import { describe, expect, it } from 'vitest';
import { parseSheetDate } from './parse-sheet-date';

describe('parseSheetDate — единый парсер даты из ячейки листа', () => {
  it('Google-serial 46023 → 2026-01-01 (НЕ год 46023)', () => {
    const d = parseSheetDate('46023');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(0);
  });

  it('serial как число (не строка) тоже парсится', () => {
    expect(parseSheetDate(46100)!.getUTCFullYear()).toBe(2026);
  });

  it('дд.мм.гггг', () => {
    const d = parseSheetDate('15.03.2026');
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(15);
  });

  it('Date-объект пробрасывается', () => {
    const src = new Date(2026, 5, 1);
    expect(parseSheetDate(src)).toBe(src);
  });

  it('пусто/null/заглушки → null', () => {
    expect(parseSheetDate('')).toBeNull();
    expect(parseSheetDate(null)).toBeNull();
    expect(parseSheetDate(undefined)).toBeNull();
  });

  it('число вне serial-диапазона (год 2026) НЕ трактуется как serial', () => {
    // 2026 < 40000 → не serial; new Date('2026') = год 2026 (не serial-конверсия)
    const d = parseSheetDate('2026');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
  });

  it('мусор → null', () => {
    expect(parseSheetDate('не дата')).toBeNull();
  });
});
