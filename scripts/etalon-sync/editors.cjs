/* Целевые списки редакторов защит (Р4, решения владельца 29-30.08.2026):
 * структура как в УО — общее ядро + персоны конкретной книги (аналоги
 * vysotskaya717 в УО). Модель выводится из свежих структ-дампов:
 *   ядро    = адрес встречается в защитах >= 6 из 8 книг, ПЛЮС CORE_EXTRA
 *             (решение 30.08): mefmat — персона УФБП и контролёр AD по всем
 *             книгам (как ufbpaemo); mugvika, zmeeva1975 — доступ УЭР к
 *             комментариям по всем книгам. Все трое подняты в ядро.
 *   персона = адрес встречается в защитах ровно одной книги.
 * Запуск напрямую печатает матрицу: node scripts/etalon-sync/editors.cjs */
const CORE_EXTRA = ['mefmat@gmail.com', 'mugvika@gmail.com', 'zmeeva1975@gmail.com'];
const fs = require('fs');
const path = require('path');
const { BOOKS, DUMP_DIR } = require('./lib.cjs');

function collectEditorsByBook() {
  const byBook = {};
  for (const [arg, b] of Object.entries(BOOKS)) {
    const struct = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, b.key + '-struct.json'), 'utf8'));
    const set = new Set();
    for (const s of struct.spreadsheet.sheets || []) {
      for (const p of s.protectedRanges || []) {
        for (const u of ((p.editors || {}).users || [])) set.add(u);
      }
    }
    byBook[arg] = set;
  }
  return byBook;
}

function buildModel() {
  const byBook = collectEditorsByBook();
  const freq = new Map();
  for (const set of Object.values(byBook)) for (const u of set) freq.set(u, (freq.get(u) || 0) + 1);
  const core = Array.from(new Set([
    ...[...freq.entries()].filter(([, n]) => n >= 6).map(([u]) => u),
    ...CORE_EXTRA,
  ])).sort();
  const coreSet = new Set(core);
  const personal = {}; const semi = new Map();
  for (const [arg, set] of Object.entries(byBook)) {
    personal[arg] = [...set].filter((u) => freq.get(u) === 1 && !coreSet.has(u)).sort();
  }
  for (const [u, n] of freq) if (n >= 2 && n < 6 && !coreSet.has(u)) semi.set(u, n);
  return { byBook, core, personal, semi };
}

/** Целевой список редакторов защит главного листа книги. */
function targetEditors(bookArg) {
  const { core, personal } = buildModel();
  return Array.from(new Set([...core, ...(personal[bookArg] || [])])).sort();
}

if (require.main === module) {
  const { byBook, core, personal, semi } = buildModel();
  const out = [];
  out.push('# Р4: целевые списки редакторов защит (модель «ядро + персоны книги»)\n');
  out.push('## Ядро (в защитах >= 6 книг, входит во все целевые списки):');
  core.forEach((u) => out.push('- ' + u));
  out.push('\n## Персоны книг (аналоги vysotskaya717 в УО):');
  for (const arg of Object.keys(BOOKS)) {
    out.push(`- ${BOOKS[arg].ru}: ` + ((personal[arg] || []).join(', ') || '(нет)'));
  }
  out.push('\n## Полуядро (2-5 книг) — в целевые списки НЕ входит, вопрос владельцу:');
  for (const [u, n] of [...semi.entries()].sort((a, b) => b[1] - a[1])) {
    const where = Object.keys(BOOKS).filter((arg) => byBook[arg].has(u)).map((arg) => BOOKS[arg].ru).join(', ');
    out.push(`- ${u} (${n} кн.: ${where})`);
  }
  out.push('\n## Целевые списки по книгам (ядро + персоны):');
  for (const arg of Object.keys(BOOKS)) {
    out.push(`- ${BOOKS[arg].ru} (${targetEditors(arg).length}): ` + targetEditors(arg).join(', '));
  }
  const file = 'E:/aemr-dumps/etalon-sync/plans/2026-08-29-r4-editors-matrix.md';
  fs.writeFileSync(file, out.join('\n'), 'utf8');
  console.log('MATRIX WRITTEN ' + file);
}

module.exports = { targetEditors, buildModel };
