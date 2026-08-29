/* Исполнитель волн переноса эталона. Пакетное «да» владельца 30.08.2026.
 * node scripts/etalon-sync/apply.cjs --wave v1
 * Перед каждой правкой: свежий структ-снапшот листа в rollback-файл.
 * После: верификация «канон ↔ факт». Консоль ASCII-only. */
const fs = require('fs');
const path = require('path');
const { BOOKS, PLANS_DIR, sheetsApi, colLetter, colIndex, hexcolor, loadStruct } = require('./lib.cjs');
const { goldenCF, goldenProtections, goldenValidation, FORMAT_POLICY, BANDING, BODY_COLUMN_CANON, serviceCF, rng } = require('./canon.cjs');
const { targetEditors } = require('./editors.cjs');

// Счётчики правил канона — всегда от текущего canon, не хардкод.
const CF_FULL = goldenCF(0).length;
const CF_VISUAL = goldenCF(0, { visualOnly: true }).length;

const ROLL_DIR = 'E:/aemr-dumps/etalon-sync/rollback';
const REPORT_DIR = 'E:/aemr-dumps/etalon-sync/reports';
const STRUCT_FIELDS = 'sheets(properties,protectedRanges,conditionalFormats,merges,bandedRanges,basicFilter,filterViews)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Структурированные действия владельца: каждый блокер превращается в точную
 * инструкцию, а не пометку (требование владельца 30.08). */
const ownerActions = [];
function ownerAction(bookRu, sheetTitle, problem, action) {
  ownerActions.push({ bookRu, sheetTitle, problem, action });
}
function ownerActionsSection() {
  if (!ownerActions.length) return '\n\n## Действий владельца не требуется';
  const byBook = new Map();
  for (const a of ownerActions) {
    if (!byBook.has(a.bookRu)) byBook.set(a.bookRu, []);
    byBook.get(a.bookRu).push(a);
  }
  const lines = ['\n\n## ЧТО СДЕЛАТЬ ВЛАДЕЛЬЦУ (без этого хвост не доводится)', '',
    'Быстрый путь для ВСЕХ пунктов сразу: один прогон Apps Script на книгу —',
    'инструкция и код: E:/aemr-dumps/etalon-sync/plans/apps-script-add-bot.md.',
    'После прогона сказать «бот впущен» — хвост доведу автоматически.', ''];
  for (const [book, acts] of byBook) {
    lines.push(`### ${book} (${acts.length}):`);
    for (const a of acts) lines.push(`- «${a.sheetTitle}»: ${a.problem}. Вручную: ${a.action}`);
  }
  return lines.join('\n');
}
const rgb = (hex) => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });

async function withRetry(fn, label) {
  let delay = 3000;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try { return await fn(); } catch (e) {
      const code = (e && (e.code || (e.response && e.response.status))) || 'ERR';
      if (attempt === 5 || code === 403 || code === 400) throw e;
      console.log('retry ' + label + ' attempt=' + attempt + ' code=' + code);
      await sleep(delay); delay = Math.min(delay * 2, 30000);
    }
  }
}

async function fetchSheetStruct(api, spreadsheetId, title) {
  const resp = await withRetry(() => api.spreadsheets.get({ spreadsheetId, fields: STRUCT_FIELDS }), 'struct');
  return (resp.data.sheets || []).find((s) => s.properties.title === title);
}

function snapshot(name, obj) {
  fs.mkdirSync(ROLL_DIR, { recursive: true });
  const p = path.join(ROLL_DIR, name + '.json');
  fs.writeFileSync(p, JSON.stringify({ savedAt: new Date().toISOString(), data: obj }));
  return p;
}

async function batch(api, spreadsheetId, requests, label, opts) {
  const safe = opts && opts.safe;
  let skipped = 0;
  for (let i = 0; i < requests.length; i += 400) {
    const chunk = requests.slice(i, i + 400);
    console.log('batch ' + label + ' chunk@' + i + ' size=' + chunk.length);
    let attempt = 0;
    for (;;) {
      try {
        await withRetry(() => api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: chunk } }), label + '#' + i);
        break;
      } catch (e) {
        const msg = String((e && e.message) || '');
        const isProt = msg.includes('protected cell') || msg.includes('permission to change who can edit');
        if (isProt && attempt < 2) {
          attempt++;
          console.log(label + '#' + i + ' protected retry, wait 10s attempt=' + attempt);
          await sleep(10000);
          continue;
        }
        if (isProt && safe && chunk.length > 1) {
          console.log(label + '#' + i + ' fallback per-request');
          for (const req of chunk) {
            try {
              await withRetry(() => api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [req] } }), label + '-one');
            } catch (e2) {
              if (String((e2 && e2.message) || '').includes('protected')) { skipped++; continue; }
              throw e2;
            }
            await sleep(400);
          }
          break;
        }
        if (isProt && safe) { skipped++; break; }
        throw e;
      }
    }
    await sleep(900);
  }
  return skipped;
}

// ---------- строители запросов ----------
function cfReplaceRequests(sheet, sheetId, cfOpts) {
  const cur = sheet.conditionalFormats || [];
  const reqs = [];
  for (let i = cur.length - 1; i >= 0; i--) reqs.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  goldenCF(sheetId, cfOpts).forEach((g, i) => {
    reqs.push({ addConditionalFormatRule: { rule: { ranges: g.ranges, booleanRule: { condition: g.rule.condition, format: g.rule.format } }, index: i } });
  });
  return reqs;
}

