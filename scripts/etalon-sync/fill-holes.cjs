/* Починка дыр: пустые ячейки формульных колонок в строках с номером закупки
 * заполняются эталонной формулой строки 4 с перенумерацией. Перебитые
 * (непустые с чужой структурой) НЕ трогаются — решение владельца 30.08.
 * Снапшот адресов дыр -> rollback (откат = очистка этих ячеек). */
const fs = require('fs');
const { BOOKS, sheetsApi } = require('./lib.cjs');

const COLS = ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retarget = (f4, rowN) => String(f4).replace(/([A-Za-zА-Яа-я\$])4(?!\d)/g, '$1' + rowN);

(async () => {
  const api = sheetsApi('write');
  const report = [];
  for (const arg of Object.keys(BOOKS)) {
    const b = BOOKS[arg];
    const q = (r) => `'${b.main.replace(/'/g, "''")}'!${r}`;
    const rA = await api.spreadsheets.values.get({ spreadsheetId: b.id, range: q('A4:A'), valueRenderOption: 'UNFORMATTED_VALUE' });
    const A = rA.data.values || [];
    const last = 3 + A.length;
    const rF = await api.spreadsheets.values.batchGet({
      spreadsheetId: b.id, ranges: COLS.map((c) => q(`${c}4:${c}${last}`)), valueRenderOption: 'FORMULA',
    });
    const data = [];
    const holes = [];
    rF.data.valueRanges.forEach((vr, ci) => {
      const col = COLS[ci];
      const rows = vr.values || [];
      const f4 = (rows[0] || [])[0];
      if (!f4 || !String(f4).startsWith('=')) return;
      // непрерывные отрезки дыр -> один range на отрезок
      let runStart = null; let runVals = [];
      const flush = () => {
        if (runStart === null) return;
        data.push({ range: q(`${col}${runStart}:${col}${runStart + runVals.length - 1}`), values: runVals.map((v) => [v]) });
        runStart = null; runVals = [];
      };
      for (let i = 1; i < A.length; i++) {
        const rowN = 4 + i;
        const cell = (rows[i] || [])[0];
        // «Все дыры» (решение 30.08): и строки-прокладки без номера — эталонная
        // формула в них отдаёт пусто, зато будущая закупка не родит дыру.
        const isHole = (cell === undefined || cell === '');
        if (isHole) {
          if (runStart === null) runStart = rowN;
          else if (rowN !== runStart + runVals.length) { flush(); runStart = rowN; }
          runVals.push(retarget(f4, rowN));
          holes.push(col + rowN);
        } else flush();
      }
      flush();
    });
    if (!data.length) { report.push(`${b.ru}: дыр нет`); await sleep(600); continue; }
    fs.writeFileSync(`E:/aemr-dumps/etalon-sync/rollback/${b.key}-holes-filled.json`,
      JSON.stringify({ savedAt: new Date().toISOString(), holes }), 'utf8');
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId: b.id,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
    report.push(`${b.ru}: заполнено дыр ${holes.length} (отрезков ${data.length})`);
    await sleep(1200);
  }
  fs.writeFileSync('E:/aemr-dumps/etalon-sync/reports/holes-filled.md',
    '# Починка дыр — ' + new Date().toISOString() + '\n\n' + report.map((r) => '- ' + r).join('\n'), 'utf8');
  console.log('HOLES DONE');
  for (const r of report) console.log('- ' + r.replace(/[^\x00-\x7F]/g, (c) => c));
})().catch((e) => { console.log('FATAL: ' + String(e.message).slice(0, 300)); process.exit(1); });
