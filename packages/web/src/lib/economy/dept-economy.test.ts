import { describe, expect, it } from 'vitest';
import type { DepartmentSummary } from '@aemr/shared';
import { budgetSelection } from './budget';
import {
  buildBarChartData, buildDeptEconomy, computeEconomyTotals,
  deptKeyOf, flattenSubordinates, sortDeptEconomy,
} from './dept-economy';
import { ORG_ITSELF } from './types';

const noFilter = budgetSelection(new Set());
const none = new Set<string>();

/** Минимальный DepartmentSummary для билдера (остальные поля не читаются). */
function summary(partial: Record<string, unknown>): DepartmentSummary {
  return partial as unknown as DepartmentSummary;
}

function uer(extra: Record<string, unknown> = {}): DepartmentSummary {
  return summary({
    department: { nameShort: 'УЭР', id: 'uer' },
    planTotal: 1000, factTotal: 900, economyTotal: 100,
    quarters: {
      year: {
        planTotal: 1000, factTotal: 900, economyTotal: 100,
        planFB: 600, planKB: 300, planMB: 100,
        factFB: 540, factKB: 270, factMB: 90,
        economyFB: 60, economyKB: 30, economyMB: 10,
      },
    },
    subordinates: [
      { name: ORG_ITSELF, planTotal: 0, factTotal: 0, economyTotal: 0 },
      { name: 'Школа 1', planTotal: 400, factTotal: 350, economyTotal: 50, economyFB: 50 },
      { name: 'Пустой', planTotal: 0, factTotal: 0, economyTotal: 0 },
      { name: 'Сад 2', planTotal: 100, factTotal: 20, economyTotal: 80 },
    ],
    ...extra,
  });
}

describe('deptKeyOf', () => {
  it('nameShort → id → "?"', () => {
    expect(deptKeyOf(summary({ department: { nameShort: 'УЭР', id: 'uer' } }))).toBe('УЭР');
    expect(deptKeyOf(summary({ department: { id: 'uer' } }))).toBe('uer');
    expect(deptKeyOf(summary({}))).toBe('?');
  });
});

