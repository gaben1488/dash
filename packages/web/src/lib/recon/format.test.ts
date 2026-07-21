// Характеризация lib/recon/format — числовое форматирование страницы «Сверка».
import { describe, expect, it } from 'vitest';
import { fmtNum, fmtPct, isZero } from './format';

describe('fmtNum', () => {
  it('нормализует -0 в «0»', () => {
    expect(fmtNum(-0)).toBe('0');
  });

  it('гасит floating-point-шум (< 1e-9) в «0»', () => {
    expect(fmtNum(1e-14)).toBe('0');
    expect(fmtNum(-1e-10)).toBe('0');
  });

  it('обычные числа — ru-RU локаль, максимум 1 знак после запятой', () => {
    expect(fmtNum(5)).toBe('5');
    expect(fmtNum(-3.14)).toBe((-3.14).toLocaleString('ru-RU', { maximumFractionDigits: 1 }));
    expect(fmtNum(1234.56)).toBe((1234.56).toLocaleString('ru-RU', { maximumFractionDigits: 1 }));
  });

  it('НЕ гасит малые, но осмысленные значения (0.001 — не шум)', () => {
    expect(fmtNum(0.001)).not.toBe('0');
  });
});

describe('fmtPct', () => {
  it('шум < 1e-9 → «0%»', () => {
    expect(fmtPct(0)).toBe('0%');
    expect(fmtPct(-1e-12)).toBe('0%');
  });

  it('1 знак после точки (toFixed, не локаль)', () => {
    expect(fmtPct(2.345)).toBe('2.3%');
    expect(fmtPct(-7.06)).toBe('-7.1%');
    expect(fmtPct(100)).toBe('100.0%');
  });
});

describe('isZero', () => {
  it('true для -0 и floating-point-шума', () => {
    expect(isZero(-0)).toBe(true);
    expect(isZero(0)).toBe(true);
    expect(isZero(1e-10)).toBe(true);
  });

  it('false для реальных значений (не округление!)', () => {
    expect(isZero(0.001)).toBe(false);
    expect(isZero(-1)).toBe(false);
  });
});
