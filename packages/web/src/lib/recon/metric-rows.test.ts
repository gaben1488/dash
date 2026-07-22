// Юниты lib/recon/metric-rows — маппинг дельт API в строки «По метрикам»,
// оценка ok/warning/critical, ГРБС-фильтр по паттерну ключа, счёты для бейджей.
import { describe, expect, it } from 'vitest';
import { buildMetricRows, countMetricAssessments, deriveAssessment, filterActiveMetricRows } from './metric-rows';
import type { MetricReconRow, ReconMetricDelta } from './types';

function makeDelta(overrides: Partial<ReconMetricDelta> = {}): ReconMetricDelta {
  return {
    metricKey: 'totals.planTotal',
    label: 'План, итого',
    officialValue: 100,
    calculatedValue: 100,
    delta: 0,
    deltaPercent: 0,
    withinTolerance: true,
    explanation: '',
    ...overrides,
  };
}

function makeRow(overrides: Partial<MetricReconRow> = {}): MetricReconRow {
  return {
    metric: 'totals.planTotal',
    metricLabel: 'План, итого',
    official: 100,
    calculated: 100,
    deltaAbs: 0,
    deltaPct: 0,
    assessment: 'ok',
    ...overrides,
  };
}

describe('deriveAssessment', () => {
  it('в допуске → ok независимо от Δ%', () => {
    expect(deriveAssessment(true, 99)).toBe('ok');
    expect(deriveAssessment(true, null)).toBe('ok');
  });

  it('вне допуска: |Δ%| > 5 → critical, иначе warning', () => {
    expect(deriveAssessment(false, 5.1)).toBe('critical');
    expect(deriveAssessment(false, -12)).toBe('critical');
    expect(deriveAssessment(false, 5)).toBe('warning');
    expect(deriveAssessment(false, 0.5)).toBe('warning');
  });

  it('вне допуска без Δ% (null) → warning, не падает', () => {
    expect(deriveAssessment(false, null)).toBe('warning');
  });
});

describe('buildMetricRows', () => {
  it('дельта без обоих значений отбрасывается', () => {
    expect(buildMetricRows([makeDelta({ officialValue: null, calculatedValue: null })])).toEqual([]);
  });

  it('одностороннее значение сохраняется, отсутствующая сторона = 0', () => {
    const [row] = buildMetricRows([makeDelta({ officialValue: null, calculatedValue: 40, deltaPercent: null })]);
    expect(row.official).toBe(0);
    expect(row.calculated).toBe(40);
    expect(row.deltaAbs).toBe(40);
    expect(row.deltaPct).toBe(0); // official = 0 → Δ% не считается
  });

  it('Δ% берётся из API по модулю, при null — считается от official', () => {
    const [fromApi] = buildMetricRows([makeDelta({ deltaPercent: -7.5 })]);
    expect(fromApi.deltaPct).toBe(7.5);
    const [computed] = buildMetricRows([makeDelta({ officialValue: 200, calculatedValue: 150, deltaPercent: null })]);
    expect(computed.deltaAbs).toBe(50);
    expect(computed.deltaPct).toBe(25);
  });

  it('метка: label из API, при отсутствии — по словарю продуктов', () => {
    const [row] = buildMetricRows([makeDelta({ label: 'Своя метка' })]);
    expect(row.metricLabel).toBe('Своя метка');
    const [fallback] = buildMetricRows([makeDelta({ label: undefined as unknown as string, metricKey: 'unknown.key' })]);
    expect(fallback.metricLabel).toBe('unknown.key'); // словарь не знает ключ → честно показываем ключ
  });
});

describe('filterActiveMetricRows', () => {
  const none: ReadonlySet<string> = new Set();

  it('пустая метрика (обе величины 0) отбрасывается всегда', () => {
    const rows = [makeRow({ official: 0, calculated: 0 })];
    expect(filterActiveMetricRows(rows, none)).toEqual([]);
    expect(filterActiveMetricRows(rows, new Set(['УЭР']))).toEqual([]);
  });

  it('пустой выбор ГРБС → проходят все непустые', () => {
    expect(filterActiveMetricRows([makeRow()], none)).toHaveLength(1);
  });

  it('grbs-метрика фильтруется по кириллическому имени ГРБС из канона', () => {
    const uer = makeRow({ metric: 'grbs.uer.planTotal' });
    const uo = makeRow({ metric: 'grbs.uo.planTotal' });
    const picked = filterActiveMetricRows([uer, uo], new Set(['УЭР']));
    expect(picked).toEqual([uer]);
  });

  it('метрика без grbs-паттерна и неизвестный id проходят всегда', () => {
    const total = makeRow({ metric: 'totals.planTotal' });
    const ghost = makeRow({ metric: 'grbs.nosuch.planTotal' });
    expect(filterActiveMetricRows([total, ghost], new Set(['УЭР']))).toEqual([total, ghost]);
  });
});

describe('countMetricAssessments', () => {
  it('считает строки по каждой оценке', () => {
    const rows = [
      makeRow({ assessment: 'ok' }),
      makeRow({ assessment: 'ok' }),
      makeRow({ assessment: 'warning' }),
      makeRow({ assessment: 'critical' }),
    ];
    expect(countMetricAssessments(rows)).toEqual({ ok: 2, warning: 1, critical: 1 });
    expect(countMetricAssessments([])).toEqual({ ok: 0, warning: 0, critical: 0 });
  });
});
