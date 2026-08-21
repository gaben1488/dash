/**
 * Числа, которые покажет раздел «Сверка трёх источников», — на живых дампах.
 * Повторяет арифметику packages/web/src/lib/monitoring/triple-view.ts:
 * разрыв класса — сумма модулей, сумма закупок — начальная цена по стороне,
 * которая её знает (лист → реестр → книга ГРБС).
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { DEPT_HEADER_ROWS } from '../packages/shared/src/index.js';
import { parseMonitoringJournal } from '../packages/core/src/monitoring/journal.js';
import {
  MONITORING_DEPT_SHEETS, parseMonitoringProcedures,
} from '../packages/core/src/monitoring/procedures.js';
import {
  TRIPLE_FINDING_LABELS, bookSide, journalSide, sheetSide, tripleCheck,
} from '../packages/core/src/monitoring/triple-check.js';

interface Grids {
  books: Record<string, { sheet: string; rows: unknown[][] }>;
  monitoring: Record<string, unknown[][]>;
}

const DEPT_BY_DUMP: Record<string, string> = {
  UER: 'УЭР', UKSiMP: 'УКСиМП', UIO: 'УИО', UAGZO: 'УАГЗО',
  UDTH: 'УДТХ', UD: 'УД', UFBP: 'УФБП', UO: 'УО',
};

const rub = (v: number | null): string =>
  v === null ? '—' : Math.round(v).toLocaleString('ru-RU');

const [gridsPath, outPath] = process.argv.slice(2);
const grids = JSON.parse(readFileSync(gridsPath, 'utf8')) as Grids;
const readAt = statSync(gridsPath).mtime.toISOString();

const rowsByDept: Record<string, unknown[][]> = {};
const sheetNameByDept: Record<string, string> = {};
for (const [dump, book] of Object.entries(grids.books)) {
  const dept = DEPT_BY_DUMP[dump] ?? dump;
  rowsByDept[dept] = book.rows.slice(DEPT_HEADER_ROWS);
  sheetNameByDept[dept] = book.sheet;
}
const deptGrids: Record<string, unknown[][]> = {};
for (const { sheet } of MONITORING_DEPT_SHEETS) {
  if (grids.monitoring[sheet]) deptGrids[sheet] = grids.monitoring[sheet];
}
const registry = parseMonitoringProcedures(deptGrids);
const journal = parseMonitoringJournal(grids.monitoring['25-26']);
const result = tripleCheck({
  readAt,
  bookRows: bookSide(rowsByDept, sheetNameByDept),
  sheetRows: sheetSide(registry.procedures),
  journalRows: journalSide(journal.rows),
});

const amountOf = (r: (typeof result.rows)[number]): number | null =>
  r.plan.sheetRub ?? r.plan.journalRub ?? r.plan.bookRub;

const groups = new Map<string, { n: number; delta: number | null; amount: number | null; expected: boolean }>();
let agreed = 0;
let expectedOnly = 0;
let diverged = 0;
let deltaSum: number | null = null;
let divergedAmount: number | null = null;

for (const row of result.rows) {
  const amount = amountOf(row);
  const real = row.findings.filter((f) => !f.expected);
  if (row.findings.length === 0) agreed += 1;
  else if (real.length === 0) { agreed += 1; expectedOnly += 1; }
  else {
    diverged += 1;
    if (amount !== null) divergedAmount = (divergedAmount ?? 0) + amount;
    for (const f of real) if (f.deltaRub !== null) deltaSum = (deltaSum ?? 0) + Math.abs(f.deltaRub);
  }
  for (const f of row.findings) {
    const g = groups.get(f.kind) ?? { n: 0, delta: null, amount: null, expected: true };
    g.n += 1;
    if (f.deltaRub !== null) g.delta = (g.delta ?? 0) + Math.abs(f.deltaRub);
    if (amount !== null) g.amount = (g.amount ?? 0) + amount;
    if (!f.expected) g.expected = false;
    groups.set(f.kind, g);
  }
}

const out: string[] = [];
out.push('# Числа раздела «Сверка трёх источников»', '');
out.push(`Момент чтения снимков: ${readAt}`, '');
out.push('## Сводка (четыре плитки экрана)', '');
out.push(`- закупок в сверке: ${result.summary.codesTotal};`);
out.push(`- сошлись: ${agreed} (из них ${expectedOnly} — где различие есть, но это форма совместной закупки);`);
out.push(`- разошлись: ${diverged};`);
out.push(`- разрыв всего: ${rub(deltaSum)} руб.;`);
out.push(`- начальная цена разошедшихся закупок: ${rub(divergedAmount)} руб. (это НЕ потеря — размер вопроса).`, '');
out.push('## Карточки классов', '');
out.push('| Класс | Закупок | Разрыв, руб. | Начальная цена, руб. | Форма |');
out.push('|---|---:|---:|---:|---|');
for (const [kind, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
  out.push(`| ${TRIPLE_FINDING_LABELS[kind as keyof typeof TRIPLE_FINDING_LABELS] ?? kind} | ${g.n} | ${rub(g.delta)} | ${rub(g.amount)} | ${g.expected ? 'да' : '—'} |`);
}
out.push('', `Строк с номером процедуры, набранным с опечаткой: ${result.orphans.length}.`, '');

writeFileSync(outPath, out.join('\n'), 'utf8');
console.log('written');