function protectionReplaceRequests(sheet, sheetId, editors, keepAD) {
  const target = goldenProtections(sheetId, editors, { keepAD });
  const cur = sheet.protectedRanges || [];
  // Идемпотентность: если защиты уже канонические (описания совпадают и бот
  // в редакторах каждой) — пересоздание пропускается, чтобы не будить гонку прав.
  const curDescs = new Set(cur.map((p) => p.description || ''));
  const allCanon = cur.length === target.length
    && target.every((t) => curDescs.has(t.description))
    && cur.every((p) => (((p.editors || {}).users) || []).some((u) => u.includes('gserviceaccount')));
  if (allCanon) return [];
  const reqs = [];
  for (const p of cur) reqs.push({ deleteProtectedRange: { protectedRangeId: p.protectedRangeId } });
  for (const t of target) {
    reqs.push({ addProtectedRange: { protectedRange: { range: t.range, description: t.description, warningOnly: false, editors: { users: t.editors.users } } } });
  }
  return reqs;
}

function validationRequests(sheetId, grbsValue) {
  const v = goldenValidation(grbsValue);
  const reqs = [];
  for (const [col, spec] of Object.entries(v)) {
    if (col === '_clear') continue;
    if (!spec) continue;
    reqs.push({ setDataValidation: { range: rng(sheetId, col), rule: spec } });
  }
  for (const col of v._clear) reqs.push({ setDataValidation: { range: rng(sheetId, col) } });
  return reqs;
}

