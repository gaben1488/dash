/**
 * Live Google Sheets contracts for procurement procedure monitoring.
 * No range protection, no silent correction of source codes/years.
 * A always derives from the beginning of G; U/V and monetary facts are source-owned.
 */
const CODE_AT_3 = "=LET(текст;TRIM(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(G3&\"\";CHAR(160);\" \");CHAR(10);\" \");CHAR(13);\" \");CHAR(9);\" \"));образец;\"(?:ЭАС|ЭЗК|ЭЕП|ЭА|ЭК)[0-9]{2,}(?:/[0-9]+)?-[0-9]{2}\";код;IFERROR(REGEXEXTRACT(UPPER(текст);\"^(\"&образец&\")(?:[[:space:][:punct:]«»—–]|$)\");\"\");остаток;IF(код=\"\";\"\";MID(UPPER(текст);LEN(код)+1;LEN(текст)));IF(OR(код=\"\";REGEXMATCH(остаток;\"(?:^|[^0-9А-ЯЁA-Za-z])\"&образец&\"(?:[^0-9А-ЯЁA-Za-z]|$)\"));\"\";код))";
const FAMILY_DUPLICATE_GATE = "=IF($B$171=0;0;IFERROR(LET(коды;INDEX(ДанныеМастера;0;1);виды;INDEX(ДанныеМастера;0;2);предки;INDEX(ДанныеМастера;0;21);наследники;INDEX(ДанныеМастера;0;22);стадии;INDEX(ДанныеМастера;0;23);ошибки;INDEX(ДанныеМастера;0;25);повторы;UNIQUE(FILTER(коды;REGEXMATCH(ошибки&\"\";\"Код повторяется у строк не вида «доля»\")));SUM(MAP(повторы;LAMBDA(повтор;N(OR(SUMPRODUCT(EXACT(коды;повтор)*NOT(EXACT(виды;\"доля\"))*(((TRIM(предки&\"\")<>\"\")+(TRIM(наследники&\"\")<>\"\")+(стадии=\"Переоформлена\"))>0))>0;SUMPRODUCT(--ISNUMBER(FIND(\"; \"&повтор&\"; \";\"&предки&\"; \")))>0;SUMPRODUCT(--ISNUMBER(FIND(\"; \"&повтор&\"; \";\"&наследники&\"; \")))>0))))));\"не рассчитано\"))";
const ANALYTICAL_STATUS = "=IFERROR(IF(OR(NOT(ISNUMBER(B220));B220<=0;COUNTIF(B157:B209;\"не рассчитано\")>0;NOT(ISNUMBER(B226));NOT(ISNUMBER(I147));B224<>\"схема соответствует\";B225<>\"охват соответствует сетке\";NOT(AND(ISFORMULA(J210);ISFORMULA(I147);ISFORMULA(B152);ISFORMULA(B153);ISFORMULA(B220);ISFORMULA(I39);ISFORMULA(I51);ISFORMULA(I63);ISFORMULA(I75);ISFORMULA(I87);ISFORMULA(I99);ISFORMULA(I111);ISFORMULA(I123);ISFORMULA(I135))));\"Свод не рассчитан: блокирующие ошибки семей, схемы или формул — см. B215, B168, B226, J210\";\"Свод рассчитан · требуют внимания: \"&B218&\" процедур · конфликтные коды: \"&B171&\" (в семейных связях: \"&B226&\")\"&CHAR(10)&\"Экономия требует распределения / проверки: \"&TEXT(B152;\"#,##0.00\")&\" ₽\"&CHAR(10)&IF(OR(COUNTIF(E16:E25;\"<>сошлось\")>0;ROUND(D150;2)<>0;ROUND(D151;2)<>0;B215<>0);\"Есть несогласованность расчётов\";\"Арифметика согласована\")&CHAR(10)&\"Результатов внесено \"&C12&\", учтено \"&B216&\", требуют проверки даты \"&B217&IF(B217>0;\" (\"&C217&\")\";\"\")&\" · без даты итогов \"&B221);\"Свод не рассчитан — проверьте формулы и контроль\")";

export function canonicalProcedureCodeFormula(row) {
  if (!Number.isInteger(row) || row < 3) throw new Error('CODE_AUTOFILL_ROW');
  return CODE_AT_3.replaceAll('G3', 'G' + row);
}

export function extractProcedureCodeFromSubject(subject) {
  const text = String(subject ?? '').replace(/[\u00a0\n\r\t]/g, ' ').trim().toUpperCase();
  const code = text.match(/^(?:ЭАС|ЭЗК|ЭЕП|ЭА|ЭК)[0-9]{2,}(?:\/[0-9]+)?-[0-9]{2}(?=[\s.,;:()«»—–!?]|$)/u)?.[0] ?? '';
  if (!code) return '';
  const remaining = text.slice(code.length);
  const second = /(?:^|[^0-9А-ЯЁA-Za-z])(?:ЭАС|ЭЗК|ЭЕП|ЭА|ЭК)[0-9]{2,}(?:\/[0-9]+)?-[0-9]{2}(?=[^0-9А-ЯЁA-Za-z]|$)/u.test(remaining);
  return second ? '' : code;
}

/**
 * One-time unification. Requires current CellData for the full A:G range,
 * including formattedValue and userEnteredValue. Fails closed if values
 * would change. A3:A1002 becomes 1000 identical relative formulas.
 * The operation does not touch data validation, row formats, or other columns.
 */
