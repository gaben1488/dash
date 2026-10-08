import test from 'node:test';
import assert from 'node:assert/strict';
import { addressedRemarkRules, archiveResidualFormula, preserveFateComment, jointMoneySummaryRequest, queueFormulaWithEmptyJSeparator } from './monitoring-finish.mjs';

test('archive keeps partially allocated money and does not migrate the same formula twice', () => {
  const old = '=LET(код;ФильтрВитрин;вид;INDEX(ДанныеМастера;0;2);нмцк;INDEX(ДанныеМастера;0;8);цена;INDEX(ДанныеМастера;0;13);м;(долейКода=0);нмцк)';
  const next = archiveResidualFormula(old);
  assert.match(next, /нмцкИсточник-IFERROR\(VLOOKUP/);
  assert.match(next, /ABS\(N\(цена\)\)/);
  assert.equal(archiveResidualFormula(next), next);
  assert.throws(() => archiveResidualFormula('=1'), /ARCHIVE_RESIDUAL_CONTRACT/);
});
test('fate keeps the source comment verbatim without inferring a successor', () => {
  const formula = '=IF(REGEXMATCH(LOWER(INDEX(ДанныеМастера;0;4)&"");"потребность пересмотрена");"В источнике: потребность пересмотрена";"Уточнить")';
  const next = preserveFateComment(formula);
  assert.match(next, /Комментарий источника:/);
  assert.equal(preserveFateComment(next), next);
});
test('conditional diagnostics preserve stage shading and map monetary cells to their source column', () => {
  const stage = { ranges:[{startColumnIndex:0,endColumnIndex:16}], booleanRule:{condition:{values:[{userEnteredValue:'=EXACT($N4;"Состоялась")'}]}} };
  const error = { ranges:[{startColumnIndex:0,endColumnIndex:16}], booleanRule:{condition:{values:[{userEnteredValue:'=ISNUMBER(FIND("; Ошибка: ";$P4))'}]}} };
  const rules = addressedRemarkRules({properties:{sheetId:2526403,gridProperties:{rowCount:1002}},conditionalFormats:[stage,error]});
  assert.deepEqual(rules[0],{deleteConditionalFormatRule:{sheetId:2526403,index:1}});
  assert.equal(rules.filter(r=>r.addConditionalFormatRule).length,3);
  assert.match(rules[1].addConditionalFormatRule.rule.booleanRule.condition.values[0].userEnteredValue, /CHOOSE\(COLUMN\(A4\)/);
});
test('joint totals use main procedures and separate date-admitted facts from current exposure', () => {
  const rows = jointMoneySummaryRequest().updateCells.rows;
  assert.equal(rows.length,9);
  assert.match(rows[1].values[2].userEnteredValue.formulaValue, /<>"доля"/);
  assert.match(rows[3].values[2].userEnteredValue.formulaValue, /<=Сегодня;FALSE/);
});


test('J stays an empty separator while full active signals move into C', () => {
  const tenColumnArray = '{due\\days\\act\\links\\dept\\cust\\subj\\money\\st\\msg}';
  const oldFallback = '{"Нет процедур в работе"' + Array(9).fill('\\' + '""').join('') + '}';
  const formula = '=LET(m;1;act;"Действие";msg;"Сигнал";IF(SUM(m)=0;' + oldFallback
    + ';SORT(FILTER(' + tenColumnArray + ';m);1;TRUE)))';
  const updated = queueFormulaWithEmptyJSeparator(formula);
  assert.match(updated, /actionWithSignal;ARRAYFORMULA/);
  assert.ok(updated.includes('{due\\days\\actionWithSignal\\links\\dept\\cust\\subj\\money\\st}'));
  assert.ok(!updated.includes(tenColumnArray));
  assert.equal(updated.slice(updated.indexOf('{"Нет процедур в работе"'), updated.indexOf(';SORT')).split('\\').length, 9);
  assert.equal(queueFormulaWithEmptyJSeparator(updated), updated);
  assert.throws(() => queueFormulaWithEmptyJSeparator('=1'), /QUEUE_EMPTY_J_CONTRACT/);
});
