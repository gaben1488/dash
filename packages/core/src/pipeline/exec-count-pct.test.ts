/**
 * A8: exec_count_pct pipeline verification
 *
 * Tests that:
 * 1. exec_count_pct (fact_count / plan_count) flows through CalcEngine → Adapter → RecalculatedMetrics
 * 2. comp_exec_count_pct and ep_exec_count_pct work correctly
 * 3. "_org_itself" appears in bySubordinate when column C is empty
 * 4. subordinate byActivity breakdown works
 * 5. ActivityBreakdown includes per-budget fields
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { CalcEngine, standardRowFilter } from './calc-engine.js';
import { adaptToRecalcMetrics } from './calc-engine-adapter.js';
import { recalculateFromRows } from './recalculate.js';

const COL = DEPT_COLUMNS;

function makeRow(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = overrides.id ?? '1';
  row[COL.SUBORDINATE] = overrides.subordinate ?? '';
  row[COL.TYPE] = overrides.type ?? 'Текущая деятельность';
  row[COL.PROGRAM_NAME] = overrides.programName ?? '';
  row[COL.SUBJECT] = overrides.subject ?? 'Закупка';
  row[COL.FB_PLAN] = overrides.fbPlan ?? 100;
  row[COL.KB_PLAN] = overrides.kbPlan ?? 200;
  row[COL.MB_PLAN] = overrides.mbPlan ?? 0;
  row[COL.TOTAL_PLAN] = overrides.totalPlan ?? 300;
  row[COL.METHOD] = overrides.method ?? 'ЭА';
  row[COL.PLAN_DATE] = overrides.planDate ?? '15.01.2025';
  row[COL.PLAN_QUARTER] = overrides.planQuarter ?? 1;
  row[COL.PLAN_YEAR] = overrides.planYear ?? 2025;
  row[COL.FACT_DATE] = overrides.factDate ?? '';
  row[COL.FACT_QUARTER] = overrides.factQuarter ?? '';
  row[COL.STATUS] = overrides.status ?? '';
  row[COL.FB_FACT] = overrides.fbFact ?? 0;
  row[COL.KB_FACT] = overrides.kbFact ?? 0;
  row[COL.MB_FACT] = overrides.mbFact ?? 0;
  row[COL.TOTAL_FACT] = overrides.totalFact ?? 0;
  row[COL.ECONOMY_FB] = overrides.ecoFB ?? 0;
  row[COL.ECONOMY_KB] = overrides.ecoKB ?? 0;
  row[COL.ECONOMY_MB] = overrides.ecoMB ?? 0;
  row[COL.FLAG] = overrides.flag ?? '';
  return row;
}

function buildSheet(dataRows: unknown[][]): unknown[][] {
  const headers = [
    new Array(32).fill('Header1'),
    new Array(32).fill('Header2'),
    new Array(32).fill('Header3'),
  ];
  return [...headers, ...dataRows];
}

describe('exec_count_pct pipeline (A8)', () => {
  const engine = new CalcEngine();

  // 5 rows: 3 competitive (2 with fact), 2 EP (1 with fact)
  const testRows = buildSheet([
    // Competitive Q1 with fact — org itself
    makeRow({ id: '1', method: 'ЭА', planQuarter: 1, totalPlan: 1000, fbPlan: 500, kbPlan: 300, mbPlan: 200, factDate: '20.02.2025', totalFact: 900, fbFact: 450, kbFact: 270, mbFact: 180 }),
    // Competitive Q1 with fact — subordinate
    makeRow({ id: '2', method: 'ЭК', planQuarter: 1, subordinate: 'МКУ ЦЭР', totalPlan: 800, fbPlan: 400, kbPlan: 200, mbPlan: 200, factDate: '25.02.2025', totalFact: 750, fbFact: 375, kbFact: 187, mbFact: 188 }),
    // Competitive Q2 without fact — org itself
    makeRow({ id: '3', method: 'ЭА', planQuarter: 2, totalPlan: 600, fbPlan: 300, kbPlan: 200, mbPlan: 100, planDate: '15.04.2025' }),
    // EP Q1 with fact — org itself
    makeRow({ id: '4', method: 'ЕП', planQuarter: 1, totalPlan: 200, fbPlan: 100, kbPlan: 50, mbPlan: 50, factDate: '10.03.2025', totalFact: 180, fbFact: 90, kbFact: 45, mbFact: 45 }),
    // EP Q2 without fact — subordinate
    makeRow({ id: '5', method: 'ЕП', planQuarter: 2, subordinate: 'МКУ ЦЭР', totalPlan: 150, fbPlan: 75, kbPlan: 50, mbPlan: 25, planDate: '20.05.2025' }),
  ]);

  describe('CalcEngine + Adapter', () => {
    const grouped = engine.compute(testRows, standardRowFilter, 3, 2025);
    const result = adaptToRecalcMetrics(grouped, 'УЭР');

    it('year-level exec_count_pct = fact_count / plan_count', () => {
      // 5 plan rows, 3 with fact date → exec_count_pct = 3/5 = 0.6
      expect(result.year.planCount).toBe(5);
      expect(result.year.factCount).toBe(3);
      expect(result.year.execCountPct).toBeCloseTo(0.6, 3);
    });

    it('comp_exec_count_pct = comp_fact / comp_plan', () => {
      // 3 competitive planned, 2 with fact → 2/3 ≈ 0.667
      expect(result.year.compExecCountPct).toBeCloseTo(2 / 3, 3);
    });

    it('ep_exec_count_pct = ep_fact / ep_plan', () => {
      // 2 EP planned, 1 with fact → 1/2 = 0.5
      expect(result.year.epExecCountPct).toBeCloseTo(0.5, 3);
    });

    it('quarter-level exec_count_pct', () => {
      // Q1: 3 plan (rows 1,2,4), 3 fact → 3/3 = 1.0
      expect(result.quarters.q1.execCountPct).toBeCloseTo(1.0, 3);
      // Q2: 2 plan (rows 3,5), 0 fact → 0/2 = 0
      expect(result.quarters.q2.execCountPct).toBeCloseTo(0, 3);
    });

    it('quarter-level comp/ep exec_count_pct', () => {
      // Q1 competitive: 2 plan, 2 fact → 1.0
      expect(result.quarters.q1.compExecCountPct).toBeCloseTo(1.0, 3);
      // Q1 EP: 1 plan, 1 fact → 1.0
      expect(result.quarters.q1.epExecCountPct).toBeCloseTo(1.0, 3);
      // Q2 competitive: 1 plan, 0 fact → 0
      expect(result.quarters.q2.compExecCountPct).toBeCloseTo(0, 3);
    });
  });

  describe('_org_itself in bySubordinate', () => {
    const grouped = engine.compute(testRows, standardRowFilter, 3, 2025);
    const result = adaptToRecalcMetrics(grouped, 'УЭР');

    it('bySubordinate contains _org_itself entry', () => {
      const orgItself = result.bySubordinate.find(s => s.name === '_org_itself');
      expect(orgItself).toBeDefined();
      // Rows 1, 3, 4 have empty col C → _org_itself
      expect(orgItself!.rowCount).toBe(3);
    });

    it('bySubordinate contains named subordinate', () => {
      const mku = result.bySubordinate.find(s => s.name === 'МКУ ЦЭР');
      expect(mku).toBeDefined();
      // Rows 2, 5
      expect(mku!.rowCount).toBe(2);
    });

    it('subordinate has execCountPct', () => {
      const orgItself = result.bySubordinate.find(s => s.name === '_org_itself')!;
      // _org_itself: 3 planned, 2 with fact (rows 1, 4) → 2/3
      expect(orgItself.execCountPct).toBeCloseTo(2 / 3, 3);

      const mku = result.bySubordinate.find(s => s.name === 'МКУ ЦЭР')!;
      // МКУ ЦЭР: 2 planned, 1 with fact (row 2) → 1/2
      expect(mku.execCountPct).toBeCloseTo(0.5, 3);
    });

    it('subordinate has byActivity breakdown', () => {
      const orgItself = result.bySubordinate.find(s => s.name === '_org_itself')!;
      expect(orgItself.byActivity).toBeDefined();
      // All 3 org-itself rows are "Текущая деятельность" with no program → current_non_program
      expect(orgItself.byActivity.current_non_program.planCount).toBe(3);
    });
  });

  describe('Legacy recalculateFromRows parity', () => {
    const legacy = recalculateFromRows(testRows, 'УЭР', 3, 2025);

    it('legacy also has _org_itself in bySubordinate', () => {
      const orgItself = legacy.bySubordinate.find(s => s.name === '_org_itself');
      expect(orgItself).toBeDefined();
      expect(orgItself!.rowCount).toBe(3);
    });

    it('legacy year-level exec_count_pct matches', () => {
      expect(legacy.year.execCountPct).toBeCloseTo(0.6, 3);
      expect(legacy.year.compExecCountPct).toBeCloseTo(2 / 3, 3);
      expect(legacy.year.epExecCountPct).toBeCloseTo(0.5, 3);
    });

    it('legacy quarter exec_count_pct', () => {
      expect(legacy.quarters.q1.execCountPct).toBeCloseTo(1.0, 3);
      expect(legacy.quarters.q2.execCountPct).toBeCloseTo(0, 3);
    });
  });

  describe('ActivityBreakdown per-budget', () => {
    const grouped = engine.compute(testRows, standardRowFilter, 3, 2025);
    const result = adaptToRecalcMetrics(grouped, 'УЭР');

    it('year activity has per-budget plan fields', () => {
      const yearAct = result.byActivity['year'];
      expect(yearAct).toBeDefined();
      // All rows are current_non_program (Текущая деятельность, no program name)
      const cnp = yearAct.current_non_program;
      expect(cnp.planCount).toBe(5);
      expect(cnp.planFB).toBe(500 + 400 + 300 + 100 + 75); // sum of all fbPlan
      expect(cnp.planKB).toBe(300 + 200 + 200 + 50 + 50);
    });

    it('year activity has per-budget fact fields', () => {
      const cnp = result.byActivity['year'].current_non_program;
      // 3 rows with fact
      expect(cnp.factCount).toBe(3);
      expect(cnp.factFB).toBe(450 + 375 + 90);
    });

    it('year activity has execCountPct', () => {
      const cnp = result.byActivity['year'].current_non_program;
      // 5 plan, 3 fact → 0.6
      expect(cnp.execCountPct).toBeCloseTo(0.6, 3);
    });
  });
});
