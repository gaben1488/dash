/* Золотой набор — единственный дом канона оформления книг ГРБС.
 * Решения владельца 29.08.2026: полный контроль (роли 47-набора + диалект УО),
 * оптимальный синтаксис (REGEXREPLACE-контроль формул, ROUND в контроле сумм,
 * TO_TEXT/REGEXMATCH для «Х», открытые диапазоны 4:низ, якорь $A4).
 * Формулы — в локали книг (разделитель «;»).
 *
 * Порядок правил = приоритет в Google Sheets (первое правило побеждает
 * при конфликте форматов): контроль формул → точечные красные → строковые
 * сигналы → 223 → визуальный слой.
 */
const { colIndex, rgbFromHex } = require('./lib.cjs');

// ---------- палитра (канон УО + контрольные цвета 47-набора) ----------
const C = {
  red: '#FFEBEE', redText: '#B81C1C',            // точечный контроль: заливка/текст
  formulaBroken: '#FF0000', white: '#FFFFFF',    // сломанная формула
  rowWarn: '#FFF1CC',                            // строка: нет G/L
  rowMiss: '#FBE3D5',                            // строка: нет причины/дубль
  law223: '#FFF2CC', law223Text: '#A26805',      // 223-маркеры и U-пропуск
  purple: '#AA00FF', purpleText: '#EA80FC',      // дата факта при нулевых суммах
  grey: '#CCCCCC', black: '#000000',             // Х при ненулевых суммах
  fProg: '#DDD6EF', fCur: '#D6EAD1',             // тип F
  ep: '#FCE8D8', eaText: '#009900',              // способ L
  tBad: '#F9E2D6', tMuted: '#666666', tOk: '#D6EAD1', // срок T
  adYes: '#D6EAD1', adNo: '#E5E5E5',             // соисполнение AD
  moneyHK: '#DBE5F0', moneyVY: '#DDD6EF', moneyZAC: '#D6EAD1', // итоги K/Y/AC (контраст)
  moneyHJlight: '#EAF2F9', moneyVXlight: '#EDE9F7', moneyZABlight: '#E8F3E5', // тройки — блеклее (решение 30.08)
};

function bg(hex) { return { backgroundColor: rgbFromHex(hex), backgroundColorStyle: { rgbColor: rgbFromHex(hex) } }; }
function fg(hex, extra) {
  return { textFormat: Object.assign({ foregroundColor: rgbFromHex(hex), foregroundColorStyle: { rgbColor: rgbFromHex(hex) } }, extra || {}) };
}
function fmt(bgHex, fgHex, bold) {
  const f = {};
  if (bgHex) Object.assign(f, bg(bgHex));
  if (fgHex || bold) Object.assign(f, fg(fgHex || C.black, bold ? { bold: true } : {}));
  else if (bold) Object.assign(f, { textFormat: { bold: true } });
  return f;
}

/** Диапазон колонок листа, строки 4..низ (открытый конец). */
function rng(sheetId, colsFrom, colsTo, fromRow) {
  return {
    sheetId,
    startRowIndex: fromRow === undefined ? 3 : fromRow,
    startColumnIndex: colIndex(colsFrom),
    endColumnIndex: colIndex(colsTo || colsFrom) + 1,
  };
}

function boolRule(formula, format) {
  return { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] }, format };
}
function textEq(value, format) {
  return { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] }, format };
}
function numGt0(format) {
  return { condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] }, format };
}

/**
 * Золотой набор УФ. sheetId — целевой лист. Диапазоны открыты до низа.
 * Каждый элемент: { name (для превью), ranges, rule }.
 */
