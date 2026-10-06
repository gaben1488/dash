// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { dayNumberOf } from '@aemr/shared';
import { ReportPage } from './Report';
import { makeReportFixture } from '../lib/report/fixture';
import { useStore } from '../store';
import { TooltipProvider } from '@radix-ui/react-tooltip';

const backend = vi.hoisted(() => ({ archiveUnavailable: false }));

vi.mock('../api', async importOriginal => {
  const original = await importOriginal<typeof import('../api')>();
  return { ...original, api: { ...original.api,
    getHistorySnapshots: async () => [],
    getReport: async (year: number, quarter = 3, asOf?: string) => {
      if (asOf && backend.archiveUnavailable) throw new Error('503 legacy archive unavailable');
      return ({
      ...makeReportFixture(),
      period: { year, quarter, asOfDay: dayNumberOf(asOf ?? '2026-09-30'), live: !asOf },
      methodology: [], svodOnlineUrl: null,
    }); },
  } };
});
const receipt = {
  release_id: `REL-${'a'.repeat(64)}`, snapshot_id: 'SNP-test', report_date: '30.09.2026',
  report_year: 2026, quarter: 3, cutoff_at: '2026-09-29T16:00:00Z', published_at: '2026-09-29T16:05:00Z',
  model_sha256: 'a'.repeat(64), rules_version: 'test', renderer_version: 'test', status: 'VERIFIED',
};
const request = vi.fn();
let saved: string[];
beforeEach(() => {
  backend.archiveUnavailable = false;
  localStorage.clear();
  useStore.setState({ year: 2026, period: 'q3', periodMode: 'explicit', focusedWeekStart: new Date('2026-09-28T00:00:00Z') });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', request);
  request.mockReset();
  request.mockImplementation(async (url: string) => ({ ok: true,
    json: async () => ({ latest: receipt, attempt: null,
      selected: url.includes('date=2026-09-30&year=2026&quarter=3') ? receipt : null }),
    blob: async () => new Blob(['docx']),
  }));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }));
  saved = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps exactly two native Word actions and downloads the server bundle instead of the browser renderer', async () => {
  localStorage.setItem('aemr_api_key', 'test-token');
  render(<TooltipProvider><ReportPage /></TooltipProvider>);
  const main = await screen.findByRole('button', { name: 'Отчёт в Word' });
  await waitFor(() => expect(main).toHaveProperty('disabled', false));
  expect(screen.getAllByRole('button', { name: /Word/ })).toHaveLength(2);
  expect(screen.queryByText('Показатели выпуска')).toBeNull();
  expect(screen.queryByText('Данные среза · JSON')).toBeNull();
  fireEvent.click(main);
  await waitFor(() => expect(saved).toHaveLength(1));
  const [url, init] = request.mock.calls.find(([url]) => url.endsWith('/main.docx'))!;
  expect(url).toBe(`/api/report-releases/${receipt.release_id}/main.docx`);
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token');
  expect(saved[0]).toContain('30.09.2026');
  fireEvent.click(screen.getByRole('button', { name: 'Доп. отчёт в Word' }));
  await waitFor(() => expect(saved).toHaveLength(2));
  expect(request.mock.calls.some(([url]) => url === `/api/report-releases/${receipt.release_id}/supplement.docx`)).toBe(true);
});

it('changing quarter clears the previous download and explains a missing matching bundle', async () => {
  render(<TooltipProvider><ReportPage /></TooltipProvider>);
  const main = await screen.findByRole('button', { name: 'Отчёт в Word' });
  await waitFor(() => expect(main).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '4 кв' }));
  expect(main).toHaveProperty('disabled', true);
  expect(await screen.findByText(/Для выбранной даты, года и квартала проверенный комплект ещё не выпущен/)).toBeTruthy();
  fireEvent.click(main);
  expect(saved).toHaveLength(0);
});

it('an archive selection never downloads the current release', async () => {
  render(<TooltipProvider><ReportPage /></TooltipProvider>);
  const main = await screen.findByRole('button', { name: 'Отчёт в Word' });
  await waitFor(() => expect(main).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: 'Архив недели' }));
  await screen.findByText(/Для выбранной даты, года и квартала проверенный комплект ещё не выпущен/);
  expect(main).toHaveProperty('disabled', true);
  expect(saved).toHaveLength(0);
});


it('prepares and downloads the full frozen archive even when the old dashboard snapshot is unavailable', async () => {
  backend.archiveUnavailable = true;
  let archived = false;
  request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/report-releases/prepare') {
      const selected = JSON.parse(String(init?.body));
      archived = true;
      return { ok: true, json: async () => ({ latest: receipt, attempt: null,
        selected: { ...receipt, report_date: selected.date.split('-').reverse().join('.'),
          report_year: selected.year, quarter: selected.quarter } }) };
    }
    return { ok: true, json: async () => ({ latest: receipt, attempt: null,
      selected: url.includes('date=2026-09-30&year=2026&quarter=3') ? receipt : null }),
      blob: async () => new Blob(['archive docx']) };
  });
  render(<TooltipProvider><ReportPage /></TooltipProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Отчёт в Word' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: 'Архив недели' }));
  await waitFor(() => expect(archived).toBe(true));
  expect(await screen.findByText(/Архивные показатели страницы недоступны/)).toBeTruthy();
  const main = screen.getByRole('button', { name: 'Отчёт в Word' });
  await waitFor(() => expect(main).toHaveProperty('disabled', false));
  fireEvent.click(main);
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(screen.queryByText(/Запустите чтение текущих источников/)).toBeNull();
});
