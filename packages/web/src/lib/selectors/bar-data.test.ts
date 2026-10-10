import { describe, expect, it } from 'vitest';
import { buildBarData, buildDeptCardOverrides } from './bar-data';
import { makeBudgetPlanFact } from './budget-filter';
import { resolvePeriodSelection } from './period-resolution';
import type { PeriodScope } from '../../store';

const noBudget = makeBudgetPlanFact(new Set());

/**
 * Опции собираются из тех же полей, что в useFilteredData: resolution выводится
 * из periodKey/activeMonths/hasMonthData тем же resolvePeriodSelection —
 * иначе тест проверял бы противоречивые входы, невозможные в продукте.
 */
function makeOpts(overrides: Partial<{
  budgetPlanFact: ReturnType<typeof makeBudgetPlanFact>;
  isBudgetFiltered: boolean;
  isActivityFiltered: boolean;
  actKeys: string[];
  periodKey: PeriodScope;
  activeMonths: Set<number>;
  hasMonthData: boolean;
  showKP: boolean;
  showEP: boolean;
}> = {}) {
  const periodKey = overrides.periodKey ?? 'q1';
  const activeMonths = overrides.activeMonths ?? new Set<number>();
  const hasMonthData = overrides.hasMonthData ?? false;
  const resolution = resolvePeriodSelection(periodKey, activeMonths, hasMonthData);
  return {
    budgetPlanFact: overrides.budgetPlanFact ?? noBudget,
    isBudgetFiltered: overrides.isBudgetFiltered ?? false,
    isActivityFiltered: overrides.isActivityFiltered ?? false,
    actKeys: overrides.actKeys ?? [],
    useMonthLevel: resolution.useMonthLevel,
    activeMonths,
    hasActiveMonths: resolution.hasActiveMonths,
    coveredQuarters: resolution.coveredQuarters,
    periodKey: resolution.periodKey,
    showKP: overrides.showKP ?? true,
    showEP: overrides.showEP ?? true,
    resolution,
    hasMonthData,
  };
}

const dept = {
  department: { id: 'uer', nameShort: 'УЭР' },
  planTotal: 500, factTotal: 250, executionPercent: 50, competitiveCount: 10, soleCount: 4,
  quarters: {
    q1: {
      kpCount: 2, epCount: 1, executionPct: 42.9, planTotal: 140, factTotal: 60,
      execCountPct: 40, planFB: 90, factFB: 40,
    },
  },
  months: { 1: { planCount: 2, factCount: 1, planTotal: 30, factTotal: 15, kpCount: 1, epCount: 0 } },
};

