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


describe('computeFilteredData — combined activity and procurement filters', () => {
  it('does not reuse unsliced official KPI cards or label EP as competitive', () => {
    const input = makeInputs('q1', cardsFor('q1'));
    const program = {
      planCount: 3, factCount: 1, planTotal: 60, factTotal: 10,
      byMethod: {
        competitive: { plan: 1, fact: 0, planSum: 40, factSum: 0 },
        ep: { plan: 2, fact: 1, planSum: 20, factSum: 10 },
      },
    };
    input.dashboardData.departmentSummaries = [{
      department: { id: 'uer', nameShort: 'УЭР' },
      quarters: { q1: {
        planCount: 3, factCount: 1, kpCount: 1, epCount: 2,
        planTotal: 60, factTotal: 10,
      } },
      byActivity: { q1: { program } },
      subordinates: [],
    }];
    input.selectedActivities = new Set(['program']);
    input.selectedMethods = new Set(['single']);
    const result = computeFilteredData(input);
    expect(result).toMatchObject({
      totalKP: 0, totalEP: 2, totalPlan: 20, totalFact: 10,
      totalPlanCount: 2, totalFactCount: 1,
      overallExecCountPct: 50, activityMethodBreakdownAvailable: true,
    });
    // The district-wide original cards have not been reinterpreted as EP
    // or used as "proof" of selected activity scope.
    expect(result.topKpis.every(k => k.metricKey.startsWith('_derived.'))).toBe(true);
    expect(result.topKpis.find(k => k.metricKey === '_derived.competitive_ratio')?.value).toBe('0.0%');
  });

  it('incompatible saved snapshots suppress derived KPI claims', () => {
    const input = makeInputs('q1', cardsFor('q1'));
    input.dashboardData.departmentSummaries = [{
      department: { id: 'uer', nameShort: 'УЭР' },
      quarters: { q1: { planCount: 3, factCount: 2 } },
      byActivity: { q1: { program: { planCount: 3, planTotal: 60 } } },
      subordinates: [],
    }];
    input.selectedActivities = new Set(['program']);
    const result = computeFilteredData(input);
    expect(result.activityMethodBreakdownAvailable).toBe(false);
    expect(result.topKpis).toEqual([]);
    expect(result.summaryByPeriod.q1.source).toBe('not_comparable');
  });
});
