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
  parseSheetDate,
  type RuleCheckContext,
} from '../packages/shared/src/index.js';
import { getSheetData } from '../packages/server/src/services/google-sheets.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(SCRIPT_DIR, 'signal_audit_output.md');
/** Instance-дамп для триажа: до 15 ПРЕДСТАВИТЕЛЬНЫХ строк на сигнал (спред по листам). */
const ROWS_OUT_PATH = path.resolve(SCRIPT_DIR, 'signal_audit_rows_2026-07-15.md');

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

/** Serial-дата Google Sheets → дд.мм.гггг (для читабельного дампа). */
function humanDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '·';
  if (typeof v === 'number' && v > 40000 && v < 60000) {
    const d = new Date((v - 25569) * 86400000);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getUTCFullYear()}`;
  }
  return short(v, 20);
}

/** Профильные колонки правила per сигнал — в instance-дамп идут только они. */
const SIGNAL_COLS: Record<string, string[]> = {
  planWithoutExecution: ['K', 'L', 'N', 'Q', 'U', 'AE', 'AF'],
  lowCompetition: ['L', 'K', 'Y', 'AC', 'AD', 'U'],
  unmappedReasonEP: ['L', 'M'],
  methodReasonMismatch: ['L', 'M'],
  epJustificationMissing: ['L', 'M', 'K', 'AE'],
  financeDelay: ['K', 'N', 'Q', 'U', 'AE', 'AF'],
  factDateBeforePlan: ['L', 'N', 'Q', 'U', 'AF'],
  economyConflict: ['L', 'K', 'Y', 'AC', 'AD', 'AE', 'AF'],
  highEconomy: ['L', 'K', 'Y', 'AC', 'AD', 'U'],
  earlyClosure: ['L', 'N', 'Q', 'U', 'AF'],
  factWithoutDate: ['N', 'Q', 'V', 'W', 'X', 'Y', 'M', 'AF'],
  dateWithoutFact: ['N', 'Q', 'Y', 'U', 'AF'],
  singleParticipant: ['L', 'K', 'Y', 'U'],
  factExceedsPlan: ['K', 'Y', 'AC', 'AD', 'N', 'Q', 'AF'],
  overdue: ['K', 'N', 'Q', 'U', 'AE', 'AF'],
  stalledContract: ['N', 'Q', 'U', 'AE', 'AF'],
  dataQuality: ['D', 'K', 'L', 'N', 'Q'],
  budgetUnderallocation: ['H', 'I', 'J', 'K', 'Y'],
  budgetSourceMissing: ['H', 'I', 'J', 'K'],
};

/** Колонки-даты: в дампе рендерим serial → дд.мм.гггг. */
const DATE_COLS = new Set(['N', 'Q']);
/** Колонки-нарративы: длинный кэп, чтобы триаж видел причину целиком. */
const LONG_COLS = new Set(['M', 'U', 'AE', 'AF']);

function renderSignalCols(key: string, cells: Record<string, unknown>): string {
  const cols = SIGNAL_COLS[key] ?? [...SAMPLE_COLS];
  return cols
    .map(col => {
      if (DATE_COLS.has(col)) return `${col}=${humanDate(cells[col])}`;
      return `${col}=${short(cells[col], LONG_COLS.has(col) ? 160 : 40)}`;
    })
    .join(' | ');
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
  /** Сырые ячейки строки — для профильного instance-дампа. */
  cells?: Record<string, unknown>;
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
  // Храним ВСЕ сэмплы (счёт срабатываний мал), представительные 15 отбираем при записи.
  if (sample) c.samples.push(sample);
}

/**
 * Представительный отбор: round-robin по листам, чтобы 15 сэмплов не были
 * «первые 15 строк УЭР», а покрывали все ГРБС, где сигнал сработал.
 */
function representative(samples: Sample[], cap = SAMPLE_CAP): Sample[] {
  const bySheet = new Map<string, Sample[]>();
  for (const s of samples) {
    const list = bySheet.get(s.sheet);
    if (list) list.push(s);
    else bySheet.set(s.sheet, [s]);
  }
  const lists = [...bySheet.values()];
  const out: Sample[] = [];
  for (let i = 0; out.length < cap; i++) {
    let added = false;
    for (const list of lists) {
      if (i < list.length) {
        out.push(list[i]);
        added = true;
        if (out.length >= cap) break;
      }
    }
    if (!added) break;
  }
  return out;
}

function sampleFromCells(sheet: string, row1based: number, cells: Record<string, unknown>, extra?: string): Sample {
  const subject = short(cells['G'] ?? cells['D'] ?? '', 70);
  const cols = SAMPLE_COLS
    .map(col => `${col}=${short(cells[col], col === 'AE' || col === 'M' ? 90 : 40)}`)
    .join(' ');
  return { sheet, row: row1based, subject, cols, extra, cells };
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

  /** Триаж-разбивки: количественно отделяют шум/техбаг от реальных случаев. */
  const triage = {
    /** economyConflict: что реально лежит в AD (гипотеза техбага: economyFlag ищет «эконом», а в AD — «да/нет»). */
    economyConflictAD: {} as Record<string, number>,
    /** financeDelay: класс совпадения — «нет/отсутствие финансирования» vs «софинансир*» (вероятный FP) vs прочее. */
    financeDelayKind: {} as Record<string, number>,
    /** lowCompetition: факт == план копейка-в-копейку (план, скорее всего, подогнан под контракт) vs 0<эк<2%. */
    lowCompetitionExactEq: 0,
    lowCompetitionTotal: 0,
    /** planWithoutExecution: есть ли плановая дата; что в комментариях. */
    pwe: { total: 0, hasPlanDate: 0, noPlanDate: 0, afPlanning: 0, afFinance: 0 },
    /** unmappedReasonEP: частотка значений M — кандидаты на новые кластеры словаря. */
    unmappedM: new Map<string, number>(),
    /** factDateBeforePlan: распределение опережения в днях. */
    fdbpDays: { d1_7: 0, d8_14: 0, d15_30: 0 },
  };

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

      // ── Триаж-разбивки по сработавшим сигналам ──
      const yNum = typeof cells['Y'] === 'number' ? cells['Y'] as number : parseFloat(String(cells['Y'] ?? '').replace(/\s/g, '').replace(',', '.'));
      const comment = `${String(cells['AE'] ?? '')} ${String(cells['AF'] ?? '')}`.toLowerCase();

      if (signals.economyConflict) {
        const adRaw = String(cells['AD'] ?? '').trim().toLowerCase();
        const adKey = adRaw === '' || /^[xхXХ·\-–—]+$/.test(adRaw) ? 'пусто' : adRaw.slice(0, 20);
        triage.economyConflictAD[adKey] = (triage.economyConflictAD[adKey] ?? 0) + 1;
      }
      if (signals.financeDelay) {
        let kind: string;
        if (comment.includes('софинансир')) kind = 'софинансир* (вероятный FP)';
        else if (/(?:нет|отсутств[а-я]*)\s+финансир/.test(comment)) kind = 'нет/отсутствие финансирования';
        else kind = 'прочее упоминание «финансир»';
        triage.financeDelayKind[kind] = (triage.financeDelayKind[kind] ?? 0) + 1;
      }
      if (signals.lowCompetition) {
        triage.lowCompetitionTotal++;
        if (!isNaN(kNum) && !isNaN(yNum) && kNum === yNum) triage.lowCompetitionExactEq++;
      }
      if (signals.planWithoutExecution) {
        triage.pwe.total++;
        const nKind = dateKind(cells['N']);
        if (nKind === 'serial' || nKind === 'ruString') triage.pwe.hasPlanDate++;
        else triage.pwe.noPlanDate++;
        if (comment.includes('планир')) triage.pwe.afPlanning++;
        if (comment.includes('финансир')) triage.pwe.afFinance++;
      }
      if (signals.unmappedReasonEP) {
        const mNorm = String(cells['M'] ?? '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 70);
        triage.unmappedM.set(mNorm, (triage.unmappedM.get(mNorm) ?? 0) + 1);
      }
      if (signals.factDateBeforePlan) {
        const nD = parseSheetDate(cells['N']);
        const qD = parseSheetDate(cells['Q']);
        if (nD && qD) {
          const diff = Math.round((nD.getTime() - qD.getTime()) / 86400000);
          if (diff <= 7) triage.fdbpDays.d1_7++;
          else if (diff <= 14) triage.fdbpDays.d8_14++;
          else triage.fdbpDays.d15_30++;
        }
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
    const reps = representative(c.samples);
    lines.push(`### ${key} — всего ${c.total}, представительных сэмплов ${reps.length}`);
    lines.push('');
    for (const s of reps) {
      lines.push(`- **[${s.sheet} стр.${s.row}]** «${s.subject}»`);
      lines.push(`  ${s.cols}`);
    }
    lines.push('');
  }

  lines.push('## Сэмплы срабатываний правил');
  lines.push('');
  for (const [key, c] of [...ruleCounts.entries()].sort((a, b) => b[1].total - a[1].total)) {
    if (c.total === 0) continue;
    const reps = representative(c.samples);
    lines.push(`### ${key} — всего ${c.total}, представительных сэмплов ${reps.length}`);
    lines.push('');
    for (const s of reps) {
      lines.push(`- **[${s.sheet} стр.${s.row}]** «${s.subject}» → ${s.extra ?? ''}`);
      lines.push(`  ${s.cols}`);
    }
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`Прогон завершён: ${new Date().toISOString()}. Длительность: ${Math.round((Date.now() - startedAt.getTime()) / 1000)}с.`);
  writeFileSync(OUT_PATH, lines.join('\n'), 'utf-8');

  // ── 5. Instance-дамп для триажа: представительные строки + разбивки ──
  const rl: string[] = [];
  rl.push(`# Instance-дамп сигналов для триажа — ${startedAt.toISOString()}`);
  rl.push('');
  rl.push('До 15 представительных строк на сигнал (round-robin по листам). Даты N/Q приведены к дд.мм.гггг.');
  rl.push('Показаны только колонки соответствующего правила. Номер строки = номер строки в Google-листе.');
  rl.push('');

  rl.push('## Триаж-разбивки (количественные срезы)');
  rl.push('');
  rl.push('### economyConflict: что лежит в столбце AD у сработавших строк');
  rl.push('');
  rl.push('| Значение AD | Строк |');
  rl.push('|---|---:|');
  for (const [k, v] of Object.entries(triage.economyConflictAD).sort((a, b) => b[1] - a[1])) {
    rl.push(`| ${k} | ${v} |`);
  }
  rl.push('');
  rl.push('### financeDelay: класс совпадения по подстроке «финансир»');
  rl.push('');
  rl.push('| Класс | Строк |');
  rl.push('|---|---:|');
  for (const [k, v] of Object.entries(triage.financeDelayKind).sort((a, b) => b[1] - a[1])) {
    rl.push(`| ${k} | ${v} |`);
  }
  rl.push('');
  rl.push(`### lowCompetition: факт == план копейка-в-копейку — ${triage.lowCompetitionExactEq} из ${triage.lowCompetitionTotal}`);
  rl.push('');
  rl.push('(точное равенство K=Y означает: «план» в таблице подогнан под сумму контракта, экономия 0% — не мера конкуренции)');
  rl.push('');
  rl.push(`### planWithoutExecution: всего ${triage.pwe.total} — план-дата есть: ${triage.pwe.hasPlanDate}, план-даты нет: ${triage.pwe.noPlanDate}; в комментарии «планир*»: ${triage.pwe.afPlanning}, «финансир*»: ${triage.pwe.afFinance}`);
  rl.push('');
  rl.push(`### factDateBeforePlan: опережение 1-7 дн: ${triage.fdbpDays.d1_7}, 8-14 дн: ${triage.fdbpDays.d8_14}, 15-30 дн: ${triage.fdbpDays.d15_30}`);
  rl.push('');
  rl.push('### unmappedReasonEP: частотка значений M (кандидаты в новые кластеры словаря)');
  rl.push('');
  rl.push('| Значение M (нормализовано, 70 симв.) | Строк |');
  rl.push('|---|---:|');
  for (const [k, v] of [...triage.unmappedM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    rl.push(`| ${k.replace(/\|/g, '/')} | ${v} |`);
  }
  rl.push('');

  rl.push('## Представительные строки по сигналам');
  rl.push('');
  for (const key of orderedKeys) {
    const c = signalCounts.get(key);
    if (!c || c.total === 0) continue;
    const reps = representative(c.samples);
    rl.push(`### ${key} — всего ${c.total}, показано ${reps.length}`);
    rl.push('');
    for (const s of reps) {
      rl.push(`- **[${s.sheet} стр.${s.row}]** «${s.subject}»`);
      rl.push(`  ${s.cells ? renderSignalCols(key, s.cells) : s.cols}`);
    }
    rl.push('');
  }

  rl.push('## Представительные строки по правилам RULE_BOOK');
  rl.push('');
  for (const [key, c] of [...ruleCounts.entries()].sort((a, b) => b[1].total - a[1].total)) {
    if (c.total === 0) continue;
    const reps = representative(c.samples);
    rl.push(`### ${key} — всего ${c.total}, показано ${reps.length}`);
    rl.push('');
    for (const s of reps) {
      rl.push(`- **[${s.sheet} стр.${s.row}]** «${s.subject}» → ${s.extra ?? ''}`);
      rl.push(`  ${s.cols}`);
    }
    rl.push('');
  }

  rl.push('---');
  rl.push(`Прогон завершён: ${new Date().toISOString()}.`);
  writeFileSync(ROWS_OUT_PATH, rl.join('\n'), 'utf-8');

  // ASCII-only summary в консоль
  const problemTotal = [...signalCounts.values()].reduce((s, c) => s + c.total, 0);
  const ruleTotal = [...ruleCounts.values()].reduce((s, c) => s + c.total, 0);
  console.log(`done: sheets=${loadedSheets.length} scannedRows=${totalScanned} signalFirings=${problemTotal} ruleFirings=${ruleTotal}`);
  console.log(`output: ${OUT_PATH}`);
  console.log(`rows dump: ${ROWS_OUT_PATH}`);
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