function goldenCF(sheetId, opts) {
  const visualOnly = opts && opts.visualOnly;
  const FORMULA_GUARD =
    '=AND($A4<>""; NOT(IFERROR(REGEXREPLACE(FORMULATEXT(K4);"([A-ZА-Я]+)"&ROW();"$1#")=REGEXREPLACE(FORMULATEXT(K$4);"([A-ZА-Я]+)4";"$1#");FALSE)))';
  const X = '"^[ХX]$"';
  const all = [
    // 1. Контроль формул (одно правило на все формульные группы)
    { name: 'Формула сломана (K, O:P, R:T, Y:AC)',
      ranges: [rng(sheetId, 'K'), rng(sheetId, 'O', 'P'), rng(sheetId, 'R', 'T'), rng(sheetId, 'Y', 'AC')],
      rule: boolRule(FORMULA_GUARD, fmt(C.formulaBroken, C.white, true)) },
    // 2. Точечные красные — обязательность и типы
    { name: 'Пустой предмет закупки G', ranges: [rng(sheetId, 'G')],
      rule: boolRule('=AND($A4<>""; LEN(TRIM($G4))=0)', fmt(C.red, C.redText, true)) },
    { name: 'Пустой способ L', ranges: [rng(sheetId, 'L')],
      rule: boolRule('=AND($A4<>""; LEN(TRIM($L4))=0)', fmt(C.red, C.redText, true)) },
    { name: 'ЕП без причины M', ranges: [rng(sheetId, 'M')],
      rule: boolRule('=AND($L4="ЕП"; LEN(TRIM($M4))=0)', fmt(C.red, C.redText, true)) },
    { name: 'Пустая плановая дата N', ranges: [rng(sheetId, 'N')],
      rule: boolRule('=AND($A4<>""; LEN(TRIM(TO_TEXT($N4)))=0)', fmt(C.red, C.redText, true)) },
    { name: 'N не дата и не Х', ranges: [rng(sheetId, 'N')],
      rule: boolRule(`=AND($A4<>""; LEN(TRIM(TO_TEXT($N4)))>0; NOT(ISNUMBER($N4)); NOT(REGEXMATCH(UPPER(TRIM(TO_TEXT($N4)));${X})))`,
        fmt(C.red, C.redText, true)) },
    { name: 'План H:J не число', ranges: [rng(sheetId, 'H', 'J')],
      rule: boolRule('=AND(H4<>""; NOT(ISNUMBER(H4)))', fmt(C.red, C.redText, true)) },
    { name: 'Факт V:X не число', ranges: [rng(sheetId, 'V', 'X')],
      rule: boolRule('=AND(V4<>""; NOT(ISNUMBER(V4)))', fmt(C.red, C.redText, true)) },
    { name: 'Остаток Z:AB не число', ranges: [rng(sheetId, 'Z', 'AB')],
      rule: boolRule('=AND(Z4<>""; NOT(ISNUMBER(Z4)))', fmt(C.red, C.redText, true)) },
    { name: 'Итог K не сходится с H+I+J', ranges: [rng(sheetId, 'K')],
      rule: boolRule('=AND($A4<>""; OR(NOT(ISNUMBER($K4)); ROUND($K4-SUM($H4:$J4);2)<>0))', fmt(C.red, C.redText, true)) },
    { name: 'Итог Y не сходится с V+W+X', ranges: [rng(sheetId, 'Y')],
      rule: boolRule('=AND($A4<>""; OR(NOT(ISNUMBER($Y4)); ROUND($Y4-SUM($V4:$X4);2)<>0))', fmt(C.red, C.redText, true)) },
    { name: 'Итог AC не сходится с Z+AA+AB', ranges: [rng(sheetId, 'AC')],
      rule: boolRule('=AND($A4<>""; OR(NOT(ISNUMBER($AC4)); ROUND($AC4-SUM($Z4:$AB4);2)<>0))', fmt(C.red, C.redText, true)) },
    { name: 'Мусор в AD (не да/нет)', ranges: [rng(sheetId, 'AD')],
      rule: boolRule('=AND($A4<>""; LEN(TRIM($AD4))>0; NOT(OR($AD4="да"; $AD4="нет")))', fmt(C.red, C.redText, true)) },
    // 3. Строчные сигналы качества факта
    { name: 'Дата факта Q есть, суммы факта нулевые', ranges: [rng(sheetId, 'B', 'AH')],
      rule: boolRule(`=AND($Q4<>""; NOT(REGEXMATCH(UPPER(TRIM(TO_TEXT($Q4)));${X})); ISNUMBER($Q4); $V4+$W4+$X4=0)`,
        fmt(C.purple, C.purpleText, true)) },
    { name: 'Q=Х, а суммы факта ненулевые', ranges: [rng(sheetId, 'B', 'AH')],
      rule: boolRule(`=AND(REGEXMATCH(UPPER(TRIM(TO_TEXT($Q4)));${X}); OR($V4>0; $W4>0; $X4>0))`,
        fmt(C.grey, C.black, true)) },
    { name: 'Срок нарушен — заполните причину U', ranges: [rng(sheetId, 'U')],
      rule: boolRule('=AND(ISNUMBER(SEARCH("Срок нарушен"; $T4)); LEN(TRIM($U4))=0)', fmt(C.law223, C.law223Text, true)) },
    { name: 'Строка без причины (срок/ЕП)', ranges: [rng(sheetId, 'A', 'AH')],
      rule: boolRule('=OR(AND(ISNUMBER(SEARCH("Срок нарушен"; $T4)); TRIM($U4)=""); AND($L4="ЕП"; TRIM($M4)=""))', fmt(C.rowMiss)) },
    { name: 'Строка без предмета или способа', ranges: [rng(sheetId, 'A', 'AH')],
      rule: boolRule('=AND($A4<>""; OR(TRIM($G4)=""; TRIM($L4)=""))', fmt(C.rowWarn)) },
    { name: 'Дубль номера A', ranges: [rng(sheetId, 'A')],
      rule: boolRule('=AND($A4<>""; COUNTIF($A$4:$A; $A4)>1)', fmt(C.rowMiss)) },
    // 4. 223-маркеры
    { vis: true, name: '223 в причине M (вся строка)', ranges: [rng(sheetId, 'A', 'AH', 0)],
      rule: boolRule('=ISNUMBER(SEARCH("223"; $M1))', fmt(C.law223)) },
    { vis: true, name: '223-ФЗ в AF при способе не ЕП', ranges: [rng(sheetId, 'L', 'M')],
      rule: boolRule('=IFERROR(AND(SEARCH("223-ФЗ";$AF4)>0; $L4<>"ЕП"); FALSE)', fmt(C.law223, C.law223Text, true)) },
    // 5. Визуальный слой (канон УО)
    { vis: true, name: 'F: Программное мероприятие', ranges: [rng(sheetId, 'F')], rule: textEq('Программное мероприятие', fmt(C.fProg)) },
    { vis: true, name: 'F: Текущая деятельность', ranges: [rng(sheetId, 'F')], rule: textEq('Текущая деятельность', fmt(C.fCur)) },
    { vis: true, name: 'L: ЕП', ranges: [rng(sheetId, 'L')], rule: textEq('ЕП', fmt(C.ep)) },
    { vis: true, name: 'L: ЭА', ranges: [rng(sheetId, 'L')], rule: textEq('ЭА', fmt(C.white, C.eaText, true)) },
    { vis: true, name: 'T: срок нарушен (текст)', ranges: [rng(sheetId, 'T')],
      rule: { condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Срок нарушен' }] }, format: fmt(C.tBad) } },
    { vis: true, name: 'T: дни просрочки > 0', ranges: [rng(sheetId, 'T')], rule: numGt0(fmt(C.tBad)) },
    { vis: true, name: 'T: срок не наступил', ranges: [rng(sheetId, 'T')],
      rule: { condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Срок не наступил' }] }, format: fmt(null, C.tMuted) } },
    { vis: true, name: 'T: исполнено в срок (число <= 0)', ranges: [rng(sheetId, 'T')],
      rule: boolRule('=AND(T4<>""; ISNUMBER(T4); T4<=0)', fmt(C.tOk)) },
    { vis: true, name: 'AD: да', ranges: [rng(sheetId, 'AD')], rule: textEq('да', fmt(C.adYes)) },
    { vis: true, name: 'AD: нет', ranges: [rng(sheetId, 'AD')], rule: textEq('нет', fmt(C.adNo)) },
    { vis: true, name: 'План H:J > 0 (блекло)', ranges: [rng(sheetId, 'H', 'J')], rule: numGt0(fmt(C.moneyHJlight)) },
    { vis: true, name: 'Итог K > 0 (контраст)', ranges: [rng(sheetId, 'K')], rule: numGt0(fmt(C.moneyHK)) },
    { vis: true, name: 'Факт V:X > 0 (блекло)', ranges: [rng(sheetId, 'V', 'X')], rule: numGt0(fmt(C.moneyVXlight)) },
    { vis: true, name: 'Итог Y > 0 (контраст)', ranges: [rng(sheetId, 'Y')], rule: numGt0(fmt(C.moneyVY)) },
    { vis: true, name: 'Остаток Z:AB > 0 (блекло)', ranges: [rng(sheetId, 'Z', 'AB')], rule: numGt0(fmt(C.moneyZABlight)) },
    { vis: true, name: 'Итог AC > 0 (контраст)', ranges: [rng(sheetId, 'AC')], rule: numGt0(fmt(C.moneyZAC)) },
  ];
  // Подведы-зеркала (решение владельца 30.08): только цветовой слой, без
  // контрольных правил — как на подведах УО.
  return visualOnly ? all.filter((g) => g.vis) : all;
}

/**
 * Целевые защиты главного листа. editors — список адресов (Р4: объединение
 * текущих списков книги, людей не меняем). keepAD — сохранить защиту AD
 * (отклонение от канона УО, обосновано: AD ставит УФБП/бот).
 */
function goldenProtections(sheetId, editors, opts) {
  const mk = (desc, range) => ({ description: desc, range, warningOnly: false, editors: { users: editors } });
  const out = [
    mk('Шапка (строки 1-3)', { sheetId, startRowIndex: 0, endRowIndex: 3 }),
    mk('Формульный столбец K', rng(sheetId, 'K')),
    mk('Формульные столбцы O:P', rng(sheetId, 'O', 'P')),
    mk('Формульные столбцы R:T', rng(sheetId, 'R', 'T')),
    mk('Формульные столбцы Y:AC', rng(sheetId, 'Y', 'AC')),
  ];
  if (opts && opts.keepAD) out.push(mk('Флаг учёта экономии AD', rng(sheetId, 'AD')));
  return out;
}

/** Целевая проверка данных по колонкам (канон УО, Р2/Р3). grbsValue — значение для B. */
function goldenValidation(grbsValue) {
  const isnum = (col) => ({ condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=ISNUMBER(${col}4)` }] }, strict: true, showCustomUi: false });
  const dateOrX = (col) => ({
    condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=OR(ISDATE(${col}4); REGEXMATCH(UPPER(TRIM(TO_TEXT(${col}4)));"^[ХX]$"))` }] },
    strict: true, showCustomUi: false,
  });
  const listOf = (vals, strict) => ({ condition: { type: 'ONE_OF_LIST', values: vals.map((v) => ({ userEnteredValue: v })) }, strict: !!strict, showCustomUi: true });
  // Решение владельца 30.08: справочник строгий — новое учреждение/программа
  // появляется ТОЛЬКО через страницу настроек; ручной ввод мимо списка отклоняется.
  const fromRange = (r) => ({ condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: r }] }, strict: true, showCustomUi: true });
  return {
    A: { condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '0' }] }, strict: true, showCustomUi: false },
    B: grbsValue ? listOf([grbsValue], true) : null,
    C: fromRange("='_Настройки'!$H$2:$H"),
    D: fromRange("='_Настройки'!$I$2:$I"),
    E: fromRange("='_Настройки'!$J$2:$J"),
    F: listOf(['Программное мероприятие', 'Текущая деятельность'], true),
    H: isnum('H'), I: isnum('I'), J: isnum('J'),
    L: listOf(['ЕП', 'ЭА'], true),
    N: dateOrX('N'), Q: dateOrX('Q'),
    V: isnum('V'), W: isnum('W'), X: isnum('X'),
    Z: isnum('Z'), AA: isnum('AA'), AB: isnum('AB'),
    AD: listOf(['да', 'нет'], true),
    // Снять валидацию (роль закрывают защиты + УФ «формула сломана»):
    _clear: ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'AC'],
  };
}

