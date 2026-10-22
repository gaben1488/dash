import { expect, it } from 'vitest';
import { toNumber } from './rule-book.js';
import cases from '../fixtures/source-value-cases.json';
import { parseEditableAmount, parsePercentage } from './editable-amount.js';
import { dayNumberOf, isoOfDayNumber } from './parse-sheet-date.js';
import { convertMoney } from './money-units.js';
import { normalizeMethod } from './dictionaries/method-families.js';
import { classifyActivity, matchesActivityScope } from './activity-scope.js';

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

// Identical source test vectors are exercised independently in TS and Python.
it.each(cases.moneyScales)('shared money scale: $raw ($from → $to)', testCase => {
  const parsed = parseEditableAmount(testCase.raw);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok || parsed.value === null) throw new Error('Expected a source amount');
  const source = testCase.from as 'rubles' | 'thousand_rubles' | 'million_rubles';
  const target = testCase.to as 'rubles' | 'thousand_rubles' | 'million_rubles';
  expect(convertMoney(parsed.value, source, target)).toBeCloseTo(Number(testCase.value), 8);
});

it.each(cases.percentScales)('shared explicit percent encoding: $raw ($encoding)', testCase => {
  const source = testCase.encoding as 'fraction' | 'points';
  expect(parsePercentage(testCase.raw, source)).toEqual({
    ok: true,
    value: testCase.value === null ? null : Number(testCase.value),
  });
});

it.each(cases.methods)('shared source method: $raw', testCase => {
  // TS preserves procurement method codes, while Python groups competition
  // into the report engine's "ЭА" bucket. Both must preserve ЕП vs auction.
  expect(normalizeMethod(testCase.raw) ?? null).toBe(testCase.ts);
});

it('program D/E does not change activity derived from F', () => {
  expect(classifyActivity('Текущая деятельность', 'Программа')).toBe('current_non_program');
  expect(matchesActivityScope('pm', 'Текущая деятельность', 'Программа')).toBe(false);
  expect(matchesActivityScope('td', 'Текущая деятельность', 'Программа')).toBe(true);
  expect(classifyActivity('Программное мероприятие')).toBe('program');
});
