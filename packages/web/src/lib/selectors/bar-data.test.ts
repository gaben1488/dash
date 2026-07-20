import { describe, expect, it } from 'vitest';
import { buildBarData, buildDeptCardOverrides } from './bar-data';
import { makeBudgetPlanFact } from './budget-filter';

const noBudget = makeBudgetPlanFact(new Set());
const baseOpts = {
  budgetPlanFact: noBudget,
  isBudgetFiltered: false,
  isActivityFiltered: false,
  actKeys: [] as string[],
  useMonthLevel: false,
  activeMonths: new Set<number>(),
  hasActiveMonths: false,
  coveredQuarters: [] as string[],
  periodKey: 'q1',
  showKP: true,
  showEP: true,
};

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
    const [b] = buildBarData([dept], baseOpts);
    expect(b).toEqual({
      name: 'УЭР', nameShort: 'УЭР', id: 'uer',
      pct: 42.9, planTotal: 140, factTotal: 60,
      kpCount: 2, epCount: 1, execCountPct: 40,
    });
  });

  it('года в quarters нет — фолбэк на депт-уровень', () => {
    const [b] = buildBarData([dept], { ...baseOpts, periodKey: 'year' });
    expect(b.pct).toBe(50);
    expect(b.planTotal).toBe(500);
    expect(b.kpCount).toBe(10);
  });

  it('способ: невыбранный тип обнуляется в счётчиках', () => {
    const [b] = buildBarData([dept], { ...baseOpts, showKP: false });
    expect(b.kpCount).toBe(0);
    expect(b.epCount).toBe(1);
  });

  it('бюджет-фильтр: план/факт из per-budget полей, pct пересчитан', () => {
    const [b] = buildBarData([dept], {
      ...baseOpts, isBudgetFiltered: true, budgetPlanFact: makeBudgetPlanFact(new Set(['fb'])),
    });
    expect(b.planTotal).toBe(90);
    expect(b.factTotal).toBe(40);
    expect(b.pct).toBe(44.4);
  });

  it('month-ветвь: агрегация выбранных месяцев', () => {
    const [b] = buildBarData([dept], {
      ...baseOpts, useMonthLevel: true, hasActiveMonths: true, activeMonths: new Set([1]),
    });
    expect(b.planTotal).toBe(30);
    expect(b.factTotal).toBe(15);
    expect(b.pct).toBe(50);
    expect(b.execCountPct).toBe(50);
  });

  it('_subFiltered: значения уже-оверрайднутого депта', () => {
    const sub = {
      department: { id: 'uer', nameShort: 'УЭР' },
      _subFiltered: true, competitiveCount: 3, soleCount: 2, planTotal: 70, factTotal: 30,
      quarters: { q1: { planCount: 4, factCount: 2 } },
    };
    const [b] = buildBarData([sub], baseOpts);
    expect(b.planTotal).toBe(70);
    expect(b.pct).toBe(42.9);
    expect(b.execCountPct).toBe(50);
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
