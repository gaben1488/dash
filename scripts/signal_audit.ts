/**
 * scripts/signal_audit.ts — аудит-прогон базы сигналов/правил на РЕАЛЬНЫХ данных Google Sheets.
 *
 * Что делает:
 *   1. Загружает все листы (СВОД + ГРБС) тем же путём, что сервер
 *      (services/google-sheets.getSheetData: UNFORMATTED_VALUE + FORMATTED_STRING даты).
 *   2. Для каждой строки каждого ГРБС гоняет detectSignals() с ТЕМ ЖЕ гейтингом,
 *      что orchestrator.detectSignalsToIssues (header rows, isMetaRow, пустышки).
 *   3. Для каждого листа гоняет RULE_BOOK через classifyRows + scope-фильтр,
 *      как validate.validateData.
 *   4. Пишет счёт срабатываний per сигнал/правило per ГРБС + сэмплы срабатываний
 *      (лист, строка, предмет, ключевые колонки) в scripts/signal_audit_output.md (UTF-8).
 *
 * Запуск (cwd = packages/server, чтобы config подхватил ../../.env):
 *   cd packages/server && npx tsx ../../scripts/signal_audit.ts
 *
 * В консоль — только ASCII (Windows cp1251). Вся кириллица — в выходной файл.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectSignals, type RowSignals } from '../packages/core/src/pipeline/signals.js';
import { classifyRows } from '../packages/core/src/pipeline/classify.js';
import { ingestSheetRows } from '../packages/core/src/pipeline/ingest.js';
import {
  ALL_SHEETS,
  SVOD_SHEET_NAME,
  DEPT_HEADER_ROWS,
  CYRILLIC_TO_LATIN,
  buildCellDict,
  isMetaRow,
  getActiveRules,
  classifySheet,
  CHECK_REGISTRY,
  LEGACY_SIGNAL_TO_CHECK,
  type RuleCheckContext,
} from '../packages/shared/src/index.js';
import { getSheetData } from '../packages/server/src/services/google-sheets.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(SCRIPT_DIR, 'signal_audit_output.md');

/** Сигналы-состояния (не проблемы) — считаем отдельно как денominator-контекст. */
const STATE_SIGNALS = new Set<keyof RowSignals>([
  'signed', 'planning', 'notDue', 'canceled', 'hasFact', 'planSoon', 'economyFlag',
]);

/** Максимум сэмплов на сигнал/правило (по всем листам суммарно). */
const SAMPLE_CAP = 15;

/** Колонки, снимаемые в сэмпл для триажа. */
const SAMPLE_COLS = ['C', 'D', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'Q', 'U', 'V', 'W', 'X', 'Y', 'AC', 'AD', 'AE', 'AF'] as const;

/** Классифицирует значение ячейки-даты: serial-число, ru-строка, X/пусто, другое. */
function dateKind(v: unknown): 'serial' | 'ruString' | 'xEmpty' | 'other' {
  if (v === null || v === undefined || v === '') return 'xEmpty';
  if (typeof v === 'number') return v >= 30000 && v <= 60000 ? 'serial' : 'other';
  const s = String(v).trim();
  if (/^[XxХх·\-—]*$/.test(s)) return 'xEmpty';
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(s)) return 'ruString';
  if (/^\d{5}$/.test(s)) return 'serial';
  return 'other';
}

function short(v: unknown, max = 60): string {
  if (v === null || v === undefined || v === '') return '·';
  return String(v).replace(/\s+/g, ' ').replace(/\|/g, '/').trim().slice(0, max);
}

function lat(sheet: string): string {
  return (CYRILLIC_TO_LATIN as Record<string, string>)[sheet] ?? sheet;
}

interface Sample {
  sheet: string;
  row: number; // 1-based, совпадает с номером строки в Google Sheets
  subject: string;
  cols: string;
  extra?: string;
}

interface Counter {
  total: number;
  bySheet: Record<string, number>;
  samples: Sample[];
}

function bump(map: Map<string, Counter>, key: string, sheet: string, sample?: Sample): void {
  let c = map.get(key);
  if (!c) {
    c = { total: 0, bySheet: {}, samples: [] };
    map.set(key, c);
  }
  c.total++;
  c.bySheet[sheet] = (c.bySheet[sheet] ?? 0) + 1;
  if (sample && c.samples.length < SAMPLE_CAP) c.samples.push(sample);
}

