import { describe, expect, it } from 'vitest';
import { formatAxisMoney, formatAxisPct, formatPct } from './format';

/** Неразрывный пробел, который Intl ставит как разделитель разрядов. */
const NBSP = '\u00A0';

describe('formatAxisMoney', () => {
  it('ни одной латинской буквы — только русские единицы', () => {
    for (const v of [0, 999, 1000, 12_345, 1_000_000, 5_400_000]) {
      expect(formatAxisMoney(v)).not.toMatch(/[A-Za-z]/);
    }
  });

  it('называет порядок честно: вход в тысячах рублей', () => {
    // Прежняя реализация печатала «1.0M» для миллиона тысяч — то есть
    // называла миллиардом миллион. Порядок ошибался в тысячу раз.
    expect(formatAxisMoney(500)).toBe(`500${NBSP}тыс.`);
    expect(formatAxisMoney(12_400)).toBe(`12,4${NBSP}млн`);
    expect(formatAxisMoney(1_000_000)).toBe(`1,0${NBSP}млрд`);
  });

  it('отрицательные суммы получают ту же шкалу', () => {
    expect(formatAxisMoney(-12_400)).toBe(`-12,4${NBSP}млн`);
  });
});

describe('formatAxisPct / formatPct', () => {
  it('процент по-русски, с запятой', () => {
    expect(formatAxisPct(25)).toBe(`25${NBSP}%`);
    expect(formatPct(12.34)).toBe(`12,3${NBSP}%`);
    expect(formatPct(12.34, 0)).toBe(`12${NBSP}%`);
  });

  it('отсутствие доли называется причиной, а не прочерком и не нулём', () => {
    expect(formatPct(null)).toBe('нет плана');
  });
});
