/**
 * scripts/_recon2025_census.ts — ОДНОРАЗОВАЯ перепись «~970 high» помесячной
 * сверки за 2025 год в двухлетних координатах (задача #5 от 2026-07-16).
 *
 * Что делает:
 *   1. ПРОБА листа «СВОД с месяцами» (SHDYU_MONTHLY_SHEET_NAME в книге
 *      SVOD_SPREADSHEET_ID): значения + формулы. Выясняет, годо-метится ли лист:
 *      ячейки-годы, формульные литералы 20xx, ссылки на фильтр AO4, подписи
 *      итого-строк.
 *   2. Официал: parseSHDYUSheet (канон-парсер packages/core) → 26 метрик на
 *      ГРБС×месяц (8 core: comp/ep × plan/fact × count/total + 18 побюджетных).
 *   3. Расчёт: readDeptSheet × 8 книг управлений → CalcEngine strict-2025
 *      (только явный P=2025) и non-strict-2025 (канон дашборда: пустой год
 *      проходит — этим путём API получил ~970 high).
 *   4. Категоризация каждой ячейки: OFFICIAL_ONLY / BOTH_MISMATCH / MATCHED /
 *      CALC_ONLY / EMPTY + репликация API-статусов (ok/warning/high/empty)
 *      + кросс-таблица «API-статус × strict-категория» (сумма бьётся с ~970).
 *
 * Запуск (cwd = packages/server, чтобы config подхватил ../../.env):
 *   cd packages/server && npx tsx ../../scripts/_recon2025_census.ts
 *   Выходной файл: env RECON_OUT или scripts/_recon2025_census_output.md
 *
 * В консоль — ТОЛЬКО ASCII (Windows cp1251). Вся кириллица — в выходной файл (UTF-8).
 * Прод-код не трогается: только чтение Google Sheets.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SHDYU_MONTHLY_SHEET_NAME,
  SHDYU_BLOCKS,
  SHDYU_ALL_BLOCK,
  SHDYU_FILTER_COLS,
  DEPARTMENT_REGISTRY,
  type SHDYUMonthlyEntry,
} from '../packages/shared/src/index.js';
import { parseSHDYUSheet } from '../packages/core/src/pipeline/shdyu-ingest.js';
import { CalcEngine, standardRowFilter } from '../packages/core/src/pipeline/calc-engine.js';
import { adaptToRecalcMetrics } from '../packages/core/src/pipeline/calc-engine-adapter.js';
import type { RecalculatedMetrics, QuarterMetrics } from '../packages/core/src/pipeline/recalculate.js';
import { getSheetDataWithFormulas, readDeptSheet } from '../packages/server/src/services/google-sheets.js';
import { SVOD_SPREADSHEET_ID, DEPARTMENT_SPREADSHEETS } from '../packages/server/src/config.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = process.env.RECON_OUT ?? path.resolve(SCRIPT_DIR, '_recon2025_census_output.md');
const TARGET_YEAR = 2025;

// ── helpers ──────────────────────────────────────────────────────────

function colLetter(c0: number): string {
  let s = '';
  let n = c0 + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function addr(r0: number, c0: number): string {
  return `${colLetter(c0)}${r0 + 1}`;
}
function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const r = Math.round(v * 100) / 100;
  return r.toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ');
}
function trunc(s: string, max = 400): string {
  const t = s.replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max)} …[${t.length} chars]` : t;
}
function cellAt(rows: unknown[][], r0: number, c0: number): unknown {
  return rows[r0]?.[c0] ?? null;
}
function isFormula(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('=');
}

// ── типы переписи ────────────────────────────────────────────────────

type ApiStatus = 'ok' | 'warning' | 'high' | 'empty';
type Category = 'EMPTY' | 'OFFICIAL_ONLY' | 'BOTH_MISMATCH' | 'MATCHED' | 'CALC_ONLY';

interface CellRec {
  dept: string;       // кириллический shortName
  month: number;      // 1-12
  metric: string;     // ключ метрики
  core: boolean;      // одна из 8 core-метрик (top-level ячейки monthly-сверки)
  off: number;        // официал (СВОД с месяцами)
  calcStrict: number; // CalcEngine strict-2025
  calcNon: number;    // CalcEngine non-strict-2025 (канон дашборда = путь API)
}

/** Точная реплика makeCell из packages/core/src/pipeline/reconcile.ts. */
function apiStatus(off: number, calc: number): ApiStatus {
  if (off === 0 && calc === 0) return 'empty';
  const base = Math.max(Math.abs(off), 1);
  const absPct = Math.abs(((calc - off) / base) * 100);
  return absPct < 1 ? 'ok' : absPct < 5 ? 'warning' : 'high';
}

