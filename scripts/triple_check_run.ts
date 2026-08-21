/**
 * triple_check_run.ts — тройная сверка на живых дампах книг.
 *
 * Сетки листов достаёт scripts/triple_check_extract.py (потоково, ijson);
 * считает — продуктовый код @aemr/core, тот же, что работает в сервисе:
 * числа отчёта и числа экрана обязаны быть одним числом.
 *
 *   python scripts/triple_check_extract.py --out grids.json
 *   ./packages/core/node_modules/.bin/tsx scripts/triple_check_run.ts grids.json отчёт.md
 *
 * tsx стоит в пакете core, а не в корне монорепозитория: `node --import tsx`
 * из корня падает с ERR_MODULE_NOT_FOUND.
 *
 * Отчёт пишется файлом в UTF-8: печатать кириллицу в консоль Windows нельзя.
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { DEPT_HEADER_ROWS } from '../packages/shared/src/index.js';
import { parseMonitoringJournal } from '../packages/core/src/monitoring/journal.js';
import {
  MONITORING_DEPT_SHEETS,
  parseMonitoringProcedures,
} from '../packages/core/src/monitoring/procedures.js';
import {
  TRIPLE_FINDING_LABELS,
  bookSide,
  journalSide,
  sheetSide,
  tripleCheck,
  type TripleFindingKind,
  type TripleRow,
} from '../packages/core/src/monitoring/triple-check.js';

/**
 * Сетки, снятые с дампов. Ячейка — либо число (книга держит число, и продукт
 * читает его без округления формата), либо строка (предмет, номер процедуры),
 * поэтому тип ячейки здесь `unknown`, как и в продуктовых разборах.
 */
interface Grids {
  books: Record<string, { sheet: string; rows: unknown[][] }>;
  monitoring: Record<string, unknown[][]>;
}

/** Короткое имя книги дампа → канонический ид управления продукта. */
const DEPT_BY_DUMP: Record<string, string> = {
  UER: 'УЭР', UKSiMP: 'УКСиМП', UIO: 'УИО', UAGZO: 'УАГЗО',
  UDTH: 'УДТХ', UD: 'УД', UFBP: 'УФБП', UO: 'УО',
};

const money = (v: number | null): string =>
  v === null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

