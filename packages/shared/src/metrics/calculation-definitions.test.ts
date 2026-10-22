import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS } from '../column-map.js';
import { METRIC_KB, metricSpecification } from './registry.js';
import { EXECUTABLE_METRICS, STANDARD_DERIVED, STANDARD_METRICS,
  metricDependencies } from './calculation-definitions.js';

const all = [...STANDARD_METRICS, ...STANDARD_DERIVED];

describe('single executable metric catalog', () => {
  it('has unique keys and the KB / lineage tied to each executable definition', () => {
    expect(new Set(all.map(d => d.key)).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(30);
    for (const definition of all) {
      const spec = metricSpecification(definition.key);
      expect(spec?.executable).toBe(definition);
      expect(spec?.documentation?.label).toBe(definition.label);
      expect(spec?.documentation?.unit).toBe(definition.unit);
      expect(spec?.lineage, `no documentary origin for ${definition.key}`).toBeDefined();
    }
  });

  it('resolves all formula operands from the same executable graph without cycles', () => {
    const visited = new Set<string>();
    const active = new Set<string>();
    function walk(key: string): void {
      expect(EXECUTABLE_METRICS.has(key), `missing executable operand ${key}`).toBe(true);
      if (visited.has(key)) return;
      expect(active.has(key), `circular metric dependency ${key}`).toBe(false);
      active.add(key);
      const d = EXECUTABLE_METRICS.get(key)!;
      if ('formula' in d) {
        for (const dependency of metricDependencies(d)) walk(dependency);
        expect(metricSpecification(key)?.dependencies).toEqual(metricDependencies(d));
      }
      active.delete(key); visited.add(key);
    }
    for (const d of all) walk(d.key);
    expect(visited.size).toBe(all.length);
  });

  it('preserves source-of-truth semantics: AD-gated economy and signed deviations', () => {
    for (const key of ['economy_fb', 'economy_kb', 'economy_mb']) {
      const def = STANDARD_METRICS.find(d => d.key === key)!;
      expect(def.gates).toEqual(expect.arrayContaining([
        { column: DEPT_COLUMNS.FACT_DATE, op: 'notEmpty' },
        { column: DEPT_COLUMNS.FLAG, op: 'eq', value: 'да' },
      ]));
    }
    expect(STANDARD_DERIVED.find(d => d.key === 'amount_deviation')?.formula)
      .toEqual({ op: 'diff', a: 'fact_total', b: 'plan_total' });
    expect(STANDARD_DERIVED.find(d => d.key === 'exec_count_pct')?.formula)
      .toEqual({ op: 'pct', numerator: 'fact_count', denominator: 'plan_count' });
    expect(METRIC_KB.savings_pct.whatIs).not.toMatch(/экономия \(сумма\)/i);
  });

  it('makes documented-only metrics explicit instead of inventing a CalcEngine formula', () => {
    const spec = metricSpecification('api_read_available');
    expect(spec?.documentation).toBeTruthy();
    expect(spec?.executable).toBeNull();
    expect(spec?.dependencies).toEqual([]);
    expect(metricSpecification('not_a_metric')).toBeNull();
  });
});
