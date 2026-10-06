/** Pure transformations for the native Sheets migration; no credentials or workbook data. */
export function splitQueueFormula(formula) {
  const start = formula.lastIndexOf(';{блок1;');
  const end = formula.lastIndexOf('});');
  if (start < 0 || end <= start || !formula.includes(';блок2;')) throw new Error('QUEUE_FORMULA_CONTRACT');
  return {
    active: formula.slice(0, start) + ';блок1' + formula.slice(end + 1),
    closed: formula.slice(0, start) + ';блок2' + formula.slice(end + 1),
  };
}

export const cancellationClockPattern = 'IF\\(AND\\(NOT\\(доля\\);AND\\(EXACT\\(рез;"Отмена по решению заказчика"\\);J[0-9]+<>"";IF\\(эеп;итогиПрошли;AND\\(ISNUMBER\\(K[0-9]+\\);Сегодня>K[0-9]+\\)\\)\\)\\);"Проверить: Проверить основание отмены — T";""\\)';

export function removeCancellationClockWarning(formula) {
  const pattern = new RegExp(cancellationClockPattern, 'gu');
  if ([...formula.matchAll(pattern)].length !== 1) throw new Error('CANCELLATION_FORMULA_CONTRACT');
  return formula.replace(pattern, '""');
}

export function auditMasterFormulas(rows, columns = [16, 18, 21, 22, 23, 24]) {
  if (!rows.length) throw new Error('EMPTY_FORMULA_BASELINE');
  const normalize = (formula, row) => formula.replace(new RegExp(`(\\$?[A-Z]{1,2})${row}(?![0-9])`, 'gu'), '$1{row}');
  const baseline = new Map(columns.map((col) => {
    const formula = rows[0].cells[col]?.userEnteredValue?.formulaValue;
    if (!formula) throw new Error('INVALID_FORMULA_BASELINE');
    return [col, normalize(formula, rows[0].row)];
  }));
  const constants = []; const deviations = []; const errors = [];
  for (const { row, cells } of rows) {
    for (const col of columns) {
      const formula = cells[col]?.userEnteredValue?.formulaValue;
      if (!formula) constants.push({ row, column: col + 1 });
      else if (normalize(formula, row) !== baseline.get(col)) deviations.push({ row, column: col + 1 });
    }
    cells.forEach((cell, col) => { if (cell.effectiveValue?.errorValue) errors.push({ row, column: col + 1, ...cell.effectiveValue.errorValue }); });
  }
  return { constants, deviations, errors };
}

export function withQualityAction(formula, row) {
  if (!formula.startsWith('=')) throw new Error('ACTION_FORMULA_CONTRACT');
  return `=LET(основное;${formula.slice(1)};замеч;Y${row}&"";IF(основное<>"";основное;IF(AND(TRIM(A${row}&"")<>"";NOT(EXACT(B${row};"доля"));REGEXMATCH(замеч;"Ошибка:|Проверить:|Неполно:"));IF(REGEXMATCH(замеч;"ИНН|Поставщик|Победитель");"Уточнить поставщика и ИНН";IF(REGEXMATCH(замеч;"дат[аы]|Дата");"Дополнить даты";IF(REGEXMATCH(замеч;"разбивк|Разбивк|бюджет|Экономия не разложена");"Разнести экономию по бюджетам";"Проверить сведения")));"")))`;
}

const column = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export function normalizeMasterRules(rules, sheetId, rowCount) {
  const seen = new Set();
  return rules.flatMap((rule) => {
    let formula = rule.booleanRule?.condition?.values?.[0]?.userEnteredValue;
    if (!formula) throw new Error('CF_FORMULA_CONTRACT');
    formula = formula.replace(/(\$?[A-Z]{1,2})\$?\d+/gu, '$13');
    // Semantics are in the diagnostic's address, not in ranges corrupted by cell pastes.
    const address = formula.match(/ — ([A-Y])(?::([A-Y]))?"/u);
    const guarded = formula.match(/^=NOT\(ISFORMULA\(([A-Y])3\)\)$/u);
    const stageOnly = formula.startsWith('=EXACT($W3;');
    if (guarded) formula = `=AND(TRIM($A3&"")<>"";NOT(ISFORMULA(${guarded[1]}3)))`;
    if (formula.includes('Проверить основание отмены')) return [];
    if (seen.has(formula)) return [];
    seen.add(formula);
    const source = rule.ranges[0];
    const range = { sheetId, startRowIndex: 2, endRowIndex: rowCount,
      startColumnIndex: stageOnly ? 22 : address ? column(address[1]) : guarded ? column(guarded[1]) : source.startColumnIndex,
      endColumnIndex: stageOnly ? 23 : address ? column(address[2] ?? address[1]) + 1 : guarded ? column(guarded[1]) + 1 : source.endColumnIndex };
    const ranges = formula === '=EXACT($B3;"доля")'
      ? [range, { ...range, startColumnIndex: 12, endColumnIndex: 17 }]
      : [range];
    return [{ ranges, booleanRule: { ...rule.booleanRule,
      condition: { ...rule.booleanRule.condition, values: [{ userEnteredValue: formula }] } } }];
  }).sort((a, b) => Number(b.booleanRule.condition.values[0].userEnteredValue.includes('NOT(ISFORMULA')) - Number(a.booleanRule.condition.values[0].userEnteredValue.includes('NOT(ISFORMULA')));
}