/** Форматные политики тела (строки 4..низ). */
const FORMAT_POLICY = {
  moneyCols: ['H', 'I', 'J', 'K', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC'],
  moneyFormat: { type: 'NUMBER', pattern: '#,##0.00' },
  dateCols: ['N', 'Q'],
  dateFormat: { type: 'DATE', pattern: 'dd.mm.yyyy' },
  bodyFont: { fontFamily: 'Arial', fontSize: 10 },
  wrap: 'WRAP',
  // Р6: на основных листах стираем только белую статику; на подведах — всю.
  whiteHexes: ['#FFFFFF'],
};

/** Банда (чередование строк) — палитра УО «ВСЕ», решение владельца 30.08: везде. */
const BANDING = { firstBand: '#FFFFFF', secondBand: '#FBF9F9' };

/** Канон тела по колонкам (выведен из сетки УО «ВСЕ» 29.08): цвет текста,
 * жирность, выравнивание. Применяется к подведам при переводе на канон. */
const BODY_COLUMN_CANON = {
  fg: { H: '#073763', I: '#073763', J: '#073763', K: '#073763', O: '#0F172A', P: '#0F172A',
        V: '#351C75', W: '#351C75', X: '#351C75', Y: '#351C75',
        Z: '#274E13', AA: '#274E13', AB: '#274E13', AC: '#274E13' },
  bold: ['K', 'L', 'N', 'Q', 'T', 'Y', 'AC', 'AD'],
  alignLeft: ['D', 'E', 'G', 'AE', 'AF', 'AG', 'AH'],
};

/** Служебные листы (Settings / GOOGLE_ФОРМУЛЫ / Контроль): канон УО — два
 * правила, диапазоны открыты до низа. */
function serviceCF(sheetId) {
  return [
    { name: 'Ошибка вычисления', ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }],
      rule: boolRule('=ISERROR(A2)', fmt('#FEE2E2', '#B91C1C', true)) },
    { name: 'Зебра по заполненным', ranges: [{ sheetId, startRowIndex: 3, startColumnIndex: 0, endColumnIndex: 3 }],
      rule: boolRule('=AND($C4<>""; ISODD(ROW()))', fmt('#F8FAFC')) },
  ];
}

