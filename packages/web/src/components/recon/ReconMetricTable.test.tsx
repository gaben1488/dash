import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ReconMetricTable } from './ReconMetricTable';
import { buildMetricRows, countMetricAssessments } from '../../lib/recon/metric-rows';

it('renders missing evidence as unverified, never as a clean reconciliation', () => {
  const deltas = [{ metricKey: 'grbs.uo.q1.plan_count', label: 'Количество', officialValue: null,
    calculatedValue: 0, delta: null, deltaPercent: null, withinTolerance: true, explanation: '' }];
  const rows = buildMetricRows(deltas);
  const html = renderToStaticMarkup(<ReconMetricTable rows={rows} deltas={deltas}
    counts={countMetricAssessments(rows)} expandedMetric={rows[0].metric} onToggleMetric={() => {}} />);
  expect(html).toContain('недостаточно данных');
  expect(html).toContain('Не проверено');
  expect(html).toContain('нет в СВОД');
  expect(html).not.toContain('Сверка чиста');
  expect(html).not.toContain('Дополнительных действий не требуется');
});

it('keeps a real zero-to-zero comparison visible and reports it as compared', () => {
  const deltas = [{ metricKey: 'grbs.uo.q1.plan_count', label: 'Количество', officialValue: 0,
    calculatedValue: 0, delta: 0, deltaPercent: null, withinTolerance: true, explanation: '' }];
  const rows = buildMetricRows(deltas);
  const html = renderToStaticMarkup(<ReconMetricTable rows={rows} deltas={deltas}
    counts={countMetricAssessments(rows)} expandedMetric={null} onToggleMetric={() => {}} />);
  expect(html).toContain('Сверка чиста');
  expect(html).toContain('Количество');
  expect(html).not.toContain('Не проверено');
});