/** Категоризация задачи #5 (порог 5%, база как в makeCell). */
function category(off: number, calc: number): Category {
  if (off === 0 && calc === 0) return 'EMPTY';
  if (calc === 0) return 'OFFICIAL_ONLY';
  if (off === 0) return 'CALC_ONLY';
  const base = Math.max(Math.abs(off), 1);
  const absPct = Math.abs(((calc - off) / base) * 100);
  return absPct < 5 ? 'MATCHED' : 'BOTH_MISMATCH';
}

/** 26 метрик ячейки monthly-сверки: 8 core + 9 compBudget + 9 epBudget. */
interface MetricDef {
  key: string;
  core: boolean;
  off: (sh: SHDYUMonthlyEntry) => number;
  calc: (rc: QuarterMetrics | undefined) => number;
}
const METRIC_DEFS: MetricDef[] = [
  // core 8 — top-level ячейки MonthlyReconRow
  { key: 'compPlan',      core: true, off: (s) => s.comp.planCount, calc: (r) => r?.competitive.plan ?? 0 },
  { key: 'compFact',      core: true, off: (s) => s.comp.factCount, calc: (r) => r?.competitive.fact ?? 0 },
  { key: 'compPlanTotal', core: true, off: (s) => s.comp.planTotal, calc: (r) => r?.competitive.planSum ?? 0 },
  { key: 'compFactTotal', core: true, off: (s) => s.comp.factTotal, calc: (r) => r?.competitive.factSum ?? 0 },
  { key: 'epPlan',        core: true, off: (s) => s.ep.planCount,   calc: (r) => r?.ep.plan ?? 0 },
  { key: 'epFact',        core: true, off: (s) => s.ep.factCount,   calc: (r) => r?.ep.fact ?? 0 },
  { key: 'epPlanTotal',   core: true, off: (s) => s.ep.planTotal,   calc: (r) => r?.ep.planSum ?? 0 },
  { key: 'epFactTotal',   core: true, off: (s) => s.ep.factTotal,   calc: (r) => r?.ep.factSum ?? 0 },
  // compBudget 9
  { key: 'comp.planFB',    core: false, off: (s) => s.comp.planFB,    calc: (r) => r?.competitive.planFB ?? 0 },
  { key: 'comp.planKB',    core: false, off: (s) => s.comp.planKB,    calc: (r) => r?.competitive.planKB ?? 0 },
  { key: 'comp.planMB',    core: false, off: (s) => s.comp.planMB,    calc: (r) => r?.competitive.planMB ?? 0 },
  { key: 'comp.factFB',    core: false, off: (s) => s.comp.factFB,    calc: (r) => r?.competitive.factFB ?? 0 },
  { key: 'comp.factKB',    core: false, off: (s) => s.comp.factKB,    calc: (r) => r?.competitive.factKB ?? 0 },
  { key: 'comp.factMB',    core: false, off: (s) => s.comp.factMB,    calc: (r) => r?.competitive.factMB ?? 0 },
  { key: 'comp.economyFB', core: false, off: (s) => s.comp.economyFB, calc: (r) => r?.competitive.economyFB ?? 0 },
  { key: 'comp.economyKB', core: false, off: (s) => s.comp.economyKB, calc: (r) => r?.competitive.economyKB ?? 0 },
  { key: 'comp.economyMB', core: false, off: (s) => s.comp.economyMB, calc: (r) => r?.competitive.economyMB ?? 0 },
  // epBudget 9
  { key: 'ep.planFB',    core: false, off: (s) => s.ep.planFB,    calc: (r) => r?.ep.planFB ?? 0 },
  { key: 'ep.planKB',    core: false, off: (s) => s.ep.planKB,    calc: (r) => r?.ep.planKB ?? 0 },
  { key: 'ep.planMB',    core: false, off: (s) => s.ep.planMB,    calc: (r) => r?.ep.planMB ?? 0 },
  { key: 'ep.factFB',    core: false, off: (s) => s.ep.factFB,    calc: (r) => r?.ep.factFB ?? 0 },
  { key: 'ep.factKB',    core: false, off: (s) => s.ep.factKB,    calc: (r) => r?.ep.factKB ?? 0 },
  { key: 'ep.factMB',    core: false, off: (s) => s.ep.factMB,    calc: (r) => r?.ep.factMB ?? 0 },
  { key: 'ep.economyFB', core: false, off: (s) => s.ep.economyFB, calc: (r) => r?.ep.economyFB ?? 0 },
  { key: 'ep.economyKB', core: false, off: (s) => s.ep.economyKB, calc: (r) => r?.ep.economyKB ?? 0 },
  { key: 'ep.economyMB', core: false, off: (s) => s.ep.economyMB, calc: (r) => r?.ep.economyMB ?? 0 },
];