describe('buildBarData (извлечено из useFilteredData §10)', () => {
  it('фильтров нет (quarter-ветвь) — значения квартала как есть', () => {
    const [b] = buildBarData([dept], makeOpts());
    expect(b).toEqual({
      name: 'УЭР', nameShort: 'УЭР', id: 'uer',
      pct: 42.9, planTotal: 140, factTotal: 60,
      kpCount: 2, epCount: 1, execCountPct: 40,
    });
  });

  it('года в quarters нет — фолбэк на депт-уровень', () => {
    const [b] = buildBarData([dept], makeOpts({ periodKey: 'year' }));
    expect(b.pct).toBe(50);
    expect(b.planTotal).toBe(500);
    expect(b.kpCount).toBe(10);
  });

  it('способ: невыбранный тип обнуляется в счётчиках', () => {
    const [b] = buildBarData([dept], makeOpts({ showKP: false }));
    expect(b.kpCount).toBe(0);
    expect(b.epCount).toBe(1);
  });

  it('только ЕП: денежный бар и процент считаются по ЕП, не по всем закупкам', () => {
    const sliced = {
      ...dept,
      quarters: {
        q1: {
          ...dept.quarters.q1, planCount: 3, factCount: 2,
          kpPlanTotal: 100, kpFactTotal: 50, kpFactCount: 1,
          epPlanTotal: 40, epFactTotal: 10, epFactCount: 1,
        },
      },
      byActivity: {
        q1: { program: {
          planCount: 3, factCount: 2,
          byMethod: {
            competitive: { plan: 2, fact: 1, planSum: 100, factSum: 50,
              planFB: 60, planKB: 40, planMB: 0, factFB: 30, factKB: 20, factMB: 0 },
            ep: { plan: 1, fact: 1, planSum: 40, factSum: 10,
              planFB: 10, planKB: 30, planMB: 0, factFB: 4, factKB: 6, factMB: 0 },
          },
        } },
      },
    };
    const [b] = buildBarData([sliced], makeOpts({ showKP: false, showEP: true }));
    expect(b).toMatchObject({
      kpCount: 0, epCount: 1, planTotal: 40, factTotal: 10, pct: 25, execCountPct: 100,
    });
    const [fb] = buildBarData([sliced], makeOpts({
      showKP: false, showEP: true,
      isBudgetFiltered: true,
      budgetPlanFact: makeBudgetPlanFact(new Set(['fb'])),
    }));
    expect(fb).toMatchObject({ planTotal: 10, factTotal: 4, pct: 40 });
  });

  it('месяц с выбранным КП показывает только конкурентные суммы и позиции', () => {
    const monthly = {
      ...dept,
      months: { 1: {
        planCount: 3, factCount: 2, planTotal: 60, factTotal: 25,
        kpCount: 2, kpFactCount: 1, kpPlanTotal: 35, kpFactTotal: 15,
        epCount: 1, epFactCount: 1, epPlanTotal: 25, epFactTotal: 10,
      } },
      byActivity: { m1: { current_non_program: {
        planCount: 3, factCount: 2,
        byMethod: {
          competitive: { plan: 2, fact: 1, planSum: 35, factSum: 15,
            planFB: 35, planKB: 0, planMB: 0, factFB: 15, factKB: 0, factMB: 0 },
          ep: { plan: 1, fact: 1, planSum: 25, factSum: 10,
            planFB: 25, planKB: 0, planMB: 0, factFB: 10, factKB: 0, factMB: 0 },
        },
      } } },
    };
    const [b] = buildBarData([monthly], makeOpts({
      periodKey: 'year', activeMonths: new Set([1]), hasMonthData: true,
      showKP: true, showEP: false,
    }));
    expect(b).toMatchObject({ planTotal: 35, factTotal: 15, kpCount: 2, epCount: 0, execCountPct: 50 });
  });

  it('подвед + только ЕП не наследует полные суммы управления при выбранном квартале', () => {
    const scoped = {
      department: { id: 'uo', nameShort: 'УО' },
      _subFiltered: true,
      planTotal: 80, factTotal: 40, competitiveCount: 2, soleCount: 1,
      quarters: { q1: {
        planCount: 3, factCount: 2, planTotal: 80, factTotal: 40,
        kpCount: 90, kpPlanTotal: 900, epPlanTotal: 100,
      } },
      byActivity: { q1: { program: {
        planCount: 3, factCount: 2,
        byMethod: {
          competitive: { plan: 2, fact: 1, planSum: 60, factSum: 34,
            planFB: 60, planKB: 0, planMB: 0, factFB: 34, factKB: 0, factMB: 0 },
          ep: { plan: 1, fact: 1, planSum: 20, factSum: 6,
            planFB: 20, planKB: 0, planMB: 0, factFB: 6, factKB: 0, factMB: 0 },
        },
      } } },
    };
    const [b] = buildBarData([scoped], makeOpts({ showKP: false, showEP: true }));
    expect(b).toMatchObject({
      planTotal: 20, factTotal: 6, pct: 30, kpCount: 0, epCount: 1, execCountPct: 100,
    });
  });

  it('бюджет-фильтр: план/факт из per-budget полей, pct пересчитан', () => {
    const [b] = buildBarData([dept], makeOpts({
      isBudgetFiltered: true, budgetPlanFact: makeBudgetPlanFact(new Set(['fb'])),
    }));
    expect(b.planTotal).toBe(90);
    expect(b.factTotal).toBe(40);
    expect(b.pct).toBe(44.4);
  });

  it('month-ветвь: агрегация выбранных месяцев', () => {
    const [b] = buildBarData([dept], makeOpts({ activeMonths: new Set([1]), hasMonthData: true }));
    expect(b.planTotal).toBe(30);
    expect(b.factTotal).toBe(15);
    expect(b.pct).toBe(50);
    expect(b.execCountPct).toBe(50);
  });

  it('activity + ЕП: бар показывает именно закупки ЕП, а не все как КП', () => {
    const metric = (plan: number, fact: number, amount: number) => ({
      plan, fact, planSum: amount, factSum: amount / 2,
      planFB: amount, planKB: 0, planMB: 0,
      factFB: amount / 2, factKB: 0, factMB: 0,
    });
    const split = { ...dept, byActivity: { q1: { program: {
      planCount: 3, byMethod: { competitive: metric(2, 1, 80), ep: metric(1, 1, 20) },
    } } } };
    const [b] = buildBarData([split], makeOpts({
      isActivityFiltered: true, actKeys: ['program'], showKP: false, showEP: true,
    }));
    expect(b).toMatchObject({ kpCount: 0, epCount: 1, planTotal: 20, factTotal: 10, execCountPct: 100 });
  });

  it('_subFiltered без периода: значения уже-оверрайднутого депта (год)', () => {
    const sub = {
      department: { id: 'uer', nameShort: 'УЭР' },
      _subFiltered: true, competitiveCount: 3, soleCount: 2, planTotal: 70, factTotal: 30,
      quarters: { q1: { planCount: 4, factCount: 2 } },
    };
    const [b] = buildBarData([sub], makeOpts({ periodKey: 'year' }));
    expect(b.planTotal).toBe(70);
    expect(b.pct).toBe(42.9);
    expect(b.execCountPct).toBe(50);
  });

  it('_subFiltered + квартал: бар режется периодом, а не показывает год (баг #4)', () => {
    // Числа-ловушки: у оверрайднутого q3 в спреде остались kpPlanTotal/kpCount
    // УПРАВЛЕНИЯ — если ветвь прочитает их, план станет 900 (депт), а не 320 (подведы).
    const sub = {
      department: { id: 'uer', nameShort: 'УЭР' },
      _subFiltered: true, competitiveCount: 3, soleCount: 2,
      planTotal: 700, factTotal: 300, // год подведов — НЕ должен попасть в бар квартала
      quarters: {
        q1: { planCount: 4, factCount: 2, planTotal: 380, factTotal: 200 },
        q3: {
          planCount: 5, factCount: 1, planTotal: 320, factTotal: 100,
          // депт-уровневые метод-поля, протащенные спредом subordinate-override
          kpCount: 40, kpPlanTotal: 900, kpFactTotal: 800, epPlanTotal: 0,
        },
      },
    };
    const [b] = buildBarData([sub], makeOpts({ periodKey: 'q3' }));
    expect(b.planTotal).toBe(320); // квартал подведов, не год и не депт-деньги
    expect(b.factTotal).toBe(100);
    expect(b.execCountPct).toBe(20); // 1/5 за q3, а не (2+1)/(4+5) за год
  });
});

describe('buildDeptCardOverrides (извлечено из useFilteredData §12)', () => {
  const barData = [{ id: 'uer', planTotal: 140, factTotal: 60, pct: 42.9 }];

  it('нет активных осей (enabled=false) — оверрайдов нет', () => {
    expect(buildDeptCardOverrides(barData, false)).toEqual({});
  });

  it('enabled — оверрайды по id из barData', () => {
    expect(buildDeptCardOverrides(barData, true)).toEqual({
      uer: { planTotal: 140, factTotal: 60, executionPercent: 42.9 },
    });
  });
});
