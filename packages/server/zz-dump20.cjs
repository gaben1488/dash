/*
 * Dump of the "Ежедневный мониторинг 2.0" workbook (READ-ONLY).
 * Console output is ASCII-only by design.
 */
const { google } = require('googleapis');
const fs = require('fs');

const BOOK_ID = process.env.BOOK_ID || '1iVY7c7unCk1uyE4xRhWS8EG2vE1Hy2FEvjw5GRGsqec';
const OUT = process.env.DUMP_OUT || '.';

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=([\s\S]*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
      v = v.slice(1, -1);
    }
    v = v.replace(/\\n/g, '\n');
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

loadEnv('C:/Users/filat/dash/packages/server/.env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, label) {
  let delay = 3000;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e && (e.code || (e.response && e.response.status))) || 'ERR';
      process.stdout.write('  retry ' + label + ' attempt=' + attempt + ' code=' + code + '\n');
      if (attempt === 6) throw e;
      await sleep(delay);
      delay = Math.min(delay * 2, 60000);
    }
  }
}

async function main() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await withRetry(
    () => sheets.spreadsheets.get({ spreadsheetId: BOOK_ID, fields: 'properties(title),sheets(properties(sheetId,title,gridProperties))' }),
    'meta'
  );
  const titles = meta.data.sheets.map((s) => s.properties.title);
  process.stdout.write('sheets=' + titles.length + '\n');

  const out = { bookId: BOOK_ID, readAt: new Date().toISOString(), sheets: {} };

  for (const sp of meta.data.sheets) {
    const title = sp.properties.title;
    const rows = (sp.properties.gridProperties && sp.properties.gridProperties.rowCount) || 1000;
    const cols = (sp.properties.gridProperties && sp.properties.gridProperties.columnCount) || 26;
    const res = await withRetry(
      () =>
        sheets.spreadsheets.get({
          spreadsheetId: BOOK_ID,
          ranges: ["'" + title.replace(/'/g, "''") + "'"],
          includeGridData: true,
          fields:
            'sheets(data(rowData(values(userEnteredValue,effectiveValue,formattedValue,userEnteredFormat(numberFormat,backgroundColor),dataValidation,note))))',
        }),
      'data:' + title
    );
    const grid = res.data.sheets[0].data[0].rowData || [];
    const cells = [];
    for (let r = 0; r < grid.length; r++) {
      const vals = (grid[r] && grid[r].values) || [];
      for (let c = 0; c < vals.length; c++) {
        const v = vals[c];
        if (!v) continue;
        const ev = v.effectiveValue;
        const uv = v.userEnteredValue;
        if (!ev && !uv && !v.formattedValue) continue;
        cells.push({
          r: r + 1,
          c: c + 1,
          uv: uv || null,
          ev: ev || null,
          fv: v.formattedValue === undefined ? null : v.formattedValue,
          nf: (v.userEnteredFormat && v.userEnteredFormat.numberFormat) || null,
          bg: (v.userEnteredFormat && v.userEnteredFormat.backgroundColor) || null,
          dv: v.dataValidation || null,
          note: v.note || null,
        });
      }
    }
    out.sheets[title] = { rows, cols, cells };
    process.stdout.write('  done sheet cells=' + cells.length + '\n');
    await sleep(800);
  }

  fs.writeFileSync(OUT + '/monitoring-2-0.json', JSON.stringify(out));
  process.stdout.write('written\n');
}

main().catch((e) => {
  process.stdout.write('FATAL ' + (e && e.message ? e.message.slice(0, 300) : String(e)) + '\n');
  process.exit(1);
});