function bodyFormatRequests(sheetId, opts) {
  const reqs = [];
  const money = { numberFormat: FORMAT_POLICY.moneyFormat };
  reqs.push({ repeatCell: { range: rng(sheetId, 'H', 'K'), cell: { userEnteredFormat: money }, fields: 'userEnteredFormat.numberFormat' } });
  reqs.push({ repeatCell: { range: rng(sheetId, 'V', 'AC'), cell: { userEnteredFormat: money }, fields: 'userEnteredFormat.numberFormat' } });
  for (const c of FORMAT_POLICY.dateCols) {
    reqs.push({ repeatCell: { range: rng(sheetId, c), cell: { userEnteredFormat: { numberFormat: FORMAT_POLICY.dateFormat } }, fields: 'userEnteredFormat.numberFormat' } });
  }
  if (opts && opts.fullBodyCanon) {
    // Подведы: полный канон текста/выравнивания по колонкам (замена ветки textFormat).
    for (let j = 0; j < 34; j++) {
      const col = colLetter(j);
      const tf = { fontFamily: FORMAT_POLICY.bodyFont.fontFamily, fontSize: FORMAT_POLICY.bodyFont.fontSize, bold: BODY_COLUMN_CANON.bold.includes(col) };
      if (BODY_COLUMN_CANON.fg[col]) {
        tf.foregroundColor = rgb(BODY_COLUMN_CANON.fg[col]);
        tf.foregroundColorStyle = { rgbColor: rgb(BODY_COLUMN_CANON.fg[col]) };
      }
      reqs.push({ repeatCell: {
        range: rng(sheetId, col),
        cell: { userEnteredFormat: { textFormat: tf, horizontalAlignment: BODY_COLUMN_CANON.alignLeft.includes(col) ? 'LEFT' : 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy',
      } });
    }
    // Полное стирание статических заливок тела (Р6, подведы).
    reqs.push({ repeatCell: { range: rng(sheetId, 'A', 'AH'), cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle' } });
  } else {
    // Главные листы: шрифт/размер и перенос, заливки решает whiteRects.
    reqs.push({ repeatCell: { range: rng(sheetId, 'A', 'AH'), cell: { userEnteredFormat: { textFormat: FORMAT_POLICY.bodyFont } }, fields: 'userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize' } });
    reqs.push({ repeatCell: { range: rng(sheetId, 'A', 'AH'), cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy' } });
  }
  return reqs;
}

/** Свежая сетка заливок тела -> прямоугольники белой статики. */
async function whiteRects(api, spreadsheetId, title, sheetId, rowCount) {
  const runsByRow = new Map();
  for (let start = 4; start <= rowCount; start += 500) {
    const end = Math.min(start + 499, rowCount);
    const resp = await withRetry(() => api.spreadsheets.get({
      spreadsheetId,
      ranges: [`'${title.replace(/'/g, "''")}'!${start}:${end}`],
      fields: 'sheets(data(startRow,rowData(values(userEnteredFormat(backgroundColor,backgroundColorStyle)))))',
    }), 'bg' + start);
    const d = ((((resp.data.sheets || [])[0] || {}).data || [])[0] || {});
    (d.rowData || []).forEach((row, i) => {
      const rown = (d.startRow || 0) + i;
      const cols = [];
      (row.values || []).forEach((v, j) => {
        const f = (v || {}).userEnteredFormat;
        if (!f) return;
        const cs = f.backgroundColorStyle;
        const hex = cs && cs.rgbColor ? hexcolor(cs.rgbColor) : (cs && cs.themeColor === 'BACKGROUND' ? '#FFFFFF' : hexcolor(f.backgroundColor));
        if (hex === '#FFFFFF') cols.push(j);
      });
      if (cols.length) runsByRow.set(rown, cols.join(','));
    });
    await sleep(700);
  }
  // merge同 рядов в прямоугольные полосы
  const rects = [];
  let curKey = null, curStart = 0, prevRow = -10;
  const flush = (endRow) => {
    if (curKey === null) return;
    const cols = curKey.split(',').map(Number);
    let a = cols[0], p = cols[0];
    for (let k = 1; k <= cols.length; k++) {
      if (k < cols.length && cols[k] === p + 1) { p = cols[k]; continue; }
      rects.push({ sheetId, startRowIndex: curStart, endRowIndex: endRow + 1, startColumnIndex: a, endColumnIndex: p + 1 });
      if (k < cols.length) { a = cols[k]; p = cols[k]; }
    }
  };
  const rows = [...runsByRow.keys()].sort((x, y) => x - y);
  for (const r of rows) {
    const key = runsByRow.get(r);
    if (key === curKey && r === prevRow + 1) { prevRow = r; continue; }
    flush(prevRow);
    curKey = key; curStart = r; prevRow = r;
  }
  flush(prevRow);
  return rects.map((range) => ({ repeatCell: { range, cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle' } }));
}

function bandingRequests(sheet, sheetId, rowCount) {
  const props = { firstBandColorStyle: { rgbColor: rgb(BANDING.firstBand) }, secondBandColorStyle: { rgbColor: rgb(BANDING.secondBand) } };
  const range = { sheetId, startRowIndex: 3, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 34 };
  const cur = (sheet.bandedRanges || [])[0];
  if (cur) return [{ updateBanding: { bandedRange: { bandedRangeId: cur.bandedRangeId, range, rowProperties: props }, fields: 'range,rowProperties' } }];
  return [{ addBanding: { bandedRange: { range, rowProperties: props } } }];
}

function filterRequests(sheet, sheetId, rowCount) {
  const reqs = [];
  const range = { sheetId, startRowIndex: 2, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 34 };
  if (sheet.basicFilter) reqs.push({ setBasicFilter: { filter: { range } } });
  for (const fv of sheet.filterViews || []) {
    reqs.push({ updateFilterView: { filter: { filterViewId: fv.filterViewId, range }, fields: 'range' } });
  }
  return reqs;
}

// ---------- шапка-канон из сетки УО ----------
function headerTemplateFromUO() {
  const grid = JSON.parse(fs.readFileSync('E:/aemr-dumps/book-dumps/meta-2026-08-29/grbs-UO-VSE-formats.json', 'utf8'));
  return grid.rowData.slice(0, 3).map((row) => ({
    values: Array.from({ length: 34 }, (_, j) => {
      const f = ((row.values || [])[j] || {}).userEnteredFormat;
      return f ? { userEnteredFormat: f } : { userEnteredFormat: {} };
    }),
  }));
}

function headerRequests(sheetId, template) {
  return [{ updateCells: { rows: template, fields: 'userEnteredFormat', start: { sheetId, rowIndex: 0, columnIndex: 0 } } }];
}

// ---------- верификация ----------
async function verify(api, book, title, expect) {
  const sheet = await fetchSheetStruct(api, book.id, title);
  const cf = (sheet.conditionalFormats || []).length;
  const pr = (sheet.protectedRanges || []).length;
  const band = ((sheet.bandedRanges || [])[0] || {});
  const rp = band.rowProperties || {};
  const second = rp.secondBandColorStyle && rp.secondBandColorStyle.rgbColor ? hexcolor(rp.secondBandColorStyle.rgbColor) : null;
  const ok = cf === expect.cf && (expect.prot === null || pr === expect.prot) && (!expect.band || second === BANDING.secondBand);
  return { ok, cf, pr, second, title };
}

// ---------- волны ----------
async function waveV1(api, report) {
  const book = BOOKS.uksimp;
  const plan = JSON.parse(fs.readFileSync(path.join(PLANS_DIR, '2026-08-29-v1-uksimp-ВСЕ.json'), 'utf8'));
  const title = book.main;
  const sheet = await fetchSheetStruct(api, book.id, title);
  const sheetId = sheet.properties.sheetId;
  const rowCount = sheet.properties.gridProperties.rowCount;
  snapshot('v1-uksimp-VSE-before', sheet);

  // 1. Справочник в _Настройки (E:J), формулы + статика.
  const dict = plan.dictionary;
  const maxLen = Math.max(dict.institutions.length, dict.programs.length, dict.subprograms.length) + 1;
  const rows = [];
  rows.push(['Учреждения (факт)', 'Программы (факт)', 'Мероприятия (факт)', 'Учреждение (Справочник)', 'Программа (Справочник)', 'Подпрограмма (Справочник)']);
  for (let i = 0; i < maxLen; i++) {
    const e = i === 0 ? `=SORT(UNIQUE(FILTER('${title}'!C4:C; '${title}'!C4:C<>"")))` : null;
    const f = i === 0 ? `=SORT(UNIQUE(FILTER('${title}'!D4:D; '${title}'!D4:D<>"")))` : null;
    const g = i === 0 ? `=SORT(UNIQUE(FILTER('${title}'!E4:E; '${title}'!E4:E<>"")))` : null;
    rows.push([e, f, g, dict.institutions[i] ?? null, dict.programs[i] ?? null, dict.subprograms[i] ?? null]);
  }
  await withRetry(() => api.spreadsheets.values.update({
    spreadsheetId: book.id, range: `'_Настройки'!E1:J${rows.length}`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: rows },
  }), 'dict');
  report.push('V1: справочник _Настройки E:J записан (' + dict.institutions.length + ' учреждений)');

  // 2. Пофазно: валидации / УФ / защиты / банда+фильтры+колонки / форматы.
  const phases = [
    ['validation', validationRequests(sheetId, plan.golden.grbsValue)],
    ['cf', cfReplaceRequests(sheet, sheetId)],
    ['protections', protectionReplaceRequests(sheet, sheetId, targetEditors('uksimp'), true)],
    ['banding', bandingRequests(sheet, sheetId, rowCount)],
    ['filters', filterRequests(sheet, sheetId, rowCount)],
    ['columns', [{ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 32, endIndex: 34 }, properties: { hiddenByUser: false }, fields: 'hiddenByUser' } }]],
    ['bodyFormats', bodyFormatRequests(sheetId, {})],
  ];
  for (const [name, reqs] of phases) {
    console.log('phase ' + name + ' reqs=' + reqs.length);
    await batch(api, book.id, reqs, 'v1-' + name);
    report.push('V1 фаза ' + name + ': ' + reqs.length + ' запросов OK');
  }

  // 3. Белая статика.
  const white = await whiteRects(api, book.id, title, sheetId, rowCount);
  await batch(api, book.id, white, 'v1-white');
  report.push('V1: белая статика стёрта (' + white.length + ' прямоугольников)');

  // 4. Settings B3. Лист «Settings» защищён целиком и бот может не входить в
  // редакторы ИМЕННО этой защиты — тогда шаг уходит владельцу.
  try {
    await withRetry(() => api.spreadsheets.values.update({
      spreadsheetId: book.id, range: "'Settings'!B3", valueInputOption: 'USER_ENTERED', requestBody: { values: [['ЭА']] },
    }), 'settingsB3');
    report.push('V1: Settings!B3 = ЭА');
  } catch (e) {
    if (String(e.message || '').includes('protected')) {
      report.push('V1: Settings!B3 ПРОПУЩЕН — лист Settings защищён целиком без бота. ТРЕБУЕТ ВЛАДЕЛЬЦА: добавить бота в редакторы защиты листа Settings или поправить B3 руками (ЭА).');
    } else throw e;
  }

  const v = await verify(api, book, title, { cf: CF_FULL, prot: 6, band: true });
  report.push('V1 ВЕРИФИКАЦИЯ: ' + JSON.stringify(v));
  return v.ok;
}

// ---------- служебные имена ----------
const SERVICE_TITLES = new Set(['_Настройки', '_ChangeLog', 'Контроль', 'Settings', 'GOOGLE_ФОРМУЛЫ']);

function podvedSheets(struct, mainTitle) {
  return (struct.sheets || []).filter((s) => {
    const t = s.properties.title;
    return t !== mainTitle && !SERVICE_TITLES.has(t) && s.properties.sheetType !== 'OBJECT';
  });
}

async function fetchAllStruct(api, spreadsheetId) {
  const resp = await withRetry(() => api.spreadsheets.get({ spreadsheetId, fields: STRUCT_FIELDS }), 'structAll');
  return resp.data;
}

/** Лист под полной защитой, в чьих редакторах бота НЕТ, недоступен боту даже
 * для структурных правок (удаление УФ). Такие уходят в очередь владельца. */
function botBlocked(sheet) {
  return (sheet.protectedRanges || []).some((p) => {
    const wholeSheet = !p.range || Object.keys(p.range).every((k) => k === 'sheetId');
    const users = ((p.editors || {}).users || []);
    return wholeSheet && !p.warningOnly && !users.some((u) => u.includes('gserviceaccount'));
  });
}

/** Подвед на канон УО: золотой УФ, шапка-шаблон УО, тело-канон, банда, редакторы. */
async function applyPodved(api, book, sheet, header, editors, report, blockedQueue) {
  const sheetId = sheet.properties.sheetId;
  const title = sheet.properties.title;
  const rowCount = sheet.properties.gridProperties.rowCount;
  if (botBlocked(sheet)) {
    blockedQueue.push(`${book.ru} «${title}»`);
    report.push(`${book.ru} подвед «${title}»: ЗАБЛОКИРОВАН (полная защита листа без бота) — очередь владельца`);
    return false;
  }
  snapshot(book.key + '-podved-' + sheetId + '-before', sheet);
  const colCount = sheet.properties.gridProperties.columnCount;
  const reqs = [];
  // Канон сетки — 34 колонки (A:AH), как в УО; старые подведы на 33 расширяются.
  if (colCount < 34) reqs.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: 34 - colCount } });
  reqs.push(
    ...cfReplaceRequests(sheet, sheetId, { visualOnly: true }),
    ...headerRequests(sheetId, header),
    ...bodyFormatRequests(sheetId, { fullBodyCanon: true }),
    ...bandingRequests(sheet, sheetId, rowCount),
    ...validationRequests(sheetId, null),
  );
  for (const p of sheet.protectedRanges || []) {
    reqs.push({ updateProtectedRange: { protectedRange: { protectedRangeId: p.protectedRangeId, editors: { users: editors } }, fields: 'editors' } });
  }
  try {
    await batch(api, book.id, reqs, book.key + '-podved');
  } catch (e) {
    if (String(e.message || '').includes('protected')) {
      blockedQueue.push(`${book.ru} «${title}»`);
      report.push(`${book.ru} подвед «${title}»: ЗАБЛОКИРОВАН защитой при правке — очередь владельца`);
      return false;
    }
    throw e;
  }
  report.push(`${book.ru} подвед «${title}»: УФ->15 (цветовой), шапка/тело канон, банда, редакторов ${editors.length}`);
  return true;
}

/** Главный лист книги по плану (plan.cjs должен быть прогнан заранее). */
async function applyMain(api, bookArg, report, opts) {
  const book = BOOKS[bookArg];
  const planFiles = fs.readdirSync(PLANS_DIR).filter((f) => f.includes('-' + bookArg + '-') && f.endsWith('.json')).sort();
  const plan = JSON.parse(fs.readFileSync(path.join(PLANS_DIR, planFiles[planFiles.length - 1]), 'utf8'));
  const title = book.main;
  const sheet = await fetchSheetStruct(api, book.id, title);
  const sheetId = sheet.properties.sheetId;
  const rowCount = sheet.properties.gridProperties.rowCount;
  snapshot(book.key + '-main-before', sheet);

  const dict = plan.dictionary;
  const maxLen = Math.max(dict.institutions.length, dict.programs.length, dict.subprograms.length) + 1;
  const rows = [['Учреждения (факт)', 'Программы (факт)', 'Мероприятия (факт)', 'Учреждение (Справочник)', 'Программа (Справочник)', 'Подпрограмма (Справочник)']];
  for (let i = 0; i < maxLen; i++) {
    rows.push([
      i === 0 ? `=SORT(UNIQUE(FILTER('${title}'!C4:C; '${title}'!C4:C<>"")))` : null,
      i === 0 ? `=SORT(UNIQUE(FILTER('${title}'!D4:D; '${title}'!D4:D<>"")))` : null,
      i === 0 ? `=SORT(UNIQUE(FILTER('${title}'!E4:E; '${title}'!E4:E<>"")))` : null,
      dict.institutions[i] ?? null, dict.programs[i] ?? null, dict.subprograms[i] ?? null,
    ]);
  }
  await withRetry(() => api.spreadsheets.values.update({
    spreadsheetId: book.id, range: `'_Настройки'!E1:J${rows.length}`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: rows },
  }), 'dict-' + bookArg);
  report.push(`${book.ru}: справочник _Настройки E:J (${dict.institutions.length} учреждений)`);

  const keepAD = (sheet.protectedRanges || []).some((p) => p.range && p.range.startColumnIndex === 29);
  const phases = [
    ['validation', validationRequests(sheetId, plan.golden.grbsValue)],
    ['cf', cfReplaceRequests(sheet, sheetId)],
    ['protections', protectionReplaceRequests(sheet, sheetId, targetEditors(bookArg), keepAD)],
    ['banding', bandingRequests(sheet, sheetId, rowCount)],
    ['filters', filterRequests(sheet, sheetId, rowCount)],
    ['bodyFormats', bodyFormatRequests(sheetId, {})],
  ];
  if (opts && opts.unhideCols) {
    phases.splice(5, 0, ['columns', [{ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 32, endIndex: 34 }, properties: { hiddenByUser: false }, fields: 'hiddenByUser' } }]]);
  }
  for (const [name, reqs] of phases) {
    if (!reqs.length) continue;
    if (name === 'protections') {
      try {
        await batch(api, book.id, reqs, bookArg + '-' + name);
        report.push(`${book.ru} фаза ${name}: ${reqs.length} OK; пауза 15с на распространение прав`);
        await sleep(15000);
      } catch (e) {
        const m = String(e.message || '');
        if (m.includes('protected') || m.includes('permission')) {
          ownerAction(book.ru, title, 'бот не входит в редакторы текущих защит листа — пересоздание защит невозможно', 'прогнать addBotEverywhere (apps-script-add-bot.md) и сказать «готово»');
          report.push(`${book.ru} фаза ${name}: ЗАБЛОКИРОВАНА (бот не редактор старых защит) — очередь владельца`);
        } else throw e;
      }
    } else {
      const skipped = await batch(api, book.id, reqs, bookArg + '-' + name, { safe: true });
      report.push(`${book.ru} фаза ${name}: ${reqs.length} OK` + (skipped ? ` (пропущено защитой: ${skipped})` : ''));
      if (skipped) ownerAction(book.ru, title, `${skipped} запросов упёрлись в защиту без бота`, 'после addBotEverywhere перегнать волну');
    }
  }
  const white = await whiteRects(api, book.id, title, sheetId, rowCount);
  let whiteSkipped = 0;
  if (white.length) whiteSkipped = await batch(api, book.id, white, bookArg + '-white', { safe: true });
  report.push(`${book.ru}: белая статика стёрта (${white.length} прямоугольников` + (whiteSkipped ? `, пропущено защитой: ${whiteSkipped}` : '') + ')');
  try {
    await withRetry(() => api.spreadsheets.values.update({
      spreadsheetId: book.id, range: "'Settings'!B3", valueInputOption: 'USER_ENTERED', requestBody: { values: [['ЭА']] },
    }), 'settingsB3-' + bookArg);
    report.push(`${book.ru}: Settings!B3 = ЭА`);
  } catch (e) {
    if (String(e.message || '').includes('protected')) {
      report.push(`${book.ru}: Settings!B3 ПРОПУЩЕН — защита листа Settings без бота (ТРЕБУЕТ ВЛАДЕЛЬЦА)`);
    } else throw e;
  }
  const keepProt = keepAD ? 6 : 5;
  const v = await verify(api, book, title, { cf: CF_FULL, prot: keepProt, band: true });
  report.push(`${book.ru} ВЕРИФИКАЦИЯ: ` + JSON.stringify(v));
  return v.ok;
}

async function waveV1b(api, report) {
  const book = BOOKS.uksimp;
  const struct = await fetchAllStruct(api, book.id);
  const header = headerTemplateFromUO();
  const editors = targetEditors('uksimp');
  const blocked = [];
  let ok = true; let done = 0;
  for (const sheet of podvedSheets(struct, book.main)) {
    const applied = await applyPodved(api, book, sheet, header, editors, report, blocked);
    if (applied) {
      done++;
      const v = await verify(api, book, sheet.properties.title, { cf: CF_VISUAL, prot: null, band: true });
      if (!v.ok) { ok = false; report.push('РАСХОЖДЕНИЕ: ' + JSON.stringify(v)); }
      await sleep(1200);
    }
  }
  report.push(`V1b: применено ${done}, заблокировано ${blocked.length}`);
  if (blocked.length) report.push('ОЧЕРЕДЬ ВЛАДЕЛЬЦА: ' + blocked.join('; '));
  return ok;
}

async function waveV2(api, report) {
  return applyMain(api, 'udth', report, {});
}

/** Разбор «Лист1» УАГЗО: дубль ПОДВЕД_РУС -> удалить, иначе переименовать. */
async function resolveList1(api, report) {
  const book = BOOKS.uagzo;
  const q = (t, r) => `'${t.replace(/'/g, "''")}'!${r}`;
  const resp = await withRetry(() => api.spreadsheets.values.batchGet({
    spreadsheetId: book.id,
    ranges: [q('Лист1', 'A4:A1003'), q('Лист1', 'G4:G1003'), q('ПОДВЕД_МКУ "Елизовское РУС"', 'A4:A1003'), q('ПОДВЕД_МКУ "Елизовское РУС"', 'G4:G1003'), q('Лист1', 'C4:C1003')],
    valueRenderOption: 'UNFORMATTED_VALUE',
  }), 'list1');
  const [a1v, g1v, a2v, g2v, c1v] = resp.data.valueRanges.map((r) => (r.values || []).map((row) => String(row[0] ?? '')));
  const key = (a, g) => a.map((x, i) => x + '' + (g[i] || '')).filter((s) => s !== '');
  const k1 = key(a1v, g1v); const k2 = key(a2v, g2v);
  const set2 = new Set(k2);
  const common = k1.filter((k) => set2.has(k)).length;
  const ratio = k1.length ? common / k1.length : 0;
  const struct = await fetchAllStruct(api, book.id);
  const l1 = (struct.sheets || []).find((s) => s.properties.title === 'Лист1');
  if (!l1) { report.push('УАГЗО: «Лист1» не найден (уже разобран)'); return; }
  if (k1.length && ratio >= 0.9) {
    snapshot('uagzo-List1-values-before-delete', { rows: k1.length, a: a1v, g: g1v });
    await batch(api, book.id, [{ deleteSheet: { sheetId: l1.properties.sheetId } }], 'del-list1');
    report.push(`УАГЗО: «Лист1» — дубль ПОДВЕД_РУС (${(ratio * 100).toFixed(0)}% строк совпало из ${k1.length}) — УДАЛЁН (снапшот значений в rollback)`);
  } else {
    const names = c1v.filter(Boolean);
    const freq = new Map(); for (const n of names) freq.set(n, (freq.get(n) || 0) + 1);
    const dom = [...freq.entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0])[0];
    const newTitle = dom ? 'ПОДВЕД_' + dom.slice(0, 80) : null;
    if (newTitle) {
      await batch(api, book.id, [{ updateSheetProperties: { properties: { sheetId: l1.properties.sheetId, title: newTitle }, fields: 'title' } }], 'ren-list1');
      report.push(`УАГЗО: «Лист1» уникален (совпадение ${(ratio * 100).toFixed(0)}%) — переименован в «${newTitle}»`);
    } else {
      report.push(`УАГЗО: «Лист1» уникален, но имя учреждения не определить (C пуст) — ОСТАВЛЕН, вопрос владельцу`);
    }
  }
}

async function waveV3(api, report) {
  let ok = true;
  const header = headerTemplateFromUO();
  for (const arg of ['uer', 'uio', 'uagzo', 'ufbp', 'ud']) {
    const r = await applyMain(api, arg, report, {});
    ok = ok && r;
    await sleep(1500);
  }
  await resolveList1(api, report);
  const blocked = [];
  for (const arg of ['uer', 'uagzo', 'ud']) {
    const book = BOOKS[arg];
    const struct = await fetchAllStruct(api, book.id);
    const editors = targetEditors(arg);
    for (const sheet of podvedSheets(struct, book.main)) {
      const applied = await applyPodved(api, book, sheet, header, editors, report, blocked);
      if (applied) {
        const v = await verify(api, book, sheet.properties.title, { cf: CF_VISUAL, prot: null, band: true });
        if (!v.ok) { ok = false; report.push('РАСХОЖДЕНИЕ: ' + JSON.stringify(v)); }
        await sleep(1200);
      }
    }
  }
  if (blocked.length) report.push('ОЧЕРЕДЬ ВЛАДЕЛЬЦА: ' + blocked.join('; '));
  return ok;
}

async function waveV5(api, report) {
  const HIDE = {
    uagzo: ['Settings', 'Контроль'],
    udth: ['Settings', 'GOOGLE_ФОРМУЛЫ'],
    ud: ['Settings'],
    uo: ['МБДОУ ДС № 5 «Ромашка»'],
  };
  for (const [arg, titles] of Object.entries(HIDE)) {
    const book = BOOKS[arg];
    const struct = await fetchAllStruct(api, book.id);
    for (const t of titles) {
      const sh = (struct.sheets || []).find((s2) => s2.properties.title === t);
      if (!sh) { report.push(`${book.ru}: «${t}» не найден`); continue; }
      if (sh.properties.hidden) { report.push(`${book.ru}: «${t}» уже скрыт`); continue; }
      try {
        await batch(api, book.id, [{ updateSheetProperties: { properties: { sheetId: sh.properties.sheetId, hidden: true }, fields: 'hidden' } }], arg + '-hide');
        report.push(`${book.ru}: «${t}» скрыт`);
      } catch (e) {
        if (String(e.message || '').includes('protected')) {
          ownerAction(book.ru, t, 'скрытие листа заблокировано защитой без бота', 'после addBotEverywhere перегнать волну v5');
          report.push(`${book.ru}: «${t}» скрыть не удалось (защита) — очередь владельца`);
        } else throw e;
      }
      await sleep(700);
    }
  }
  return true;
}

async function waveV6(api, report) {
  const book = BOOKS.uo;
  let ok = await applyMain(api, 'uo', report, {});
  await withRetry(() => api.spreadsheets.values.batchUpdate({
    spreadsheetId: book.id,
    requestBody: { valueInputOption: 'USER_ENTERED', data: [
      { range: "'_Настройки'!A1:C1", values: [['Параметр', 'Значение', 'Пояснение']] },
      { range: "'_Настройки'!A6:C6", values: [['Игнорируемые листы', 'Settings, GOOGLE_ФОРМУЛЫ', 'Через запятую. Не отслеживаются вообще. Листы с «_» в начале игнорируются всегда']] },
    ] },
  }), 'uo-nastroyki');
  report.push('УО: _Настройки — заголовки A1:C1 канон, «Игнорируемые листы» возвращены (A6)');
  try {
    const CONTROL_B11 = '=SUMPRODUCT(--(\'ВСЕ\'!A4:A<>"");--(\'ВСЕ\'!Q4:Q<>"");--NOT(ISNUMBER(\'ВСЕ\'!Q4:Q));--(\'ВСЕ\'!Q4:Q<>"Х");--(\'ВСЕ\'!Q4:Q<>"X");--(\'ВСЕ\'!Q4:Q<>"х");--(\'ВСЕ\'!Q4:Q<>"x"))';
    await withRetry(() => api.spreadsheets.values.update({
      spreadsheetId: book.id, range: "'Контроль'!B11", valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[CONTROL_B11]] },
    }), 'uo-control');
    report.push('УО: Контроль!B11 — потолок 1874 снят (открытые диапазоны)');
  } catch (e) {
    if (String(e.message || '').includes('protected')) {
      ownerAction('УО', 'Контроль', 'правка B11 заблокирована защитой листа', 'после addBotEverywhere перегнать v6');
      report.push('УО: Контроль!B11 ЗАБЛОКИРОВАН — очередь владельца');
    } else throw e;
  }
  try {
    const { GOOGLE_FORMULAS_CANON } = require('./canon.cjs');
    const data = GOOGLE_FORMULAS_CANON.map(([col, f], i) => ({ range: `'GOOGLE_ФОРМУЛЫ'!A${i + 2}:B${i + 2}`, values: [[col, "'" + f]] }));
    await withRetry(() => api.spreadsheets.values.batchUpdate({
      spreadsheetId: book.id, requestBody: { valueInputOption: 'RAW', data },
    }), 'uo-gf');
    report.push('УО: GOOGLE_ФОРМУЛЫ — эталонные формулы восстановлены (текстом, без #REF!)');
  } catch (e) {
    if (String(e.message || '').includes('protected')) {
      ownerAction('УО', 'GOOGLE_ФОРМУЛЫ', 'правка эталонных формул заблокирована защитой листа', 'после addBotEverywhere перегнать v6');
      report.push('УО: GOOGLE_ФОРМУЛЫ ЗАБЛОКИРОВАНЫ — очередь владельца');
    } else throw e;
  }
  const struct = await fetchAllStruct(api, book.id);
  const header = headerTemplateFromUO();
  const editors = targetEditors('uo');
  const blocked = [];
  let done = 0;
  for (const sheet of podvedSheets(struct, book.main)) {
    const applied = await applyPodved(api, book, sheet, header, editors, report, blocked);
    if (applied) {
      done++;
      const v = await verify(api, book, sheet.properties.title, { cf: CF_VISUAL, prot: null, band: true });
      if (!v.ok) { ok = false; report.push('РАСХОЖДЕНИЕ: ' + JSON.stringify(v)); }
      await sleep(1000);
    }
  }
  report.push(`V6 подведы УО: применено ${done}, заблокировано ${blocked.length}`);
  for (const b of blocked) ownerAction('УО', b, 'полная защита листа без бота', 'addBotEverywhere, затем перегнать v6');
  return ok;
}

