// Замер адаптивности вёрстки: сколько правил ширины объявлено на файл.
// Считаем tailwind-префиксы контрольных точек (sm:/md:/lg:/xl:/2xl:/max-*:),
// медиазапросы в стилях и обращения к matchMedia по ширине.
// Печать только ASCII — консоль Windows не принимает кириллицу.
import { readFileSync } from 'node:fs';
import { argv } from 'node:process';

const RE_BREAKPOINT = /(?:^|[\s"'`{:])(?:max-)?(?:sm|md|lg|xl|2xl):/g;
const RE_MEDIA = /@media[^{]*(?:width|hover|pointer)/g;
const RE_MATCHMEDIA = /matchMedia\(/g;

const rows = [];
for (const file of argv.slice(2)) {
  const src = readFileSync(file, 'utf8');
  const bp = (src.match(RE_BREAKPOINT) || []).length;
  const media = (src.match(RE_MEDIA) || []).length;
  const mm = (src.match(RE_MATCHMEDIA) || []).length;
  rows.push({ file, bp, media, mm, total: bp + media + mm, lines: src.split('\n').length });
}
rows.sort((a, b) => b.total - a.total);
for (const r of rows) {
  console.log(`${String(r.total).padStart(4)}  bp=${String(r.bp).padStart(3)} media=${r.media} mm=${r.mm} lines=${String(r.lines).padStart(5)}  ${r.file}`);
}
console.log(`TOTAL ${rows.reduce((s, r) => s + r.total, 0)} over ${rows.length} files`);
