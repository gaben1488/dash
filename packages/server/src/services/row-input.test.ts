import { describe, expect, it } from 'vitest';
import { isWritableDate, parseWritableMoney } from './row-input.js';

describe('полный разбор суммы перед записью в Google Sheets', () => {
  it('принимает нормальные суммы, в том числе с пробелами и запятой', () => {
    expect(parseWritableMoney('1 234,50')).toBe(1234.5);
    expect(parseWritableMoney('1\u00a0234,50')).toBe(1234.5);
    expect(parseWritableMoney('-100,01')).toBe(-100.01);
    expect(parseWritableMoney(0)).toBe(0);
  });
  it('не обрезает испорченную сумму и не принимает бесконечность', () => {
    for (const value of ['12abc', '1.2.3', '1e309', '123 45', '', ' ', Infinity, -Infinity, NaN, true, null]) {
      expect(parseWritableMoney(value)).toBeNull();
    }
  });
});
describe('календарный день перед записью', () => {
  it('принимает существующие даты и очищение', () => {
    for (const value of ['29.02.2024', '2024-02-29', '10.10.2026', '2026-10-10', '']) {
      expect(isWritableDate(value)).toBe(true);
    }
  });
  it('отклоняет невозможные даты и лишние суффиксы', () => {
    for (const value of ['31.02.2026', '29.02.2025', '2026-13-99', '2026-01-14garbage', '2026-10-10T00:00:00Z', '0000-01-01', null, 46100]) {
      expect(isWritableDate(value)).toBe(false);
    }
  });
});