async function waveV7(api, report) {
  // 1. Строгая валидация справочника C/D/E на главных листах всех книг.
  for (const arg of Object.keys(BOOKS)) {
    const book = BOOKS[arg];
    const sheet = await fetchSheetStruct(api, book.id, book.main);
    const sheetId = sheet.properties.sheetId;
    const v = goldenValidation(null);
    const reqs = ['C', 'D', 'E'].map((col) => ({ setDataValidation: { range: rng(sheetId, col), rule: v[col] } }));
    const skipped = await batch(api, book.id, reqs, arg + '-strictCDE', { safe: true });
    report.push(`${book.ru}: строгий справочник C/D/E` + (skipped ? ` (пропущено ${skipped})` : ' OK'));
    await sleep(800);
  }
  // 2. Settings!B3 -> ЭА там, где лежит «ЭА и аналоги».
  for (const arg of ['uksimp', 'uagzo', 'ud', 'ufbp']) {
    const book = BOOKS[arg];
    try {
      await withRetry(() => api.spreadsheets.values.update({
        spreadsheetId: book.id, range: "'Settings'!B3", valueInputOption: 'USER_ENTERED', requestBody: { values: [['ЭА']] },
      }), 'b3-' + arg);
      report.push(`${book.ru}: Settings!B3 = ЭА`);
    } catch (e) {
      if (String(e.message || '').includes('protected')) {
        ownerAction(book.ru, 'Settings', 'B3 всё ещё под защитой без бота', 'проверить защиту листа Settings');
        report.push(`${book.ru}: Settings!B3 ЗАБЛОКИРОВАН`);
      } else throw e;
    }
    await sleep(600);
  }
  // 3. Подведы УЭР/УАГЗО/УД (открыты владельцем).
  const header = headerTemplateFromUO();
  const blocked = [];
  let ok = true;
  for (const arg of ['uer', 'uagzo', 'ud']) {
    const book = BOOKS[arg];
    const struct = await fetchAllStruct(api, book.id);
    const editors = targetEditors(arg);
    for (const sheet of podvedSheets(struct, book.main)) {
      const applied = await applyPodved(api, book, sheet, header, editors, report, blocked);
      if (applied) {
        const v = await verify(api, book, sheet.properties.title, { cf: CF_VISUAL, prot: null, band: true });
        if (!v.ok) { ok = false; report.push('РАСХОЖДЕНИЕ: ' + JSON.stringify(v)); }
        await sleep(1000);
      }
    }
  }
  if (blocked.length) report.push('Всё ещё заблокировано: ' + blocked.join('; '));
  return ok;
}

