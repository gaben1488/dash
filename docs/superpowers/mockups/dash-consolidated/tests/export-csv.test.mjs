import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeSelectionCsv } from '../src/export-csv.mjs';

test('CSV не теряет составной номер, пустой факт и нулевую сумму', () => {
  const csv = serializeSelectionCsv([{ number: '173/1', dept: 'УО', subject: 'Учебники', plan: 100, fact: null }, { number: '173/2', dept: 'УО', subject: 'Столы', plan: 0, fact: 0 }]);
  assert.ok(csv.includes('173/1;УО;Учебники;100;'));
  assert.ok(csv.includes('173/2;УО;Столы;0;0'));
});

test('CSV экранирует разделители, кавычки и переносы без потери значения', () => {
  const csv = serializeSelectionCsv([{ number: '4', dept: 'УД', subject: 'Ремонт; "А"\nЭтап 2', plan: 10, fact: 9 }]);
  assert.ok(csv.includes('"Ремонт; ""А""\nЭтап 2";10;9'));
  assert.equal(csv.split('\r\n').length, 2);
});

test('CSV не допускает интерпретацию текстового предмета как формулы', () => {
  const csv = serializeSelectionCsv([{ number: '=1+1', dept: '@dept', subject: ' +HYPERLINK("https://example.com")', plan: -2, fact: 0 }]);
  assert.ok(csv.includes("'=1+1;'@dept;"));
  assert.ok(csv.includes("' +HYPERLINK"));
  assert.ok(csv.includes(';-2;0'));
});