export function planCanonicalProcedureCodes(rows, sheetId, rowCount) {
  if (!Number.isInteger(sheetId) || !Number.isInteger(rowCount) || rowCount < 3 || rows.length !== rowCount) throw new Error('CODE_UNIFICATION_BOUNDS');
  if (rows[1]?.values?.[0]?.formattedValue !== 'Код процедуры') throw new Error('CODE_UNIFICATION_SCHEMA');
  const changed = [];
  for (let index = 2; index < rowCount; index++) {
    const cols = rows[index]?.values ?? [];
    const cellA = cols[0] ?? {};
    const source = cols[6] ?? {};
    const current = String(cellA.formattedValue ?? cellA.effectiveValue?.stringValue ?? cellA.userEnteredValue?.stringValue ?? '');
    const subject = String(source.formattedValue ?? source.effectiveValue?.stringValue ?? source.userEnteredValue?.stringValue ?? '');
    const expected = extractProcedureCodeFromSubject(subject);
    if (current !== expected) throw new Error('CODE_UNIFICATION_VALUE:' + (index + 1) + ':' + current + ':' + expected);
    if (cellA.userEnteredValue?.formulaValue !== canonicalProcedureCodeFormula(index + 1)) changed.push(index + 1);
  }
  if (!changed.length) return [];
  const source = { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 };
  return [
    { updateCells: { start: { sheetId, rowIndex: 2, columnIndex: 0 }, rows: [{ values: [{ userEnteredValue: { formulaValue: canonicalProcedureCodeFormula(3) } }] }], fields: 'userEnteredValue' } },
    { copyPaste: { source, destination: { ...source, startRowIndex: 3, endRowIndex: rowCount }, pasteType: 'PASTE_FORMULA', pasteOrientation: 'NORMAL' } },
  ];
}

export function familyLinkedDuplicateCountFormula() {
  return FAMILY_DUPLICATE_GATE;
}
export function canonicalAnalyticalStatusFormula() {
  return ANALYTICAL_STATUS;
}

function replaceExactlyOnce(source, before, after) {
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) throw new Error('ARCHIVE_DATE_CONTRACT:' + occurrences);
  return source.replace(before, after);
}

/**
 * Keep completed procedures visible. Exclude only their unadmitted
 * price/savings/budget monetary facts; show reason in the P remark.
 * Blank date retains the accepted accumulated-history rule.
 * Applicable to the archive data spill A4; header A2 is already date-aware.
 */
export function admitCompletedArchiveFacts(formula) {
  if (typeof formula !== 'string' || !formula.startsWith('=')) throw new Error('ARCHIVE_DATE_CONTRACT');
  if (formula.includes('FILTER(ARRAYFORMULA(IF(допуск;цена;""));м)')) return formula;
  if (!formula.includes('FILTER(ARRAYFORMULA(цена);м)')) return formula;
  let fixed = replaceExactlyOnce(formula, 'стадия;INDEX(ДанныеМастера;0;23);есть;', 'стадия;INDEX(ДанныеМастера;0;23);итоги;INDEX(ДанныеМастера;0;12);есть;');
  fixed = replaceExactlyOnce(fixed, 'выбор;TRIM($B$1&"");процБезДолей;', 'табДата;IFERROR(FILTER({код\\итоги};проц);{""\\""});датаФакта;ARRAYFORMULA(IF(EXACT(вид;"доля");IFERROR(VLOOKUP(код;табДата;2;FALSE);"");итоги));допуск;ARRAYFORMULA(IF(TRIM(датаФакта&"")="";TRUE;IFERROR(IF(ISNUMBER(датаФакта);датаФакта;DATEVALUE(датаФакта))<=Сегодня;FALSE)));выбор;TRIM($B$1&"");процБезДолей;');
  for (const name of ['цена', 'экономия', 'фб', 'кб', 'мб']) {
    fixed = replaceExactlyOnce(fixed, 'FILTER(ARRAYFORMULA(' + name + ');м)', 'FILTER(ARRAYFORMULA(IF(допуск;' + name + ';""));м)');
  }
  fixed = replaceExactlyOnce(fixed, 'FILTER(INDEX(ДанныеМастера;0;25);м)', 'FILTER(ARRAYFORMULA(IF(NOT(допуск);"Денежный факт вне расчётной даты или дата некорректна — не учтён; ";"")&INDEX(ДанныеМастера;0;25));м)');
  return fixed;
}

/** Contract diagnostics rather than access restrictions. */
export function auditProcedureFormulaCoverage(rows, { requireCode = true } = {}) {
  const missing = []; const manualInn = []; const badFormula = []; const calcErrors = [];
  if (!Array.isArray(rows) || !rows.length) throw new Error('EMPTY_MASTER_AUDIT');
  const required = [16, 21, 22, 23, 24].concat(requireCode ? [0] : []);
  for (const entry of rows) {
    const row = entry.row;
    const cells = entry.cells ?? [];
    for (const column of required) {
      const formula = cells[column]?.userEnteredValue?.formulaValue;
      if (!formula) missing.push({ row, column: column + 1 });
      if (column === 0 && formula && formula !== canonicalProcedureCodeFormula(row)) badFormula.push({ row, column: 1 });
    }
    const s = cells[18];
    if (s?.userEnteredValue && !s.userEnteredValue.formulaValue) {
      const inn = String(s.formattedValue ?? s.userEnteredValue.stringValue ?? s.userEnteredValue.numberValue ?? '');
      manualInn.push({ row, inn, validShape: /^([0-9]{10}|[0-9]{12})$/u.test(inn) });
    }
    cells.forEach((cell, column) => {
      if (cell?.effectiveValue?.errorValue) calcErrors.push({ row, column: column + 1, error: cell.effectiveValue.errorValue });
    });
  }
  return { missing, badFormula, manualInn, calcErrors };
}
