import { expect, it } from 'vitest';
import { toNumber } from './rule-book.js';
import cases from '../fixtures/source-value-cases.json';
import { parseEditableAmount, parsePercentage } from './editable-amount.js';
import { dayNumberOf, isoOfDayNumber } from './parse-sheet-date.js';
import { convertMoney } from './money-units.js';

it('reads the whole finite number instead of accepting a numeric prefix', () => {
  for (const raw of ['123abc', 'Infinity', '1 23', '1,2,3', Infinity, -Infinity, NaN, true]) {
    expect(toNumber(raw), String(raw)).toBeNull();
  }
});
it('preserves Russian grouping, signed values, real zero and absence', () => {
  expect(toNumber('1\u202f234,56')).toBe(1234.56);
  expect(toNumber('-20 000')).toBe(-20000);
  expect(toNumber('0')).toBe(0);
  expect(toNumber(null)).toBeNull();
  expect(toNumber('')).toBeNull();
});

it.each(cases.numbers)('shared numeric contract: $raw', testCase => {
  const parsed = parseEditableAmount(testCase.raw);
  if ('invalid' in testCase) expect(parsed.ok).toBe(false);
  else expect(parsed).toEqual({ ok: true, value: testCase.value === null ? null : Number(testCase.value) });
});
it.each(cases.dates)('shared calendar contract: $raw', testCase => {
  const day = dayNumberOf(testCase.raw);
  expect(day === null ? null : isoOfDayNumber(day)).toBe(testCase.value);
});
it('has explicit financial and percentage scales', () => {
  expect(convertMoney(-20000, 'thousand_rubles', 'rubles')).toBe(-20000000);
  expect(convertMoney(20, 'million_rubles', 'thousand_rubles')).toBe(20000);
  expect(convertMoney(Infinity, 'rubles', 'thousand_rubles')).toBeNull();
  expect(parsePercentage('1,5%', 'fraction')).toEqual({ ok: true, value: 0.015 });
  expect(parsePercentage(1.5, 'fraction')).toEqual({ ok: true, value: 1.5 });
  expect(parsePercentage(1.5, 'points')).toEqual({ ok: true, value: 0.015 });
  expect(parsePercentage('%', 'points')).toEqual({ ok: false });
});
