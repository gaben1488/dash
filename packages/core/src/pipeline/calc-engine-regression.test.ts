/**
 * Regression test: CalcEngine + adapter vs recalculateFromRows
 *
 * Verifies that the new CalcEngine pipeline produces identical results
 * to the legacy recalculateFromRows() for the same input data.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { CalcEngine, standardRowFilter } from './calc-engine.js';
import { adaptToRecalcMetrics } from './calc-engine-adapter.js';
import { recalculateFromRows } from './recalculate.js';

const COL = DEPT_COLUMNS;

// ── Test data builder ─────────────────────────────────────────────

function makeRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  // Defaults for a valid competitive Q1 row
  row[COL.ID] = overrides.id ?? '1';
  row[COL.SUBORDINATE] = overrides.subordinate ?? 'МКУ Тест';
  row[COL.TYPE] = overrides.type ?? 'Текущая деятельность';
  row[COL.SUBJECT] = overrides.subject ?? 'Закупка канцтоваров';
  row[COL.FB_PLAN] = overrides.fbPlan ?? 100;
  row[COL.KB_PLAN] = overrides.kbPlan ?? 200;
  row[COL.MB_PLAN] = overrides.mbPlan ?? 300;
  row[COL.TOTAL_PLAN] = overrides.totalPlan ?? 600;
  row[COL.METHOD] = overrides.method ?? 'ЭА';
  row[COL.PLAN_DATE] = overrides.planDate ?? '15.01.2025';
  row[COL.PLAN_QUARTER] = overrides.planQuarter ?? 1;
  row[COL.PLAN_YEAR] = overrides.planYear ?? 2025;
  row[COL.FACT_DATE] = overrides.factDate ?? '';
  row[COL.STATUS] = overrides.status ?? '';
  row[COL.FB_FACT] = overrides.fbFact ?? 0;
  row[COL.KB_FACT] = overrides.kbFact ?? 0;
  row[COL.MB_FACT] = overrides.mbFact ?? 0;
  row[COL.TOTAL_FACT] = overrides.totalFact ?? 0;
  row[COL.ECONOMY_FB] = overrides.ecoFB ?? 0;
  row[COL.ECONOMY_KB] = overrides.ecoKB ?? 0;
  row[COL.ECONOMY_MB] = overrides.ecoMB ?? 0;
  row[COL.ECONOMY_TOTAL] = overrides.ecoTotal ?? 0;
  row[COL.FLAG] = overrides.flag ?? '';
  return row;
}

function buildSheet(dataRows: unknown[][]): unknown[][] {
  // 3 header rows + data rows (startRow=3)
  const headers = [
    new Array(32).fill('Header1'),
    new Array(32).fill('Header2'),
    new Array(32).fill('Header3'),
  ];
  return [...headers, ...dataRows];
}

// ── Comparison helper ──────────────────────────────────────────────

function compareMetrics(label: string, newVal: number, oldVal: number, tolerance = 0.001) {
  if (Math.abs(newVal - oldVal) > tolerance) {
    return `${label}: new=${newVal}, old=${oldVal}, diff=${(newVal - oldVal).toFixed(6)}`;
  }
  return null;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('CalcEngine regression vs recalculateFromRows', () => {
  const engine = new CalcEngine();

  it('should match for plan-only rows (no facts)', () => {
    const rows = buildSheet([
      makeRow({ id: '1', method: 'ЭА', planQuarter: 1, totalPlan: 1000, fbPlan: 400, kbPlan: 300, mbPlan: 300 }),
      makeRow({ id: '2', method: 'ЕП', planQuarter: 2, totalPlan: 500, fbPlan: 200, kbPlan: 150, mbPlan: 150 }),
      makeRow({ id: '3', method: 'ЭК', planQuarter: 1, totalPlan: 750, fbPlan: 250, kbPlan: 250, mbPlan: 250 }),
    ]);

    const oldResult = recalculateFromRows(rows, 'УЭР', 3, 2025);
    const grouped = engine.compute(rows, standardRowFilter, 3, 2025);
    const newResult = adaptToRecalcMetrics(grouped, 'УЭР');

    // Year-level plan
    expect(newResult.year.planCount).toBe(oldResult.year.planCount);
    expect(newResult.year.planTotal).toBeCloseTo(oldResult.year.planTotal, 2);
    expect(newResult.year.planFB).toBeCloseTo(oldResult.year.planFB, 2);
    expect(newResult.year.planKB).toBeCloseTo(oldResult.year.planKB, 2);
    expect(newResult.year.planMB).toBeCloseTo(oldResult.year.planMB, 2);

    // Q1 plan
    expect(newResult.quarters.q1.planCount).toBe(oldResult.quarters.q1.planCount);
    expect(newResult.quarters.q1.planTotal).toBeCloseTo(oldResult.quarters.q1.planTotal, 2);

    // Q2 plan
    expect(newResult.quarters.q2.planCount).toBe(oldResult.quarters.q2.planCount);

    // Method breakdown
    expect(newResult.totalCompetitive).toBe(oldResult.totalCompetitive);
    expect(newResult.totalEP).toBe(oldResult.totalEP);

    // Zero facts
    expect(newResult.year.factCount).toBe(0);
    expect(oldResult.year.factCount).toBe(0);
  });

  it('should match for rows with facts and economy', () => {
    const rows = buildSheet([
      makeRow({
        id: '1', method: 'ЭА', planQuarter: 1, totalPlan: 1000, fbPlan: 500, kbPlan: 300, mbPlan: 200,
        factDate: '20.02.2025', totalFact: 800, fbFact: 400, kbFact: 250, mbFact: 150,
        ecoFB: 100, ecoKB: 50, ecoMB: 50, flag: 'да',
      }),
      makeRow({
        id: '2', method: 'ЕП', planQuarter: 1, totalPlan: 500, fbPlan: 200, kbPlan: 150, mbPlan: 150,
        factDate: '25.03.2025', totalFact: 450, fbFact: 180, kbFact: 130, mbFact: 140,
        ecoFB: 20, ecoKB: 20, ecoMB: 10, flag: 'да',
      }),
    ]);

    const oldResult = recalculateFromRows(rows, 'УЭР', 3, 2025);
    const grouped = engine.compute(rows, standardRowFilter, 3, 2025);
    const newResult = adaptToRecalcMetrics(grouped, 'УЭР');

    // Year facts
    expect(newResult.year.factCount).toBe(oldResult.year.factCount);
    expect(newResult.year.factTotal).toBeCloseTo(oldResult.year.factTotal, 2);
    expect(newResult.year.factFB).toBeCloseTo(oldResult.year.factFB, 2);

    // Economy
    expect(newResult.year.economyTotal).toBeCloseTo(oldResult.year.economyTotal, 2);
    expect(newResult.year.economyFB).toBeCloseTo(oldResult.year.economyFB, 2);
    expect(newResult.year.economyKB).toBeCloseTo(oldResult.year.economyKB, 2);
    expect(newResult.year.economyMB).toBeCloseTo(oldResult.year.economyMB, 2);

    // Execution %
    expect(newResult.year.executionPct).toBeCloseTo(oldResult.year.executionPct, 4);

    // Q1 economy and execution
    expect(newResult.quarters.q1.economyTotal).toBeCloseTo(oldResult.quarters.q1.economyTotal, 2);
    expect(newResult.quarters.q1.executionPct).toBeCloseTo(oldResult.quarters.q1.executionPct, 4);

    // Competitive breakdown in Q1
    expect(newResult.quarters.q1.competitive.planSum).toBeCloseTo(oldResult.quarters.q1.competitive.planSum, 2);
    expect(newResult.quarters.q1.competitive.factSum).toBeCloseTo(oldResult.quarters.q1.competitive.factSum, 2);

    // EP breakdown in Q1
    expect(newResult.quarters.q1.ep.plan).toBe(oldResult.quarters.q1.ep.plan);
    expect(newResult.quarters.q1.ep.fact).toBe(oldResult.quarters.q1.ep.fact);

    // EP share
    expect(newResult.epSharePct).toBeCloseTo(oldResult.epSharePct, 4);

    // Conflicts
    expect(newResult.conflicts).toBe(oldResult.conflicts);
  });

  it('should match for multi-quarter mixed data', () => {
    const rows = buildSheet([
      // Q1 competitive
      makeRow({ id: '1', method: 'ЭА', planQuarter: 1, totalPlan: 1000, fbPlan: 500, kbPlan: 300, mbPlan: 200,
        factDate: '15.01.2025', totalFact: 900, fbFact: 450, kbFact: 270, mbFact: 180,
        ecoFB: 50, ecoKB: 30, ecoMB: 20, flag: 'да' }),
      // Q2 EP
      makeRow({ id: '2', method: 'ЕП', planQuarter: 2, totalPlan: 300, fbPlan: 100, kbPlan: 100, mbPlan: 100 }),
      // Q3 competitive with fact
      makeRow({ id: '3', method: 'ЭЗК', planQuarter: 3, totalPlan: 2000, fbPlan: 800, kbPlan: 700, mbPlan: 500,
        factDate: '10.07.2025', totalFact: 1800, fbFact: 720, kbFact: 630, mbFact: 450,
        ecoFB: 80, ecoKB: 70, ecoMB: 50, flag: 'да' }),
      // Q4 plan only
      makeRow({ id: '4', method: 'ЭА', planQuarter: 4, totalPlan: 500, fbPlan: 200, kbPlan: 150, mbPlan: 150 }),
      // Different subordinate
      makeRow({ id: '5', method: 'ЭА', planQuarter: 1, subordinate: 'Школа №1', totalPlan: 400, fbPlan: 150, kbPlan: 120, mbPlan: 130 }),
    ]);

    const oldResult = recalculateFromRows(rows, 'УО', 3, 2025);
    const grouped = engine.compute(rows, standardRowFilter, 3, 2025);
    const newResult = adaptToRecalcMetrics(grouped, 'УО');

    // Year totals
    expect(newResult.year.planCount).toBe(oldResult.year.planCount);
    expect(newResult.year.planTotal).toBeCloseTo(oldResult.year.planTotal, 2);
    expect(newResult.year.factCount).toBe(oldResult.year.factCount);
    expect(newResult.year.factTotal).toBeCloseTo(oldResult.year.factTotal, 2);
    expect(newResult.year.economyTotal).toBeCloseTo(oldResult.year.economyTotal, 2);

    // Per-quarter
    for (const qk of ['q1', 'q2', 'q3', 'q4'] as const) {
      const nq = newResult.quarters[qk];
      const oq = oldResult.quarters[qk];
      expect(nq.planCount).toBe(oq.planCount);
      expect(nq.factCount).toBe(oq.factCount);
      expect(nq.planTotal).toBeCloseTo(oq.planTotal, 2);
      expect(nq.factTotal).toBeCloseTo(oq.factTotal, 2);
      expect(nq.economyTotal).toBeCloseTo(oq.economyTotal, 2);
    }

    // Subordinates
    expect(newResult.bySubordinate.length).toBe(oldResult.bySubordinate.length);
    // Both should have 2 subordinates
    const newSubs = new Map(newResult.bySubordinate.map(s => [s.name, s]));
    for (const oldSub of oldResult.bySubordinate) {
      const newSub = newSubs.get(oldSub.name);
      expect(newSub).toBeDefined();
      expect(newSub!.planTotal).toBeCloseTo(oldSub.planTotal, 2);
      expect(newSub!.factTotal).toBeCloseTo(oldSub.factTotal, 2);
      expect(newSub!.economyTotal).toBeCloseTo(oldSub.economyTotal, 2);
    }

    // Data row count
    expect(newResult.dataRowCount).toBe(oldResult.dataRowCount);
  });

  it('should match for orphan facts (fact date present, no plan quarter)', () => {
    const rows = buildSheet([
      // Normal Q1 row
      makeRow({ id: '1', method: 'ЭА', planQuarter: 1, totalPlan: 1000, fbPlan: 500, kbPlan: 300, mbPlan: 200,
        factDate: '15.01.2025', totalFact: 900, fbFact: 450, kbFact: 270, mbFact: 180 }),
      // Orphan: has fact but no plan quarter
      makeRow({ id: '2', method: 'ЕП', planQuarter: '', totalPlan: 500, fbPlan: 200, kbPlan: 150, mbPlan: 150,
        factDate: '20.04.2025', totalFact: 450, fbFact: 180, kbFact: 130, mbFact: 140 }),
    ]);

    const oldResult = recalculateFromRows(rows, 'УЭР', 3, 2025);
    const grouped = engine.compute(rows, standardRowFilter, 3, 2025);
    const newResult = adaptToRecalcMetrics(grouped, 'УЭР');

    // Year fact should include orphan
    expect(newResult.year.factCount).toBe(oldResult.year.factCount);
    expect(newResult.year.factTotal).toBeCloseTo(oldResult.year.factTotal, 2);

    // Q1 fact should NOT include orphan
    expect(newResult.quarters.q1.factCount).toBe(oldResult.quarters.q1.factCount);
    expect(newResult.quarters.q1.factTotal).toBeCloseTo(oldResult.quarters.q1.factTotal, 2);
  });

  it('should match for economy conflicts', () => {
    const rows = buildSheet([
      // Approved economy but ecoTotal = 0 → conflict
      makeRow({ id: '1', method: 'ЭА', planQuarter: 1, totalPlan: 1000,
        factDate: '15.01.2025', totalFact: 1000, flag: 'да',
        ecoFB: 0, ecoKB: 0, ecoMB: 0 }),
      // Has economy but no flag → conflict
      makeRow({ id: '2', method: 'ЭА', planQuarter: 1, totalPlan: 500,
        factDate: '20.01.2025', totalFact: 400,
        ecoFB: 50, ecoKB: 25, ecoMB: 25 }),
      // Proper: flag + economy → no conflict
      makeRow({ id: '3', method: 'ЭА', planQuarter: 1, totalPlan: 800,
        factDate: '25.01.2025', totalFact: 700,
        ecoFB: 50, ecoKB: 30, ecoMB: 20, flag: 'да' }),
    ]);

    const oldResult = recalculateFromRows(rows, 'УЭР', 3, 2025);
    const grouped = engine.compute(rows, standardRowFilter, 3, 2025);
    const newResult = adaptToRecalcMetrics(grouped, 'УЭР');

    expect(newResult.conflicts).toBe(oldResult.conflicts);
    expect(newResult.economyTotalMath).toBeCloseTo(oldResult.economyTotalMath, 2);
  });

  it('should match for plan total fallback (K=0, sum H+I+J)', () => {
    const rows = buildSheet([
      // totalPlan=0 but per-budget filled → fallback to H+I+J
      makeRow({ id: '1', method: 'ЭА', planQuarter: 1,
        totalPlan: 0, fbPlan: 100, kbPlan: 200, mbPlan: 300 }),
      // totalPlan filled → use K directly
      makeRow({ id: '2', method: 'ЕП', planQuarter: 2,
        totalPlan: 600, fbPlan: 200, kbPlan: 200, mbPlan: 200 }),
    ]);

    const oldResult = recalculateFromRows(rows, 'УЭР', 3, 2025);
    const grouped = engine.compute(rows, standardRowFilter, 3, 2025);
    const newResult = adaptToRecalcMetrics(grouped, 'УЭР');

    // Should both use fallback for row 1
    expect(newResult.year.planTotal).toBeCloseTo(oldResult.year.planTotal, 2);
    expect(newResult.quarters.q1.planTotal).toBeCloseTo(oldResult.quarters.q1.planTotal, 2);
  });

  it('should match activity breakdown', () => {
    const rows = buildSheet([
      makeRow({ id: '1', method: 'ЭА', planQuarter: 1, type: 'Программное мероприятие',
        totalPlan: 1000, factDate: '15.01.2025', totalFact: 800 }),
      makeRow({ id: '2', method: 'ЕП', planQuarter: 1, type: 'Текущая деятельность',
        totalPlan: 500, factDate: '20.01.2025', totalFact: 400 }),
      makeRow({ id: '3', method: 'ЭА', planQuarter: 2, type: 'Программное мероприятие',
        totalPlan: 700 }),
    ]);

    const oldResult = recalculateFromRows(rows, 'УЭР', 3, 2025);
    const grouped = engine.compute(rows, standardRowFilter, 3, 2025);
    const newResult = adaptToRecalcMetrics(grouped, 'УЭР');

    // Activity breakdown for Q1 and year
    for (const period of ['q1', 'q2', 'year'] as const) {
      const oldA = oldResult.byActivity[period];
      const newA = newResult.byActivity[period];
      if (!oldA || !newA) continue;

      expect(newA.program.planCount).toBe(oldA.program.planCount);
      expect(newA.program.factCount).toBe(oldA.program.factCount);
      expect(newA.program.planTotal).toBeCloseTo(oldA.program.planTotal, 2);
      expect(newA.program.factTotal).toBeCloseTo(oldA.program.factTotal, 2);

      expect(newA.current_program.planCount).toBe(oldA.current_program.planCount);
      expect(newA.current_program.factCount).toBe(oldA.current_program.factCount);
    }
  });

  it('should match monthly breakdown', () => {
    const rows = buildSheet([
      makeRow({ id: '1', method: 'ЭА', planQuarter: 1, planDate: '15.01.2025',
        totalPlan: 1000, factDate: '20.01.2025', totalFact: 900 }),
      makeRow({ id: '2', method: 'ЕП', planQuarter: 1, planDate: '10.03.2025',
        totalPlan: 500, factDate: '25.03.2025', totalFact: 450 }),
      makeRow({ id: '3', method: 'ЭА', planQuarter: 2, planDate: '05.04.2025',
        totalPlan: 700 }),
    ]);

    const oldResult = recalculateFromRows(rows, 'УЭР', 3, 2025);
    const grouped = engine.compute(rows, standardRowFilter, 3, 2025);
    const newResult = adaptToRecalcMetrics(grouped, 'УЭР');

    // Monthly data
    for (let m = 1; m <= 12; m++) {
      const oldM = oldResult.months[m];
      const newM = newResult.months[m];
      expect(newM.planCount).toBe(oldM.planCount);
      expect(newM.factCount).toBe(oldM.factCount);
      expect(newM.planTotal).toBeCloseTo(oldM.planTotal, 2);
      expect(newM.factTotal).toBeCloseTo(oldM.factTotal, 2);
    }
  });
});
