/* QA-приёмка: глубокая сверка «канон ↔ факт» по всем 8 книгам.
 * Оси: УФ пословно (формулы/диапазоны/цвета), защиты (диапазон+описание+
 * редакторы), валидация (тип+строгость), банда, фильтр-виды, колонки,
 * форматы (проба), справочник, Settings, формульная целостность K..AC,
 * подведы (16 УФ, 34 колонки, защита с целевыми редакторами).
 * Отчёт: ПОЛНЫЙ перечень отклонений. Консоль ASCII. */
const fs = require('fs');
const { BOOKS, sheetsApi, colIndex, colLetter, hexcolor, a1 } = require('./lib.cjs');
const { goldenCF, goldenProtections, goldenValidation, BANDING } = require('./canon.cjs');
const { targetEditors } = require('./editors.cjs');

const CF_FULL = goldenCF(0).length;
const CF_VISUAL = goldenCF(0, { visualOnly: true }).length;
const SERVICE = new Set(['_Настройки', '_ChangeLog', 'Контроль', 'Settings', 'GOOGLE_ФОРМУЛЫ']);
const FORMULA_COLS = ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normFormula(f, row) {
  if (!f) return '';
  return String(f).replace(new RegExp('([A-Za-zА-Яа-я\\$])' + row + '(?!\\d)', 'g'), '$1#').replace(/\s+/g, '');
}
/* Google материализует открытый конец диапазона в rowCount листа при
 * сохранении правила — для сравнения нормализуем такой конец обратно. */
function normRanges(ranges, rowCount) {
  return (ranges || []).map((r) => {
    if (r.endRowIndex === rowCount) { const c = Object.assign({}, r); delete c.endRowIndex; return c; }
    return r;
  });
}
function cfKey(rule, ranges) {
  const cond = rule.condition || {};
  const vals = (cond.values || []).map((v) => String(v.userEnteredValue || '').replace(/\s+/g, '')).join('|');
  const fmt = rule.format || {};
  const bg = fmt.backgroundColorStyle && fmt.backgroundColorStyle.rgbColor ? hexcolor(fmt.backgroundColorStyle.rgbColor) : (fmt.backgroundColor ? hexcolor(fmt.backgroundColor) : '-');
  const tf = fmt.textFormat || {};
  const fg = tf.foregroundColorStyle && tf.foregroundColorStyle.rgbColor ? hexcolor(tf.foregroundColorStyle.rgbColor) : (tf.foregroundColor ? hexcolor(tf.foregroundColor) : '-');
  const rr = (ranges || []).map((r) => a1(r)).sort().join(',');
  return [cond.type, vals, bg, fg, tf.bold ? 'B' : '-', rr].join(' :: ');
}