async function waveV8(api, report) {
  let ok = true;
  for (const arg of Object.keys(BOOKS)) {
    const book = BOOKS[arg];
    const struct = await fetchAllStruct(api, book.id);
    for (const sheet of struct.sheets || []) {
      const t = sheet.properties.title;
      const isMain = t === book.main;
      const isPod = !isMain && !SERVICE_TITLES.has(t) && sheet.properties.sheetType !== 'OBJECT';
      if (!isMain && !isPod) continue;
      if (botBlocked(sheet)) { report.push(`${book.ru} «${t}»: пропуск (защита без бота)`); continue; }
      const reqs = cfReplaceRequests(sheet, sheet.properties.sheetId, isMain ? undefined : { visualOnly: true });
      await batch(api, book.id, reqs, arg + '-cf8', { safe: true });
      const v = await verify(api, book, t, { cf: isMain ? CF_FULL : CF_VISUAL, prot: null, band: false });
      if (!v.ok) { ok = false; report.push('РАСХОЖДЕНИЕ: ' + JSON.stringify(v)); }
      await sleep(900);
    }
    report.push(`${book.ru}: контраст денег перегнан по всем листам`);
  }
  return ok;
}

async function waveV9(api, report) {
  const VIEW_NAMES = ['УЭР', 'ИСПОЛНИТЕЛЬ', 'КООРДИНАТОР'];
  let ok = true;
  for (const arg of Object.keys(BOOKS)) {
    const book = BOOKS[arg];
    const sheet = await fetchSheetStruct(api, book.id, book.main);
    const sheetId = sheet.properties.sheetId;
    snapshot(book.key + '-filters-before', { basicFilter: sheet.basicFilter || null, filterViews: sheet.filterViews || [] });
    const reqs = [];
    if (sheet.basicFilter) reqs.push({ clearBasicFilter: { sheetId } });
    for (const fv of sheet.filterViews || []) reqs.push({ deleteFilterView: { filterId: fv.filterViewId } });
    for (const name of VIEW_NAMES) {
      reqs.push({ addFilterView: { filter: { title: name,
        range: { sheetId, startRowIndex: 2, startColumnIndex: 0, endColumnIndex: 34 } } } });
    }
    const skipped = await batch(api, book.id, reqs, arg + '-views', { safe: true });
    // проверка
    const after = await fetchSheetStruct(api, book.id, book.main);
    const names = (after.filterViews || []).map((f) => f.title).sort();
    const good = !after.basicFilter && names.length === 3 && VIEW_NAMES.every((n) => names.includes(n));
    if (!good) { ok = false; }
    report.push(`${book.ru}: базовый фильтр ${after.basicFilter ? 'ОСТАЛСЯ ⚠' : 'убран'}; виды: ${names.join(', ')}` + (skipped ? ` (пропущено ${skipped})` : ''));
    await sleep(900);
  }
  return ok;
}

