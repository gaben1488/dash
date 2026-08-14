/**
 * ХАРНЕСС КЛАССА «ПЕРИМЕТР ПЕРИОДА» — страж на класс дефектов, а не на проявление.
 *
 * Требование владельца (14.08, дословно): «чтобы ошибка … была проверена и не
 * повторялась ни в одном другом контракте, карточке, метрике, ни на какой
 * странице, ни при каком варианте фильтров».
 *
 * Класс (интервью пп. 5, 6, 11, 12, 14–19, 24, 36; реестр охоты #4, #5, #10):
 * одно и то же выбранное время применялось к РАЗНЫМ числам одного экрана
 * по-разному — итоги резались периодом, а бары/подведы/экономия читали год.
 *
 * Здесь на согласованной фикстуре (месяцы складываются в кварталы, кварталы —
 * в год, управление = сумма подведов) прогоняется МАТРИЦА выборов периода и
 * осей, и для каждой комбинации проверяется, что все числа экрана считаются
 * ОДНИМ периметром:
 *   I1  сумма частей (бары) = итог страницы;
 *   I2  узлы mdm (карточки управлений) в сумме = итог страницы;
 *   I3  экономия итога = сумма экономии карточек (один период);
 *   I4  счётчики процедур согласованы между итогом и узлами;
 *   I5  week-режим и «сбросить период» = год (недельные месяцы — не фильтр);
 *   I6  два способа выразить один квартал (period и месяцы) дают одни числа.
 * Любой будущий селектор, снова прочитавший год под заголовком квартала,
 * уронит хотя бы один из инвариантов.
 */
import { describe, expect, it } from 'vitest';
import { computeFilteredData } from './useFilteredData';
import { buildMultiDimMetricsFromFilteredData } from './useMultiDimMetrics';
import type { PeriodScope, PeriodMode } from '../store';

// ── Фикстура: данные согласованы по построению ──

/** Квартал i (1..4) управления: все поля кратны i, деньги = КП + ЕП. */
function deptQuarter(i: number) {
  return {
    planCount: 6 * i, factCount: 3 * i, kpCount: 2 * i, epCount: i,
    planTotal: 300 * i, factTotal: 150 * i,
    kpPlanTotal: 200 * i, epPlanTotal: 100 * i, kpFactTotal: 100 * i, epFactTotal: 50 * i,
    economyTotal: 12 * i, economyFB: 6 * i, economyKB: 4 * i, economyMB: 2 * i,
    planFB: 150 * i, planKB: 100 * i, planMB: 50 * i,
    factFB: 75 * i, factKB: 50 * i, factMB: 25 * i,
    executionPct: 50, execCountPct: 50,
  };
}

/** Половина всех числовых полей объекта (месяц = половина квартала). */
function half(src: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(src).map(([k, v]) => [k, v / 2]));
}

/** Нулевые значения тех же полей (третий месяц квартала пуст). */
function zero(src: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.keys(src).map((k) => [k, 0]));
}

/** Месяцы 1..12: первый и второй месяц квартала — по половине, третий — нули. */
function monthsOf(quarterOf: (i: number) => Record<string, number>): Record<number, any> {
  const months: Record<number, any> = {};
  for (let i = 1; i <= 4; i++) {
    const q = quarterOf(i);
    months[3 * i - 2] = half(q);
    months[3 * i - 1] = half(q);
    months[3 * i] = zero(q);
  }
  return months;
}

/** Подвед: SubPeriodMetrics — БЕЗ разбивки по способу (как в реальных данных). */
function subQuarter(i: number, m: number) {
  return {
    planCount: 2 * i * m, factCount: i * m,
    planTotal: 100 * i * m, factTotal: 50 * i * m,
    economyTotal: 4 * i * m, economyFB: 2 * i * m, economyKB: i * m, economyMB: i * m,
    planFB: 50 * i * m, planKB: 30 * i * m, planMB: 20 * i * m,
    factFB: 25 * i * m, factKB: 15 * i * m, factMB: 10 * i * m,
  };
}

function makeSub(name: string, m: number) {
  return {
    name,
    rowCount: 20 * m,
    planTotal: 1000 * m, factTotal: 500 * m, // Σ кварталов
    competitiveCount: 5 * m, epCount: 3 * m,
    economyTotal: 40 * m, // Σ 4i·m
    quarters: { q1: subQuarter(1, m), q2: subQuarter(2, m), q3: subQuarter(3, m), q4: subQuarter(4, m) },
    months: monthsOf((i) => subQuarter(i, m)),
  };
}

function makeDept(id: string, nameShort: string, subs: any[]) {
  const quarters: Record<string, any> = {
    q1: deptQuarter(1), q2: deptQuarter(2), q3: deptQuarter(3), q4: deptQuarter(4),
  };
  // Реальный /api/dashboard кладёт в quarters и ключ 'year' (сумма кварталов).
  const year: Record<string, number> = {};
  for (const q of [quarters.q1, quarters.q2, quarters.q3, quarters.q4]) {
    for (const [k, v] of Object.entries(q)) year[k] = (year[k] ?? 0) + (v as number);
  }
  year.executionPct = 50; year.execCountPct = 50;
  quarters.year = year;
  return {
    department: { id, nameShort, name: nameShort },
    planTotal: 3000, factTotal: 1500, executionPercent: 50,
    competitiveCount: 20, soleCount: 10,
    planCount: 60, factCount: 30,
    economyTotal: 120,
    quarters,
    months: monthsOf(deptQuarter),
    subordinates: subs,
  };
}

