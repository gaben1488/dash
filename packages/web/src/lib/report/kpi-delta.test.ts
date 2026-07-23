/**
 * Юниты маршрутизации «дельта слепков → KPI-плитка» (R1-хвост, ярус 1).
 *
 * Честность источников: плитки отчёта считаются из строк-атомов (calc),
 * а дельта недели — по слепкам metric_history, где живут только официальные
 * ячейки СВОДа. Бейдж разрешён лишь плитке, у которой есть однозначный
 * официальный аналог той же семантики; нет аналога — нет и бейджа.
 */
import { describe, it, expect } from 'vitest';
import { getMetricByKey } from '@aemr/shared';
import type { MetricDelta } from '@aemr/core';
import { kpiDeltaFor, officialAnalogKey } from './kpi-delta';

/** Минимальная дельта слепков с нужным ключом. */
function delta(metricKey: string): MetricDelta {
  return {
    metricKey,
    from: { value: 40, at: '2026-07-16T04:00:00.000Z' },
    to: { value: 42, at: '2026-07-23T04:00:00.000Z' },
    deltaAbs: 2,
    deltaPct: 0.05,
    direction: 'up',
    sentiment: 'good',
  };
}

describe('officialAnalogKey — официальный аналог плитки в слое слепков', () => {
  it('исполнение КП/ЕП: аналог — колонка G районных строк СВОДа (год и Q1)', () => {
    expect(officialAnalogKey('comp_exec_count_pct', 'year')).toBe('competitive.year.percent');
    expect(officialAnalogKey('ep_exec_count_pct', 'year')).toBe('sole.year.percent');
    expect(officialAnalogKey('comp_exec_count_pct', 1)).toBe('competitive.q1.percent');
    expect(officialAnalogKey('ep_exec_count_pct', 1)).toBe('sole.q1.percent');
  });

  it('кварталы Q2–Q4: районных строк в СВОДе нет — аналога нет', () => {
    expect(officialAnalogKey('comp_exec_count_pct', 2)).toBeUndefined();
    expect(officialAnalogKey('ep_exec_count_pct', 3)).toBeUndefined();
    expect(officialAnalogKey('comp_exec_count_pct', 4)).toBeUndefined();
  });

  it('суммы КП+ЕП (итого-счётчики и деньги) — одной официальной ячейки нет', () => {
    const totals = ['plan_count', 'fact_count', 'exec_count_pct', 'plan_total', 'fact_total', 'economy_total'];
    for (const key of totals) {
      expect(officialAnalogKey(key, 'year')).toBeUndefined();
      expect(officialAnalogKey(key, 1)).toBeUndefined();
    }
  });

  it('каждый выданный аналог существует в REPORT_MAP (ключ не выдуман)', () => {
    const keys = [
      officialAnalogKey('comp_exec_count_pct', 'year'),
      officialAnalogKey('ep_exec_count_pct', 'year'),
      officialAnalogKey('comp_exec_count_pct', 1),
      officialAnalogKey('ep_exec_count_pct', 1),
    ];
    for (const key of keys) {
      expect(key).toBeDefined();
      expect(getMetricByKey(key!)).toBeDefined();
    }
  });
});

describe('kpiDeltaFor — выбор дельты для плитки из diff слепков', () => {
  const deltas = [delta('competitive.year.percent'), delta('sole.q1.percent'), delta('grbs.uer.kp.q1.count')];

  it('точное соответствие: у плитки есть аналог, и он есть в diff', () => {
    const found = kpiDeltaFor({ officialKey: 'competitive.year.percent' }, deltas);
    expect(found).toBe(deltas[0]);
  });

  it('отсутствие аналога: плитка без officialKey — без дельты, даже при богатом diff', () => {
    expect(kpiDeltaFor({}, deltas)).toBeUndefined();
  });

  it('пустой diff: дельты нет даже у плитки с аналогом', () => {
    expect(kpiDeltaFor({ officialKey: 'competitive.year.percent' }, [])).toBeUndefined();
  });

  it('аналог есть, но в diff такого ключа нет — без дельты', () => {
    expect(kpiDeltaFor({ officialKey: 'competitive.q1.percent' }, deltas)).toBeUndefined();
  });
});
