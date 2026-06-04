import { describe, it, expect } from 'vitest';
import { buildSvodView, hasSvodData, type SvodMetricsMap } from './svod-view.js';

/** Хелпер: метрика из числа. */
function m(n: number): { numericValue: number } {
  return { numericValue: n };
}

/**
 * Синтетическая карta officialMetrics в БОЕВОЙ схеме ключей (REPORT_MAP):
 * свод использует суффикс `fact_count` для E, департамент — `fact`.
 */
const MAP: SvodMetricsMap = {
  // Сводный КП (competitive) — год
  'competitive.year.count': m(100),
  'competitive.year.fact_count': m(80),
  'competitive.year.total_plan': m(10_000),
  'competitive.year.total_fact': m(7_000),
  'competitive.year.economy_total': m(500),
  // Сводный ЕП (sole) — год
  'sole.year.count': m(40),
  'sole.year.fact_count': m(30),
  'sole.year.total_plan': m(4_000),
  'sole.year.total_fact': m(3_000),
  'sole.year.economy_total': m(100),
  // Департамент УЭР, КП — год (суффикс E = `fact`)
  'grbs.uer.kp.year.count': m(12),
  'grbs.uer.kp.year.fact': m(9),
  'grbs.uer.kp.year.total_plan': m(1_200),
  'grbs.uer.kp.year.total_fact': m(800),
  // Департамент УЭР, ЕП — год
  'grbs.uer.ep.year.count': m(5),
  'grbs.uer.ep.year.fact': m(4),
  'grbs.uer.ep.year.total_plan': m(500),
  'grbs.uer.ep.year.total_fact': m(450),
};

describe('buildSvodView', () => {
  it('читает сводные КП/ЕП из ключей competitive/sole (E через fact_count)', () => {
    const v = buildSvodView(MAP);
    expect(v.summary.kp.year.planCount).toBe(100);
    expect(v.summary.kp.year.factCount).toBe(80);
    expect(v.summary.ep.year.planCount).toBe(40);
    expect(v.summary.ep.year.factCount).toBe(30);
  });

  it('ИТОГО = КП + ЕП: суммы складываются, исполнение пересчитано (E/D по штукам)', () => {
    const t = buildSvodView(MAP).summary.total.year;
    expect(t.planCount).toBe(140); // 100 + 40
    expect(t.factCount).toBe(110); // 80 + 30
    expect(t.planTotal).toBe(14_000); // 10000 + 4000
    expect(t.factTotal).toBe(10_000); // 7000 + 3000
    expect(t.executionPct).toBeCloseTo(110 / 140, 6);
    expect(t.economyTotal).toBe(600); // 500 + 100
  });

  it('читает блок департамента (E через суффикс fact) и считает его ИТОГО', () => {
    const uer = buildSvodView(MAP).departments.find((d) => d.id === 'uer');
    expect(uer).toBeDefined();
    expect(uer!.block.kp.year.planCount).toBe(12);
    expect(uer!.block.kp.year.factCount).toBe(9);
    expect(uer!.block.total.year.planCount).toBe(17); // 12 + 5
    expect(uer!.block.total.year.factCount).toBe(13); // 9 + 4
    expect(uer!.block.total.year.executionPct).toBeCloseTo(13 / 17, 6);
  });

  it('возвращает все 8 ГРБС; отсутствующие ячейки → null', () => {
    const v = buildSvodView(MAP);
    expect(v.departments).toHaveLength(8);
    const uio = v.departments.find((d) => d.id === 'uio');
    expect(uio).toBeDefined();
    expect(uio!.block.kp.year.planCount).toBeNull();
    expect(uio!.block.total.year.executionPct).toBeNull(); // нет плана → нет %
  });

  it('hasSvodData распознаёт наличие данных', () => {
    expect(hasSvodData(MAP)).toBe(true);
    expect(hasSvodData({})).toBe(false);
    expect(hasSvodData(null)).toBe(false);
    expect(hasSvodData(undefined)).toBe(false);
  });
});
