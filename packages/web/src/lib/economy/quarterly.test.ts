import { describe, expect, it } from 'vitest';
import type { DepartmentSummary } from '@aemr/shared';
import { budgetSelection } from './budget';
import {
  buildDeptSparks, buildPerDeptQuarterly, buildQuarterlyTrend,
  economySpark, mergeTrendWithDepts, pctSpark, quarterDeltas,
} from './quarterly';

const noFilter = budgetSelection(new Set());

function summary(partial: Record<string, unknown>): DepartmentSummary {
  return partial as unknown as DepartmentSummary;
}

function dept(name: string, quarters: Record<string, unknown>): DepartmentSummary {
  return summary({ department: { nameShort: name, id: name.toLowerCase() }, quarters });
}

const q = (planTotal: number, economyTotal: number, extras: Record<string, number> = {}) =>
  ({ planTotal, economyTotal, ...extras });

describe('buildQuarterlyTrend', () => {
  it('всегда четыре точки Q1..Q4; отсутствующие кварталы — нули', () => {
    const trend = buildQuarterlyTrend([dept('УЭР', { q1: q(1000, 100, { economyFB: 60, economyKB: 30, economyMB: 10 }) })], noFilter);
    expect(trend.map(t => t.name)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(trend[0]).toEqual({ name: 'Q1', economy: 100, pct: 10, fb: 60, kb: 30, mb: 10 });
    expect(trend[3]).toEqual({ name: 'Q4', economy: 0, pct: 0, fb: 0, kb: 0, mb: 0 });
  });

  it('суммирует по всем ГРБС набора', () => {
    const trend = buildQuarterlyTrend([
      dept('УЭР', { q2: q(100, 10) }),
      dept('АГЗ', { q2: q(300, 30) }),
    ], noFilter);
    expect(trend[1].economy).toBe(40);
    expect(trend[1].pct).toBe(10);
  });

  it('бюджет-фильтр меняет economy/pct, но компоненты fb/kb/mb всегда полные', () => {
    const budgets = budgetSelection(new Set(['fb']));
    const trend = buildQuarterlyTrend([
      dept('УЭР', { q1: { planTotal: 1000, economyTotal: 100, planFB: 600, economyFB: 60, planKB: 400, economyKB: 40 } }),
    ], budgets);
    expect(trend[0].economy).toBe(60);
    expect(trend[0].pct).toBe(10); // 60/600
    expect(trend[0].fb).toBe(60);
    expect(trend[0].kb).toBe(40); // компонента для стека не фильтруется
  });
});

describe('economySpark / pctSpark', () => {
  it('деривятся из тренда; pct округлён до 0.1', () => {
    const trend = buildQuarterlyTrend([dept('УЭР', { q1: q(300, 10) })], noFilter);
    expect(economySpark(trend)).toEqual([10, 0, 0, 0]);
    expect(pctSpark(trend)).toEqual([3.3, 0, 0, 0]); // 10/300 = 3.333…
  });
});

describe('buildPerDeptQuarterly', () => {
  const two = [dept('УЭР', { q1: q(100, 10) }), dept('АГЗ', { q1: q(100, 20) })];

  it('null при одном ГРБС и при более чем шести', () => {
    expect(buildPerDeptQuarterly([two[0]], noFilter)).toBeNull();
    const seven = Array.from({ length: 7 }, (_, i) => dept(`Д${i}`, {}));
    expect(buildPerDeptQuarterly(seven, noFilter)).toBeNull();
  });

  it('серии по кварталам с уникальными цветами', () => {
    const series = buildPerDeptQuarterly(two, noFilter)!;
    expect(series.map(s => s.id)).toEqual(['УЭР', 'АГЗ']);
    expect(series[0].data).toEqual([10, 0, 0, 0]);
    expect(series[1].data).toEqual([20, 0, 0, 0]);
    expect(series[0].color).not.toBe(series[1].color);
  });
});

describe('mergeTrendWithDepts', () => {
  it('без оверлея — точки тренда как есть', () => {
    const trend = buildQuarterlyTrend([dept('УЭР', { q1: q(100, 10) })], noFilter);
    const merged = mergeTrendWithDepts(trend, null);
    expect(merged).toEqual(trend);
  });

  it('дописывает поле-линию каждого ГРБС в каждую точку', () => {
    const two = [dept('УЭР', { q1: q(100, 10) }), dept('АГЗ', { q2: q(100, 20) })];
    const trend = buildQuarterlyTrend(two, noFilter);
    const merged = mergeTrendWithDepts(trend, buildPerDeptQuarterly(two, noFilter));
    expect(merged[0]['УЭР']).toBe(10);
    expect(merged[0]['АГЗ']).toBe(0);
    expect(merged[1]['АГЗ']).toBe(20);
  });
});

describe('buildDeptSparks', () => {
  it('квартальные ряды по ключу ГРБС', () => {
    const sparks = buildDeptSparks([dept('УЭР', { q1: q(100, 10), q3: q(100, 30) })], noFilter);
    expect(sparks['УЭР']).toEqual([10, 0, 30, 0]);
  });
});

describe('quarterDeltas', () => {
  it('последний ненулевой квартал против предыдущего', () => {
    const d = quarterDeltas([10, 25, 40, 0], [1, 2.5, 4, 0]);
    expect(d).toEqual({ economy: 15, pct: 1.5, label: 'Q3 vs Q2' });
  });

  it('нет данных или только Q1 — нулевые дельты без подписи', () => {
    expect(quarterDeltas([0, 0, 0, 0], [0, 0, 0, 0])).toEqual({ economy: 0, pct: 0, label: '' });
    expect(quarterDeltas([10, 0, 0, 0], [1, 0, 0, 0])).toEqual({ economy: 0, pct: 0, label: '' });
  });
});
