import { describe, expect, it } from 'vitest';
import { computeFilteredData } from './useFilteredData';
import type { PeriodScope } from '../store';

/**
 * Здесь стерегутся два обещания расчёта, которые легко потерять при правках:
 * расчёт ничего не пишет в исходные данные, и посчитанный тренд отвечает на
 * смену периода, а не застывает на первом посчитанном.
 */

/** Рост во втором квартале: 40% → 80%. */
const SUMMARY_GROWING = {
  q1: { kpPercent: 40, epPercent: 60, kpCount: 4, epCount: 6 },
  q2: { kpPercent: 80, epPercent: 20, kpCount: 8, epCount: 2 },
};

/** Тот же квартал в другом разрезе — падение: 90% → 30%. */
const SUMMARY_FALLING = {
  q1: { kpPercent: 90, epPercent: 10, kpCount: 9, epCount: 1 },
  q2: { kpPercent: 30, epPercent: 70, kpCount: 3, epCount: 7 },
};

function makeInputs(period: PeriodScope, kpiCards: any[], summaryByPeriod = SUMMARY_GROWING) {
  return {
    dashboardData: {
      departmentSummaries: [],
      kpiCards,
      summaryByPeriod,
      snapshot: { issues: [], deltas: [] },
    } as any,
    selectedDepartments: new Set<string>(),
    selectedSubordinates: new Set<string>(),
    deptOnlyMode: new Set<string>(),
    subordinatesMap: {},
    period,
    activeMonths: new Set<number>(),
    periodMode: 'explicit' as const,
    selectedMethods: new Set<string>(),
    selectedActivities: new Set<string>(),
    selectedBudgets: new Set<string>(),
    activityFilter: 'all' as const,
    searchQuery: '',
    year: 2026,
    dataYear: 2026,
    loading: false,
  };
}

/** Карточки, по которым считается тренд: ключ вида `competitive.{период}.percent`. */
function cardsFor(period: string) {
  return [
    { metricKey: `competitive.${period}.percent`, label: 'Доля конкурентных', value: '80%' },
    { metricKey: `sole.${period}.percent`, label: 'Доля единственного поставщика', value: '20%' },
  ];
}

describe('computeFilteredData — тренд KPI', () => {
  it('не пишет спарклайн и тренд в исходные карточки', () => {
    const cards = cardsFor('q2');

    const result = computeFilteredData(makeInputs('q2', cards));

    expect(cards[0]).not.toHaveProperty('trend');
    expect(cards[0]).not.toHaveProperty('sparkData');
    // При этом на выданных наружу карточках тренд есть.
    const shown = result.topKpis.find(k => k.metricKey === 'competitive.q2.percent');
    expect(shown?.trend).toBe('up'); // 40% в первом квартале → 80% во втором
  });

  it('пересчитывает тренд, когда фильтр изменил сводку по кварталам', () => {
    // Это ровно то, что происходит при выборе управления: карточки те же самые
    // объекты из данных, а сводка по кварталам пересчитана под срез. Тренд обязан
    // описывать срез, а не то, что было посчитано до наложения фильтра.
    const cards = cardsFor('q2');

    const before = computeFilteredData(makeInputs('q2', cards, SUMMARY_GROWING));
    const after = computeFilteredData(makeInputs('q2', cards, SUMMARY_FALLING));

    expect(before.topKpis.find(k => k.metricKey === 'competitive.q2.percent')?.trend).toBe('up');
    expect(after.topKpis.find(k => k.metricKey === 'competitive.q2.percent')?.trend).toBe('down');
  });

  it('оставляет тренд, пришедший с сервера, нетронутым', () => {
    const cards = cardsFor('q2').map(c => ({ ...c, trend: 'stable' as const }));

    const result = computeFilteredData(makeInputs('q2', cards));

    expect(result.topKpis.find(k => k.metricKey === 'competitive.q2.percent')?.trend).toBe('stable');
  });
});

describe('computeFilteredData — exact procurement method across linked metrics', () => {
  it('method only EP with federal budget uses identical money in headline, bar and quarter', () => {
    const input = makeInputs('q1', []);
    const method = (
      plan: number, fact: number, planSum: number, factSum: number,
      planFB: number, factFB: number,
    ) => ({
      plan, fact, planSum, factSum, planFB, factFB,
      planKB: planSum - planFB, factKB: factSum - factFB,
      planMB: 0, factMB: 0,
    });
    input.dashboardData.departmentSummaries = [{
      department: { id: 'uo', nameShort: 'УО' },
      planTotal: 140, factTotal: 70, competitiveCount: 2, soleCount: 1,
      quarters: { q1: {
        planCount: 3, factCount: 2,
        planTotal: 140, factTotal: 70,
        kpCount: 2, epCount: 1,
        kpPlanTotal: 100, kpFactTotal: 50,
        epPlanTotal: 40, epFactTotal: 20,
        planFB: 90, factFB: 45, planKB: 50, factKB: 25,
      } },
      byActivity: { q1: { program: {
        planCount: 3, factCount: 2,
        byMethod: {
          competitive: method(2, 1, 100, 50, 80, 40),
          ep: method(1, 1, 40, 20, 10, 5),
        },
      } } },
      subordinates: [], issueCount: 0, criticalIssueCount: 0,
    }];
    input.selectedMethods = new Set(['single']);
    input.selectedBudgets = new Set(['fb']);
    const fd = computeFilteredData(input);
    expect(fd.activityMethodCoverage).toBe(true);
    expect(fd.totalPlan).toBe(10);
    expect(fd.totalFact).toBe(5);
    expect(fd.totalKP).toBe(0);
    expect(fd.totalEP).toBe(1);
    expect(fd.barData[0]).toMatchObject({
      planTotal: 10, factTotal: 5, kpCount: 0, epCount: 1, pct: 50,
    });
    expect(fd.summaryByPeriod.q1).toMatchObject({
      kpCount: 0, epCount: 1, epPlan: 40,
      fbPlan: 10, fbFact: 5, kbPlan: 0, mbPlan: 0,
    });
  });
});
