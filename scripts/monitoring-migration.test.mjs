import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMasterRules, splitQueueFormula, removeCancellationClockWarning, auditMasterFormulas, withQualityAction } from './monitoring-migration.mjs';

test('разрастание первой очереди не сдвигает формулу второй', () => {
  const old = '=IFERROR(LET(код;ФильтрВитрин;блок1;FILTER(код;код<>"");блок2;FILTER(код;код="X");{блок1;{""};{"Данные по закрытым строкам"};блок2});"ошибка")';
  const { active, closed } = splitQueueFormula(old);
  assert.match(active, /;блок1\);"ошибка"\)$/u);
  assert.match(closed, /;блок2\);"ошибка"\)$/u);
  assert.doesNotMatch(active, /Данные по закрытым/u);
  assert.throws(() => splitQueueFormula('=SUM(A:A)'), /QUEUE_FORMULA_CONTRACT/u);
});

test('УФ проверяет нужную колонку этой строки, а не следы вставки ячеек', () => {
  const rule = (formula, startColumnIndex, startRowIndex = 2) => ({
    ranges: [{ sheetId: 1, startRowIndex, endRowIndex: 429, startColumnIndex, endColumnIndex: startColumnIndex + 1 }],
    booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] }, format: {} },
  });
  const normalized = normalizeMasterRules([
    rule('=ISNUMBER(FIND("Ошибка: Суммы — N:P";$Y429))', 18, 427),
    rule('=ISNUMBER(FIND("Ошибка: Суммы — N:P";$Y3))', 14),
    rule('=NOT(ISFORMULA(Q3))', 16),
    { ...rule('=EXACT($W3;"Объявлена")', 0), ranges: [{ sheetId: 1, startRowIndex: 2, endRowIndex: 1002, startColumnIndex: 0, endColumnIndex: 25 }] },
  ], 1, 1002);
  assert.equal(normalized.length, 3);
  assert.deepEqual(normalized[1].ranges, [{ sheetId: 1, startRowIndex: 2, endRowIndex: 1002, startColumnIndex: 13, endColumnIndex: 16 }]);
  assert.match(normalized[1].booleanRule.condition.values[0].userEnteredValue, /\$Y3/u);
  assert.match(normalized[0].booleanRule.condition.values[0].userEnteredValue, /TRIM\(\$A3/u);
  assert.equal(normalized[2].ranges[0].startColumnIndex, 22);
  assert.equal(normalized[2].ranges[0].endColumnIndex, 23);
});

test('отмена не становится ошибкой только потому, что сегодня прошло больше времени', () => {
  const clause = 'IF(AND(NOT(доля);AND(EXACT(рез;"Отмена по решению заказчика");J429<>"";IF(эеп;итогиПрошли;AND(ISNUMBER(K429);Сегодня>K429))));"Проверить: Проверить основание отмены — T";"")';
  assert.equal(removeCancellationClockWarning(`=TEXTJOIN("; ";TRUE;${clause};"Ошибка: Иное")`), '=TEXTJOIN("; ";TRUE;"";"Ошибка: Иное")');
  assert.throws(() => removeCancellationClockWarning('=SUM(A:A)'), /CANCELLATION_FORMULA_CONTRACT/u);
});

test('страж отличает абсолютную границу от ошибочной ссылки на соседнюю строку и ручного значения', () => {
  const cell = (formulaValue) => ({ userEnteredValue: { formulaValue } });
  const template = cell('=IF(A3="";"";SUM($A$3:$A$1002;R3))');
  const rows = [{ row: 3, cells: [template] }, { row: 4, cells: [cell('=IF(A4="";"";SUM($A$3:$A$1002;R4))')] },
    { row: 5, cells: [cell('=IF(A4="";"";SUM($A$3:$A$1002;R5))')] }, { row: 6, cells: [{ userEnteredValue: { numberValue: 10 } }] }];
  assert.deepEqual(auditMasterFormulas(rows, [0]), { constants: [{ row: 6, column: 1 }], deviations: [{ row: 5, column: 1 }], errors: [] });
});

test('действия закрывают конкретную причину и сохраняют прежнее действие', () => {
  const f = withQualityAction('=IF(A3="";"";"Подвести итоги")', 3);
  assert.match(f, /основное;IF\(A3/u);
  assert.match(f, /основное<>"";основное/u);
  assert.match(f, /Уточнить поставщика и ИНН/u);
  assert.match(f, /Дополнить даты/u);
  assert.match(f, /Ошибка:\|Проверить:\|Неполно:/u);
  assert.throws(() => withQualityAction('константа', 3), /ACTION_FORMULA_CONTRACT/u);
});

test('автокод заполняет только пустые A внутри прочитанных границ и сохраняет ручной код', async () => {
  const { planProcedureCodeAutofill, procedureCodeFormula } = await import('./monitoring-migration.mjs');
  const rows = [{ values: [{ userEnteredValue: { stringValue: 'Код' } }] },
    { values: [{ userEnteredValue: { stringValue: 'Код процедуры' } }] },
    { values: [{ userEnteredValue: { stringValue: 'ЭАС09-26' } }] },
    { values: [{}] }, { values: [{}] },
    { values: [{ userEnteredValue: { formulaValue: '=G6' } }] }, { values: [{}] }];
  const requests = planProcedureCodeAutofill(rows, 2526300, 7);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[0].updateCells.start, { sheetId: 2526300, rowIndex: 3, columnIndex: 0 });
  assert.equal(requests[0].updateCells.rows[0].values[0].userEnteredValue.formulaValue, procedureCodeFormula(4));
  assert.deepEqual(requests[1].copyPaste.destination, { sheetId: 2526300, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 1 });
  assert.equal(requests[2].updateCells.start.rowIndex, 6);
  assert.equal(requests[0].updateCells.fields, 'userEnteredValue');
  assert.throws(() => planProcedureCodeAutofill(rows, 1, 8), /CODE_AUTOFILL_BOUNDS/);
  assert.throws(() => planProcedureCodeAutofill(rows.slice(2), 1, 5), /CODE_AUTOFILL_HEADER/);
  assert.throws(() => procedureCodeFormula(2), /CODE_AUTOFILL_ROW/);
  assert.match(procedureCodeFormula(1002), /G1002/);
});
