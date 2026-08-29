/* Перекраска «Лист1» УАГЗО на цветовой подвед-канон (после смены канона 30.08). */
const { BOOKS, sheetsApi } = require('./lib.cjs');
const { applyPodved, headerTemplateFromUO, verify, fetchAllStruct } = require('./apply.cjs');
const { targetEditors } = require('./editors.cjs');

(async () => {
  const api = sheetsApi('write');
  const book = BOOKS.uagzo;
  const struct = await fetchAllStruct(api, book.id);
  const sheet = (struct.sheets || []).find((s) => s.properties.title === 'Лист1');
  if (!sheet) { console.log('NO List1'); return; }
  const report = []; const blocked = [];
  const applied = await applyPodved(api, book, sheet, headerTemplateFromUO(), targetEditors('uagzo'), report, blocked);
  const v = applied ? await verify(api, book, 'Лист1', { cf: 15, prot: null, band: true }) : { ok: false, blocked };
  console.log('LIST1 ' + JSON.stringify(v));
  for (const r of report) console.log('- ' + r);
})().catch((e) => { console.log('FATAL: ' + String(e.message).slice(0, 200)); process.exit(1); });
