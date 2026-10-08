import test from 'node:test';
import assert from 'node:assert/strict';
import { addressedRemarkRules, archiveResidualFormula, preserveFateComment, jointMoneySummaryRequest, nativeMoneyPresentationRequests, workQueueDividerPresentationRequests } from './monitoring-finish.mjs';

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

test('workplace keeps J as the active signal and gives N a visible blank gutter', () => {
  const layout = workQueueDividerPresentationRequests();
  assert.equal(layout.length, 4);
  assert.deepEqual(layout[0].updateDimensionProperties.range, {
    sheetId: 2526400, dimension: 'COLUMNS', startIndex: 9, endIndex: 10,
  });
  assert.equal(layout[0].updateDimensionProperties.properties.pixelSize, 185);
  assert.deepEqual(layout[1].updateDimensionProperties.range, {
    sheetId: 2526400, dimension: 'COLUMNS', startIndex: 10, endIndex: 13,
  });
  assert.equal(layout[1].updateDimensionProperties.properties.hiddenByUser, true);
  assert.equal(layout[2].updateDimensionProperties.properties.pixelSize, 36);
  assert.equal(layout[2].updateDimensionProperties.properties.hiddenByUser, false);
  assert.deepEqual([layout[3].repeatCell.range.startColumnIndex, layout[3].repeatCell.range.endColumnIndex], [13, 14]);

  const liveStyle = nativeMoneyPresentationRequests([]);
  const header = liveStyle.find(r => r.updateCells?.range?.sheetId === 2526400)?.updateCells;
  assert.match(header.rows[0].values[0].userEnteredValue.formulaValue, /COUNTIF\(P3:P1002/);
  assert.ok(liveStyle.some(r => r.repeatCell?.range?.startColumnIndex === 13));
  assert.ok(!liveStyle.some(r => r.updateCells?.range?.startColumnIndex === 9));
});