async function waveV11(api, report) {
  const dims = JSON.parse(fs.readFileSync('E:/aemr-dumps/etalon-sync/plans/uo-dims-canon.json', 'utf8'));
  const COLS = dims['ВСЕ'].cols; // ширины A:AH — единые для главных и подведов
  const MAIN_ROWS = [20, 20, 20];
  const POD_ROWS = [20, 28, 60];
  function dimRequests(sheetId, isMain) {
    const reqs = [];
    let i = 0;
    while (i < COLS.length) {
      let j = i;
      while (j + 1 < COLS.length && COLS[j + 1] === COLS[i]) j++;
      reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: j + 1 }, properties: { pixelSize: COLS[i] }, fields: 'pixelSize' } });
      i = j + 1;
    }
    const rows = isMain ? MAIN_ROWS : POD_ROWS;
    rows.forEach((px, r) => {
      reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
    });
    return reqs;
  }
  let ok = true;
  for (const arg of Object.keys(BOOKS)) {
    const book = BOOKS[arg];
    const struct = await fetchAllStruct(api, book.id);
    const reqs = [];
    let sheets = 0;
    for (const sheet of struct.sheets || []) {
      const t = sheet.properties.title;
      const isMain = t === book.main;
      const isPod = !isMain && !SERVICE_TITLES.has(t) && sheet.properties.sheetType !== 'OBJECT';
      if (!isMain && !isPod) continue;
      if (botBlocked(sheet)) { report.push(`${book.ru} «${t}»: размеры пропущены (защита)`); continue; }
      reqs.push(...dimRequests(sheet.properties.sheetId, isMain));
      sheets++;
    }
    const skipped = await batch(api, book.id, reqs, arg + '-dims', { safe: true });
    report.push(`${book.ru}: размеры канона УО на ${sheets} листах` + (skipped ? ` (пропущено ${skipped})` : ''));
    await sleep(1000);
  }
  return ok;
}