describe('buildDeptEconomy', () => {
  it('пустой вход → пустой выход', () => {
    expect(buildDeptEconomy({ summaries: [], periodKey: 'year', budgets: noFilter, deptOnlyMode: none })).toEqual([]);
  });

  it('без фильтра берёт официальные totals квартала', () => {
    const [d] = buildDeptEconomy({ summaries: [uer()], periodKey: 'year', budgets: noFilter, deptOnlyMode: none });
    expect(d.dept).toBe('УЭР');
    expect(d.limit).toBe(1000);
    expect(d.price).toBe(900);
    expect(d.economy).toBe(100);
    expect(d.pct).toBe(10);
    expect(d.highEconomy).toBe(false);
    expect(d.economyOfficial).toBe(100);
  });

  it('нет квартального среза → фолбэк на годовые totals самого ГРБС', () => {
    const [d] = buildDeptEconomy({ summaries: [uer()], periodKey: 'q3', budgets: noFilter, deptOnlyMode: none });
    expect(d.limit).toBe(1000);
    expect(d.economy).toBe(100);
    // бюджетная разбивка отсутствующего квартала — нули
    expect(d.budget.economyFB).toBe(0);
  });

  it('бюджет-фильтр суммирует только выбранные компоненты (лимит/факт/экономия)', () => {
    const budgets = budgetSelection(new Set(['fb', 'kb']));
    const [d] = buildDeptEconomy({ summaries: [uer()], periodKey: 'year', budgets, deptOnlyMode: none });
    expect(d.limit).toBe(900);   // 600+300
    expect(d.price).toBe(810);   // 540+270
    expect(d.economy).toBe(90);  // 60+30
    expect(d.pct).toBeCloseTo(10);
  });

  it('highEconomy при pct > 25', () => {
    const s = uer({ quarters: { year: { planTotal: 100, factTotal: 70, economyTotal: 30 } } });
    const [d] = buildDeptEconomy({ summaries: [s], periodKey: 'year', budgets: noFilter, deptOnlyMode: none });
    expect(d.pct).toBe(30);
    expect(d.highEconomy).toBe(true);
  });

  it('подведы: держит нулевой ORG_ITSELF, режет нулевые прочие, сортирует по экономии', () => {
    const [d] = buildDeptEconomy({ summaries: [uer()], periodKey: 'year', budgets: noFilter, deptOnlyMode: none });
    expect(d.subordinates.map(s => s.name)).toEqual(['Сад 2', 'Школа 1', ORG_ITSELF]);
    expect(d.realSubCount).toBe(2);
    const school = d.subordinates.find(s => s.name === 'Школа 1')!;
    expect(school.pct).toBe(12.5); // 50/400
    expect(school.budget.economyFB).toBe(50);
  });

  it('deptOnly-режим: подведы не строятся вовсе и это помечено флагом', () => {
    const [d] = buildDeptEconomy({ summaries: [uer()], periodKey: 'year', budgets: noFilter, deptOnlyMode: new Set(['УЭР']) });
    expect(d.subordinates).toEqual([]);
    expect(d.realSubCount).toBe(0);
    // Флаг отличает «подведов нет» от «подведы скрыты фильтром».
    expect(d.deptOnly).toBe(true);
    expect(buildDeptEconomy({ summaries: [uer()], periodKey: 'year', budgets: noFilter, deptOnlyMode: none })[0].deptOnly).toBe(false);
  });

  it('нет лимита → доля null, а не ноль (нулевой знаменатель — не ноль)', () => {
    const s = uer({ planTotal: 0, economyTotal: 40, quarters: { year: { planTotal: 0, factTotal: 0, economyTotal: 40 } } });
    const [d] = buildDeptEconomy({ summaries: [s], periodKey: 'year', budgets: noFilter, deptOnlyMode: none });
    expect(d.limit).toBe(0);
    expect(d.economy).toBe(40);
    expect(d.pct).toBeNull();
    expect(d.highEconomy).toBe(false); // без доли порог 25 % неприменим
  });

  it('конфликты: economyConflicts → signalCounts.economyConflict → 0', () => {
    const b = { summaries: [uer({ economyConflicts: 5 })], periodKey: 'year', budgets: noFilter, deptOnlyMode: none };
    expect(buildDeptEconomy(b)[0].conflicts).toBe(5);
    const viaSignals = uer({ signalCounts: { economyConflict: 3 } });
    expect(buildDeptEconomy({ ...b, summaries: [viaSignals] })[0].conflicts).toBe(3);
    expect(buildDeptEconomy({ ...b, summaries: [uer()] })[0].conflicts).toBe(0);
  });

  it('economyOfficial null, когда официального итога нет', () => {
    const s = uer({ economyTotal: null });
    const [d] = buildDeptEconomy({ summaries: [s], periodKey: 'year', budgets: noFilter, deptOnlyMode: none });
    expect(d.economyOfficial).toBeNull();
  });
});

function rows() {
  const a = uer();
  const b = summary({
    department: { nameShort: 'АГЗ', id: 'agz' },
    planTotal: 500, factTotal: 480, economyTotal: 20, economyConflicts: 2,
    quarters: {}, subordinates: [],
  });
  return buildDeptEconomy({ summaries: [a, b], periodKey: 'year', budgets: noFilter, deptOnlyMode: none });
}

describe('sortDeptEconomy', () => {
  it('сортирует по полю и направлению, не мутируя вход', () => {
    const input = rows();
    const desc = sortDeptEconomy(input, 'economy', 'desc');
    expect(desc.map(d => d.dept)).toEqual(['УЭР', 'АГЗ']);
    const asc = sortDeptEconomy(input, 'economy', 'asc');
    expect(asc.map(d => d.dept)).toEqual(['АГЗ', 'УЭР']);
    expect(input.map(d => d.dept)).toEqual(['УЭР', 'АГЗ']); // порядок входа не тронут
  });

  it('dept — локале-сравнение по-русски', () => {
    expect(sortDeptEconomy(rows(), 'dept', 'asc').map(d => d.dept)).toEqual(['АГЗ', 'УЭР']);
  });

  it('conflicts и subCount', () => {
    expect(sortDeptEconomy(rows(), 'conflicts', 'desc')[0].dept).toBe('АГЗ');
    expect(sortDeptEconomy(rows(), 'subCount', 'desc')[0].dept).toBe('УЭР');
  });

  it('строки без доли уходят вниз в обе стороны', () => {
    const noPlan = summary({
      department: { nameShort: 'БЕЗПЛАНА', id: 'np' },
      planTotal: 0, factTotal: 0, economyTotal: 5,
      quarters: {}, subordinates: [],
    });
    const input = buildDeptEconomy({
      summaries: [noPlan, ...([uer()])], periodKey: 'year', budgets: noFilter, deptOnlyMode: none,
    });
    expect(sortDeptEconomy(input, 'pct', 'desc').at(-1)!.dept).toBe('БЕЗПЛАНА');
    expect(sortDeptEconomy(input, 'pct', 'asc').at(-1)!.dept).toBe('БЕЗПЛАНА');
  });
});

