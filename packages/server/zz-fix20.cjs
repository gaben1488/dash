/*
 * Repair of the "Ежедневный мониторинг 2.0" workbook: formula separators.
 * The book lives in the ru_RU locale, where the argument separator is ';'.
 * Console output is ASCII-only by design.
 */
const { google } = require('googleapis');
const fs = require('fs');

const BOOK_ID = process.env.BOOK_ID || '1iVY7c7unCk1uyE4xRhWS8EG2vE1Hy2FEvjw5GRGsqec';

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=([\s\S]*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) v = v.slice(1, -1);
    v = v.replace(/\\n/g, '\n');
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv('C:/Users/filat/dash/packages/server/.env');

const SHEETS = [
  ['1. УЭР', 44],
  ['2. УКСиМП', 27],
  ['3. УИО', 34],
  ['4. УАГиЗО', 27],
  ['5. УДТХиРКИ', 34],
  ['6. УД', 107],
  ['7. УФБП', 6],
  ['8. УО', 111],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, label) {
  let delay = 3000;
  for (let a = 1; a <= 6; a++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e && (e.code || (e.response && e.response.status))) || 'ERR';
      process.stdout.write('  retry ' + label + ' attempt=' + a + ' code=' + code + '\n');
      if (a === 6) throw e;
      await sleep(delay);
      delay = Math.min(delay * 2, 60000);
    }
  }
}

function economy(r) {
  return '=IF(ISBLANK(I' + r + ');"";IF(I' + r + '=0;0;ROUND(D' + r + '-I' + r + ';2)))';
}
function check(r) {
  return (
    '=IF(AND(ISBLANK(L' + r + ');ISBLANK(M' + r + ');ISBLANK(N' + r + '));"разбивки нет";' +
    'IF(ROUND(SUM(L' + r + ':N' + r + ');2)=ROUND(N(J' + r + ');2);"верно";"ошибка"))'
  );
}

async function main() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const api = google.sheets({ version: 'v4', auth });

  const data = [];
  for (const [title, last] of SHEETS) {
    const rows = [];
    for (let r = 3; r <= last; r++) rows.push([economy(r), check(r)]);
    data.push({ range: "'" + title + "'!J3:K" + last, values: rows });
  }
  const j = [];
  for (let r = 2; r <= 392; r++) j.push([economy(r)]);
  data.push({ range: "'25-26'!J2:J392", values: j });

  const counts = [];
  for (const [title] of SHEETS) counts.push(["=COUNTIF('" + title + "'!I3:I1000;\"<>\"&\"\")"]);
  data.push({ range: "'СВОДНЫЙ'!C4:C11", values: counts });

  for (const chunk of data) {
    await withRetry(
      () =>
        api.spreadsheets.values.update({
          spreadsheetId: BOOK_ID,
          range: chunk.range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: chunk.values },
        }),
      chunk.range
    );
    process.stdout.write('updated rows=' + chunk.values.length + '\n');
    await sleep(700);
  }
  process.stdout.write('DONE\n');
}

main().catch((e) => {
  process.stdout.write('FATAL ' + (e && e.message ? String(e.message).slice(0, 300) : String(e)) + '\n');
  process.exit(1);
});