function sampleFromCells(sheet: string, row1based: number, cells: Record<string, unknown>, extra?: string): Sample {
  const subject = short(cells['G'] ?? cells['D'] ?? '', 70);
  const cols = SAMPLE_COLS
    .map(col => `${col}=${short(cells[col], col === 'AE' || col === 'M' ? 90 : 40)}`)
    .join(' ');
  return { sheet, row: row1based, subject, cols, extra };
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const errors: Record<string, string> = {};
  const sheetRows: Record<string, unknown[][]> = {};

  // ── 1. Загрузка листов: до 3 глобальных проходов × 5 попыток на лист
  //    (сеть с плавающими TLS-обрывами — лист может подняться с 4-й попытки). ──
  async function loadSheet(sheetName: string): Promise<string> {
    let lastErr = '';
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const rows = await getSheetData(sheetName);
        sheetRows[sheetName] = rows;
        console.log(`loaded ${lat(sheetName)}: rows=${rows.length} (attempt ${attempt})`);
        return '';
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        await new Promise(res => setTimeout(res, 1000 * attempt));
      }
    }
    return lastErr;
  }

  let pending = [...(ALL_SHEETS as readonly string[])];
  for (let pass = 1; pass <= 3 && pending.length > 0; pass++) {
    const stillFailing: string[] = [];
    for (const sheetName of pending) {
      const err = await loadSheet(sheetName);
      if (err) {
        errors[sheetName] = err;
        stillFailing.push(sheetName);
        console.log(`FAILED (pass ${pass}) ${lat(sheetName)}: ${err.slice(0, 100)}`);
      } else {
        delete errors[sheetName];
      }
    }
    pending = stillFailing;
    if (pending.length > 0 && pass < 3) {
      console.log(`pass ${pass} done, retrying ${pending.length} sheets after pause...`);
      await new Promise(res => setTimeout(res, 5000));
    }
  }

  const loadedSheets = Object.keys(sheetRows);
  if (loadedSheets.length === 0) {
    const md = [
      `# Прогон сигналов — ${startedAt.toISOString()}`,
      '',
      '## ПРОГОН НЕ УДАЛСЯ: ни один лист не загружен',
      '',
      ...Object.entries(errors).map(([s, e]) => `- ${s}: ${e}`),
    ].join('\n');
    writeFileSync(OUT_PATH, md, 'utf-8');
    console.log('NO DATA - see output file');
    process.exitCode = 2;
    return;
  }

  // ── 2. Сигналы (только деп-листы, гейтинг = detectSignalsToIssues) ──
  const signalCounts = new Map<string, Counter>();
  const stateCounts = new Map<string, Counter>();
  const rowStats: Record<string, { raw: number; scanned: number; dataRows: number }> = {};
  /** Диагностика формата дат N/Q per лист: serial-числа ломают parseDate (год 46091). */
  const dateDiag: Record<string, Record<'N' | 'Q', Record<string, number>>> = {};

  for (const sheetName of loadedSheets) {
    if (sheetName === SVOD_SHEET_NAME) continue;
    const rows = sheetRows[sheetName];
    let scanned = 0;
    let dataRows = 0;
    const diag: Record<'N' | 'Q', Record<string, number>> = { N: {}, Q: {} };

    for (let r = DEPT_HEADER_ROWS; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < 5) continue;
      const cells = buildCellDict(row);

      const nameCell = String(cells['C'] ?? cells['D'] ?? '').trim();
      if (isMetaRow(nameCell)) continue;
      const allEmpty = Object.values(cells).every(v => v === null || v === undefined || v === '');
      if (allEmpty) continue;

      let signals: RowSignals;
      try {
        signals = detectSignals(cells);
      } catch {
        continue;
      }
      scanned++;

      // «Честная» строка данных: есть предмет (G, не X-плейсхолдер) или план (K > 0)
      const gText = String(cells['G'] ?? '').trim();
      const kNum = typeof cells['K'] === 'number' ? cells['K'] as number : parseFloat(String(cells['K'] ?? '').replace(/\s/g, '').replace(',', '.'));
      const isRealDataRow = (gText.length > 0 && !/^[XxХх·\-—]+$/.test(gText)) || (!isNaN(kNum) && kNum > 0);
      if (isRealDataRow) {
        dataRows++;
        for (const col of ['N', 'Q'] as const) {
          const kind = dateKind(cells[col]);
          diag[col][kind] = (diag[col][kind] ?? 0) + 1;
        }
      }

      for (const [key, val] of Object.entries(signals)) {
        if (val !== true) continue;
        const target = STATE_SIGNALS.has(key as keyof RowSignals) ? stateCounts : signalCounts;
        const sample = target === signalCounts ? sampleFromCells(sheetName, r + 1, cells) : undefined;
        bump(target, key, sheetName, sample);
      }
    }
    rowStats[sheetName] = { raw: rows.length, scanned, dataRows };
    dateDiag[sheetName] = diag;
  }

  const totalScanned = Object.values(rowStats).reduce((s, v) => s + v.scanned, 0);
  const totalDataRows = Object.values(rowStats).reduce((s, v) => s + v.dataRows, 0);

  // ── 3. Правила RULE_BOOK (все листы, scope-фильтр как validateData) ──
  const ruleCounts = new Map<string, Counter>();
  for (const sheetName of loadedSheets) {
    const rows = sheetRows[sheetName];
    const classified = classifyRows(sheetName, ingestSheetRows(sheetName, rows));
    const sheetClass = classifySheet(sheetName);

    for (const rule of getActiveRules()) {
      if (rule.enabled === false) continue;
      if (rule.scope === 'svod' && sheetClass.kind !== 'svod') continue;
      if (rule.scope === 'department' && sheetClass.kind !== 'department' && sheetClass.kind !== 'subordinates_agg') continue;

      for (const row of classified) {
        if (row.classification === 'header') continue;
        if (rule.rowFilter && !rule.rowFilter.includes(row.classification)) continue;
        const ctx: RuleCheckContext = {
          cells: row.cells,
          rowIndex: row.rowIndex,
          sheet: row.sheet,
          classification: row.classification,
          allRows: classified,
        };
        let result;
        try {
          result = rule.check(ctx);
        } catch {
          continue;
        }
        if (!result.passed) {
          const extra = `cell=${result.cell ?? '?'} actual=${short(result.actual, 30)} expected=${short(result.expected, 30)} | ${short(result.message, 160)}`;
          bump(ruleCounts, rule.id, sheetName, sampleFromCells(sheetName, row.rowIndex, row.cells, extra));
        }
      }
    }
  }

  // ── 4. Markdown-отчёт ──
  const deptSheets = loadedSheets.filter(s => s !== SVOD_SHEET_NAME);
  const lines: string[] = [];
  lines.push(`# Прогон сигналов и правил на реальных данных — ${startedAt.toISOString()}`);
  lines.push('');
  lines.push(`Листов загружено: ${loadedSheets.length} из ${(ALL_SHEETS as readonly string[]).length}. ` +
    `Строк просканировано (после гейтинга, деп-листы): **${totalScanned}**.`);
  lines.push('');

  if (Object.keys(errors).length > 0) {
    lines.push('## Ошибки загрузки листов');
    for (const [s, e] of Object.entries(errors)) lines.push(`- **${s}**: ${e}`);
    lines.push('');
  }

  lines.push('## Строки по листам');
  lines.push('');
  lines.push('| Лист | Строк сырых | Просканировано | Строк данных (G или K>0) |');
  lines.push('|---|---:|---:|---:|');
  for (const s of deptSheets) {
    lines.push(`| ${s} | ${rowStats[s]?.raw ?? 0} | ${rowStats[s]?.scanned ?? 0} | ${rowStats[s]?.dataRows ?? 0} |`);
  }
  if (sheetRows[SVOD_SHEET_NAME]) {
    lines.push(`| ${SVOD_SHEET_NAME} | ${sheetRows[SVOD_SHEET_NAME].length} | (правила по scope svod) | |`);
  }
  lines.push(`| **Итого** | | ${totalScanned} | **${totalDataRows}** |`);
  lines.push('');

  lines.push('## Диагностика формата дат (N = план, Q = факт; по строкам данных)');
  lines.push('');
  lines.push('serial = число дней Google Sheets (46091 = 2026 год) — parseDate() в signals.ts его НЕ понимает');
  lines.push('и превращает в «1 января 46091 года»; все датные сигналы на таких листах молча мертвы.');
  lines.push('');
  lines.push('| Лист | N serial | N дд.мм.гггг | N X/пусто | N другое | Q serial | Q дд.мм.гггг | Q X/пусто | Q другое |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of deptSheets) {
    const d = dateDiag[s];
    if (!d) continue;
    const g = (col: 'N' | 'Q', k: string) => d[col][k] ?? 0;
    lines.push(`| ${s} | ${g('N', 'serial')} | ${g('N', 'ruString')} | ${g('N', 'xEmpty')} | ${g('N', 'other')} | ${g('Q', 'serial')} | ${g('Q', 'ruString')} | ${g('Q', 'xEmpty')} | ${g('Q', 'other')} |`);
  }
  lines.push('');

  const severityOf = (signalKey: string): string => {
    const checkId = (LEGACY_SIGNAL_TO_CHECK as Record<string, string>)[signalKey];
    if (!checkId) return 'badge-only';
    const check = CHECK_REGISTRY.find(c => c.id === checkId);
    return check ? `${check.severity}` : '???';
  };

  const breakdown = (c: Counter): string =>
    deptSheets.filter(s => c.bySheet[s]).map(s => `${s}:${c.bySheet[s]}`).join(', ') || '—';

  lines.push('## Проблемные сигналы (detectSignals, деп-листы)');
  lines.push('');
  lines.push(`| Сигнал | severity | Всего | % от ${totalScanned} строк | По ГРБС |`);
  lines.push('|---|---|---:|---:|---|');
  const allProblemKeys = Object.keys(LEGACY_SIGNAL_TO_CHECK)
    .concat(['singleParticipant', 'lowCompetition', 'methodReasonMismatch', 'unmappedReasonEP', 'budgetMismatch']);
  const seen = new Set<string>();
  const orderedKeys = [
    ...[...signalCounts.entries()].sort((a, b) => b[1].total - a[1].total).map(([k]) => k),
    ...allProblemKeys,
  ].filter(k => (seen.has(k) ? false : (seen.add(k), true)));
  for (const key of orderedKeys) {
    const c = signalCounts.get(key);
    const total = c?.total ?? 0;
    const pct = totalScanned > 0 ? ((total / totalScanned) * 100).toFixed(1) : '0';
    lines.push(`| ${key} | ${severityOf(key)} | ${total} | ${pct}% | ${c ? breakdown(c) : '—'} |`);
  }
  lines.push('');

  lines.push('## Сигналы-состояния (контекст, не проблемы)');
  lines.push('');
  lines.push('| Сигнал | Всего | По ГРБС |');
  lines.push('|---|---:|---|');
  for (const [key, c] of [...stateCounts.entries()].sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`| ${key} | ${c.total} | ${breakdown(c)} |`);
  }
  lines.push('');

  lines.push('## Правила RULE_BOOK (validateData-эквивалент)');
  lines.push('');
  lines.push('| Правило | scope | severity | Всего | По листам |');
  lines.push('|---|---|---|---:|---|');
  for (const rule of getActiveRules()) {
    const c = ruleCounts.get(rule.id);
    const bd = c
      ? Object.entries(c.bySheet).map(([s, n]) => `${s}:${n}`).join(', ')
      : '—';
    lines.push(`| ${rule.id} | ${rule.scope} | ${rule.severity} | ${c?.total ?? 0} | ${bd} |`);
  }
  lines.push('');

  lines.push('## Сэмплы срабатываний сигналов (для триажа)');
  lines.push('');
  for (const key of orderedKeys) {
    const c = signalCounts.get(key);
    if (!c || c.total === 0) continue;
    lines.push(`### ${key} — всего ${c.total}, сэмплов ${c.samples.length}`);
    lines.push('');
    for (const s of c.samples) {
      lines.push(`- **[${s.sheet} стр.${s.row}]** «${s.subject}»`);
      lines.push(`  ${s.cols}`);
    }
    lines.push('');
  }

  lines.push('## Сэмплы срабатываний правил');
  lines.push('');
  for (const [key, c] of [...ruleCounts.entries()].sort((a, b) => b[1].total - a[1].total)) {
    if (c.total === 0) continue;
    lines.push(`### ${key} — всего ${c.total}, сэмплов ${c.samples.length}`);
    lines.push('');
    for (const s of c.samples) {
      lines.push(`- **[${s.sheet} стр.${s.row}]** «${s.subject}» → ${s.extra ?? ''}`);
      lines.push(`  ${s.cols}`);
    }
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`Прогон завершён: ${new Date().toISOString()}. Длительность: ${Math.round((Date.now() - startedAt.getTime()) / 1000)}с.`);
  writeFileSync(OUT_PATH, lines.join('\n'), 'utf-8');

  // ASCII-only summary в консоль
  const problemTotal = [...signalCounts.values()].reduce((s, c) => s + c.total, 0);
  const ruleTotal = [...ruleCounts.values()].reduce((s, c) => s + c.total, 0);
  console.log(`done: sheets=${loadedSheets.length} scannedRows=${totalScanned} signalFirings=${problemTotal} ruleFirings=${ruleTotal}`);
  console.log(`output: ${OUT_PATH}`);
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