/** Эталонные формулы листа GOOGLE_ФОРМУЛЫ (реконструкция взамен #REF!-битых;
 * контрольная дата — Settings!$B$6, актуальная раскладка). */
const GOOGLE_FORMULAS_CANON = [
  ['K', '=ARRAYFORMULA(IF(A4:A="";"";H4:H+I4:I+J4:J))'],
  ['O', '=ARRAYFORMULA(IF(A4:A="";"";IF(REGEXMATCH(UPPER(TRIM(TO_TEXT(N4:N)));"^(X|Х)$");"X";ROUNDUP(MONTH(N4:N)/3;0))))'],
  ['P', '=ARRAYFORMULA(IF(A4:A="";"";IF(REGEXMATCH(UPPER(TRIM(TO_TEXT(N4:N)));"^(X|Х)$");"X";YEAR(N4:N))))'],
  ['R', '=ARRAYFORMULA(IF(A4:A="";"";IF(REGEXMATCH(UPPER(TRIM(TO_TEXT(Q4:Q)));"^(X|Х)$");"X";ROUNDUP(MONTH(Q4:Q)/3;0))))'],
  ['S', '=ARRAYFORMULA(IF(A4:A="";"";IF(REGEXMATCH(UPPER(TRIM(TO_TEXT(Q4:Q)));"^(X|Х)$");"X";YEAR(Q4:Q))))'],
  ['T', '=ARRAYFORMULA(IF(A4:A="";"";IF(REGEXMATCH(UPPER(TRIM(TO_TEXT(Q4:Q)));"^(X|Х)$");IF(N4:N>Settings!$B$6;"Срок не наступил";"Срок нарушен");Q4:Q-N4:N)))'],
  ['Y', '=ARRAYFORMULA(IF(A4:A="";"";V4:V+W4:W+X4:X))'],
  ['Z', '=ARRAYFORMULA(IF(A4:A="";"";IF(REGEXMATCH(UPPER(TRIM(TO_TEXT(Q4:Q)));"^(X|Х)$");0;H4:H-V4:V)))'],
  ['AA', '=ARRAYFORMULA(IF(A4:A="";"";IF(REGEXMATCH(UPPER(TRIM(TO_TEXT(Q4:Q)));"^(X|Х)$");0;I4:I-W4:W)))'],
  ['AB', '=ARRAYFORMULA(IF(A4:A="";"";IF(REGEXMATCH(UPPER(TRIM(TO_TEXT(Q4:Q)));"^(X|Х)$");0;J4:J-X4:X)))'],
  ['AC', '=ARRAYFORMULA(IF(A4:A="";"";Z4:Z+AA4:AA+AB4:AB))'],
];

module.exports = { C, goldenCF, goldenProtections, goldenValidation, FORMAT_POLICY, rng,
  BANDING, BODY_COLUMN_CANON, serviceCF, GOOGLE_FORMULAS_CANON };
