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