// ── main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const out: string[] = [];
  const push = (s = ''): void => { out.push(s); };

  push('# Перепись recon-2025 (задача #5) — сырой вывод скрипта');
  push('');
  push(`> Сгенерировано: ${new Date().toISOString()} · scripts/_recon2025_census.ts`);
  push(`> Книга СВОД: \`${SVOD_SPREADSHEET_ID}\` · лист: «${SHDYU_MONTHLY_SHEET_NAME}» · целевой год среза: ${TARGET_YEAR}`);
  push('');

  // ═══ Шаг 1. Проба листа «СВОД с месяцами» ═══
  console.log('[1/4] probing monthly sheet (values + formulas) ...');
  const { values, formulas } = await getSheetDataWithFormulas(SVOD_SPREADSHEET_ID, SHDYU_MONTHLY_SHEET_NAME);
  const maxCols = Math.max(0, ...values.map((r) => r?.length ?? 0));
  push('## §1. Структура листа «СВОД с месяцами»');
  push('');
  push(`Размерность: ${values.length} строк × ${maxCols} колонок (формульный слой: ${formulas.length} строк).`);
  push('');

  // 1a. Фильтр-ячейки AN4/AO4
  const an4 = cellAt(values, 3, SHDYU_FILTER_COLS.ACTIVITY_FILTER);
  const ao4 = cellAt(values, 3, SHDYU_FILTER_COLS.YEAR);
  const an4f = cellAt(formulas, 3, SHDYU_FILTER_COLS.ACTIVITY_FILTER);
  const ao4f = cellAt(formulas, 3, SHDYU_FILTER_COLS.YEAR);
  push('### 1a. Фильтр-ячейки (AN4 = активность, AO4 = ГОД листа)');
  push('');
  push(`- AN4 (фильтр активности) = \`${JSON.stringify(an4)}\`${isFormula(an4f) ? ` · формула: \`${trunc(String(an4f), 200)}\`` : ' · константа'}`);
  push(`- AO4 (ГОД) = \`${JSON.stringify(ao4)}\`${isFormula(ao4f) ? ` · формула: \`${trunc(String(ao4f), 200)}\`` : ' · константа'}`);
  push('');

  // 1b. Все ячейки-годы на листе (значения)
  const yearCells: string[] = [];
  values.forEach((row, r) => {
    row?.forEach((v, c) => {
      const isNumYear = typeof v === 'number' && Number.isInteger(v) && v >= 2000 && v <= 2100;
      const isStrYear = typeof v === 'string' && /^20\d{2}$/.test(v.trim());
      if (isNumYear || isStrYear) yearCells.push(`${addr(r, c)}=${String(v).trim()}`);
    });
  });
  push('### 1b. ВСЕ ячейки-годы на листе (число/строка 2000–2100)');
  push('');
  push(`Всего: ${yearCells.length}`);
  push('');
  push('```');
  for (let i = 0; i < Math.min(yearCells.length, 200); i += 10) {
    push(yearCells.slice(i, i + 10).join('  '));
  }
  if (yearCells.length > 200) push(`… ещё ${yearCells.length - 200}`);
  push('```');
  push('');

  // 1c. Годовые литералы в формулах + ссылки на AO4 + P-колонку книг
  const yearLiteral = /(?<![0-9A-Za-z$])20\d{2}(?![0-9])/g; // не часть ссылки типа C2026 или числа
  const yearLitCount = new Map<string, number>();
  const yearLitSamples = new Map<string, string[]>();
  let formulaCells = 0;
  let ao4RefCount = 0;
  const ao4Samples: string[] = [];
  let pColRefCount = 0;
  const pColSamples: string[] = [];
  formulas.forEach((row, r) => {
    row?.forEach((f, c) => {
      if (!isFormula(f)) return;
      formulaCells++;
      for (const m of f.matchAll(yearLiteral)) {
        const y = m[0];
        yearLitCount.set(y, (yearLitCount.get(y) ?? 0) + 1);
        const arr = yearLitSamples.get(y) ?? [];
        if (arr.length < 3) {
          const i = m.index ?? 0;
          arr.push(`${addr(r, c)}: …${f.slice(Math.max(0, i - 60), i + 70).replace(/\s+/g, ' ')}…`);
          yearLitSamples.set(y, arr);
        }
      }
      if (/\$?AO\$?4(?![0-9])/.test(f)) {
        ao4RefCount++;
        if (ao4Samples.length < 5) ao4Samples.push(`${addr(r, c)}: ${trunc(f, 260)}`);
      }
      if (/!\$?P\$?[0-9:$]/.test(f) || /\$P:\$P/.test(f) || /P:P/.test(f)) {
        pColRefCount++;
        if (pColSamples.length < 5) pColSamples.push(`${addr(r, c)}: ${trunc(f, 260)}`);
      }
    });
  });
  push('### 1c. Годовая привязка ФОРМУЛ');
  push('');
  push(`Формульных ячеек всего: ${formulaCells}`);
  push('');
  push('| Литерал года в формулах | Кол-во вхождений |');
  push('|---|---:|');
  for (const [y, n] of [...yearLitCount.entries()].sort()) push(`| ${y} | ${n} |`);
  if (yearLitCount.size === 0) push('| — (ни одного годового литерала) | 0 |');
  push('');
  for (const [y, samples] of [...yearLitSamples.entries()].sort()) {
    push(`Примеры «${y}»:`);
    push('```');
    samples.forEach((s) => push(s));
    push('```');
  }
  push(`Формул со ссылкой на AO4 (год-фильтр листа): **${ao4RefCount}**`);
  if (ao4Samples.length) {
    push('```');
    ao4Samples.forEach((s) => push(s));
    push('```');
  }
  push(`Формул со ссылкой на колонку P (план-год) книг: **${pColRefCount}**`);
  if (pColSamples.length) {
    push('```');
    pColSamples.forEach((s) => push(s));
    push('```');
  }
  push('');

  // 1d. Ключевые ячейки: шапка, блок ВСЕ и УЭР — значения + формулы
  push('### 1d. Ключевые ячейки (значение · формула)');
  push('');
  const dumpCell = (r0: number, c0: number, label: string): void => {
    const v = cellAt(values, r0, c0);
    const f = cellAt(formulas, r0, c0);
    push(`- ${addr(r0, c0)} (${label}) = \`${JSON.stringify(v)}\`${isFormula(f) ? ` · \`${trunc(String(f), 320)}\`` : ''}`);
  };
  push('Шапка (строки 1–4, непустые ячейки A–T):');
  for (let r = 0; r <= 3; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= 19; c++) {
      const v = cellAt(values, r, c);
      if (v != null && String(v).trim() !== '') cells.push(`${addr(r, c)}=«${trunc(String(v), 60)}»`);
    }
    if (cells.length) push(`- ${cells.join(' · ')}`);
  }
  push('');
  push('Блок ВСЕ (строки 5=янв КП, 17=итого КП, 22=янв ЕП, 34=итого ЕП):');
  for (const [r1, label] of [[5, 'янв КП'], [17, 'итого КП'], [22, 'янв ЕП'], [34, 'итого ЕП']] as const) {
    dumpCell(r1 - 1, 0, `${label} A`);
    dumpCell(r1 - 1, 1, `${label} B`);
    dumpCell(r1 - 1, 2, `${label} C=plan_count`);
    dumpCell(r1 - 1, 9, `${label} J=plan_total`);
  }
  push('');
  push('Блок УЭР (45=янв КП, 57=итого КП, 62=янв ЕП, 74=итого ЕП; шапка блока 41–44):');
  for (let r = 41; r <= 44; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= 19; c++) {
      const v = cellAt(values, r - 1, c);
      if (v != null && String(v).trim() !== '') cells.push(`${addr(r - 1, c)}=«${trunc(String(v), 60)}»`);
    }
    if (cells.length) push(`- ${cells.join(' · ')}`);
  }
  for (const [r1, label] of [[45, 'янв КП'], [46, 'фев КП'], [57, 'итого КП'], [62, 'янв ЕП'], [74, 'итого ЕП']] as const) {
    dumpCell(r1 - 1, 0, `${label} A`);
    dumpCell(r1 - 1, 1, `${label} B`);
    dumpCell(r1 - 1, 2, `${label} C=plan_count`);
    dumpCell(r1 - 1, 3, `${label} D=fact_count`);
    dumpCell(r1 - 1, 9, `${label} J=plan_total`);
    dumpCell(r1 - 1, 13, `${label} N=fact_total`);
  }
  push('');
  push('Квартальная секция УЭР (строка 45, U/V/AC):');
  dumpCell(44, 20, 'U45 quarter label');
  dumpCell(44, 21, 'V45 plan_count Q');
  dumpCell(44, 28, 'AC45 plan_total Q');
  push('');
  push('Подписи B итого-строк всех блоков (где по формату живёт год):');
  const allBlocks = [SHDYU_ALL_BLOCK, ...SHDYU_BLOCKS];
  for (const b of allBlocks) {
    const bComp = cellAt(values, b.compTotalRow - 1, 1);
    const bEp = cellAt(values, b.epTotalRow - 1, 1);
    const aComp = cellAt(values, b.compTotalRow - 1, 0);
    const aEp = cellAt(values, b.epTotalRow - 1, 0);
    push(`- ${b.grbsShort}: итогоКП B${b.compTotalRow}=\`${JSON.stringify(bComp)}\` (A=«${trunc(String(aComp ?? ''), 40)}») · итогоЕП B${b.epTotalRow}=\`${JSON.stringify(bEp)}\` (A=«${trunc(String(aEp ?? ''), 40)}»)`);
  }
  push('');

  // ═══ Шаг 2. Официал: канон-парсер ═══
  console.log('[2/4] parsing official monthly layer via parseSHDYUSheet ...');
  const official = parseSHDYUSheet(values, formulas);
  push('## §2. Официальный слой (parseSHDYUSheet)');
  push('');
  push(`Распознано блоков: ${Object.keys(official).length} (${Object.keys(official).join(', ')})`);
  push('');

  // ═══ Шаг 3. Расчёт: 8 книг управлений, strict-2025 и non-strict-2025 ═══
  console.log('[3/4] loading 8 dept books + CalcEngine (strict & non-strict 2025) ...');
  const engine = new CalcEngine();
  interface DeptCalc {
    shortName: string;
    latinId: string;
    sheetName: string;
    rowsTotal: number;
    strict: RecalculatedMetrics;
    strictRowCount: number;
    nonStrict: RecalculatedMetrics;
    nonStrictRowCount: number;
    error?: string;
  }
  const deptCalcs: DeptCalc[] = [];
  for (const dept of DEPARTMENT_REGISTRY) {
    const ssId = DEPARTMENT_SPREADSHEETS[dept.shortName];
    try {
      const res = await readDeptSheet(dept.shortName, ssId);
      const strictGrouped = engine.compute(res.values, standardRowFilter, 3, TARGET_YEAR, { strictYear: true });
      const nonGrouped = engine.compute(res.values, standardRowFilter, 3, TARGET_YEAR);
      deptCalcs.push({
        shortName: dept.shortName,
        latinId: dept.latinId,
        sheetName: res.sheetName,
        rowsTotal: res.values.length,
        strict: adaptToRecalcMetrics(strictGrouped, dept.shortName),
        strictRowCount: strictGrouped.rowCount,
        nonStrict: adaptToRecalcMetrics(nonGrouped, dept.shortName),
        nonStrictRowCount: nonGrouped.rowCount,
      });
      console.log(`  ${dept.latinId}: rows=${res.values.length} strict2025Rows=${strictGrouped.rowCount} nonStrictRows=${nonGrouped.rowCount}`);
    } catch (err) {
      deptCalcs.push({
        shortName: dept.shortName, latinId: dept.latinId, sheetName: '?', rowsTotal: 0,
        strict: adaptToRecalcMetrics(engine.compute([], standardRowFilter, 0), dept.shortName),
        strictRowCount: 0,
        nonStrict: adaptToRecalcMetrics(engine.compute([], standardRowFilter, 0), dept.shortName),
        nonStrictRowCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      console.log(`  ${dept.latinId}: ERROR ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  push('## §3. Расчётный слой: строгий 2025-срез по книгам управлений');
  push('');
  push('| ГРБС | лист | строк в книге | строк P=2025 (strict) | строк non-strict-2025 (P=2025 или пусто) | strict план год, тыс ₽ | strict факт год | strict план, ед | strict факт, ед |');
  push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const d of deptCalcs) {
    if (d.error) {
      push(`| ${d.shortName} | ОШИБКА: ${d.error} | — | — | — | — | — | — | — |`);
      continue;
    }
    push(`| ${d.shortName} | ${d.sheetName} | ${d.rowsTotal} | ${d.strictRowCount} | ${d.nonStrictRowCount} | ${fmt(d.strict.year.planTotal)} | ${fmt(d.strict.year.factTotal)} | ${fmt(d.strict.year.planCount)} | ${fmt(d.strict.year.factCount)} |`);
  }
  push('');

  // ═══ Шаг 4. Перепись ячеек ═══
  console.log('[4/4] census over dept x month x metric cells ...');
  const records: CellRec[] = [];
  for (const d of deptCalcs) {
    const sh = official[d.latinId];
    if (!sh) continue;
    for (let m = 1; m <= 12; m++) {
      const entry = sh.months[m];
      if (!entry) continue;
      const rcStrict = d.strict.months[m];
      const rcNon = d.nonStrict.months[m];
      for (const def of METRIC_DEFS) {
        records.push({
          dept: d.shortName,
          month: m,
          metric: def.key,
          core: def.core,
          off: def.off(entry),
          calcStrict: def.calc(rcStrict),
          calcNon: def.calc(rcNon),
        });
      }
    }
  }

  push('## §4. Перепись ячеек сверки (8 ГРБС × 12 мес × 26 метрик)');
  push('');
  push(`Всего ячеек: ${records.length} (ожидание: 8×12×26 = 2496; API-строк 96 × 26).`);
  push('');

  // 4a. Репликация API-пути: официал vs NON-strict calc (канон дашборда)
  const repl = new Map<ApiStatus, number>([['ok', 0], ['warning', 0], ['high', 0], ['empty', 0]]);
  const replCore = new Map<ApiStatus, number>([['ok', 0], ['warning', 0], ['high', 0], ['empty', 0]]);
  for (const rec of records) {
    const st = apiStatus(rec.off, rec.calcNon);
    repl.set(st, (repl.get(st) ?? 0) + 1);
    if (rec.core) replCore.set(st, (replCore.get(st) ?? 0) + 1);
  }
  push('### 4a. Репликация API `/api/reconciliation/monthly?year=2025` (официал vs non-strict-расчёт)');
  push('');
  push('| статус | все 26 метрик | только 8 core |');
  push('|---|---:|---:|');
  for (const st of ['ok', 'warning', 'high', 'empty'] as ApiStatus[]) {
    push(`| ${st} | ${repl.get(st)} | ${replCore.get(st)} |`);
  }
  push('');
  push(`Контроль: API отдавал counts ≈ {ok: 2, high: 970, empty: 1513} (07-13: high=981). Совпадение с точностью до дрейфа живых данных подтверждает, что перепись считает ТО ЖЕ, что прод.`);
  push('');

  // 4b. Категории по strict-2025
  const catCount = new Map<Category, number>();
  const catCoreCount = new Map<Category, number>();
  const catByDept = new Map<string, Map<Category, number>>();
  const catByMonth = new Map<number, Map<Category, number>>();
  const catByMetric = new Map<string, Map<Category, number>>();
  const cross = new Map<string, number>(); // `${apiStatus}|${category}`
  for (const rec of records) {
    const cat = category(rec.off, rec.calcStrict);
    const st = apiStatus(rec.off, rec.calcNon);
    catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
    if (rec.core) catCoreCount.set(cat, (catCoreCount.get(cat) ?? 0) + 1);
    const bd = catByDept.get(rec.dept) ?? new Map<Category, number>();
    bd.set(cat, (bd.get(cat) ?? 0) + 1);
    catByDept.set(rec.dept, bd);
    const bm = catByMonth.get(rec.month) ?? new Map<Category, number>();
    bm.set(cat, (bm.get(cat) ?? 0) + 1);
    catByMonth.set(rec.month, bm);
    const bk = catByMetric.get(rec.metric) ?? new Map<Category, number>();
    bk.set(cat, (bk.get(cat) ?? 0) + 1);
    catByMetric.set(rec.metric, bk);
    cross.set(`${st}|${cat}`, (cross.get(`${st}|${cat}`) ?? 0) + 1);
  }
  const CATS: Category[] = ['OFFICIAL_ONLY', 'BOTH_MISMATCH', 'MATCHED', 'CALC_ONLY', 'EMPTY'];
  push('### 4b. Категории (официал vs STRICT-2025 расчёт)');
  push('');
  push('| категория | все 26 метрик | только 8 core |');
  push('|---|---:|---:|');
  for (const c of CATS) push(`| ${c} | ${catCount.get(c) ?? 0} | ${catCoreCount.get(c) ?? 0} |`);
  push(`| **Σ** | **${records.length}** | **${[...catCoreCount.values()].reduce((a, b) => a + b, 0)}** |`);
  push('');

  push('### 4c. Кросс-таблица: API-статус (non-strict) × strict-категория');
  push('');
  push('Каждая ячейка API-сверки 2025 попадает ровно в одну клетку — сумма бьётся с counts API.');
  push('');
  push(`| API \\ strict | ${CATS.join(' | ')} | Σ |`);
  push(`|---|${CATS.map(() => '---:').join('|')}|---:|`);
  for (const st of ['ok', 'warning', 'high', 'empty'] as ApiStatus[]) {
    const cells = CATS.map((c) => cross.get(`${st}|${c}`) ?? 0);
    push(`| ${st} | ${cells.join(' | ')} | ${cells.reduce((a, b) => a + b, 0)} |`);
  }
  push('');

  const catTable = (title: string, map: Map<string | number, Map<Category, number>>, keys: (string | number)[]): void => {
    push(`### ${title}`);
    push('');
    push(`| срез | ${CATS.join(' | ')} |`);
    push(`|---|${CATS.map(() => '---:').join('|')}|`);
    for (const k of keys) {
      const m = map.get(k as never) ?? new Map<Category, number>();
      push(`| ${k} | ${CATS.map((c) => m.get(c) ?? 0).join(' | ')} |`);
    }
    push('');
  };
  catTable('4d. Категории по ГРБС', catByDept as never, deptCalcs.map((d) => d.shortName));
  catTable('4e. Категории по месяцам', catByMonth as never, Array.from({ length: 12 }, (_, i) => i + 1));
  catTable('4f. Категории по метрикам', catByMetric as never, METRIC_DEFS.map((d) => d.key));

  // 4g. Топ-примеры
  const topTable = (title: string, recs: CellRec[], sortVal: (r: CellRec) => number, cap = 15): void => {
    push(`### ${title}`);
    push('');
    push('| ГРБС | мес | метрика | официал | strict-расчёт | non-strict-расчёт |');
    push('|---|---:|---|---:|---:|---:|');
    for (const r of recs.sort((a, b) => sortVal(b) - sortVal(a)).slice(0, cap)) {
      push(`| ${r.dept} | ${r.month} | ${r.metric} | ${fmt(r.off)} | ${fmt(r.calcStrict)} | ${fmt(r.calcNon)} |`);
    }
    push('');
  };
  topTable(
    '4g. OFFICIAL_ONLY — топ по величине официала (строгих 2025-данных в книгах нет)',
    records.filter((r) => category(r.off, r.calcStrict) === 'OFFICIAL_ONLY'),
    (r) => Math.abs(r.off),
  );
  topTable(
    '4h. BOTH_MISMATCH — топ по |Δ| (оба слоя ненулевые, |Δ|≥5%)',
    records.filter((r) => category(r.off, r.calcStrict) === 'BOTH_MISMATCH'),
    (r) => Math.abs(r.calcStrict - r.off),
  );
  topTable(
    '4i. CALC_ONLY — топ по величине расчёта (строки P=2025 есть, официал пуст)',
    records.filter((r) => category(r.off, r.calcStrict) === 'CALC_ONLY'),
    (r) => Math.abs(r.calcStrict),
  );
  topTable(
    '4j. MATCHED — примеры совпадений (|Δ|<5%)',
    records.filter((r) => category(r.off, r.calcStrict) === 'MATCHED'),
    (r) => Math.abs(r.off),
    10,
  );

  writeFileSync(OUT_PATH, `${out.join('\n')}\n`, 'utf-8');
  console.log(`done. output: ${OUT_PATH}`);
  console.log(`records=${records.length} repl(ok/warn/high/empty)=${['ok', 'warning', 'high', 'empty'].map((s) => repl.get(s as ApiStatus)).join('/')}`);
  console.log(`strict cats (OFF_ONLY/BOTH/MATCH/CALC_ONLY/EMPTY)=${CATS.map((c) => catCount.get(c) ?? 0).join('/')}`);
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
