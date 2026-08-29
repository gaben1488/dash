/* Генератор превью-плана переноса эталона (READ-ONLY).
 * Использование: node scripts/etalon-sync/plan.cjs --book uksimp
 * Читает свежий структ-дамп 29.08 + живые значения/валидацию, строит полный
 * дифф «было → станет» и пишет план: md (владельцу) + json (для apply).
 * В книгу НЕ ПИШЕТ. Консоль ASCII-only. */
const fs = require('fs');
const path = require('path');
const { BOOKS, DUMP_DIR, PLANS_DIR, sheetsApi, colLetter, colIndex, hexcolor, a1, loadStruct } = require('./lib.cjs');
const { goldenCF, goldenProtections, goldenValidation, FORMAT_POLICY } = require('./canon.cjs');
const { targetEditors } = require('./editors.cjs');

const bookArg = (process.argv.find((a) => a.startsWith('--book')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--book') + 1];
const BOOK = BOOKS[bookArg];
if (!BOOK) { console.log('FATAL: unknown --book'); process.exit(2); }

function colorstyle(cs, fall) {
  if (cs && cs.rgbColor) return hexcolor(cs.rgbColor);
  if (cs && cs.themeColor) return 'theme:' + cs.themeColor;
  return hexcolor(fall);
}

function describeFormat(f) {
  if (!f) return '';
  const parts = [];
  const b = colorstyle(f.backgroundColorStyle, f.backgroundColor);
  if (b) parts.push('заливка ' + b);
  const tf = f.textFormat || {};
  const fgc = colorstyle(tf.foregroundColorStyle, tf.foregroundColor);
  if (fgc) parts.push('текст ' + fgc);
  if (tf.bold) parts.push('жирный');
  return parts.join(', ');
}

function describeRule(cf) {
  const ranges = (cf.ranges || []).map((r) => a1(r)).join('; ');
  if (cf.booleanRule) {
    const c = cf.booleanRule.condition || {};
    const vals = (c.values || []).map((v) => v.userEnteredValue).join(', ');
    return `${ranges} :: ${c.type}(${vals}) -> ${describeFormat(cf.booleanRule.format)}`;
  }
  return ranges + ' :: градиент';
}

async function main() {
  const api = sheetsApi('read');
  const struct = loadStruct(BOOK.key);
  const sheet = struct.spreadsheet.sheets.find((s) => s.properties.title === BOOK.main);
  if (!sheet) { console.log('FATAL: main sheet not found in dump'); process.exit(2); }
  const sheetId = sheet.properties.sheetId;
  const rowCount = sheet.properties.gridProperties.rowCount;

  // ---- живое чтение: значения для счётчиков/справочника, валидация строки 4,
  //      Settings и _Настройки ----
  const q = (r) => `'${BOOK.main.replace(/'/g, "''")}'!${r}`;
  const values = await api.spreadsheets.values.batchGet({
    spreadsheetId: BOOK.id,
    ranges: [q('B4:B'), q('C4:C'), q('D4:D'), q('E4:E'), q('L4:L'), "'Settings'!A1:C10", "'_Настройки'!A1:C12", "'_Настройки'!H2:H300"],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const [vB, vC, vD, vE, vL, vSettings, vNastr, vHDict] = values.data.valueRanges.map((r) => r.values || []);
  const flat = (rows) => rows.map((r) => (r[0] === undefined || r[0] === null ? '' : String(r[0]).trim())).filter((s) => s !== '');
  const count = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return m; };

  const dvResp = await api.spreadsheets.get({
    spreadsheetId: BOOK.id,
    ranges: [q('4:4')],
    fields: 'sheets(data(startColumn,rowData(values(dataValidation))))',
  });
  const dvRow = ((((dvResp.data.sheets || [])[0] || {}).data || [])[0] || {});
  const curValidation = {};
  ((dvRow.rowData || [])[0] || { values: [] }).values.forEach((v, j) => {
    if (v && v.dataValidation) curValidation[colLetter((dvRow.startColumn || 0) + j)] = v.dataValidation;
  });

  // ---- текущее состояние из структ-дампа ----
  const curCF = sheet.conditionalFormats || [];
  const curProt = sheet.protectedRanges || [];
  // Р4 (29.08.2026): ядро + персоны книги (аналоги vysotskaya717 в УО).
  const editorsUnion = targetEditors(bookArg);

  // ---- форматная сетка (свежая, 29.08) ----
  let whiteCells = 0, themeCells = 0, calibriIslands = 0, overflowCells = 0;
  const numFmtDust = new Map();
  const fmtPath = path.join(DUMP_DIR, BOOK.key + '-VSE-formats.json');
  const fmtPathAlt = path.join(DUMP_DIR, BOOK.key + '-MAIN-formats.json');
  const gridFile = fs.existsSync(fmtPath) ? fmtPath : (fs.existsSync(fmtPathAlt) ? fmtPathAlt : null);
  if (gridFile) {
    const grid = JSON.parse(fs.readFileSync(gridFile, 'utf8'));
    grid.rowData.forEach((row, i) => {
      if (i < 3) return; // тело
      (row.values || []).forEach((v, j) => {
        const f = (v || {}).userEnteredFormat;
        if (!f) return;
        const cs = f.backgroundColorStyle;
        const bgHex = cs && cs.rgbColor ? hexcolor(cs.rgbColor) : (cs && cs.themeColor ? 'theme' : hexcolor(f.backgroundColor));
        if (bgHex === '#FFFFFF') whiteCells++;
        else if (bgHex === 'theme') themeCells++;
        const tf = f.textFormat || {};
        if (tf.fontFamily && tf.fontFamily !== 'Arial') calibriIslands++;
        if (!tf.fontFamily && f.textFormat) calibriIslands += 0; // семейство не задано — канон закроет колонкой
        if (f.wrapStrategy === 'OVERFLOW_CELL' || f.wrapStrategy === 'CLIP') overflowCells++;
        const nf = f.numberFormat;
        if (nf && nf.pattern) {
          const col = colLetter(j);
          const canonMoney = FORMAT_POLICY.moneyCols.includes(col) && nf.pattern === FORMAT_POLICY.moneyFormat.pattern;
          const canonDate = FORMAT_POLICY.dateCols.includes(col) && nf.pattern === FORMAT_POLICY.dateFormat.pattern;
          if ((FORMAT_POLICY.moneyCols.includes(col) && !canonMoney) || (FORMAT_POLICY.dateCols.includes(col) && !canonDate)) {
            const k = col + ' ' + nf.pattern;
            numFmtDust.set(k, (numFmtDust.get(k) || 0) + 1);
          }
        }
      });
    });
  }

  // ---- целевое ----
  const bCounts = count(flat(vB));
  const grbsValue = [...bCounts.entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0])[0] || null;
  const golden = goldenCF(sheetId);
  const targetProt = goldenProtections(sheetId, editorsUnion, { keepAD: curProt.some((p) => p.range && p.range.startColumnIndex === colIndex('AD')) });
  const targetVal = goldenValidation(grbsValue);

  // ---- справочник ----
  const cVal = curValidation.C || {};
  const lawList = (cVal.condition && cVal.condition.type === 'ONE_OF_LIST' && cVal.condition.values)
    ? cVal.condition.values.map((v) => v.userEnteredValue) : [];
  const curStatic = flat(vHDict); // утверждённый словарь H, если уже ведётся (УО)
  const factC = [...count(flat(vC)).entries()].sort((x, y) => y[1] - x[1]);
  const factSet = new Set(factC.map((e) => e[0]));
  const listSet = new Set([...lawList, ...curStatic]);
  const union = Array.from(new Set([...factC.map((e) => e[0]), ...lawList, ...curStatic]))
    .filter((s) => s && s !== 'X')
    .sort((a2, b2) => a2.localeCompare(b2, 'ru'));
  union.push('X');
  const dictPrograms = [...count(flat(vD)).entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0]);
  const dictSub = [...count(flat(vE)).entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0]);

  const lCounts = [...count(flat(vL)).entries()].sort((x, y) => y[1] - x[1]);
  const badL = lCounts.filter(([v]) => v !== 'ЕП' && v !== 'ЭА');

  // ---- Settings ----
  const settingsB3 = ((vSettings[2] || [])[1] || '');

  // ================= рендер плана =================
  const stamp = new Date().toISOString().slice(0, 10);
  const planName = `${stamp}-v1-${bookArg}-${BOOK.main}`;
  const md = [];
  const w = (s) => md.push(s);

  w(`# План В1: ${BOOK.ru}, лист «${BOOK.main}» — перенос эталона`);
  w('');
  w(`> Построен ${new Date().toISOString()} от структ-дампа 29.08 + живых значений.`);
  w('> ПРАВОК НЕ ВНЕСЕНО. Применение — только после однозначного «да» владельца');
  w('> на этот файл (можно «да, кроме пункта N»). Каждый пункт нумерован.');
  w('');
  w(`Лист: ${rowCount}×34, sheetId ${sheetId}. Редакторы защит (Р4: ядро + персоны книги, см. r4-editors-matrix):`);
  w(editorsUnion.map((e) => '`' + e + '`').join(', '));
  w('');

  w('## П1. Условное форматирование: полная замена набора');
  w('');
  w(`### Удаляются все текущие правила (${curCF.length}):`);
  curCF.forEach((cf, i) => w(`- [${i}] ${describeRule(cf)}`));
  w('');
  w(`### Устанавливается золотой набор (${golden.length}), порядок = приоритет:`);
  golden.forEach((g, i) => {
    const rr = g.ranges.map((r) => a1(r)).join('; ');
    const c = g.rule.condition;
    const vals = (c.values || []).map((v) => v.userEnteredValue).join(', ');
    w(`- [${i + 1}] **${g.name}** — ${rr} :: ${c.type}${vals ? '(' + vals + ')' : ''} -> ${describeFormat(g.rule.format)}`);
  });
  w('');

  w('## П2. Защиты: полная замена');
  w('');
  w(`### Удаляются текущие (${curProt.length}):`);
  curProt.forEach((p) => {
    const where = p.range && Object.keys(p.range).filter((k) => k !== 'sheetId').length ? a1(p.range) : 'лист целиком';
    w(`- ${where}${p.description ? ' | ' + p.description : ''} | редакторов ${((p.editors || {}).users || []).length}`);
  });
  w('');
  w(`### Устанавливаются (${targetProt.length}), все жёсткие, диапазоны до низа листа, редакторы — объединение выше:`);
  targetProt.forEach((p) => w(`- ${a1(p.range)} | ${p.description}`));
  w('');

  w('## П3. Проверка данных (валидация) по колонкам');
  w('');
  w('| Колонка | Сейчас (по строке 4) | Станет |');
  w('|---|---|---|');
  const allCols = new Set([...Object.keys(curValidation), ...Object.keys(targetVal).filter((k) => k !== '_clear' && targetVal[k])]);
  [...allCols].sort((x, y) => colIndex(x) - colIndex(y)).forEach((col) => {
    const cur = curValidation[col];
    const curTxt = cur ? `${cur.condition.type}${cur.strict ? ' strict' : ''}` : '—';
    const tgt = targetVal[col];
    let tgtTxt = '—';
    if (targetVal._clear.includes(col)) tgtTxt = 'СНЯТЬ (роль у защиты + УФ)';
    else if (tgt) {
      const vals = (tgt.condition.values || []).map((v) => v.userEnteredValue).join(', ');
      tgtTxt = `${tgt.condition.type}(${vals.length > 80 ? vals.slice(0, 77) + '…' : vals})${tgt.strict ? ' strict' : ''}`;
    }
    w(`| ${col} | ${curTxt} | ${tgtTxt} |`);
  });
  w('');
  w(`Значение для B (ГРБС, по факту данных): **${grbsValue}** (${[...bCounts.entries()].map(([v, n]) => v + '×' + n).join(', ')})`);
  w('');

  w('## П4. Справочник подведов в «_Настройки» (создаётся блок E:J)');
  w('');
  w('- E1:G1 — заголовки «Учреждения (факт)», «Программы (факт)», «Мероприятия (факт)»; E2/F2/G2 — формулы динамики:');
  w("  `=SORT(UNIQUE(FILTER('" + BOOK.main + "'!C4:C; '" + BOOK.main + "'!C4:C<>\"\")))` (аналогично D и E).");
  w('- H1:J1 — «Учреждение (Справочник)», «Программа (Справочник)», «Подпрограмма (Справочник)»; статика ниже.');
  w('- Правка справочника = правка H/I/J; выпадающие списки листа читают их открытым диапазоном (Р2).');
  w('');
  w(`### Статика H (учреждения), предлагаемый состав (${union.length}):`);
  union.forEach((u) => {
    const marks = [];
    if (!factSet.has(u) && listSet.has(u)) marks.push('только в старом зашитом списке — В ДАННЫХ НЕ ВСТРЕЧАЕТСЯ');
    if (factSet.has(u) && !listSet.has(u) && listSet.size) marks.push('есть в данных, в старом списке не было');
    w(`- ${u}${marks.length ? '  ⟵ ' + marks.join('; ') : ''}`);
  });
  w('');
  w(`### Статика I (программы, из данных, ${dictPrograms.length}):`);
  dictPrograms.forEach((p) => w(`- ${p.length > 140 ? p.slice(0, 137) + '…' : p}`));
  w('');
  w(`### Статика J (мероприятия, из данных): ${dictSub.length} позиций (полный список в JSON плана).`);
  w('');

  w('## П5. Форматы тела (строки 4..низ)');
  w('');
  w(`- [П5.1] Стереть белую статическую заливку (Р6, основной лист — только белую): ~${whiteCells} яч. #FFFFFF + ${themeCells} яч. theme:BACKGROUND. Цветные заливки не трогаются.`);
  w(`- [П5.2] Числовые форматы к канону: деньги ${FORMAT_POLICY.moneyCols.join(',')} -> #,##0.00; даты N,Q -> dd.mm.yyyy. Сейчас пыли: ${[...numFmtDust.entries()].map(([k, n]) => k + '×' + n).join('; ') || 'нет'}.`);
  w(`- [П5.3] Шрифт тела: Arial 10 всем колонкам (жирность и цвета текста не трогаются). Островков не-Arial: ${calibriIslands}.`);
  w(`- [П5.4] Перенос: WRAP всему телу (сейчас OVERFLOW/CLIP: ${overflowCells} яч.).`);
  w('');

  w('## П6. Остальное по листу');
  w('');
  w('- [П6.1] Банда (чередование): привести к канону УО «ВСЕ» — без цвета шапки, полосы #FFFFFF/#FBF9F9, диапазон A4 до низа. (Сейчас: #FFFFFF/#F5F5F5 c шапкой.)');
  w('- [П6.2] Базовый фильтр: перепривязать к A3:AH до низа (сейчас A3:AF685 — не покрывает AG:AH и обрезан).');
  w('- [П6.3] Фильтр-виды «Нечаева», «УЭР аналитика закупок»: перепривязать до низа (сейчас до 679).');
  w('- [П6.4] Показать скрытые колонки AG:AH (канон УО — видимы).');
  w('');

  w('## П7. Служебные листы');
  w('');
  const nastrKeys = vNastr.map((r) => (r[0] || '')).filter(Boolean).join(' | ');
  w(`- Служебная часть «_Настройки» (колонка A, не трогается): ${nastrKeys}`);
  w(`- [П7.1] Settings!B3: «${settingsB3}» -> «ЭА» (Р3).`);
  const lTxt = lCounts.map(([v, n]) => `«${v}»×${n}`).join(', ');
  w(`- Факт по колонке L листа «${BOOK.main}»: ${lTxt || 'пусто'}.`);
  if (badL.length) w(`- ВНИМАНИЕ: неканонических значений L: ${badL.map(([v, n]) => `«${v}»×${n}`).join(', ')} — строки станут красными по УФ; данные НЕ правим (отдельное решение).`);
  w('');
  w('> Вне плана (следующие волны): подвед-листы книги (В1б, тёмные -> канон УО, заливки долой), «_Настройки» служебная часть не трогается.');

  fs.mkdirSync(PLANS_DIR, { recursive: true });
  fs.writeFileSync(path.join(PLANS_DIR, planName + '.md'), md.join('\n'), 'utf8');

  const planJson = {
    createdAt: new Date().toISOString(),
    book: bookArg, bookKey: BOOK.key, spreadsheetId: BOOK.id, sheetTitle: BOOK.main, sheetId, rowCount,
    baseline: { cfCount: curCF.length, protCount: curProt.length, protectedRangeIds: curProt.map((p) => p.protectedRangeId) },
    editors: editorsUnion,
    golden: { cf: golden, protections: targetProt, validation: targetVal, grbsValue },
    dictionary: { institutions: union, programs: dictPrograms, subprograms: dictSub },
    formats: FORMAT_POLICY,
    settings: { b3: 'ЭА' },
    approved: false,
  };
  fs.writeFileSync(path.join(PLANS_DIR, planName + '.json'), JSON.stringify(planJson, null, 1), 'utf8');
  console.log('PLAN WRITTEN ' + planName + ' cfDel=' + curCF.length + ' cfAdd=' + golden.length + ' protDel=' + curProt.length + ' protAdd=' + targetProt.length);
}

main().catch((e) => { console.log('FATAL: ' + String(e && e.message ? e.message : e).slice(0, 300)); process.exit(1); });
