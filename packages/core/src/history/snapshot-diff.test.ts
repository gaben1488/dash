import { describe, it, expect } from 'vitest';
import { diffMetrics, sentimentFor, type MetricRow } from './snapshot-diff.js';

describe('diffMetrics', () => {
  const from: MetricRow[] = [
    { metricKey: 'sole.year.share', numericValue: 0.5039, at: '2026-05-29' },
    { metricKey: 'economy.year.total', numericValue: 33503, at: '2026-05-29' },
    { metricKey: 'gone.metric', numericValue: 10, at: '2026-05-29' },
  ];
  const to: MetricRow[] = [
    { metricKey: 'sole.year.share', numericValue: 0.5406, at: '2026-06-05' },
    { metricKey: 'economy.year.total', numericValue: 52781, at: '2026-06-05' },
    { metricKey: 'new.metric', numericValue: 5, at: '2026-06-05' },
  ];

  it('считает дельту, направление и сентимент', () => {
    const map = Object.fromEntries(diffMetrics(from, to).map((d) => [d.metricKey, d]));
    expect(map['sole.year.share'].deltaAbs).toBeCloseTo(0.0367, 4);
    expect(map['sole.year.share'].direction).toBe('up');
    expect(map['sole.year.share'].sentiment).toBe('bad'); // рост доли ЕП = внимание
    expect(map['economy.year.total'].direction).toBe('up');
    expect(map['economy.year.total'].sentiment).toBe('good'); // рост экономии = хорошо
  });

  it('появление/исчезновение метрики не даёт NaN', () => {
    const map = Object.fromEntries(diffMetrics(from, to).map((d) => [d.metricKey, d]));
    expect(map['gone.metric'].direction).toBe('disappeared');
    expect(map['new.metric'].direction).toBe('appeared');
    expect(Number.isNaN(map['new.metric'].deltaPct as number)).toBe(false);
  });

  it('sentimentFor: flat = neutral', () => {
    expect(sentimentFor('economy.year.total', 'flat')).toBe('neutral');
  });

  it('сортирует по убыванию |deltaAbs|', () => {
    const out = diffMetrics(from, to);
    const abs = out.map((d) => Math.abs(d.deltaAbs ?? 0));
    expect(abs).toEqual([...abs].sort((a, b) => b - a));
  });
});
