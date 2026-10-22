import { describe, expect, it } from 'vitest';
import { CalcEngine, adaptToRecalcMetrics, standardRowFilter } from '@aemr/core';
import { DEPT_COLUMNS } from '@aemr/shared';
import { computeFilteredData } from './useFilteredData';

type Atom = {
  dept: 'УО' | 'УЭР';
  subordinate: string;
  month: number;
  method: 'competitive' | 'ep';
  activity: 'program' | 'current_non_program';
  fb: number;
  kb: number;
  factFb: number;
  factKb: number;
  economyFb?: number;
  economyKb?: number;
  approved?: boolean;
};

const atoms: Atom[] = [
  { dept: 'УО', subordinate: 'Школа № 1', month: 1, method: 'competitive', activity: 'program',
    fb: 100, kb: 0, factFb: 80, factKb: 0, economyFb: 10, approved: true },
  { dept: 'УО', subordinate: 'Школа № 1', month: 4, method: 'ep', activity: 'current_non_program',
    fb: 0, kb: 60, factFb: 0, factKb: 0, economyKb: 6, approved: true },
  { dept: 'УО', subordinate: 'Сад № 2', month: 1, method: 'competitive', activity: 'current_non_program',
    fb: 0, kb: 40, factFb: 0, factKb: 20, economyKb: 4, approved: true },
  { dept: 'УО', subordinate: '', month: 4, method: 'ep', activity: 'program',
    fb: 20, kb: 0, factFb: 20, factKb: 0 },
  { dept: 'УЭР', subordinate: '', month: 1, method: 'ep', activity: 'program',
    fb: 10, kb: 20, factFb: 0, factKb: 10, economyKb: 2, approved: true },
  { dept: 'УЭР', subordinate: '', month: 4, method: 'competitive', activity: 'current_non_program',
    fb: 70, kb: 0, factFb: 50, factKb: 0 },
];

function sourceRow(a: Atom, i: number): unknown[] {
  const row: unknown[] = new Array(34).fill('');
  row[DEPT_COLUMNS.ID] = String(i + 1);
  row[DEPT_COLUMNS.SUBORDINATE] = a.subordinate;
  row[DEPT_COLUMNS.SUBJECT] = 'Проверочная закупка';
  row[DEPT_COLUMNS.TYPE] = a.activity === 'program' ? 'Программное мероприятие' : 'Текущая деятельность';
  row[DEPT_COLUMNS.METHOD] = a.method === 'ep' ? 'ЕП' : 'ЭА';
  row[DEPT_COLUMNS.PLAN_DATE] = '15.' + String(a.month).padStart(2, '0') + '.2026';
  row[DEPT_COLUMNS.PLAN_QUARTER] = a.month <= 3 ? 1 : 2;
  row[DEPT_COLUMNS.PLAN_YEAR] = 2026;
  row[DEPT_COLUMNS.FB_PLAN] = a.fb;
  row[DEPT_COLUMNS.KB_PLAN] = a.kb;
  row[DEPT_COLUMNS.TOTAL_PLAN] = a.fb + a.kb;
  row[DEPT_COLUMNS.FB_FACT] = a.factFb;
  row[DEPT_COLUMNS.KB_FACT] = a.factKb;
  row[DEPT_COLUMNS.TOTAL_FACT] = a.factFb + a.factKb;
  row[DEPT_COLUMNS.FLAG] = a.approved ? 'да' : '';
  row[DEPT_COLUMNS.ECONOMY_FB] = a.economyFb ?? 0;
  row[DEPT_COLUMNS.ECONOMY_KB] = a.economyKb ?? 0;
  if (a.factFb + a.factKb > 0) {
    row[DEPT_COLUMNS.FACT_DATE] = '20.' + String(a.month).padStart(2, '0') + '.2026';
  }
  return row;
}

function asQuarter(q: any) {
  return {
    ...q,
    kpCount: q.competitive?.plan ?? 0,
    kpFactCount: q.competitive?.fact ?? 0,
    epCount: q.ep?.plan ?? 0,
    epFactCount: q.ep?.fact ?? 0,
    kpPlanTotal: q.competitive?.planSum ?? 0,
    kpFactTotal: q.competitive?.factSum ?? 0,
    epPlanTotal: q.ep?.planSum ?? 0,
    epFactTotal: q.ep?.factSum ?? 0,
  };
}

