/*
 * AEMR: full dump of all project Google Sheets workbooks (READ-ONLY).
 * Layers: values, formulas, formatting, conditional formatting, protection,
 * data validation, merges, named ranges, hidden rows/cols/sheets, filters, notes.
 * Runs in a dedicated container from the aemr-server image with /out bind-mounted
 * to the VPS host, so results survive compose redeploys of the prod services.
 * Streaming JSON write: peak memory = one sheet, not one book.
 * Console output is ASCII-only by design.
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const OUT = process.env.DUMP_OUT || '/out';

const BOOKS = [
  { key: 'svod',       name: 'СВОД_для_Google',        id: '1i692JdP-FqWMSfVgBjTmDCoUakacbJpZMq9tJhQlRhg' },
  { key: 'monitoring', name: 'Ежедневный мониторинг',  id: '15VKFyOPbyP2vJVvmAFVXD0lV14ZwgJ0nxwbhBdjJMps' },
  { key: 'grbs-UER',   name: 'ГРБС УЭР',               id: '15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4' },
  { key: 'grbs-UIO',   name: 'ГРБС УИО',               id: '1qCBY5EDSASxK6_ZPQbxzdF8cKIjcwcuykbnOc45Ukn8' },
  { key: 'grbs-UAGZO', name: 'ГРБС УАГЗО',             id: '1DgO0t_Zx-PXmtLBp5ddkQvb2_pTkmyFKP_PaDqjOyXk' },
  { key: 'grbs-UFBP',  name: 'ГРБС УФБП',              id: '14A7vvvvPFxY3SKwtYnMsNfmn_kkxbxWSkN78cYBfszQ' },
  { key: 'grbs-UD',    name: 'ГРБС УД',                id: '1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg' },
  { key: 'grbs-UDTH',  name: 'ГРБС УДТХ',              id: '1bxh-mRLQ_ODsdpZ4JW2JJ8sOMjg4zJRhPydR6vjzqb4' },
  { key: 'grbs-UKSiMP',name: 'ГРБС УКСиМП',            id: '1aFAw9AfNxkTVCqwp6G6fchn3ZeDi8FwFu5-xgRSo7aI' },
  { key: 'grbs-UO',    name: 'ГРБС УО',                id: '1AGvXDSKSjpPc11ce4NDK262qySM4W6nFTq2YcgQ6Sds' },
];

const STRUCT_FIELDS = [
  'properties',
  'namedRanges',
  'sheets(properties,protectedRanges,conditionalFormats,merges,bandedRanges,basicFilter,filterViews)',
].join(',');

const DATA_FIELDS =
  'sheets(properties(sheetId,title),data(startRow,startColumn,' +
  'rowData(values(userEnteredValue,effectiveValue,formattedValue,userEnteredFormat,dataValidation,note)),' +
  'rowMetadata(hiddenByUser,hiddenByFilter),columnMetadata(hiddenByUser)))';

const CHUNK_ROWS = 400;
const PAUSE_MS = 1100;
const BOOK_PAUSE_MS = 2600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, label) {
  let delay = 3000;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e && (e.code || (e.response && e.response.status))) || 'ERR';
      process.stdout.write('  retryable error ' + label + ' attempt=' + attempt + ' code=' + code + '\n');
      if (attempt === 6) throw e;
      await sleep(delay);
      delay = Math.min(delay * 2, 60000);
    }
  }
}

function rowHasContent(r) {
  return !!(r && r.values && r.values.some((v) => v && Object.keys(v).length > 0));
}

async function dumpBook(sheetsApi, book) {
  process.stdout.write('BOOK ' + book.key + ' start\n');
  const structResp = await withRetry(
    () => sheetsApi.spreadsheets.get({ spreadsheetId: book.id, fields: STRUCT_FIELDS }),
    book.key + '/struct'
  );
  const struct = structResp.data;
  await sleep(PAUSE_MS);

  const sheetList = struct.sheets || [];
  process.stdout.write('  sheets=' + sheetList.length + '\n');

  const outPath = path.join(OUT, book.key + '.json');
  const tmpPath = outPath + '.part';
  const fd = fs.openSync(tmpPath, 'w');
  const w = (s) => fs.writeSync(fd, s);
  w('{"dumpedAt":' + JSON.stringify(new Date().toISOString()) +
    ',"bookKey":' + JSON.stringify(book.key) +
    ',"bookName":' + JSON.stringify(book.name) +
    ',"spreadsheetId":' + JSON.stringify(book.id) +
    ',"spreadsheet":{"properties":' + JSON.stringify(struct.properties || {}) +
    ',"namedRanges":' + JSON.stringify(struct.namedRanges || []) +
    ',"sheets":[');

  for (let si = 0; si < sheetList.length; si++) {
    const sh = sheetList[si];
    const p = sh.properties || {};
    const grid = p.gridProperties || {};
    const rowCount = grid.rowCount || 0;
    if (rowCount && p.sheetType !== 'OBJECT') {
      const titleEsc = String(p.title).replace(/'/g, "''");
      const collected = [];
      const rowMeta = [];
      let colMeta = null;
      let emptyStreak = 0;
      for (let start = 1; start <= rowCount; start += CHUNK_ROWS) {
        const end = Math.min(start + CHUNK_ROWS - 1, rowCount);
        const range = "'" + titleEsc + "'!" + start + ':' + end;
        const resp = await withRetry(
          () => sheetsApi.spreadsheets.get({ spreadsheetId: book.id, ranges: [range], fields: DATA_FIELDS }),
          book.key + '/sheet#' + si + '/rows' + start
        );
        await sleep(PAUSE_MS);
        const shResp = ((resp.data.sheets || [])[0] || {});
        const d = ((shResp.data || [])[0] || {});
        const rows = d.rowData || [];
        if (colMeta === null && d.columnMetadata) colMeta = d.columnMetadata;
        if (d.rowMetadata) rowMeta.push(...d.rowMetadata);
        collected.push(...rows);
        const nonEmpty = rows.some(rowHasContent);
        if (nonEmpty) {
          emptyStreak = 0;
        } else {
          emptyStreak++;
          if (emptyStreak >= 2) {
            process.stdout.write('  sheet#' + si + ' stop after 2 empty chunks at row ' + end + '\n');
            break;
          }
        }
      }
      while (collected.length && !rowHasContent(collected[collected.length - 1])) collected.pop();
      sh.data = [{ startRow: 0, startColumn: 0, rowData: collected, rowMetadata: rowMeta, columnMetadata: colMeta || [] }];
      process.stdout.write('  sheet#' + si + ' rows_kept=' + collected.length + ' of grid ' + rowCount + '\n');
    } else {
      process.stdout.write('  sheet#' + si + ' non-grid, no data\n');
    }
    w((si ? ',' : '') + JSON.stringify(sh));
    sheetList[si] = null;
    sh.data = null;
    if (global.gc) global.gc();
  }
  w(']}}');
  fs.closeSync(fd);
  fs.renameSync(tmpPath, outPath);
  const sz = fs.statSync(outPath).size;
  process.stdout.write('BOOK ' + book.key + ' done bytes=' + sz + '\n');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = String(process.env.GOOGLE_PRIVATE_KEY || '');
  // tolerate env-file style: surrounding quotes kept verbatim by `docker run --env-file`
  key = key.replace(/^['"]/, '').replace(/['"]$/, '').replace(/\\n/g, '\n');
  if (!email || !key) {
    process.stdout.write('FATAL: missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY\n');
    process.exit(2);
  }
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const failures = [];
  const only = String(process.env.DUMP_ONLY || '').split(',').filter(Boolean);
  for (const book of BOOKS) {
    if (only.length && !only.includes(book.key)) continue;
    const outPath = path.join(OUT, book.key + '.json');
    if (!process.env.DUMP_FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
      process.stdout.write('BOOK ' + book.key + ' already dumped, skip\n');
      continue;
    }
    try {
      await dumpBook(sheetsApi, book);
    } catch (e) {
      const code = (e && (e.code || (e.response && e.response.status))) || 'ERR';
      const msg = e && e.message ? String(e.message).slice(0, 200) : 'unknown';
      process.stdout.write('BOOK ' + book.key + ' FAILED code=' + code + ' msg=' + msg + '\n');
      failures.push({ key: book.key, code: String(code), msg });
    }
    await sleep(BOOK_PAUSE_MS);
  }
  fs.writeFileSync(path.join(OUT, '_failures.json'), JSON.stringify(failures));
  process.stdout.write('ALL DONE failures=' + failures.length + '\n');
}

main().catch((e) => {
  process.stdout.write('FATAL: ' + String(e && e.message ? e.message : e).slice(0, 300) + '\n');
  process.exit(1);
});
