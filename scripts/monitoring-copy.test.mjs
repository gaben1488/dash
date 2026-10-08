import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeActionFormula } from './monitoring-copy.mjs';

test('clarifies actions without changing canonical quality tokens or conditions', () => {
  const source = '=IF(ISNUMBER(FIND("Дата не дата";Y3));"Исправить: Дата не дата";"Уточнить поставщика и ИНН")';
  assert.equal(humanizeActionFormula(source), '=IF(ISNUMBER(FIND("Дата не дата";Y3));"Исправить формат даты";"Уточнить поставщика и ИНН")');
  assert.equal(humanizeActionFormula(humanizeActionFormula(source)), humanizeActionFormula(source));
  assert.throws(() => humanizeActionFormula('Ручное действие'), /ACTION_FORMULA/);
});
