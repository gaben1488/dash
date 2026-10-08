/** Pure transformations for the native Sheets migration; no credentials or workbook data. */
/** Every connected node is reachable within |V|-1 expansions; no fixed chain ceiling. */
export function repairArchiveFamilyExpansion(formula) {
  const old = 'expand(expand(expand(expand(expand(expand("; "&нач&"; "))))))';
  if (typeof formula !== 'string' || !formula.startsWith('=') || formula.split(old).length !== 2) throw new Error('ARCHIVE_FAMILY_CONTRACT');
  return formula.replace(old, 'REDUCE("; "&нач&"; ";SEQUENCE(MAX(1;ROWS(лкКод)-1));LAMBDA(набор;шаг;expand(набор)))');
}

/** Repairs the existing 235-row analytical layout without touching master inputs. */
export function planAnalyticalRepair(cells, sheetId, rowCount) {
  const byAddress = new Map(cells.map(c => [`${c.row}:${c.column}`, c.cell]));
  if (rowCount < 235 || byAddress.get('2:0')?.userEnteredValue?.stringValue !== 'Управление') throw new Error('ANALYTICAL_SCHEMA');
  const requests = [];
  const put = (row, column, value, note = '') => requests.push({ updateCells: {
    start: { sheetId, rowIndex: row - 1, columnIndex: column },
    rows: [{ values: [{ userEnteredValue: typeof value === 'number' ? { numberValue: value } : value.startsWith('=') ? { formulaValue: value } : { stringValue: value }, note }] }],
    fields: 'userEnteredValue,note',
  } });
  const col = n => `INDEX(ДанныеМастера;0;${n})`;
  const primary = `(TRIM(${col(1)}&"")<>"")*(${col(2)}<>"доля")`;
  const eligible = `IFERROR(IF(TRIM(${col(12)}&"")="";TRUE;IF(ISNUMBER(${col(12)});${col(12)};DATEVALUE(${col(12)}))<=Сегодня);FALSE)`;
  const realized = `${primary}*(${col(23)}="Состоялась")`;
  const admitted = `${realized}*${eligible}`;
  const residual = `ROUND(N(${col(17)})-N(${col(14)})-N(${col(15)})-N(${col(16)});2)`;
  for (const { row, column, cell } of cells) {
    const formula = cell.userEnteredValue?.formulaValue;
    if (formula?.includes('<=Сегодня);TRUE)')) put(row, column, formula.replaceAll('<=Сегодня);TRUE)', '<=Сегодня);FALSE)'), cell.note ?? '');
    if (row >= 157 && row <= 209 && column === 1 && formula?.includes('MID($A')) {
      const label = byAddress.get(`${row}:0`)?.userEnteredValue?.stringValue;
      if (!label?.includes('. ')) throw new Error('ANALYTICAL_CLASS_SCHEMA');
      const token = label.slice(label.indexOf('. ') + 2).replaceAll('"', '""');
      put(row, column, `=IFERROR(SUMPRODUCT(--ISNUMBER(FIND("${token}";${col(25)})));"не рассчитано")`, `Правило ${label.split('.')[0]}. Поиск сообщения канона; пользовательская подпись A не участвует в расчёте.`);
    }
  }
  // NMCK is the full exposure of recorded results. Price/savings remain date-admitted facts.
  for (let i = 0; i < 9; i++) {
    const row = 30 + 12 * i;
    put(row, 2, `=SUMPRODUCT(N(${col(8)});(${col(23)}="Состоялась");(${col(5)}=$R${i + 3});(${col(2)}<>"доля"))`, 'Все внесённые результаты, включая требующие проверки по дате. Цена и экономия отдельно допускаются на дату расчёта.');
    put(row, 0, 'Результат «Состоялась» внесён');
  }
  put(138, 0, 'Результат «Состоялась» внесён');
  put(2, 2, 'Результатов внесено'); put(2, 7, 'НМЦК учтённых результатов');
  put(2, 8, 'Цена по учтённым итогам'); put(2, 9, 'Учтённая экономия');
  put(2, 11, 'Экономия · ФБ'); put(2, 12, 'Экономия · КБ'); put(2, 13, 'Экономия · МБ');
  put(2, 16, 'НМЦК переоформленных');
  put(27, 0, 'Объём процедур по стадиям');
  put(28, 1, 'Основных процедур'); put(28, 2, 'НМЦК всех в категории');
  put(28, 3, 'Цена учтённых итогов'); put(28, 4, 'Учтённая экономия');
  put(28, 5, 'Экономия · ФБ'); put(28, 6, 'Экономия · КБ'); put(28, 7, 'Экономия · МБ');
  put(152, 0, 'Распределить / проверить экономию: остатки больше 0,01 ₽');
  put(152, 1, `=ROUND(SUMPRODUCT(${admitted};${residual};--(ABS(${residual})>0,01));2)`, 'Из денежных полей, без поиска текста замечаний. Та же выборка, что у учтённой экономии.');
  put(153, 0, 'Остатки распределения до 0,01 ₽ включительно');
  put(153, 1, `=ROUND(SUMPRODUCT(${admitted};${residual};--(ABS(${residual})<=0,01));2)`, 'Автоматический остаток; это сумма данных, а не фиксированная поправка и не порог сверки.');
  put(216, 0, 'Результатов учтено на дату'); put(216, 1, `=SUMPRODUCT(${admitted})`);
  put(217, 0, 'Результат внесён, но не учтён по дате'); put(217, 1, `=SUMPRODUCT(${realized}*(1-N(${eligible})))`);
  put(217, 2, `=IFERROR(LET(условие;ARRAYFORMULA(${realized}*(1-N(${eligible})));HYPERLINK("#gid=2526300&range=T"&(MATCH(1;условие;0)+2);TEXTJOIN(", ";TRUE;FILTER(${col(1)};условие))));IF(B217=0;"нет";"не рассчитано"))`);
  put(218, 0, 'Основных процедур требуют внимания'); put(218, 1, `=SUMPRODUCT(${primary}*N(REGEXMATCH(${col(25)}&"";"Ошибка:|Проверить:|Неполно:")))`);
  put(219, 0, 'Основных процедур с любыми замечаниями'); put(219, 1, `=SUMPRODUCT(${primary}*(TRIM(${col(25)}&"")<>""))`);
  put(220, 0, 'Строк мастера, включая доли · знаменатель'); put(220, 1, `=SUMPRODUCT(--(TRIM(${col(1)}&"")<>""))`);
  put(221, 0, 'Учтены без даты итогов · ограничение анализа'); put(221, 1, `=SUMPRODUCT(${realized}*(TRIM(${col(12)}&"")=""))`);
  for (let row = 157; row <= 209; row++) put(row, 6, `=IFERROR(IF($B$220>0;B${row}/$B$220;"не рассчитано");"не рассчитано")`);
  put(156, 6, 'Доля строк мастера, включая доли');
  put(1, 0, 'Дата расчёта:');
  put(1, 2, '=IFERROR(IF(OR(COUNTIF(E16:E25;"<>сошлось")>0;ROUND(D150;2)<>0;ROUND(D151;2)<>0;B215<>0);"Есть несогласованность расчётов";"Арифметика согласована")&" · результатов внесено "&C12&", учтено "&B216&", требуют проверки даты "&B217&IF(B217>0;" ("&C217&")";"")&" · без даты итогов "&B221;"Свод не рассчитан — проверьте формулы и контроль")', 'Дата расчёта не является датой последнего обновления фактов. Согласованность арифметики не подтверждает полноту и достоверность источников.');
  put(13, 0, '=HYPERLINK("#gid=2526400&range=O3";"Проверка данных · процедур: "&B218&" · открыть очередь")');
  put(222, 0, 'Дата расчёта — параметр Сегодня. Момент обновления фактов и история срезов в книге пока не фиксируются.');
  put(223, 0, 'Четыре категории считаются по канону; доли не увеличивают число процедур и деньги. Внесённый результат не доказывает заключение контракта. НМЦК включает все процедуры категории, цена и экономия — только результаты, допущенные на дату расчёта. Пустая дата допускает накопительный результат с замечанием; ошибочная или будущая дата не допускает денежный факт. Для периода без даты результат не датируется автоматически. Экономия по ФБ / КБ / МБ — распределение экономии, не финансирование. Строки контроля и уникальные процедуры — разные счётчики.');
  put(210, 9, familyValuationFormula(), 'Служебный пересчёт семей: 9 управлений + итог. Слабосвязные компоненты направленных связей U; каждая семья один раз. Корни — без предка, живые члены — не «Переоформлена». Сбой / цикл / неизвестный предок не заменяются нулём.');
  for (let i = 0; i < 9; i++) put(39 + 12 * i, 8, `=IFERROR(VLOOKUP($R${i + 3};$J$210:$K$219;2;FALSE);"не рассчитано")`);
  put(147, 8, '=IFERROR(INDEX($K$210:$K$219;10);"не рассчитано")');
  put(224, 0, 'Схема полей источника');
  const headers = { A: 'Код процедуры', B: 'Вид строки', E: 'Управление', H: 'НМЦК', L: 'Дата подведения итогов', M: 'Цена по итогам', N: 'ФБ', O: 'КБ', P: 'МБ', Q: 'Экономия', U: 'Предок', W: 'Стадия', Y: 'Замечания' };
  put(224, 1, `=IF(AND(${Object.entries(headers).map(([c, name]) => `'Рабочий реестр процедур'!${c}2="${name}"`).join(';')});"схема соответствует";"Схема изменилась — проверьте расчёты")`);
  put(225, 0, 'Охват диапазона ДанныеМастера');
  put(225, 1, '=IF(OR(ROWS(\'Рабочий реестр процедур\'!A3:A)<>ROWS(ДанныеМастера);COLUMNS(ДанныеМастера)<>25);"Диапазон требует расширения / проверки";"охват соответствует сетке")', 'ROWS открытой ссылки проверяет размер сетки, данные агрегируются только в ограниченном ДанныеМастера. Добавление строк за нижней границей блокирует успешный статус до расширения охвата.');
  const status = requests.find(r => r.updateCells.start.rowIndex === 0 && r.updateCells.start.columnIndex === 2).updateCells.rows[0].values[0];
  const text = status.userEnteredValue.formulaValue;
  status.userEnteredValue.formulaValue = '=IFERROR(IF(OR(NOT(ISNUMBER(B220));B220<=0;COUNTIF(B157:B209;"не рассчитано")>0;NOT(ISNUMBER(I147));B224<>"схема соответствует");"Свод не рассчитан — проверьте знаменатель, правила, семьи и схему";' + text.slice('=IFERROR('.length, -';"Свод не рассчитан — проверьте формулы и контроль")'.length) + ');"Свод не рассчитан — проверьте формулы и контроль")';
  const derived = ['J210', 'I147', 'B152', 'B153', 'B220', ...Array.from({ length: 9 }, (_, i) => `I${39 + 12 * i}`)];
  status.userEnteredValue.formulaValue = status.userEnteredValue.formulaValue.replace('B224<>"схема соответствует")', `B224<>"схема соответствует";B225<>"охват соответствует сетке";NOT(AND(${derived.map(a => `ISFORMULA(${a})`).join(';')})))`);
  status.userEnteredValue.formulaValue = status.userEnteredValue.formulaValue.replace('IF(OR(COUNTIF(E16:E25;', '"Требуют внимания · процедур: "&B218&CHAR(10)&"Учтённая цена: "&TEXT(I12;"#,##0.00")&" ₽ · экономия: "&TEXT(J12;"#,##0.00")&" ₽"&CHAR(10)&IF(OR(COUNTIF(E16:E25;').replace('&" · результатов внесено "', '&CHAR(10)&"Результатов внесено "');
  put(226, 0, 'Дубли кодов, влияющие на связи / семейную аналитику');
  put(226, 1, familyLinkedDuplicateGuardFormula(), 'Только пересечения кодов внутри связей и переоформленных попыток блокируют граф. Остальные дубли остаются явными ошибками.');
  status.userEnteredValue.formulaValue = canonicalAnalyticalStatusFormula();
  return requests;
}

