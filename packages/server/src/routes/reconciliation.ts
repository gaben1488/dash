import type { FastifyInstance } from 'fastify';
import {
  DEPARTMENTS,
  SHDYU_MONTHLY_SHEET_NAME,
  SHDYU_SHEET_NAME_CANDIDATES,
  groupCascades,
} from '@aemr/shared';
import type { DataSnapshot, ReconLine } from '@aemr/shared';
import {
  reconcile,
  reconcileMonthly,
  explainReconLine,
  linkCascades,
  type MonthlyReconCell,
  type MonthlyReconRow,
  type MonthlyReconSummary,
  type ReconMeasure,
  type ReconSummary,
  type RawRow,
} from '@aemr/core';
import {
  getSnapshot,
  getSHDYUCache,
  getSHDYULoadError,
  getSHDYURawRowCount,
  getSHDYUOfficialYear,
} from '../services/snapshot.js';
import { getSheetDataWithFormulas } from '../services/google-sheets.js';
import { SVOD_SPREADSHEET_ID } from '../config.js';

function parseTargetYear(query: Record<string, string | undefined>): number | undefined {
  const raw = query.year;
  if (!raw || raw === 'all') return undefined;
  const year = Number.parseInt(raw, 10);
  return Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : undefined;
}

function n(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const parsed = Number.parseFloat(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricValue(metrics: DataSnapshot['officialMetrics'] | DataSnapshot['calculatedMetrics'], key: string): number | undefined {
  const value = metrics[key]?.numericValue;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstMetric(metrics: DataSnapshot['officialMetrics'] | DataSnapshot['calculatedMetrics'], keys: string[]): number {
  for (const key of keys) {
    const value = metricValue(metrics, key);
    if (value !== undefined) return value;
  }
  return 0;
}

function calculatedYearValue(snapshot: DataSnapshot, deptId: string, field: string): number {
  const direct = metricValue(snapshot.calculatedMetrics, `grbs.${deptId}.year.${field}`);
  if (direct !== undefined) return direct;
  return n((snapshot.recalcResults?.[deptId] as any)?.year?.[field]);
}

function buildDepartmentReconciliation(snapshot: DataSnapshot): ReconSummary {
  const official = new Map<string, { planTotal: number; factTotal: number; economyTotal: number }>();
  const calculated = new Map<string, { planTotal: number; factTotal: number; economyTotal: number }>();

  for (const dept of DEPARTMENTS) {
    const deptId = dept.id;
    const deptName = dept.nameShort;
    const prefix = `grbs.${deptId}`;

    const officialPlan =
      firstMetric(snapshot.officialMetrics, [`${prefix}.kp.year.total_plan`]) +
      firstMetric(snapshot.officialMetrics, [`${prefix}.ep.year.total_plan`]);
    const officialFact =
      firstMetric(snapshot.officialMetrics, [`${prefix}.kp.year.total_fact`]) +
      firstMetric(snapshot.officialMetrics, [`${prefix}.ep.year.total_fact`]);
    const officialEconomy =
      firstMetric(snapshot.officialMetrics, [`${prefix}.kp.year.economy_total`, `${prefix}.economy.kp`]) +
      firstMetric(snapshot.officialMetrics, [`${prefix}.ep.year.economy_total`, `${prefix}.economy.ep`]);

    const calcPlan =
      firstMetric(snapshot.calculatedMetrics, [`${prefix}.year.plan_total`]) ||
      calculatedYearValue(snapshot, deptId, 'planTotal');
    const calcFact =
      firstMetric(snapshot.calculatedMetrics, [`${prefix}.year.fact_total`]) ||
      calculatedYearValue(snapshot, deptId, 'factTotal');
    const calcEconomy =
      firstMetric(snapshot.calculatedMetrics, [`${prefix}.year.economy_total`]) ||
      calculatedYearValue(snapshot, deptId, 'economyTotal');

    official.set(deptName, { planTotal: officialPlan, factTotal: officialFact, economyTotal: officialEconomy });
    calculated.set(deptName, { planTotal: calcPlan, factTotal: calcFact, economyTotal: calcEconomy });
  }

  return attachRootCauses(reconcile(official, calculated), snapshot);
}

/**
 * Наполнить строки сверки первопричинами (требование владельца 07.08).
 *
 * Дельта без объяснения — недоделанная сверка, поэтому по каждому ГРБС
 * прогоняются классификаторы по трём мерам сразу (план-деньги, факт-деньги,
 * количество процедур), а каскады схлопываются: одна причина, задевшая три
 * показателя, показывается один раз со списком следствий.
 *
 * Строки-атомы берутся из снимка. Их нет (старый снимок до 24.07 либо демо) —
 * причины не выдумываются: поле просто отсутствует, и интерфейс честно
 * говорит, что доказательство недоступно.
 */
function attachRootCauses(summary: ReconSummary, snapshot: DataSnapshot): ReconSummary {
  const rowsByDept = snapshot.rowsByDept;
  if (!rowsByDept || Object.keys(rowsByDept).length === 0) return summary;

  const sheetOf = (deptName: string): string | undefined =>
    DEPARTMENTS.find((d) => d.nameShort === deptName)?.nameShort;

  const rows = summary.rows.map((row) => {
    const sheet = sheetOf(row.department) ?? row.department;
    const atoms = (rowsByDept[sheet] ?? rowsByDept[row.department]) as RawRow[] | undefined;
    if (!atoms || atoms.length === 0) return row;

    // Три меры одной книги: показатели разные, а причина у них может быть
    // общая — ради этого случая и заведён каскад.
    const lines: ReconLine[] = [
      { metric: `${sheet}.plan_total`, official: row.fullPlanOfficial, computed: row.fullPlanCalculated, delta: row.planDelta, rootCauses: [] },
      { metric: `${sheet}.fact_total`, official: row.fullFactOfficial, computed: row.fullFactCalculated, delta: row.factDelta, rootCauses: [] },
      { metric: `${sheet}.economy_total`, official: row.ecoTotalOfficial, computed: row.ecoTotalCalculated, delta: row.ecoDelta, rootCauses: [] },
    ];
    const measures: ReconMeasure[] = ['planMoney', 'factMoney', 'factMoney'];

    const explained = lines.map((line, i) =>
      explainReconLine(line, { rows: atoms, sheet, measure: measures[i] }),
    );
    const groups = groupCascades(linkCascades(explained));
    return groups.length > 0 ? { ...row, rootCauses: groups } : row;
  });

  return { ...summary, rows };
}

function deptNamesByLatinId(): Record<string, string> {
  return Object.fromEntries(DEPARTMENTS.map((dept) => [dept.id, dept.nameShort]));
}

function monthlyCells(row: MonthlyReconRow): MonthlyReconCell[] {
  const cells: MonthlyReconCell[] = [
    row.compPlan,
    row.compFact,
    row.compPlanTotal,
    row.compFactTotal,
    row.epPlan,
    row.epFact,
    row.epPlanTotal,
    row.epFactTotal,
  ];
  const compBudget = row.compBudget as Record<string, MonthlyReconCell> | undefined;
  const epBudget = row.epBudget as Record<string, MonthlyReconCell> | undefined;
  if (compBudget) cells.push(...Object.values(compBudget));
  if (epBudget) cells.push(...Object.values(epBudget));
  return cells;
}

function recomputeMonthlyCounts(rows: MonthlyReconRow[]): MonthlyReconSummary['counts'] {
  const cells = rows.flatMap(monthlyCells);
  return {
    ok: cells.filter((cell) => cell.status === 'ok').length,
    warning: cells.filter((cell) => cell.status === 'warning').length,
    high: cells.filter((cell) => cell.status === 'high').length,
    empty: cells.filter((cell) => cell.status === 'empty').length,
    noCalc: cells.filter((cell) => cell.status === 'no_calc').length,
  };
}

function filterMonthlySummary(summary: MonthlyReconSummary, dept?: string): MonthlyReconSummary {
  const normalized = String(dept ?? '').trim().toLowerCase();
  if (!normalized) return summary;
  const rows = summary.rows.filter((row) =>
    row.deptId.toLowerCase() === normalized || row.deptName.toLowerCase() === normalized,
  );
  const counts = recomputeMonthlyCounts(rows);
  const overallStatus = counts.high > 0
    ? 'Есть расхождения'
    : counts.warning > 0
      ? 'Требует проверки'
      : 'Данные согласованы';
  return { rows, counts, overallStatus };
}

function cellAt(rows: unknown[][], rowIndex: number, colIndex: number): unknown {
  return rows[rowIndex]?.[colIndex] ?? null;
}

function compactDigest(sheetName: string, values: unknown[][], formulas: unknown[][]) {
  const maxCols = Math.max(0, ...values.map((row) => row.length), ...formulas.map((row) => row.length));
  let formulaCells = 0;
  for (const row of formulas) {
    for (const cell of row) if (typeof cell === 'string' && cell.startsWith('=')) formulaCells++;
  }
  return {
    sheetName,
    ok: true,
    format: maxCols >= 39 || values.length >= 350 ? 'current' : 'unknown',
    rows: values.length,
    maxCols,
    formulaCells,
    landmarks: {
      A1: cellAt(values, 0, 0),
      B4: cellAt(values, 3, 1),
      U5: cellAt(values, 4, 20),
      AM5: cellAt(values, 4, 38),
      AN4: cellAt(values, 3, 39),
      AO4: cellAt(values, 3, 40),
    },
  };
}

function escapeCsv(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function reconciliationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reconciliation', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const snapshot = await getSnapshot(query.refresh === 'true', parseTargetYear(query));
    const reconciliation = buildDepartmentReconciliation(snapshot);
    return reply.send({
      reconciliation,
      totalDeltas: snapshot.deltas.length,
      methodology: 'Официальные ячейки СВОД ТД-ПМ сопоставляются с независимым CalcEngine-пересчётом строк управлений.',
      sourceSheet: 'СВОД ТД-ПМ',
      thresholds: { ok: '|Δ| < 1%', warning: '|Δ| 1–5%', high: '|Δ| ≥ 5%' },
    });
  });

  app.get('/api/reconciliation/monthly', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const snapshot = await getSnapshot(query.refresh === 'true', parseTargetYear(query));
    const shdyuData = snapshot.shdyuData ?? getSHDYUCache();
    const loadError = getSHDYULoadError();

    if (!shdyuData) {
      return reply.send({
        rows: [],
        counts: { ok: 0, warning: 0, high: 0, empty: 0 },
        overallStatus: 'Нет данных',
        warning: loadError ?? `Лист «${SHDYU_MONTHLY_SHEET_NAME}» не загружен: нет данных для помесячной сверки.`,
        officialSource: {
          spreadsheetId: SVOD_SPREADSHEET_ID,
          sheetName: SHDYU_MONTHLY_SHEET_NAME,
          sheetCandidates: SHDYU_SHEET_NAME_CANDIDATES,
          rawRowCount: getSHDYURawRowCount(),
        },
      });
    }

    // Год-гейт официального слоя (перепись 16.07, рекомендация A+C): лист
    // «СВОД с месяцами» существует ТОЛЬКО для года AO4 (все 2112 месячных
    // формул фильтруют P=$AO$4). Запрошен другой год → помесячного официала
    // за него НЕ СУЩЕСТВУЕТ; сравнение с официалом-другого-года давало 970
    // псевдо-«high» (860 OFFICIAL_ONLY). Честный ответ — пустая сверка с
    // объяснением, не мусорное сравнение.
    const requestedYear = parseTargetYear(query);
    const officialYear = getSHDYUOfficialYear();
    if (requestedYear && officialYear && requestedYear !== officialYear) {
      return reply.send({
        rows: [],
        counts: { ok: 0, warning: 0, high: 0, empty: 0, noOfficial: 0 },
        overallStatus: `Помесячная сверка существует только для ${officialYear} года`,
        warning: `Лист «${SHDYU_MONTHLY_SHEET_NAME}» содержит помесячные данные только за ${officialYear} год (параметр-ячейка AO4): официального помесячного слоя за ${requestedYear} не существует, сравнение неприменимо. Квартальные официалы ${requestedYear} года есть в СВОД ТД-ПМ.`,
        officialSource: {
          spreadsheetId: SVOD_SPREADSHEET_ID,
          sheetName: SHDYU_MONTHLY_SHEET_NAME,
          sheetCandidates: SHDYU_SHEET_NAME_CANDIDATES,
          rawRowCount: getSHDYURawRowCount(),
          officialYear,
        },
      });
    }

    // 5.4-A: расчётный слой за срез отсутствует (в книгах управлений нет строк
    // этого план-года — у всех ГРБС годовые план И факт нулевые). Официал
    // сравнивать не с чем: ячейки идут как no_calc, не сотни ложных «high».
    const recalc = snapshot.recalcResults ?? {};
    const calcLayerAbsent = Object.keys(recalc).length > 0 && Object.values(recalc).every((rc) => {
      const y = (rc as { year?: { planTotal?: number; factTotal?: number } }).year;
      return ((y?.planTotal ?? 0) === 0) && ((y?.factTotal ?? 0) === 0);
    });

    const summary = reconcileMonthly(recalc, shdyuData as any, deptNamesByLatinId(), { calcLayerAbsent });
    const filtered = filterMonthlySummary(summary, query.dept);
    const noCalcWarning = calcLayerAbsent
      ? `Расчёт за ${parseTargetYear(query) ?? 'этот'} год не построен: книги управлений содержат только текущий план-год. Сравнение с официальным слоем неприменимо.`
      : null;
    return reply.send({
      ...filtered,
      ...(loadError ? { warning: loadError } : noCalcWarning ? { warning: noCalcWarning } : {}),
      officialSource: {
        spreadsheetId: SVOD_SPREADSHEET_ID,
        sheetName: SHDYU_MONTHLY_SHEET_NAME,
        sheetCandidates: SHDYU_SHEET_NAME_CANDIDATES,
        rawRowCount: getSHDYURawRowCount(),
      },
      methodology: 'Официальный слой берётся только из листа «СВОД с месяцами»; расчётный слой строится построчно по листам управлений через CalcEngine.',
    });
  });

  app.get('/api/reconciliation/monthly/diagnostics', async (_request, reply) => {
    try {
      const { values, formulas } = await getSheetDataWithFormulas(SVOD_SPREADSHEET_ID, SHDYU_MONTHLY_SHEET_NAME);
      return reply.send({
        spreadsheetId: SVOD_SPREADSHEET_ID,
        canonicalSheet: SHDYU_MONTHLY_SHEET_NAME,
        sheets: [compactDigest(SHDYU_MONTHLY_SHEET_NAME, values, formulas)],
      });
    } catch (error) {
      return reply.send({
        spreadsheetId: SVOD_SPREADSHEET_ID,
        canonicalSheet: SHDYU_MONTHLY_SHEET_NAME,
        sheets: [{ sheetName: SHDYU_MONTHLY_SHEET_NAME, ok: false, error: error instanceof Error ? error.message : String(error) }],
      });
    }
  });

  app.get('/api/export/reconciliation', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const snapshot = await getSnapshot(false, parseTargetYear(query));
    const reconciliation = buildDepartmentReconciliation(snapshot);
    const rows = [
      ['Управление', 'План СВОД', 'План расчёт', 'Δ план', 'Δ план %', 'Факт СВОД', 'Факт расчёт', 'Δ факт', 'Δ факт %', 'Экономия СВОД', 'Экономия расчёт', 'Δ экономия', 'Оценка'],
      ...reconciliation.rows.map((row) => [row.department, row.fullPlanOfficial, row.fullPlanCalculated, row.planDelta, row.planDeltaPct, row.fullFactOfficial, row.fullFactCalculated, row.factDelta, row.factDeltaPct, row.ecoTotalOfficial, row.ecoTotalCalculated, row.ecoDelta, row.assessment.status]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(';')).join('\n');
    return reply
      .header('Content-Disposition', 'attachment; filename="aemr-reconciliation.csv"')
      .header('Content-Type', 'text/csv; charset=utf-8')
      .send(`\uFEFF${csv}`);
  });
}