function main(): void {
  const [gridsPath, outPath] = process.argv.slice(2);
  const grids = JSON.parse(readFileSync(gridsPath, 'utf8')) as Grids;
  const readAt = statSync(gridsPath).mtime.toISOString();

  // Сторона 1 — книги ГРБС (шапка в три строки срезается).
  const rowsByDept: Record<string, unknown[][]> = {};
  const sheetNameByDept: Record<string, string> = {};
  for (const [dump, book] of Object.entries(grids.books)) {
    const dept = DEPT_BY_DUMP[dump] ?? dump;
    rowsByDept[dept] = book.rows.slice(DEPT_HEADER_ROWS);
    sheetNameByDept[dept] = book.sheet;
  }
  const bookRows = bookSide(rowsByDept, sheetNameByDept);

  // Стороны 2 и 3 — листы управлений и переходящий реестр книги мониторинга.
  const deptGrids: Record<string, unknown[][]> = {};
  for (const { sheet } of MONITORING_DEPT_SHEETS) {
    if (grids.monitoring[sheet]) deptGrids[sheet] = grids.monitoring[sheet];
  }
  const registry = parseMonitoringProcedures(deptGrids);
  const journal = parseMonitoringJournal(grids.monitoring['25-26']);

  const result = tripleCheck({
    readAt,
    bookRows,
    sheetRows: sheetSide(registry.procedures),
    journalRows: journalSide(journal.rows),
  });

  // ── Отчёт ────────────────────────────────────────────────────────
  const out: string[] = [];
  out.push('# Тройная сверка на живых дампах', '');
  out.push(`Момент чтения снимков: ${readAt}`, '');
  out.push('## Что с чем сверялось', '');
  out.push(`- книги ГРБС: ${Object.keys(rowsByDept).length}, строк с номером процедуры в AG — ${bookRows.length};`);
  // Имя листа — половина адреса, и оно же ответ на вопрос «откуда число»:
  // в книгах УАГЗО и УКСиМП лист данных объявлен в Settings неверно (канон
  // п.96), поэтому названный лист обязан быть виден читателю.
  for (const [dept, name] of Object.entries(sheetNameByDept).sort()) {
    out.push(`  - ${dept}: лист «${name}», строк ${rowsByDept[dept].length};`);
  }
  out.push(`- листы управлений мониторинга: процедур ${registry.procedures.length}, из них с разобранным кодом ${registry.procedures.filter((p) => p.code !== null).length};`);
  out.push(`- переходящий реестр «25-26»: строк ${journal.rows.length}, с разобранным кодом ${journal.rows.filter((r) => r.code !== null).length}.`, '');

  const s = result.summary;
  out.push('## Охват', '');
  out.push(`- закупок в сверке (уникальных кодов): ${s.codesTotal};`);
  out.push(`- все три записи на месте: ${s.allThreeSides};`);
  out.push(`- две записи из трёх: ${s.twoSides};`);
  out.push(`- одна запись: ${s.oneSide};`);
  out.push(`- без единого расхождения («сверка чиста»): ${s.clean}.`, '');

  out.push('## Классы расхождений', '');
  out.push('| Класс | Закупок |');
  out.push('|---|---:|');
  for (const kind of Object.keys(TRIPLE_FINDING_LABELS) as TripleFindingKind[]) {
    out.push(`| ${TRIPLE_FINDING_LABELS[kind]} | ${s.byKind[kind]} |`);
  }
  out.push('');

  // Кто отстаёт по каждой величине — ради чего заводилась третья запись.
  const outliers: Record<string, Record<string, number>> = {};
  for (const key of ['plan', 'fact', 'savings'] as const) {
    const tally: Record<string, number> = { book: 0, sheet: 0, journal: 0, 'все трое': 0 };
    for (const row of result.rows) {
      const m = row[key];
      if (m.agrees !== false) continue;
      tally[m.outlier ?? 'все трое'] += 1;
    }
    outliers[key] = tally;
  }
  out.push('## Кто отстал (две записи против одной)', '');
  out.push('| Величина | книга ГРБС | лист управления | реестр «25-26» | расходятся все трое |');
  out.push('|---|---:|---:|---:|---:|');
  const names: Record<string, string> = { plan: 'начальная цена', fact: 'факт / цена победителя', savings: 'экономия' };
  for (const key of ['plan', 'fact', 'savings']) {
    const t = outliers[key];
    out.push(`| ${names[key]} | ${t.book} | ${t.sheet} | ${t.journal} | ${t['все трое']} |`);
  }
  out.push('');

  // Десять крупнейших расхождений — чтобы разговор был предметным.
  const worst = result.rows
    .flatMap((row: TripleRow) => row.findings
      .filter((f) => f.deltaRub !== null && !f.expected)
      .map((f) => ({ row, f })))
    .sort((a, b) => Math.abs(b.f.deltaRub as number) - Math.abs(a.f.deltaRub as number))
    .slice(0, 15);
  out.push('## Пятнадцать крупнейших расхождений', '');
  // Организация в строке — требование канона п.119: сигнал называет не только
  // ГРБС, но и учреждение внутри него, иначе адресовать замечание некому.
  out.push('| Код | Класс | Разрыв, руб. | Адреса | Учреждение | Предмет |');
  out.push('|---|---|---:|---|---|---|');
  for (const { row, f } of worst) {
    const org = row.subordinates.length > 0 ? row.subordinates.join('; ').slice(0, 40) : '—';
    out.push(`| ${f.code} | ${TRIPLE_FINDING_LABELS[f.kind]} | ${money(f.deltaRub)} | ${f.addresses.slice(0, 3).join(', ')} | ${org} | ${row.subject.slice(0, 60)} |`);
  }
  out.push('');

  out.push('## Коды с опечаткой (мост не строится)', '');
  out.push('| Адрес | Записано | Похоже на | Кандидат по предмету |');
  out.push('|---|---|---|---|');
  for (const o of result.orphans.slice(0, 30)) {
    out.push(`| ${o.address} | ${o.text.slice(0, 50)} | ${o.guess ?? '—'} | ${o.subjectCandidate ? `${o.subjectCandidate.code} (${Math.round(o.subjectCandidate.similarity * 100)} %)` : '—'} |`);
  }
  out.push('');

  // Пример разбора одной закупки — как это выглядит человеку.
  const example = result.rows.find((r) => r.findings.some((f) => f.kind === 'fact-differs' && !f.expected));
  if (example) {
    out.push('## Пример одной закупки', '');
    out.push(`Код ${example.code} — «${example.subject.slice(0, 90)}».`, '');
    for (const [label, m] of [['Начальная цена', example.plan], ['Факт / цена победителя', example.fact], ['Экономия', example.savings]] as const) {
      out.push(`- ${label}: книга ГРБС — ${money(m.bookRub)}; лист управления — ${money(m.sheetRub)}; реестр «25-26» — ${money(m.journalRub)}.`);
    }
    out.push('');
    for (const f of example.findings) out.push(`- **${TRIPLE_FINDING_LABELS[f.kind]}.** ${f.note} Адреса: ${f.addresses.join(', ')}.`);
    out.push('');
  }

  writeFileSync(outPath, out.join('\n'), 'utf8');
  process.stdout.write(`written: ${outPath}\n`);
}

main();