/** Native disclosure preserves the existing coordinates read by Dash. Apply once. */
export function planAnalyticalLayout(sheetId) {
  const range = (startRowIndex, endRowIndex, startColumnIndex = 0, endColumnIndex = 7) => ({ sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex });
  const requests = [
    { unmergeCells: { range: range(0, 1, 2, 18) } },
    { mergeCells: { range: range(0, 1, 2, 7), mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: range(12, 13), mergeType: 'MERGE_ALL' } },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1, hideGridlines: true } }, fields: 'gridProperties.frozenRowCount,gridProperties.hideGridlines' } },
    { repeatCell: { range: range(0, 235, 0, 18), cell: { userEnteredFormat: { textFormat: { fontSize: 12 }, verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat.textFormat.fontSize,userEnteredFormat.verticalAlignment' } },
    { repeatCell: { range: range(0, 1, 2, 7), cell: { userEnteredFormat: { wrapStrategy: 'WRAP', textFormat: { bold: false } } }, fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.textFormat.bold' } },
    { repeatCell: { range: range(1, 2, 0, 18), cell: { userEnteredFormat: { wrapStrategy: 'WRAP', textFormat: { bold: true, fontSize: 11 } } }, fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 235 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 72 }, fields: 'pixelSize' } },
    { repeatCell: { range: range(156, 209, 6, 7), cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.00%' } } }, fields: 'userEnteredFormat.numberFormat' } },
  ];
  [260, 140, 140, 140, 140, 120, 140].forEach((pixelSize, startIndex) => requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex, endIndex: startIndex + 1 }, properties: { pixelSize }, fields: 'pixelSize' } }));
  const groups = [{ sheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 18 }, ...[[14, 25], [27, 154], [155, 225]].map(([startIndex, endIndex]) => ({ sheetId, dimension: 'ROWS', startIndex, endIndex }))];
  for (const r of groups) requests.push({ addDimensionGroup: { range: r } }, { updateDimensionGroup: { dimensionGroup: { range: r, depth: 1, collapsed: true }, fields: 'collapsed' } }, { updateDimensionProperties: { range: r, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
  requests.push({ addConditionalFormatRule: { index: 0, rule: { ranges: [range(0, 1, 2, 7)], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=REGEXMATCH($C$1;"Свод не рассчитан|Есть несогласованность")' }] }, format: { backgroundColor: { red: 1, green: 0.88, blue: 0.88 } } } } } },
    { addConditionalFormatRule: { index: 1, rule: { ranges: [range(0, 1, 2, 7)], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$B$218>0' }] }, format: { backgroundColor: { red: 1, green: 0.96, blue: 0.82 } } } } } });
  return requests;
}

/** Add views once; then use the returned IDs for links. Never change the shared basic filter. */
export function planAnalyticalViews(masterSheetId, rowCount) {
  return [
    ['Проверка данных · основные процедуры', '=REGEXMATCH($Y3;"Ошибка:|Проверить:|Неполно:")'],
    ['Распределить экономию', '=ISNUMBER(FIND("Экономия не разложена";$Y3))'],
    ['Уточнить поставщика и ИНН', '=ISNUMBER(FIND("Одному имени несколько ИНН";$Y3))'],
    ['Результат требует проверки даты', '=AND($W3="Состоялась";IFERROR(IF(TRIM($L3&"")="";FALSE;IF(ISNUMBER($L3);$L3;DATEVALUE($L3))>Сегодня);TRUE))'],
  ].map(([title, formula]) => ({ addFilterView: { filter: {
    title, range: { sheetId: masterSheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 25 },
    criteria: { 1: { hiddenValues: ['доля'] }, 24: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] } } },
  } } }));
}

export function planAnalyticalLinks(sheetId, masterSheetId, viewIds) {
  if (viewIds.length !== 4 || viewIds.some(id => !Number.isInteger(id))) throw new Error('ANALYTICAL_VIEW_IDS');
  return [
    [13, 0, '"Проверка данных · процедур: "&B218&" · открыть отобранный реестр"'],
    [183, 1, '"28. Экономия не разложена"'],
    [182, 2, '"27. Одному имени несколько ИНН"'],
    [186, 3, '"31. Результат раньше срока"'],
  ].map(([row, view, label]) => ({ updateCells: {
    start: { sheetId, rowIndex: row - 1, columnIndex: 0 },
    rows: [{ values: [{ userEnteredValue: { formulaValue: `=HYPERLINK("#gid=${masterSheetId}&fvid=${viewIds[view]}";${label})` } }] }],
    fields: 'userEnteredValue',
  } }));
}

/** A code collision only blocks family calculations when the conflicted identifier
 * belongs to a replacement/ancestry chain. Other collisions remain visible errors.
 */
export function familyLinkedDuplicateGuardFormula() {
  return "=IF($B$171=0;0;IFERROR(LET(коды;INDEX(ДанныеМастера;0;1);виды;INDEX(ДанныеМастера;0;2);предки;INDEX(ДанныеМастера;0;21);наследники;INDEX(ДанныеМастера;0;22);стадии;INDEX(ДанныеМастера;0;23);ошибки;INDEX(ДанныеМастера;0;25);повторы;UNIQUE(FILTER(коды;REGEXMATCH(ошибки&\"\";\"Код повторяется у строк не вида «доля»\")));SUM(MAP(повторы;LAMBDA(повтор;N(OR(SUMPRODUCT(EXACT(коды;повтор)*NOT(EXACT(виды;\"доля\"))*(((TRIM(предки&\"\")<>\"\")+(TRIM(наследники&\"\")<>\"\")+(стадии=\"Переоформлена\"))>0))>0;SUMPRODUCT(--ISNUMBER(FIND(\"; \"&повтор&\"; \";\"&предки&\"; \")))>0;SUMPRODUCT(--ISNUMBER(FIND(\"; \"&повтор&\"; \";\"&наследники&\"; \")))>0))))));\"не рассчитано\"))";
}

/** A computed summary can coexist with explicitly disclosed non-family issues. */
export function canonicalAnalyticalStatusFormula() {
  return "=IFERROR(IF(OR(NOT(ISNUMBER(B220));B220<=0;COUNTIF(B157:B209;\"не рассчитано\")>0;NOT(ISNUMBER(B226));NOT(ISNUMBER(I147));B224<>\"схема соответствует\";B225<>\"охват соответствует сетке\";NOT(AND(ISFORMULA(J210);ISFORMULA(I147);ISFORMULA(B152);ISFORMULA(B153);ISFORMULA(B220);ISFORMULA(I39);ISFORMULA(I51);ISFORMULA(I63);ISFORMULA(I75);ISFORMULA(I87);ISFORMULA(I99);ISFORMULA(I111);ISFORMULA(I123);ISFORMULA(I135))));\"Свод не рассчитан: блокирующие ошибки семей, схемы или формул — см. B215, B168, B226, J210\";\"Свод рассчитан · требуют внимания: \"&B218&\" процедур · конфликтные коды: \"&B171&\" (в семейных связях: \"&B226&\")\"&CHAR(10)&\"Экономия требует распределения / проверки: \"&TEXT(B152;\"#,##0.00\")&\" ₽\"&CHAR(10)&IF(OR(COUNTIF(E16:E25;\"<>сошлось\")>0;ROUND(D150;2)<>0;ROUND(D151;2)<>0;B215<>0);\"Есть несогласованность расчётов\";\"Арифметика согласована\")&CHAR(10)&\"Результатов внесено \"&C12&\", учтено \"&B216&\", требуют проверки даты \"&B217&IF(B217>0;\" (\"&C217&\")\";\"\")&\" · без даты итогов \"&B221);\"Свод не рассчитан — проверьте формулы и контроль\")";
}

/** One native calculation for all nine views, including branches and merged roots. */
export function familyValuationFormula() {
  const col = n => `INDEX(ДанныеМастера;0;${n})`;
  const empty = 'VSTACK(HSTACK($R$3:$R$11;MAP($R$3:$R$11;LAMBDA(группа;0)));HSTACK("Итого";0))';
  return `=IFERROR(IF(OR($B$215<>0;$B$168>0;NOT(ISNUMBER($B$226));$B$226>0);"не рассчитано";LET(маска;ARRAYFORMULA((TRIM(${col(1)}&"")<>"")*(${col(2)}<>"доля"));всеКоды;FILTER(${col(1)};маска);всеПредки;FILTER(${col(21)};маска);всеГруппы;FILTER(${col(5)};маска);всеСуммы;FILTER(${col(8)};маска);всеСтадии;FILTER(${col(23)};маска);IF(OR(COUNTIF(всеПредки;"<>")=0;COUNTIF(всеСтадии;"Переоформлена")=0);${empty};LET(связанные;MAP(всеКоды;всеПредки;LAMBDA(код;предки;OR(TRIM(предки&"")<>"";SUM(ARRAYFORMULA(--ISNUMBER(FIND("; "&код&"; ";"; "&всеПредки&"; "))))>0)));коды;FILTER(всеКоды;связанные);предки;FILTER(всеПредки;связанные);группы;FILTER(всеГруппы;связанные);суммы;FILTER(всеСуммы;связанные);стадии;FILTER(всеСтадии;связанные);число;ROWS(коды);семьи;REDUCE(SEQUENCE(число);SEQUENCE(число);LAMBDA(метки;шаг;MAP(коды;предки;LAMBDA(код;егоПредки;MIN(FILTER(метки;ARRAYFORMULA((коды=код)+ISNUMBER(FIND("; "&код&"; ";"; "&предки&"; "))+ISNUMBER(FIND("; "&коды&"; ";"; "&егоПредки&"; ")))))))));семьиЗамены;UNIQUE(FILTER(семьи;стадии="Переоформлена"));изменения;MAP(семьиЗамены;LAMBDA(семья;ROUND(SUMPRODUCT(--(семьи=семья);суммы;--(стадии<>"Переоформлена"))-SUMPRODUCT(--(семьи=семья);суммы;--(TRIM(предки&"")=""));2)));группыСемей;MAP(семьиЗамены;LAMBDA(семья;TEXTJOIN(" | ";TRUE;UNIQUE(FILTER(группы;семьи=семья;стадии="Переоформлена")))));VSTACK(HSTACK($R$3:$R$11;MAP($R$3:$R$11;LAMBDA(группа;IF(SUM(ARRAYFORMULA(--ISNUMBER(FIND(группа;группыСемей))*--ISNUMBER(FIND(" | ";группыСемей))))>0;"семья в двух группах";ROUND(SUMPRODUCT(--(группыСемей=группа);изменения);2)))));HSTACK("Итого";ROUND(SUM(изменения);2)))))));"не рассчитано")`;
}
/** Source-side input convenience. A remains the key read by every consumer. */
/** Always derive A from G; a manual code is not a permanent override. */
export function procedureCodeFormula(row) {
  if (!Number.isInteger(row) || row < 3) throw new Error('CODE_AUTOFILL_ROW');
  return "=LET(текст;TRIM(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(G3&\"\";CHAR(160);\" \");CHAR(10);\" \");CHAR(13);\" \");CHAR(9);\" \"));образец;\"(?:ЭАС|ЭЗК|ЭЕП|ЭА|ЭК)[0-9]{2,}(?:/[0-9]+)?-[0-9]{2}\";код;IFERROR(REGEXEXTRACT(UPPER(текст);\"^(\"&образец&\")(?:[[:space:][:punct:]«»—–]|$)\");\"\");остаток;IF(код=\"\";\"\";MID(UPPER(текст);LEN(код)+1;LEN(текст)));IF(OR(код=\"\";REGEXMATCH(остаток;\"(?:^|[^0-9А-ЯЁA-Za-z])\"&образец&\"(?:[^0-9А-ЯЁA-Za-z]|$)\"));\"\";код))".replace('G3&', `G${row}&`);
}

/** One authoritative formula for every data row. G changes must recalculate A.
 * Read the full A:G rectangle and refuse to overwrite a contradictory existing key.
 * Never infer or silently "repair" a year, method code or source identifier.
 */
export function planProcedureCodeAutofill(rows, sheetId, rowCount) {
  if (!Number.isInteger(sheetId) || !Number.isInteger(rowCount) || rowCount < 4 || rows.length !== rowCount) throw new Error('CODE_AUTOFILL_BOUNDS');
  if (rows[1]?.values?.[0]?.userEnteredValue?.stringValue !== 'Код процедуры') throw new Error('CODE_AUTOFILL_HEADER');
  const validPrefix = /^(?:ЭАС|ЭЗК|ЭЕП|ЭА|ЭК)[0-9]{2,}(?:\/[0-9]+)?-[0-9]{2}(?=[\s.,;:()«»—–]|$)/u;
  const codeInside = /(?:ЭАС|ЭЗК|ЭЕП|ЭА|ЭК)[0-9]{2,}(?:\/[0-9]+)?-[0-9]{2}/u;
  for (let index = 2; index < rowCount; index++) {
    const cells = rows[index]?.values ?? [];
    const recorded = String(cells[0]?.formattedValue ?? cells[0]?.effectiveValue?.stringValue ?? cells[0]?.userEnteredValue?.stringValue ?? '').trim();
    const source = String(cells[6]?.formattedValue ?? cells[6]?.effectiveValue?.stringValue ?? cells[6]?.userEnteredValue?.stringValue ?? '').replace(/[\u00a0\n\r\t]/gu, ' ').trim().toUpperCase();
    if (!recorded) continue;
    const match = validPrefix.exec(source);
    const trailing = match ? source.slice(match[0].length) : '';
    if (!match || match[0] !== recorded || codeInside.test(trailing)) throw new Error(`CODE_AUTOFILL_SOURCE_CONFLICT:A${index + 1}:G${index + 1}`);
  }
  const first = { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 };
  return [
    { updateCells: { start: { sheetId, rowIndex: 2, columnIndex: 0 },
      rows: [{ values: [{ userEnteredValue: { formulaValue: procedureCodeFormula(3) } }] }], fields: 'userEnteredValue' } },
    { copyPaste: { source: first,
      destination: { ...first, startRowIndex: 3, endRowIndex: rowCount }, pasteType: 'PASTE_FORMULA', pasteOrientation: 'NORMAL' } },
  ];
}

/** Retain the clean key in A; explain collisions and parser failures in X/Y.
 * The request is idempotent; first run on a full, freshly inspected A:Y grid.
 */
export function explainProcedureCollisionAction(formula, row) {
  if (!Number.isInteger(row) || row < 3 || typeof formula !== 'string' || !formula.startsWith('=')) throw new Error('CODE_ACTION_CONTRACT');
  if (formula.includes('⚠ КОНФЛИКТ ') && formula.includes('Нет формулы кода в A')) return formula;
  if (!formula.includes(`Y${row}`)) throw new Error('CODE_ACTION_DIAGNOSTIC_REQUIRED');
  const conflicts=`TEXTJOIN(", ";TRUE;FILTER(ROW($A$3:$A$1002);EXACT($A$3:$A$1002;A${row});NOT(EXACT($B$3:$B$1002;"доля"))))`;
  return `=IF(AND(TRIM(G${row}&"")<>"";NOT(ISFORMULA(A${row})));"⚠ Нет формулы кода в A — восстановить";IF(AND(TRIM(G${row}&"")<>"";TRIM(A${row}&"")="");"⚠ Код в G не распознан — исправить начало G";IF(ISNUMBER(FIND("Ошибка: Код повторяется у строк не вида «доля» — A";Y${row}));"⚠ КОНФЛИКТ "&A${row}&": строки "&${conflicts}&". Сверить G по документу";IF(ISNUMBER(FIND("Ошибка: Дубль доли — A";Y${row}));"⚠ Дубль доли "&A${row}&" / "&E${row}&" — см. Y";${formula.slice(1)}))))`;
}

export function explainProcedureCollisionRemarks(formula, row) {
  if (!Number.isInteger(row) || row < 3 || typeof formula !== 'string' || !formula.startsWith('=')) throw new Error('CODE_REMARK_CONTRACT');
  if (formula.includes('Автокод в A перезаписан') && formula.includes('Код из G не распознан')) return formula;
  const first=`=IF(TRIM(A${row}&"")="";"";LET(`;
  if (!formula.startsWith(first)) throw new Error('CODE_REMARK_BASELINE');
  const once=(oldText,nextText)=>{if(formula.split(oldText).length!==2)throw new Error('CODE_REMARK_TEMPLATE');formula=formula.replace(oldText,nextText)};
  once(first,`=IF(TRIM(A${row}&"")="";IF(TRIM(G${row}&"")<>"";"Ошибка: Код из G не распознан — A/G";"");LET(`);
  const codeRows=`TEXTJOIN(", ";TRUE;FILTER(ROW($A$3:$A$1002);EXACT($A$3:$A$1002;код);NOT(EXACT($B$3:$B$1002;"доля"))))`;
  const shareRows=`TEXTJOIN(", ";TRUE;FILTER(ROW($A$3:$A$1002);EXACT($A$3:$A$1002;код);EXACT($B$3:$B$1002;"доля");EXACT($E$3:$E$1002;E${row})))`;
  once('"Ошибка: Код повторяется у строк не вида «доля» — A"', `"Ошибка: Код повторяется у строк не вида «доля» — A: "&код&"; строки "&${codeRows}&" — сверить G"`);
  once('"Ошибка: Дубль доли — A"', `"Ошибка: Дубль доли — A: "&код&" / "&E${row}&"; строки "&${shareRows}`);
  return `=IF(AND(TRIM(G${row}&"")<>"";NOT(ISFORMULA(A${row})));"Ошибка: Автокод в A перезаписан — A";${formula.slice(1)})`;
}

/** All diagnostic rows have one template; do not hide or clear conflicting keys. */
export function planMasterCodeDiagnostics(actionFormula,remarkFormula,sheetId,rowCount=1002) {
  if (!Number.isInteger(sheetId) || rowCount < 4) throw new Error('CODE_DIAGNOSTIC_BOUNDS');
  const x=explainProcedureCollisionAction(actionFormula,3);
  const y=explainProcedureCollisionRemarks(remarkFormula,3);
  return [
    { updateCells: { start: { sheetId,rowIndex:2,columnIndex:23 },
      rows: [{values:[{userEnteredValue:{formulaValue:x}},{userEnteredValue:{formulaValue:y}}]}],
      fields:'userEnteredValue' } },
    { copyPaste: { source: {sheetId,startRowIndex:2,endRowIndex:3,startColumnIndex:23,endColumnIndex:25},
      destination: {sheetId,startRowIndex:3,endRowIndex:rowCount,startColumnIndex:23,endColumnIndex:25},
      pasteType:'PASTE_FORMULA',pasteOrientation:'NORMAL' } },
  ];
}

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

export function auditMasterFormulas(rows, columns = [0, 16, 18, 21, 22, 23, 24]) {
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
      startColumnIndex: stageOnly ? 0 : address ? column(address[1]) : guarded ? column(guarded[1]) : source.startColumnIndex,
      endColumnIndex: stageOnly ? 25 : address ? column(address[2] ?? address[1]) + 1 : guarded ? column(guarded[1]) + 1 : source.endColumnIndex };
    const ranges = formula === '=EXACT($B3;"доля")'
      ? [range, { ...range, startColumnIndex: 12, endColumnIndex: 17 }]
      : [range];
    return [{ ranges, booleanRule: { ...rule.booleanRule,
      condition: { ...rule.booleanRule.condition, values: [{ userEnteredValue: formula }] } } }];
  }).sort((a, b) => Number(b.booleanRule.condition.values[0].userEnteredValue.includes('NOT(ISFORMULA')) - Number(a.booleanRule.condition.values[0].userEnteredValue.includes('NOT(ISFORMULA')));
}

/** Owner clarification 08.10: department archive contains completed outcomes only.
 * Participant shares inherit the primary outcome; money/date admission stays separate.
 */
export function completedArchiveFormula(formula) {
  // Blank dates retain the accumulated-history policy; unreadable dates never admit facts.
  formula = formula.replaceAll('DATEVALUE(датаФакта))<=Сегодня;TRUE)', 'DATEVALUE(датаФакта))<=Сегодня;FALSE)');
  // The mask already replaces parents with shares. A parent with no shares still owns its amounts.
  formula = formula.replaceAll('м*NOT(процБезДолей)', 'м');
  for (const amount of ['нмцк', 'цена', 'экономия', 'фб', 'кб', 'мб']) formula = formula.replaceAll(`IF(процБезДолей;"";${amount})`, amount);
  const oldPrimary = 'процБезДолей;ARRAYFORMULA(есть*EXACT(вид;"процедура")*(долейКода=0))';
  const primary = oldPrimary.slice(0, -1) + '*IF(EXACT(выбор;"все");1;--EXACT(упр;выбор)))';
  const oldMask = 'м;ARRAYFORMULA(--((свои+процБезДолей)>0))';
  const mask = oldMask.slice(0, -1) + '*EXACT(стд;"Состоялась"))';
  if (formula.includes(primary) && formula.includes(mask)) return formula;
  if (!formula.startsWith('=') || !formula.includes(oldPrimary) || !formula.includes(oldMask)) throw new Error('ARCHIVE_FORMULA_CONTRACT');
  return formula.replace(oldPrimary, primary).replace(oldMask, mask);
}

export function withPendingFateAction(formula, row) {
  if (!formula.startsWith('=')) throw new Error('FATE_ACTION_FORMULA_CONTRACT');
  const d = `LOWER(D${row}&"")`;
  return `=LET(действие;${formula.slice(1)};IF(действие<>"";действие;IF(AND(A${row}<>"";B${row}<>"доля";W${row}="Не состоялась");IF(REGEXMATCH(${d};"потребность пересмотрена|потребность отменена|реализовано другим способом");"";IF(REGEXMATCH(${d};"родословная: *э[а-я]+[0-9]+-[0-9]{2}");"Проверить связь, указанную в комментарии";IF(REGEXMATCH(${d};"на доработке|на доработку");"Уточнить результат доработки у заказчика";"Уточнить дальнейшее решение по потребности")));"")))`;
}

/** Svod full-grid A1:R235; counts and family graphs always retain the master. */
export function planMoneyAttribution(svod, sheetId) {
  const requests = [];
  const append = (r, c) => {
    const old = svod[r]?.[c];
    if (typeof old !== 'string' || !old.startsWith('=') || !/INDEX\(ДанныеМастера;0;(8|13|14|15|16|17)\)/u.test(old)) return;
    requests.push({ updateCells: { range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: c, endColumnIndex: c + 1 }, rows: [{ values: [{ userEnteredValue: { formulaValue: inlineMoneyAttributionFormula(old) } }] }], fields: 'userEnteredValue' } });
  };
  for (let r = 2; r < 11; r++) for (const c of [6, 7, 8, 9, 11, 12, 13, 15, 16]) append(r, c);
  for (let r = 29; r < 135; r++) for (let c = 2; c <= 8; c++) {
    if (c !== 8 || String(svod[r]?.[c]).includes('SUMIFS')) append(r, c);
  }
  return requests;
}

function formulaArguments(text) {
  const parts = []; let depth = 0; let quoted = false; let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') { if (quoted && text[i + 1] === '"') { i++; continue; } quoted = !quoted; }
    if (quoted) continue;
    if (text[i] === '(' || text[i] === '{') depth++;
    if (text[i] === ')' || text[i] === '}') depth--;
    if (text[i] === ';' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start)); return parts;
}

/** SUMIFS requires ranges; SUMPRODUCT also accepts the computed arrays below. */
function arraySumCriteria(body) {
  return body.split('SUMIFS(').map((piece, index) => {
    if (index === 0) return piece;
    let depth = 1; let quoted = false; let end = 0;
    for (; end < piece.length; end++) {
      if (piece[end] === '"') { if (quoted && piece[end + 1] === '"') { end++; continue; } quoted = !quoted; }
      if (quoted) continue;
      if (piece[end] === '(') depth++;
      if (piece[end] === ')' && --depth === 0) break;
    }
    const args = formulaArguments(piece.slice(0, end));
    if (args.length < 3 || args.length % 2 !== 1) throw new Error('SUMIFS_CONTRACT');
    const masks = [];
    for (let i = 1; i < args.length; i += 2) {
      const criteria = args[i + 1]; const literal = /^"(<>|<=|>=|=|<|>)(.*)"$/u.exec(criteria);
      masks.push(`(${args[i]}${literal?.[1] ?? '='}${literal ? `"${literal[2]}"` : criteria})`);
    }
    return `SUMPRODUCT(N(${args[0]});${masks.join(';')})${piece.slice(end + 1)}`;
  }).join('');
}

/** Known shares transfer money; the unallocated balance stays at the primary owner. */
export function inlineMoneyAttributionFormula(formula) {
  if (formula.startsWith("=LET(sourceCode;")) return formula;
  const original = formula.replaceAll('ДенежныеРазрезы', 'ДанныеМастера');
  const field = /INDEX\(ДанныеМастера;0;(\d+)\)/gu;
  const columns = [...original.matchAll(field)].map(m => Number(m[1]));
  const monetary = columns.find(n => [8, 13, 14, 15, 16, 17].includes(n));
  if (!original.startsWith('=') || monetary === undefined || !/SUM(?:PRODUCT|IFS)\(/u.test(original)) throw new Error('MONEY_FORMULA_CONTRACT');
  const names = { 1: 'code', 2: 'rowKind', 5: 'department', 8: 'cash', 10: 'publication', 12: 'resultDate', 13: 'cash', 14: 'cash', 15: 'cash', 16: 'cash', 17: 'cash', 20: 'result', 23: 'stage' };
  const direct = n => `INDEX(ДанныеМастера;0;${n})`;
  const definitions = [
    `sourceCode;${direct(1)}`, `sourceKind;${direct(2)}`,
    'primaryRows;IFERROR(FILTER(ДанныеМастера;(sourceCode<>"")*(sourceKind<>"доля"));ДанныеМастера)',
    'hasParent;ARRAYFORMULA(IFERROR(MATCH(sourceCode;INDEX(primaryRows;0;1);0);0)>0)',
    `sourceAmount;${direct(monetary)}`,
    `partTotals;IFERROR(QUERY(FILTER({sourceCode\\ARRAYFORMULA(N(sourceAmount))};sourceKind="доля");"select Col1, sum(Col2) group by Col1 label sum(Col2) ''";0);{""\\0})`,
    'cash;ARRAYFORMULA(IF(sourceKind="доля";IF(hasParent;N(sourceAmount);0);N(sourceAmount)-IFERROR(VLOOKUP(sourceCode;partTotals;2;FALSE);0)))',
  ];
  for (const n of new Set(columns)) {
    if (n === monetary) continue;
    const name = names[n]; if (!name) throw new Error(`MONEY_COLUMN_CONTRACT_${n}`);
    const value = n === 1 ? 'ARRAYFORMULA(IF((sourceKind="доля")*NOT(hasParent);"";sourceCode))'
      : n === 5 ? direct(n) : `ARRAYFORMULA(IF(sourceKind="доля";IFERROR(VLOOKUP(sourceCode;primaryRows;${n};FALSE);"");${direct(n)}))`;
    definitions.push(`${name};${value}`);
  }
  const body = arraySumCriteria(original.slice(1)).replace(field, (_, n) => names[Number(n)]);
  return `=LET(${definitions.join(';')};${body})`;
}

/** View-only labels and exact master links; source names and long subjects stay unchanged. */
export function archiveReadingFormula(formula, { fate = false, masterSheetId = 2526300 } = {}) {
  if (!formula.startsWith('=') || !formula.includes('упр;INDEX(ДанныеМастера;0;5);') || !formula.includes('FILTER(код;м)')) throw new Error('ARCHIVE_READING_CONTRACT');
  const names = `'Сводный аналитический лист'!$R$3:$R$11\\'Сводный аналитический лист'!$A$3:$A$11`;
  let result = formula.replace('упр;INDEX(ДанныеМастера;0;5);', `упр;INDEX(ДанныеМастера;0;5);кратко;ARRAYFORMULA(IFERROR(VLOOKUP(упр;{${names}};2;FALSE);упр));`)
    .replace('зак;INDEX(ДанныеМастера;0;6);', 'зак;INDEX(ДанныеМастера;0;6);краткийЗаказчик;ARRAYFORMULA(LEFT(зак;90)&IF(LEN(зак)>90;"…";""));')
    .replace('предмет;INDEX(ДанныеМастера;0;7);', 'предмет;INDEX(ДанныеМастера;0;7);краткийПредмет;ARRAYFORMULA(LEFT(предмет;110)&IF(LEN(предмет)>110;"…";""));')
    .replace('IFERROR(SORT({FILTER(код;м)', `IFERROR(SORT({MAP(FILTER(код;м);FILTER(SEQUENCE(ROWS(ДанныеМастера);1;3);м);LAMBDA(к;стр;HYPERLINK("#gid=${masterSheetId}&range=A"&стр;к)))`)
    .replace('\\FILTER(упр;м)\\', '\\FILTER(кратко;м)\\')
    .replace('\\FILTER(зак;м)\\', '\\FILTER(краткийЗаказчик;м)\\')
    .replace('\\FILTER(предмет;м)\\', '\\FILTER(краткийПредмет;м)\\');
  if (fate) {
    const text = 'ARRAYFORMULA(IF(стадия="Переоформлена";"Продолжение: "&наследник;IF(REGEXMATCH(LOWER(INDEX(ДанныеМастера;0;4)&"");"потребность пересмотрена");"В источнике: потребность пересмотрена";IF(INDEX(ДанныеМастера;0;24)<>"";INDEX(ДанныеМастера;0;24);"Уточнить дальнейшее решение по потребности")))&IF(INDEX(ДанныеМастера;0;25)<>"";" · "&LEFT(INDEX(ДанныеМастера;0;25);140);""))';
    result = result.replace('\\FILTER(INDEX(ДанныеМастера;0;25);м)', `\\FILTER(${text};м)`);
  }
  return result;
}