const SUB1 = makeSub('Школа №1', 1);
const SUB2 = makeSub('Сад №2', 2);
const UER = makeDept('uer', 'УЭР', [SUB1, SUB2]);
const UO = makeDept('uo', 'УО', []);

const SUBORDINATES_MAP = { 'УЭР': ['Школа №1', 'Сад №2'], 'УО': [] };

function makeInputs(overrides: Partial<{
  period: PeriodScope;
  activeMonths: Set<number>;
  periodMode: PeriodMode;
  selectedSubordinates: Set<string>;
  selectedMethods: Set<string>;
  selectedBudgets: Set<string>;
}> = {}) {
  return {
    dashboardData: {
      departmentSummaries: [UER, UO],
      kpiCards: [],
      summaryByPeriod: {},
      snapshot: { issues: [], deltas: [] },
    } as any,
    selectedDepartments: new Set<string>(),
    selectedSubordinates: overrides.selectedSubordinates ?? new Set<string>(),
    deptOnlyMode: new Set<string>(),
    subordinatesMap: SUBORDINATES_MAP,
    period: overrides.period ?? 'year',
    activeMonths: overrides.activeMonths ?? new Set<number>(),
    periodMode: overrides.periodMode ?? ('explicit' as PeriodMode),
    selectedMethods: overrides.selectedMethods ?? new Set<string>(),
    selectedActivities: new Set<string>(),
    selectedBudgets: overrides.selectedBudgets ?? new Set<string>(),
    activityFilter: 'all' as const,
    searchQuery: '',
    year: 2026,
    dataYear: 2026,
    loading: false,
  };
}

/** Инварианты одного периметра для произвольной комбинации фильтров. */
function checkOnePerimeter(fd: ReturnType<typeof computeFilteredData>, label: string) {
  const mdm = buildMultiDimMetricsFromFilteredData(fd);

  // I1: сумма частей (бары) = итог страницы
  const barPlan = fd.barData.reduce((s: number, b: any) => s + b.planTotal, 0);
  const barFact = fd.barData.reduce((s: number, b: any) => s + b.factTotal, 0);
  expect(barPlan, `${label}: Σ баров (план) ≠ итогу`).toBeCloseTo(fd.totalPlan, 6);
  expect(barFact, `${label}: Σ баров (факт) ≠ итогу`).toBeCloseTo(fd.totalFact, 6);

  // I2: узлы mdm (карточки управлений) в сумме = итог страницы
  const mdmPlan = mdm.departments.reduce((s, d) => s + d.total.planTotal, 0);
  const mdmFact = mdm.departments.reduce((s, d) => s + d.total.factTotal, 0);
  expect(mdmPlan, `${label}: Σ карточек (план) ≠ итогу`).toBeCloseTo(fd.totalPlan, 6);
  expect(mdmFact, `${label}: Σ карточек (факт) ≠ итогу`).toBeCloseTo(fd.totalFact, 6);

  // I3: экономия — один период у итога и карточек
  const mdmEco = mdm.departments.reduce((s, d) => s + d.total.economyTotal, 0);
  expect(mdm.totals.economyTotal, `${label}: экономия итога ≠ Σ карточек`).toBeCloseTo(mdmEco, 6);

  // I4: счётчики процедур согласованы
  const mdmPlanCount = mdm.departments.reduce((s, d) => s + d.total.planCount, 0);
  const mdmFactCount = mdm.departments.reduce((s, d) => s + d.total.factCount, 0);
  expect(mdmPlanCount, `${label}: Σ planCount ≠ итогу`).toBeCloseTo(fd.totalPlanCount, 6);
  expect(mdmFactCount, `${label}: Σ factCount ≠ итогу`).toBeCloseTo(fd.totalFactCount, 6);

  return mdm;
}

const perimeterOf = (fd: ReturnType<typeof computeFilteredData>) => ({
  totalPlan: fd.totalPlan,
  totalFact: fd.totalFact,
  totalKP: fd.totalKP,
  totalEP: fd.totalEP,
  totalPlanCount: fd.totalPlanCount,
  totalFactCount: fd.totalFactCount,
  totalEconomy: fd.totalEconomy,
  bars: fd.barData.map((b: any) => ({ id: b.id, planTotal: b.planTotal, factTotal: b.factTotal })),
});

