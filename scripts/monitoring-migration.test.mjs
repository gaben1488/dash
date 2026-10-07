import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMasterRules, splitQueueFormula, removeCancellationClockWarning, auditMasterFormulas, withQualityAction } from './monitoring-migration.mjs';

test('архив расширяет семью по размеру графа, сохраняя остальную формулу', async () => {
  const { repairArchiveFamilyExpansion } = await import('./monitoring-migration.mjs');
  const old = '=LET(семья;expand(expand(expand(expand(expand(expand("; "&нач&"; "))))));SUM(семья))';
  assert.equal(repairArchiveFamilyExpansion(old), '=LET(семья;REDUCE("; "&нач&"; ";SEQUENCE(MAX(1;ROWS(лкКод)-1));LAMBDA(набор;шаг;expand(набор)));SUM(семья))');
  assert.throws(() => repairArchiveFamilyExpansion('=SUM(A1:A2)'), /ARCHIVE_FAMILY_CONTRACT/u);
});

test('повторный ремонт архива сохраняет допуск пустой даты, но исключает ошибку разбора', async () => {
  const { completedArchiveFormula } = await import('./monitoring-migration.mjs');
  const f = '=LET(процБезДолей;ARRAYFORMULA(есть*EXACT(вид;"процедура")*(долейКода=0)*IF(EXACT(выбор;"все");1;--EXACT(упр;выбор)));м;ARRAYFORMULA(--((свои+процБезДолей)>0)*EXACT(стд;"Состоялась"));IF(TRIM(датаФакта&"")="";TRUE;IFERROR(IF(ISNUMBER(датаФакта);датаФакта;DATEVALUE(датаФакта))<=Сегодня;TRUE)))';
  const fixed = completedArchiveFormula(f);
  assert.equal(fixed, f.replace('<=Сегодня;TRUE)', '<=Сегодня;FALSE)'));
  assert.equal(completedArchiveFormula(fixed), fixed);
});

test('основная совместная процедура без долей сохраняет деньги в архиве', async () => {
  const { completedArchiveFormula } = await import('./monitoring-migration.mjs');
  const f = '=LET(процБезДолей;ARRAYFORMULA(есть*EXACT(вид;"процедура")*(долейКода=0)*IF(EXACT(выбор;"все");1;--EXACT(упр;выбор)));м;ARRAYFORMULA(--((свои+процБезДолей)>0)*EXACT(стд;"Состоялась"));вПоказателях;ARRAYFORMULA(м*NOT(процБезДолей));FILTER(ARRAYFORMULA(IF(процБезДолей;"";нмцк));м))';
  const fixed = completedArchiveFormula(f);
  assert.equal(fixed, f.replace('м*NOT(процБезДолей)', 'м').replace('IF(процБезДолей;"";нмцк)', 'нмцк'));
});

test('ремонт свода сохраняет введённые деньги и отвергает другую раскладку', async () => {
  const { planAnalyticalRepair } = await import('./monitoring-migration.mjs');
  const cells = [{ row: 2, column: 0, cell: { userEnteredValue: { stringValue: 'Управление' } } },
    { row: 152, column: 1, cell: { userEnteredValue: { formulaValue: '=SUM(A1:A2)' } } },
    { row: 153, column: 1, cell: { userEnteredValue: { numberValue: 0.01 } } }];
  const requests = planAnalyticalRepair(cells, 2526800, 235);
  const writes = requests.filter(r => r.updateCells).map(r => r.updateCells);
  assert(writes.some(r => r.start.rowIndex === 152 && r.rows[0].values[0].userEnteredValue.formulaValue));
  assert(writes.some(r => r.start.rowIndex === 219 && r.rows[0].values[0].userEnteredValue.formulaValue));
  assert(writes.every(r => r.start.sheetId === 2526800 && r.start.rowIndex < 235));
  assert(writes.every(r => r.fields === 'userEnteredValue,note'));
  assert.throws(() => planAnalyticalRepair([], 2526800, 235), /ANALYTICAL_SCHEMA/);
});

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
  assert.equal(normalized[2].ranges[0].startColumnIndex, 0);
  assert.equal(normalized[2].ranges[0].endColumnIndex, 25);
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

 test('архив ГРБС отделяет состоявшиеся и соблюдает выбранное управление', async () => {
  const { completedArchiveFormula } = await import('./monitoring-migration.mjs');
  const base = '=LET(процБезДолей;ARRAYFORMULA(есть*EXACT(вид;"процедура")*(долейКода=0));свои;ARRAYFORMULA(есть);м;ARRAYFORMULA(--((свои+процБезДолей)>0));FILTER(код;м))';
  const result = completedArchiveFormula(base);
  assert.match(result, /долейКода=0\)\*IF\(EXACT\(выбор;"все"\);1;--EXACT\(упр;выбор\)\)/u);
  assert.match(result, /м;ARRAYFORMULA\(--\(\(свои\+процБезДолей\)>0\)\*EXACT\(стд;"Состоялась"\)\)/u);
  assert.equal(completedArchiveFormula(result), result);
  assert.throws(() => completedArchiveFormula('=SUM(A1:A3)'), /ARCHIVE_FORMULA_CONTRACT/u);
});
