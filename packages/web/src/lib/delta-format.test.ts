import { describe, it, expect } from 'vitest';
import type { MetricDelta } from '@aemr/core';
import { formatDelta } from './delta-format';

const base: MetricDelta = {
  metricKey: 'sole.year.share',
  from: { value: 0.5039, at: '2026-05-29T00:00:00Z' },
  to: { value: 0.5406, at: '2026-06-05T00:00:00Z' },
  deltaAbs: 0.0367,
  deltaPct: 0.0728,
  direction: 'up',
  sentiment: 'bad',
};
const mk = (over: Partial<MetricDelta>): MetricDelta => ({ ...base, ...over });

describe('formatDelta', () => {
  it('рост → ▲, процент по модулю, tone из сентимента', () => {
    const v = formatDelta(mk({}));
    expect(v.arrow).toBe('▲');
    expect(v.text).toBe('7.3%');
    expect(v.tone).toBe('bad');
    expect(v.title).toContain('было');
  });

  it('падение → ▼', () => {
    expect(formatDelta(mk({ direction: 'down', deltaPct: -0.1, sentiment: 'good' })).arrow).toBe('▼');
  });

  it('появление → ▲ «новое», без NaN', () => {
    const v = formatDelta(mk({ direction: 'appeared', from: null, deltaPct: null, deltaAbs: 5 }));
    expect(v.text).toBe('новое');
    expect(v.arrow).toBe('▲');
    expect(v.text).not.toContain('NaN');
  });

  it('исчезновение → ▼ «убыло»', () => {
    const v = formatDelta(mk({ direction: 'disappeared', to: null, deltaPct: null }));
    expect(v.arrow).toBe('▼');
    expect(v.text).toBe('убыло');
  });

  it('плоско → → нейтрально', () => {
    const v = formatDelta(mk({ direction: 'flat', deltaPct: 0, sentiment: 'neutral' }));
    expect(v.arrow).toBe('→');
    expect(v.tone).toBe('neutral');
  });

  it('без deltaPct → абсолютная величина', () => {
    const v = formatDelta(mk({ deltaPct: null, deltaAbs: 19278 }));
    expect(v.text.replace(/\D/g, '')).toBe('19278');
  });
});
