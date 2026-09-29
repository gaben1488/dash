// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PublishedReleaseMetrics } from './PublishedReleaseMetrics';

const release = {
  release_id: `REL-${'a'.repeat(64)}`, snapshot_id: 'SNP-saved', report_date: '30.09.2026',
  cutoff_at: '2026-09-29T16:00:00Z', published_at: '2026-09-29T16:05:00Z',
  model_sha256: 'a'.repeat(64), rules_version: 'rules', renderer_version: 'renderer', status: 'VERIFIED' as const,
};
const block = { plan_count: 17, fact_count: 12, remain_count: 5, plan_amount: 123.45, fact_amount: 90.12, remain_amount: 33.33, execution_pct: 70.5 };
const projection = { snapshot_id: release.snapshot_id, report_date: release.report_date,
  rules_version: release.rules_version, renderer_version: release.renderer_version,
  headline: { report_date: release.report_date, current_quarter: 3,
    competitive: { year: block, quarter: block }, single_supplier: { year: block, quarter: block } } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('показывает значения сохранённого среза по закреплённому идентификатору', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => projection });
  vi.stubGlobal('fetch', fetch);
  render(<PublishedReleaseMetrics release={release} />);
  expect(await screen.findByText('Конкурентные · год')).toBeTruthy();
  expect(screen.getAllByText('123,45').length).toBe(4);
  expect(fetch.mock.calls[0][0]).toBe(`/api/report-releases/${release.release_id}/dashboard`);
});

it('не показывает цифры другой версии под датой выбранного выпуска', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...projection, snapshot_id: 'SNP-other' }) }));
  render(<PublishedReleaseMetrics release={release} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('123,45')).toBeNull();
});