async function main() {
  const wave = (process.argv.find((a) => a.startsWith('--wave')) || '').split('=')[1] || process.argv[process.argv.indexOf('--wave') + 1];
  const api = sheetsApi('write');
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const report = [];
  let ok = false;
  if (wave === 'v1') ok = await waveV1(api, report);
  else if (wave === 'v1b') ok = await waveV1b(api, report);
  else if (wave === 'v2') ok = await waveV2(api, report);
  else if (wave === 'v3') ok = await waveV3(api, report);
  else if (wave === 'v5') ok = await waveV5(api, report);
  else if (wave === 'v7') ok = await waveV7(api, report);
  else if (wave === 'v8') ok = await waveV8(api, report);
  else if (wave === 'v9') ok = await waveV9(api, report);
  else if (wave === 'v11') ok = await waveV11(api, report);
  else if (wave === 'v6') ok = await waveV6(api, report);
  else { console.log('FATAL: unknown wave'); process.exit(2); }
  const file = path.join(REPORT_DIR, new Date().toISOString().replace(/[:.]/g, '-') + '-' + wave + '.md');
  fs.writeFileSync(file, '# Отчёт волны ' + wave + '\n\n' + report.map((r) => '- ' + r).join('\n')
    + ownerActionsSection() + '\n\nИтог: ' + (ok ? 'OK' : 'РАСХОЖДЕНИЕ — см. выше'), 'utf8');
  console.log('WAVE ' + wave + ' ' + (ok ? 'OK' : 'MISMATCH') + ' report=' + file);
}

if (require.main === module) {
  main().catch((e) => {
    console.log('FATAL: ' + String(e && e.message ? e.message : e).slice(0, 400));
    console.log('STACK: ' + String(e && e.stack ? e.stack : '').split('\n').slice(0, 8).join(' | '));
    process.exit(1);
  });
}
module.exports = { applyPodved, headerTemplateFromUO, verify, fetchAllStruct, podvedSheets, batch, snapshot };