(async () => {
  const api = sheetsApi('read');
  const out = ['# QA-приёмка эталона — ' + new Date().toISOString(), ''];
  let totalIssues = 0;
  for (const arg of Object.keys(BOOKS)) {
    const b = BOOKS[arg];
    const issues = [];
    const info = [];
    const struct = (await api.spreadsheets.get({ spreadsheetId: b.id, fields: 'sheets(properties,protectedRanges,conditionalFormats,bandedRanges,basicFilter,filterViews)' })).data;
    const main = struct.sheets.find((s) => s.properties.title === b.main);
    const sheetId = main.properties.sheetId;

    // 1. УФ пословно
    const rowCount = main.properties.gridProperties.rowCount;
    const want = goldenCF(sheetId).map((g) => cfKey(g.rule, normRanges(g.ranges, rowCount)));
    const got = (main.conditionalFormats || []).map((r) => cfKey(r.booleanRule || {}, normRanges(r.ranges, rowCount)));
    if (want.length !== got.length) issues.push(`УФ: правил ${got.length}, канон ${want.length}`);
    for (let i = 0; i < Math.min(want.length, got.length); i++) {
      if (want[i] !== got[i]) issues.push(`УФ[${i + 1}] расходится:\n    канон: ${want[i]}\n    факт : ${got[i]}`);
    }

    // 2. Защиты
    const keepAD = (main.protectedRanges || []).some((p) => p.range && p.range.startColumnIndex === 29);
    const targetProt = goldenProtections(sheetId, targetEditors(arg), { keepAD });
    const gotProt = main.protectedRanges || [];
    if (targetProt.length !== gotProt.length) issues.push(`Защит: ${gotProt.length}, канон ${targetProt.length}`);
    for (const t of targetProt) {
      const m = gotProt.find((p) => (p.description || '') === t.description);
      if (!m) { issues.push(`Защита «${t.description}» отсутствует`); continue; }
      const wantE = new Set(t.editors.users); const gotE = new Set(((m.editors || {}).users) || []);
      const missing = [...wantE].filter((u) => !gotE.has(u));
      const extra = [...gotE].filter((u) => !wantE.has(u));
      if (missing.length) issues.push(`Защита «${t.description}»: нет редакторов ${missing.join(', ')}`);
      if (extra.length) info.push(`Защита «${t.description}»: лишние редакторы ${extra.join(', ')}`);
      if (a1(m.range) !== a1(t.range)) issues.push(`Защита «${t.description}»: диапазон ${a1(m.range)} ≠ ${a1(t.range)}`);
    }

    // 3. Банда, фильтры, колонки
    const band = ((main.bandedRanges || [])[0] || {}).rowProperties || {};
    const second = band.secondBandColorStyle && band.secondBandColorStyle.rgbColor ? hexcolor(band.secondBandColorStyle.rgbColor) : null;
    if (second !== BANDING.secondBand) issues.push(`Банда: ${second} ≠ ${BANDING.secondBand}`);
    if (main.basicFilter) issues.push('Базовый фильтр не убран');
    const views = (main.filterViews || []).map((f) => f.title).sort();
    const wantViews = ['ИСПОЛНИТЕЛЬ', 'КООРДИНАТОР', 'УЭР'];
    if (JSON.stringify(views) !== JSON.stringify(wantViews)) issues.push(`Виды: [${views.join(', ')}] ≠ [${wantViews.join(', ')}]`);
    for (const fv of main.filterViews || []) {
      if (fv.range && fv.range.endRowIndex && fv.range.endRowIndex < rowCount) {
        issues.push(`Вид «${fv.title}» короче листа (${fv.range.endRowIndex} < ${rowCount})`);
      }
    }

    // 4. Валидация + форматы + скрытость колонок (грид-проба строк 4-5)
    const grid = (await api.spreadsheets.get({
      spreadsheetId: b.id,
      ranges: [`'${b.main.replace(/'/g, "''")}'!A4:AH5`],
      fields: 'sheets(data(rowData(values(dataValidation(condition(type),strict),userEnteredFormat(numberFormat,wrapStrategy,textFormat(fontFamily,fontSize)))),columnMetadata(hiddenByUser,pixelSize)))',
    })).data.sheets[0];
    const row4 = ((grid.data[0].rowData || [])[0] || {}).values || [];
    const gv = goldenValidation(null);
    for (const [col, spec] of Object.entries(gv)) {
      if (col === '_clear') continue;
      const cell = row4[colIndex(col)] || {};
      const dv = cell.dataValidation;
      if (spec) {
        if (!dv) { issues.push(`Валидация ${col}: отсутствует (канон ${spec.condition.type})`); continue; }
        if (dv.condition.type !== spec.condition.type) issues.push(`Валидация ${col}: ${dv.condition.type} ≠ ${spec.condition.type}`);
        if (spec.strict && !dv.strict) issues.push(`Валидация ${col}: не строгая`);
      }
    }
    for (const col of gv._clear) {
      const cell = row4[colIndex(col)] || {};
      if (cell.dataValidation) issues.push(`Валидация ${col}: должна быть снята (формульная колонка)`);
    }
    const row5 = ((grid.data[0].rowData || [])[1] || {}).values || [];
    const f5 = (col) => ((row5[colIndex(col)] || {}).userEnteredFormat || {});
    for (const col of ['H', 'K', 'V', 'AC']) {
      const nf = (f5(col).numberFormat || {}).pattern || '-';
      if (nf !== '#,##0.00') issues.push(`Формат ${col}5: «${nf}» ≠ #,##0.00`);
    }
    for (const col of ['N', 'Q']) {
      const nf = (f5(col).numberFormat || {}).pattern || '-';
      if (nf !== 'dd.mm.yyyy') issues.push(`Формат ${col}5: «${nf}» ≠ dd.mm.yyyy`);
    }
    const gf = f5('G');
    if ((gf.wrapStrategy || '-') !== 'WRAP') issues.push(`G5 wrap: ${gf.wrapStrategy}`);
    const gtf = gf.textFormat || {};
    if (gtf.fontFamily && gtf.fontFamily !== 'Arial') issues.push(`G5 шрифт: ${gtf.fontFamily}`);
    const colsMeta = grid.data[0].columnMetadata || [];
    [32, 33].forEach((ci) => { if ((colsMeta[ci] || {}).hiddenByUser) issues.push(`Колонка ${colLetter(ci)} скрыта`); });

    // 4b. Размеры колонок по канону УО (проба: A, G, M, U, AH)
    const dimsCanon = JSON.parse(fs.readFileSync('E:/aemr-dumps/etalon-sync/plans/uo-dims-canon.json', 'utf8'))['ВСЕ'].cols;
    const colMeta2 = grid.data[0].columnMetadata || [];
    for (const cn of ['A', 'G', 'M', 'U', 'AH']) {
      const ci = colIndex(cn);
      const px = (colMeta2[ci] || {}).pixelSize;
      if (px !== undefined && px !== dimsCanon[ci]) issues.push(`Ширина ${cn}: ${px} ≠ ${dimsCanon[ci]}`);
    }

    // 5. Справочник + Settings
    const vals = (await api.spreadsheets.values.batchGet({
      spreadsheetId: b.id,
      ranges: ["'_Настройки'!E1:J1", "'_Настройки'!H2:H4", "'Settings'!B3", `'${b.main.replace(/'/g, "''")}'!A4:A`],
    })).data.valueRanges;
    const heads = (vals[0].values || [[]])[0];
    if ((heads[3] || '') !== 'Учреждение (Справочник)') issues.push(`_Настройки H1: «${heads[3] || ''}»`);
    if (!((vals[1].values || []).length)) issues.push('_Настройки: статика H пуста');
    const b3 = ((vals[2].values || [[]])[0][0] || '');
    if (b3 !== 'ЭА') issues.push(`Settings!B3: «${b3}» ≠ ЭА`);
    const lastDataRow = 3 + (vals[3].values || []).length;

    // 6. Формульная целостность K..AC
    const q = (r) => `'${b.main.replace(/'/g, "''")}'!${r}`;
    const fResp = await api.spreadsheets.values.batchGet({
      spreadsheetId: b.id,
      ranges: FORMULA_COLS.map((c) => q(`${c}4:${c}${lastDataRow}`)),
      valueRenderOption: 'FORMULA',
    });
    let broken = 0, holes = 0;
    const examples = [];
    fResp.data.valueRanges.forEach((vr, ci) => {
      const col = FORMULA_COLS[ci];
      const rows = vr.values || [];
      const etalon = normFormula((rows[0] || [])[0], 4);
      if (!etalon || !String((rows[0] || [])[0]).startsWith('=')) { issues.push(`Формула-эталон ${col}4 не формула`); return; }
      for (let i = 1; i < rows.length; i++) {
        const raw = (rows[i] || [])[0];
        const rowN = 4 + i;
        if (raw === undefined || raw === '') { holes++; continue; }
        if (normFormula(raw, rowN) !== etalon) {
          broken++;
          const anum = ((vals[3].values || [])[i] || [])[0];
          if (examples.length < 12) examples.push(`${col}${rowN} (закупка №${anum ?? '?'}): ${String(raw).slice(0, 60)}`);
        }
      }
    });
    if (broken) { issues.push(`Перебитых формул: ${broken}. Примеры: ${examples.join(' | ')}`); }
    if (holes) info.push(`Пустых ячеек внутри формульных колонок (дыры): ${holes}`);

    // 7. Подведы
    let podCount = 0, podBad = 0;
    for (const sh of struct.sheets) {
      const t = sh.properties.title;
      if (t === b.main || SERVICE.has(t) || sh.properties.sheetType === 'OBJECT') continue;
      podCount++;
      const cf = (sh.conditionalFormats || []).length;
      if (cf !== CF_VISUAL) { podBad++; issues.push(`Подвед «${t}»: УФ ${cf} ≠ ${CF_VISUAL}`); }
      if (sh.properties.gridProperties.columnCount !== 34) issues.push(`Подвед «${t}»: колонок ${sh.properties.gridProperties.columnCount}`);
      const pb = ((sh.bandedRanges || [])[0] || {}).rowProperties || {};
      const ps = pb.secondBandColorStyle && pb.secondBandColorStyle.rgbColor ? hexcolor(pb.secondBandColorStyle.rgbColor) : null;
      if (ps !== BANDING.secondBand) issues.push(`Подвед «${t}»: банда ${ps}`);
      const whole = (sh.protectedRanges || []).find((p) => !p.range || Object.keys(p.range).every((k) => k === 'sheetId'));
      if (!whole) issues.push(`Подвед «${t}»: нет защиты листа`);
      else {
        const eds = new Set(((whole.editors || {}).users) || []);
        const missing = targetEditors(arg).filter((u) => !eds.has(u));
        if (missing.length) issues.push(`Подвед «${t}»: в защите нет ${missing.join(', ')}`);
      }
    }

    out.push(`## ${b.ru} — ${issues.length ? 'ОТКЛОНЕНИЙ: ' + issues.length : 'PASS'} (подведов ${podCount})`);
    for (const i of issues) out.push('- ⚠ ' + i);
    for (const i of info) out.push('- ℹ ' + i);
    out.push('');
    totalIssues += issues.length;
    await sleep(1200);
  }
  out.push(totalIssues ? `ИТОГ: ${totalIssues} отклонений — НЕ ПРИНЯТО, см. ⚠` : 'ИТОГ: отклонений нет — ГОТОВО К ПРИЁМКЕ.');
  fs.writeFileSync('E:/aemr-dumps/etalon-sync/reports/qa-acceptance.md', out.join('\n'), 'utf8');
  console.log('QA DONE issues=' + totalIssues);
})().catch((e) => { console.log('FATAL: ' + String(e.message).slice(0, 300)); process.exit(1); });