describe('харнесс класса: один экран — один периметр', () => {
  // Матрица периодов, у каждого — ожидаемый итог (по построению фикстуры).
  const periodMatrix: Array<{
    label: string;
    inputs: ReturnType<typeof makeInputs>;
    expected: { plan: number; fact: number; economy: number };
  }> = [
    {
      label: 'год целиком',
      inputs: makeInputs({ period: 'year' }),
      expected: { plan: 6000, fact: 3000, economy: 240 },
    },
    {
      label: 'квартал q3 (period + месяцы, как ставит navigateTo)',
      inputs: makeInputs({ period: 'q3', activeMonths: new Set([7, 8, 9]) }),
      expected: { plan: 1800, fact: 900, economy: 72 },
    },
    {
      label: 'квартал q3 (только period)',
      inputs: makeInputs({ period: 'q3' }),
      expected: { plan: 1800, fact: 900, economy: 72 },
    },
    {
      label: 'один месяц (май = половина q2)',
      inputs: makeInputs({ activeMonths: new Set([5]) }),
      expected: { plan: 600, fact: 300, economy: 24 },
    },
    {
      label: 'месяцы+квартал (q1 полностью + июль)',
      inputs: makeInputs({ activeMonths: new Set([1, 2, 3, 7]) }),
      expected: { plan: 1500, fact: 750, economy: 60 },
    },
  ];

  for (const { label, inputs, expected } of periodMatrix) {
    it(`${label}: инварианты держатся и итог за период верен`, () => {
      const fd = computeFilteredData(inputs);
      checkOnePerimeter(fd, label);
      expect(fd.totalPlan, `${label}: план`).toBeCloseTo(expected.plan, 6);
      expect(fd.totalFact, `${label}: факт`).toBeCloseTo(expected.fact, 6);
      expect(fd.totalEconomy, `${label}: экономия`).toBeCloseTo(expected.economy, 6);
    });

    it(`${label} + подвед: срез подведа режется ТЕМ ЖЕ периодом (баг #4)`, () => {
      const fd = computeFilteredData({
        ...inputs,
        selectedSubordinates: new Set(['Школа №1']),
      });
      checkOnePerimeter(fd, `${label}+подвед`);
      // Подвед №1 — ровно 1/6 денег каждого периода двух управлений… нет:
      // его кварталы = 100i при 300i у управления и двух управлениях,
      // т.е. 1/6 общего плана периода.
      expect(fd.totalPlan, `${label}+подвед: план`).toBeCloseTo(expected.plan / 6, 6);
      expect(fd.totalFact, `${label}+подвед: факт`).toBeCloseTo(expected.fact / 6, 6);
    });
  }

  it('I5: week-режим с «месяцами недели» в состоянии = год (недельные месяцы — не фильтр, баг #5)', () => {
    const year = computeFilteredData(makeInputs({ period: 'year' }));
    // Легаси-писатель (клик по неделе) оставил месяц в activeMonths при week-режиме.
    const weekPolluted = computeFilteredData(makeInputs({
      period: 'year', periodMode: 'week', activeMonths: new Set([8]),
    }));
    expect(perimeterOf(weekPolluted)).toEqual(perimeterOf(year));
  });

  it('I5: после «сбросить период» (week + пусто) = год', () => {
    const year = computeFilteredData(makeInputs({ period: 'year' }));
    const cleared = computeFilteredData(makeInputs({ periodMode: 'week', activeMonths: new Set() }));
    expect(perimeterOf(cleared)).toEqual(perimeterOf(year));
  });

  it('I6: два способа выразить квартал (period против месяцев) — одни и те же числа', () => {
    const viaPeriod = computeFilteredData(makeInputs({ period: 'q3' }));
    const viaMonths = computeFilteredData(makeInputs({ period: 'q3', activeMonths: new Set([7, 8, 9]) }));
    expect(perimeterOf(viaMonths)).toEqual(perimeterOf(viaPeriod));
  });

  it('способ (только КП) + квартал: счётчики и деньги итога — КП за квартал', () => {
    const fd = computeFilteredData(makeInputs({
      period: 'q2', selectedMethods: new Set(['competitive']),
    }));
    expect(fd.totalKP).toBe(8);   // 2i·2 департамента, i=2
    expect(fd.totalEP).toBe(0);
    expect(fd.totalPlan).toBe(800);  // kpPlanTotal q2 × 2
    expect(fd.totalFact).toBe(400);
  });

  it('бюджет (ФБ) + месяц: план/факт и экономия — ФБ за месяц, не квартал и не год', () => {
    const fd = computeFilteredData(makeInputs({
      activeMonths: new Set([5]), selectedBudgets: new Set(['fb']),
    }));
    expect(fd.totalPlan).toBe(300);      // planFB мая (150) × 2 департамента
    expect(fd.totalFact).toBe(150);
    expect(fd.totalEconomy).toBe(12);    // economyFB мая (6) × 2 — не 24 за q2
  });

  it('подвед + квартал: числа регресса из реестра — квартал подведа, не его год', () => {
    // Прямой сценарий бага #4: под заголовком «III квартал» стояли годовые
    // числа подведа (1000/500). Должны стоять квартальные (300/150).
    const fd = computeFilteredData(makeInputs({
      period: 'q3', activeMonths: new Set([7, 8, 9]),
      selectedSubordinates: new Set(['Школа №1']),
    }));
    expect(fd.totalPlan).toBe(300);
    expect(fd.totalFact).toBe(150);
    expect(fd.totalPlan).not.toBe(1000); // год подведа — рецидив бага #4
  });
});
