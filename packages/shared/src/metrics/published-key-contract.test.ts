import { describe, expect, it } from 'vitest';
import { resolvePublishedMetricKey } from './published-key-contract.js';

describe('the only published metric key adapter', () => {
  it('keeps old public IDs but resolves a single executable definition', () => {
    expect(resolvePublishedMetricKey('grbs.uo.kp.q1.count')).toEqual({
      publishedKey: 'grbs.uo.kp.q1.count',
      definitionKey: 'plan_count', grain: 'department_sheet_row',
      departmentId: 'uo', method: 'competitive', period: 'q1',
    });
    expect(resolvePublishedMetricKey('grbs.uo.ep.m12.total_fact')).toMatchObject({
      definitionKey: 'fact_total', departmentId: 'uo', method: 'ep', period: 'm12',
    });
    expect(resolvePublishedMetricKey('grbs.uo.ep.percent')).toMatchObject({
      definitionKey: 'share_ep_money', departmentId: 'uo', method: null, period: 'year',
    });
    expect(resolvePublishedMetricKey('grbs.uo.year.exec_count_pct')).toMatchObject({
      definitionKey: 'exec_count_pct', method: null, period: 'year',
    });
    expect(resolvePublishedMetricKey('sole.year.amount_dev')).toMatchObject({
      definitionKey: 'amount_deviation', method: 'ep', departmentId: null, period: 'year',
    });
    expect(resolvePublishedMetricKey('competitive.m1.fact_count')).toMatchObject({
      definitionKey: 'fact_count', method: 'competitive', period: 'm1',
    });
  });

  it('does not invent formulas for unknown or diagnostic-only legacy identifiers', () => {
    for (const key of ['grbs.uo.ep.total', 'grbs.uo.economy.math',
      'grbs.uo.kp.q1.magic', 'grbs.uo.kp.q0.count',
      'other.year.count', 'grbs.uo.kp.m13.count']) {
      expect(resolvePublishedMetricKey(key), key).toBeNull();
    }
  });
});
