/* Финальная сверка «канон ↔ факт» по всем 8 книгам: главные (34 УФ, защиты,
 * банда #FBF9F9), подведы (15 УФ, банда), остатки без бота. UTF-8 отчёт. */
const fs = require('fs');
const { BOOKS, sheetsApi, hexcolor } = require('./lib.cjs');
const { goldenCF } = require('./canon.cjs');
const CF_FULL = goldenCF(0).length;
const CF_VISUAL = goldenCF(0, { visualOnly: true }).length;

const SERVICE = new Set(['_Настройки', '_ChangeLog', 'Контроль', 'Settings', 'GOOGLE_ФОРМУЛЫ']);

(async () => {
  const api = sheetsApi('read');
  const lines = ['# Финальная сверка эталона — ' + new Date().toISOString(), ''];
  let bad = 0;
  for (const arg of Object.keys(BOOKS)) {
    const b = BOOKS[arg];
    const r = await api.spreadsheets.get({
      spreadsheetId: b.id,
      fields: 'sheets(properties(title,hidden),conditionalFormats,protectedRanges(range,editors(users)),bandedRanges(rowProperties(secondBandColorStyle)))',
    });
    lines.push(`## ${b.ru}`);
    for (const sh of r.data.sheets) {
      const t = sh.properties.title;
      const cf = (sh.conditionalFormats || []).length;
      const band = (((sh.bandedRanges || [])[0] || {}).rowProperties || {});
      const second = band.secondBandColorStyle && band.secondBandColorStyle.rgbColor ? hexcolor(band.secondBandColorStyle.rgbColor) : null;
      const noBot = (sh.protectedRanges || []).filter((p) => !(((p.editors || {}).users) || []).some((u) => u.includes('gserviceaccount'))).length;
      if (t === b.main) {
        const okCf = cf === CF_FULL; const okBand = second === '#FBF9F9';
        if (!okCf || !okBand || noBot) bad++;
        lines.push(`- ГЛАВНЫЙ «${t}»: УФ ${cf}${okCf ? '' : ` ≠${CF_FULL} ⚠`}; банда ${second}${okBand ? '' : ' ⚠'}; защит без бота ${noBot}${noBot ? ' ⚠' : ''}`);
      } else if (!SERVICE.has(t)) {
        const okCf = cf === CF_VISUAL; const okBand = second === '#FBF9F9';
        if (!okCf || !okBand) { bad++; lines.push(`- подвед «${t}»: УФ ${cf}${okCf ? '' : ` ≠${CF_VISUAL} ⚠`}; банда ${second || 'нет'}${okBand ? '' : ' ⚠'}${sh.properties.hidden ? '' : '; ВИДИМ'}`); }
      } else {
        if (noBot) lines.push(`- служебный «${t}»: защит без бота ${noBot}`);
      }
    }
    lines.push('');
    await new Promise((r2) => setTimeout(r2, 700));
  }
  lines.push(bad ? `ИТОГ: расхождений ${bad} — см. ⚠` : 'ИТОГ: все листы соответствуют канону.');
  fs.writeFileSync('E:/aemr-dumps/etalon-sync/reports/final-verify.md', lines.join('\n'), 'utf8');
  console.log('VERIFY DONE bad=' + bad);
})().catch((e) => { console.log('FATAL: ' + String(e.message).slice(0, 200)); process.exit(1); });
