/** Native presentation changes only. Source facts, IDs and stage fills stay intact. */
export function addressedRemarkRules(sheet) {
  const id = sheet.properties.sheetId;
  const configs = {
    2526403: { row: 4, note: '$P4', map: { A:'A', B:'B', C:'E', D:'F', E:'G', F:'H', G:'M', H:'Q', I:'N', J:'O', K:'P', L:'R', M:'T', N:'W', O:'V', P:'Y' } },
    2526402: { row: 2, note: '$P2', map: { A:'A', B:'B', C:'E', D:'F', E:'G', F:'H', G:'M', H:'Q', I:'N', J:'O', K:'P', L:'T', M:'W', N:'R', O:'B', P:'Y' } },
    2526401: { row: 2, note: 'IF(COUNTIFS(INDEX(ДанныеМастера;0;1);$A2;INDEX(ДанныеМастера;0;2);"<>доля")=1;IFERROR(INDEX(FILTER(INDEX(ДанныеМастера;0;25);INDEX(ДанныеМастера;0;1)=$A2;INDEX(ДанныеМастера;0;2)<>"доля");1);"");"")', map: { A:'A', B:'E', C:'F', D:'G', E:'H', F:'L', G:'T', H:'W', J:'V', L:'X' } },
  };
  const config = configs[id];
  if (!config) return [];
  const requests = [];
  const rules = sheet.conditionalFormats ?? [];
  const generic = rules.flatMap((r,i) => {
    const f = r.booleanRule?.condition?.values?.[0]?.userEnteredValue ?? '';
    return /FIND\("; (Ошибка|Проверить|Неполно): /u.test(f) && r.ranges.some(x => (x.endColumnIndex - x.startColumnIndex) > 1) ? [i] : [];
  });
  if (!generic.length) return requests;
  for (const index of generic.reverse()) requests.push({ deleteConditionalFormatRule: { sheetId:id, index } });
  const shades = { 'Ошибка': { red:1,green:.886,blue:.886 }, 'Проверить': { red:1,green:.957,blue:.827 }, 'Неполно': { red:.898,green:.949,blue:1 } };
  const width = Math.max(...Object.keys(config.map).map(col => col.charCodeAt(0)-64));
  const note = config.note.replaceAll('ДанныеМастера', 'INDIRECT("ДанныеМастера")');
  const source = `CHOOSE(COLUMN(A${config.row});${Array.from({length:width},(_,i)=>`"${config.map[String.fromCharCode(65+i)] ?? 'NONE'}"`).join(';')})`;
  for (const [level, color] of Object.entries(shades)) {
    const match = `IF(${source}="Y";ISNUMBER(SEARCH("${level}:";${note}));REGEXMATCH(${note}&"";"(?:^|; )${level}: [^;]* — "&${source}&"(?:$|;)"))`;
    requests.push({ addConditionalFormatRule: { index:0, rule: { ranges:[{sheetId:id,startRowIndex:config.row-1,endRowIndex:sheet.properties.gridProperties.rowCount,startColumnIndex:0,endColumnIndex:width}], booleanRule:{condition:{type:'CUSTOM_FORMULA',values:[{userEnteredValue:`=AND($A${config.row}<>"";${match})`}]},format:{backgroundColor:color}} } } });
  }
  return requests;
}

export function nativeMoneyPresentationRequests(sheets) {
  const requests = sheets.flatMap(addressedRemarkRules);
  const show = (id,start,end,width) => requests.push({updateDimensionProperties:{range:{sheetId:id,dimension:'COLUMNS',startIndex:start,endIndex:end},properties:{hiddenByUser:false,pixelSize:width},fields:'hiddenByUser,pixelSize'}});
  show(2526400,7,8,155); show(2526401,12,13,265); show(2526401,13,14,75); show(2526401,14,16,160); show(2526402,17,18,265); show(2526402,18,20,160);
  requests.push({updateCells:{range:{sheetId:2526400,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:1},rows:[{values:[{userEnteredValue:{formulaValue:'="В работе: "&COUNTIF(D3:D1002;"?*")&" · НМЦК: "&TEXT(SUM(H3:H1002);"#,##0.00")&" ₽. Код открывает строку реестра. Дата — ориентир. Проверки закрытых процедур: "&COUNTIF(O3:O1002;"?*")&" — справа."'}}]}],fields:'userEnteredValue'}});
  return requests;
}

/** Keep unallocated participant money at the primary department, including partial allocations. */
export function archiveResidualFormula(formula) {
  if (formula.includes('нмцкИсточник;')) return formula;
  const fields = { нмцк:8, цена:13, экономия:17, фб:14, кб:15, мб:16 };
  const used = [];
  for (const [name, column] of Object.entries(fields)) {
    const old = `${name};INDEX(ДанныеМастера;0;${column});`;
    if (!formula.includes(old)) continue;
    used.push(name);
    const raw = `${name}Источник`;
    const totals = `IFERROR(QUERY(FILTER({код\\ARRAYFORMULA(N(${raw}))};вид="доля");"select Col1, sum(Col2) group by Col1 label sum(Col2) ''";0);{""\\0})`;
    formula = formula.replace(old, `${raw};INDEX(ДанныеМастера;0;${column});${name};ARRAYFORMULA(IF(вид="доля";${raw};IF(ISNUMBER(${raw});${raw}-IFERROR(VLOOKUP(код;${totals};2;FALSE);0);"")));`);
  }
  if (!used.includes('нмцк') || !formula.includes('(долейКода=0)')) throw new Error('ARCHIVE_RESIDUAL_CONTRACT');
  const residual = used.map(name => `(ABS(N(${name}))>1/100)`).join('+');
  return formula.replace('(долейКода=0)', `(((долейКода=0)+(${residual})+NOT(ISNUMBER(нмцкИсточник)))>0)`);
}

export function preserveFateComment(formula) {
  const old = 'IF(REGEXMATCH(LOWER(INDEX(ДанныеМастера;0;4)&"");"потребность пересмотрена");"В источнике: потребность пересмотрена";';
  const replacement = 'IF(INDEX(ДанныеМастера;0;4)<>"";"Комментарий источника: "&INDEX(ДанныеМастера;0;4);';
  if (formula.includes(replacement)) return formula;
  if (!formula.includes(old)) throw new Error('FATE_COMMENT_CONTRACT');
  return formula.replace(old, replacement);
}

export function jointMoneySummaryRequest() {
  const col = n => `INDEX(ДанныеМастера;0;${n})`;
  const primary = `(${col(1)}<>"")*(${col(2)}<>"доля")*((${col(2)}="процедура")+REGEXMATCH(${col(1)}&"";"^ЭАС")>0)`;
  const admitted = `${primary}*(${col(23)}="Состоялась")*IF(TRIM(${col(12)}&"")="";TRUE;IFERROR(IF(ISNUMBER(${col(12)});${col(12)};DATEVALUE(${col(12)}))<=Сегодня;FALSE))`;
  const sum = (mask,n) => `SUMPRODUCT(${mask};N(${col(n)}))`;
  const count = mask => `SUMPRODUCT(${mask})`;
  const entries = [['НМЦК текущих процедур',`${primary}*(${col(23)}<>"Переоформлена")`,8],['НМЦК учтённых результатов',admitted,8],['Цена по учтённым итогам',admitted,13],['Экономия учтённых результатов',admitted,17],['Экономия · ФБ',admitted,14],['Экономия · КБ',admitted,15],['Экономия · МБ',admitted,16],['Переоформленные · история',`${primary}*(${col(23)}="Переоформлена")`,8]];
  const cell = value => ({userEnteredValue:value.startsWith('=') ? {formulaValue:value} : {stringValue:value}});
  return {updateCells:{start:{sheetId:2526402,rowIndex:2,columnIndex:17},rows:[{values:['Показатель','Процедур','Сумма, руб.'].map(cell)},...entries.map(([label,mask,n])=>({values:[label,`=${count(mask)}`,`=${sum(mask,n)}`].map(cell)}))],fields:'userEnteredValue'}};
}


/** Convert legacy ten-column A:J queue spill to A:I without losing signals.
 * Column J belongs exclusively to the visual separator. Must read A3 live
 * before applying, and preserve code D / money H / right queue O:X.
 */
export function queueFormulaWithEmptyJSeparator(formula) {
  const oldColumns = '{due\\days\\act\\links\\dept\\cust\\subj\\money\\st\\msg}';
  const newColumns = '{due\\days\\actionWithSignal\\links\\dept\\cust\\subj\\money\\st}';
  const combinedAction = 'actionWithSignal;ARRAYFORMULA(IF(msg="";act;IF(act="";msg;act&CHAR(10)&msg)))';
  if (formula.includes(newColumns) && formula.includes(combinedAction)) return formula;
  if (!formula.includes(oldColumns) || !formula.includes(';IF(SUM(m)=0;')) {
    throw new Error('QUEUE_EMPTY_J_CONTRACT');
  }
  let next = formula.replace(oldColumns, newColumns);
  next = next.replace(';IF(SUM(m)=0;', ';' + combinedAction + ';IF(SUM(m)=0;');
  const begin = next.indexOf('{"Нет процедур в работе"');
  const end = next.indexOf(';SORT', begin);
  if (begin < 0 || end < 0 || next.slice(begin, end).split('\\').length !== 10) {
    throw new Error('QUEUE_EMPTY_J_FALLBACK_CONTRACT');
  }
  const fallback = '{"Нет процедур в работе"' + Array(8).fill('\\' + '""').join('') + '}';
  return next.slice(0, begin) + fallback + next.slice(end);
}