describe('flattenSubordinates', () => {
  it('без ORG_ITSELF, с привязкой к ГРБС, по экономии убыв.', () => {
    const flat = flattenSubordinates(rows());
    expect(flat.map(s => s.name)).toEqual(['Сад 2', 'Школа 1']);
    expect(flat[0].deptName).toBe('УЭР');
    expect(flat[0].deptId).toBe('УЭР');
  });
});

describe('computeEconomyTotals', () => {
  it('пустой набор → нули по суммам и «нет значения» по долям', () => {
    const t = computeEconomyTotals([]);
    expect(t.economy).toBe(0);
    expect(t.share).toBeNull();
    expect(t.avgPct).toBeNull();
    expect(t.pctMin).toBeNull();
    expect(t.pctMax).toBeNull();
    expect(t.ratedCount).toBe(0);
  });

  it('агрегаты по набору', () => {
    const t = computeEconomyTotals(rows());
    expect(t.economy).toBe(120);
    expect(t.plan).toBe(1500);
    expect(t.fact).toBe(1380);
    expect(t.avgPct).toBeCloseTo((10 + 4) / 2);
    expect(t.ratedCount).toBe(2);
    expect(t.pctMin).toBe(4);
    expect(t.pctMax).toBe(10);
    expect(t.highCount).toBe(0);
    expect(t.conflicts).toBe(2);
    expect(t.subCount).toBe(2);
    expect(t.deptOnlyCount).toBe(0);
    expect(t.fbEco).toBe(60);
    expect(t.kbEco).toBe(30);
    expect(t.mbEco).toBe(10);
  });

  it('доля района взвешена объёмом и НЕ равна среднему по управлениям', () => {
    // Крупное управление сэкономило 10 % от 1000, мелкое — 4 % от 500.
    // Доля района = 120/1500 = 8 %, среднее по управлениям = 7 %.
    // Пока это разные числа, подписывать среднее «долей района» нельзя.
    const t = computeEconomyTotals(rows());
    expect(t.share).toBeCloseTo(8);
    expect(t.avgPct).toBeCloseTo(7);
    expect(t.share).not.toBeCloseTo(t.avgPct!);
  });

  it('управления без лимита не попадают в среднее и не обнуляют его', () => {
    const noPlan = summary({
      department: { nameShort: 'БЕЗПЛАНА', id: 'np' },
      planTotal: 0, factTotal: 0, economyTotal: 0,
      quarters: {}, subordinates: [],
    });
    const t = computeEconomyTotals(buildDeptEconomy({
      summaries: [uer(), noPlan], periodKey: 'year', budgets: noFilter, deptOnlyMode: none,
    }));
    expect(t.ratedCount).toBe(1);
    expect(t.avgPct).toBeCloseTo(10);
    expect(t.pctMin).toBe(10);
  });

  it('считает управления в режиме «только само управление»', () => {
    const t = computeEconomyTotals(buildDeptEconomy({
      summaries: [uer()], periodKey: 'year', budgets: noFilter, deptOnlyMode: new Set(['УЭР']),
    }));
    expect(t.deptOnlyCount).toBe(1);
    expect(t.subCount).toBe(0);
  });
});

describe('buildBarChartData', () => {
  it('разрез «само/подведы» + топ-3 подведа', () => {
    const [d] = buildBarChartData(rows());
    expect(d.name).toBe('УЭР');
    expect(d.total).toBe(100);
    expect(d.ownEco).toBe(0);       // ORG_ITSELF нулевой
    expect(d.subsEco).toBe(130);    // 80 + 50
    expect(d.subCount).toBe(2);
    expect(d.topSubs).toEqual([
      { name: 'Сад 2', eco: 80 },
      { name: 'Школа 1', eco: 50 },
    ]);
  });
});