function department(name: Atom['dept'], id: string) {
  const mine = atoms.filter(a => a.dept === name);
  const grouped = new CalcEngine().compute(mine.map(sourceRow), standardRowFilter, 0, 2026);
  const result = adaptToRecalcMetrics(grouped, name);
  const quarters: Record<string, any> = Object.fromEntries(
    ['q1', 'q2', 'q3', 'q4'].map(pk => [pk, asQuarter(result.quarters[pk as keyof typeof result.quarters])]),
  );
  const year = result.year;
  quarters.year = {
    ...year,
    kpCount: result.totalCompetitive,
    epCount: result.totalEP,
    kpFactCount: Object.values(quarters).reduce((n, q) => n + q.kpFactCount, 0),
    epFactCount: Object.values(quarters).reduce((n, q) => n + q.epFactCount, 0),
    kpPlanTotal: Object.values(quarters).reduce((n, q) => n + q.kpPlanTotal, 0),
    epPlanTotal: Object.values(quarters).reduce((n, q) => n + q.epPlanTotal, 0),
    kpFactTotal: Object.values(quarters).reduce((n, q) => n + q.kpFactTotal, 0),
    epFactTotal: Object.values(quarters).reduce((n, q) => n + q.epFactTotal, 0),
  };
  return {
    department: { id, nameShort: name, name },
    planTotal: result.year.planTotal,
    factTotal: result.year.factTotal,
    planCount: result.year.planCount,
    factCount: result.year.factCount,
    competitiveCount: result.totalCompetitive,
    soleCount: result.totalEP,
    quarters,
    months: Object.fromEntries(Object.entries(result.months).map(([k, q]) => [k, asQuarter(q)])),
    byActivity: result.byActivity,
    subordinates: result.bySubordinate,
    economyTotal: result.year.economyTotal,
  };
}

type Choice = {
  dept: string;
  subordinate: string;
  period: 'q1' | 'q2' | 'year';
  method: '' | 'competitive' | 'single';
  activity: '' | 'program' | 'current_non_program';
  budget: '' | 'fb' | 'kb';
};

function scoped(c: Choice) {
  return atoms.filter(a => (!c.dept || a.dept === c.dept)
    && (!c.subordinate || a.subordinate === c.subordinate)
    && (c.period === 'year' || (c.period === 'q1' ? a.month <= 3 : a.month >= 4))
    && (!c.method || a.method === (c.method === 'single' ? 'ep' : 'competitive'))
    && (!c.activity || a.activity === c.activity));
}

const DATA_DEPTS = [department('УО', 'uo'), department('УЭР', 'uer')];

function filtered(c: Choice) {
  return computeFilteredData({
    dashboardData: { departmentSummaries: DATA_DEPTS, summaryByPeriod: {}, snapshot: { issues: [], deltas: [] }, kpiCards: [] } as any,
    selectedDepartments: new Set(c.dept ? [c.dept] : []),
    selectedSubordinates: new Set(c.subordinate ? [c.subordinate] : []),
    deptOnlyMode: new Set<string>(),
    subordinatesMap: { 'УО': ['Школа № 1', 'Сад № 2'], 'УЭР': [] },
    period: c.period,
    activeMonths: new Set<number>(),
    periodMode: 'explicit' as const,
    selectedMethods: new Set(c.method ? [c.method] : []),
    selectedActivities: new Set(c.activity ? [c.activity] : []),
    selectedBudgets: new Set(c.budget ? [c.budget] : []),
    activityFilter: 'all' as const,
    searchQuery: '',
    year: 2026,
    dataYear: 2026,
    loading: false,
  });
}

describe('C03.01: independently calculated six-axis matrix from source atoms', () => {
  it('department × subordinate × period × method × activity × budget preserves scoped money', () => {
    let combinations = 0;
    for (const dept of ['', 'УО', 'УЭР']) {
      for (const subordinate of ['', 'Школа № 1']) {
        for (const period of ['q1', 'q2', 'year'] as const) {
          for (const method of ['', 'competitive', 'single'] as const) {
            for (const activity of ['', 'program', 'current_non_program'] as const) {
              for (const budget of ['', 'fb', 'kb'] as const) {
                const c = { dept, subordinate, period, method, activity, budget };
                const label = JSON.stringify(c);
                const rows = scoped(c);
                const expectedPlan = rows.reduce((sum, a) => sum
                  + (budget === 'kb' ? a.kb : budget === 'fb' ? a.fb : a.fb + a.kb), 0);
                const expectedFact = rows.reduce((sum, a) => sum
                  + (budget === 'kb' ? a.factKb : budget === 'fb' ? a.factFb : a.factFb + a.factKb), 0);
                const expectedEconomy = rows.reduce((sum, a) =>
                  sum + (a.approved && a.factFb + a.factKb > 0
                    ? budget === 'kb' ? (a.economyKb ?? 0)
                      : budget === 'fb' ? (a.economyFb ?? 0)
                        : (a.economyFb ?? 0) + (a.economyKb ?? 0)
                    : 0), 0);
                const fd = filtered(c);
                expect(fd.activityMethodCoverage, label + ': matrix coverage').toBe(true);
                expect(fd.totalPlan, label + ': plan').toBeCloseTo(expectedPlan, 8);
                expect(fd.totalFact, label + ': fact').toBeCloseTo(expectedFact, 8);
                expect(fd.totalEconomy, label + ': approved AD economy').toBeCloseTo(expectedEconomy, 8);
                expect(fd.barData.reduce((n: number, b: any) => n + b.planTotal, 0),
                  label + ': sum of departmental bars').toBeCloseTo(fd.totalPlan, 8);
                expect(fd.barData.reduce((n: number, b: any) => n + b.factTotal, 0),
                  label + ': sum of facts').toBeCloseTo(fd.totalFact, 8);
                combinations++;
              }
            }
          }
        }
      }
    }
    expect(combinations).toBe(486);
  });
});
