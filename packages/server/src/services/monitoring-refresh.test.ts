import { beforeEach, expect, it, vi } from 'vitest';
import { MONITORING_DATA_SHEETS } from '@aemr/core';
const reader = vi.hoisted(() => ({ partial: false, changed: false, calls: 0 }));
vi.mock('./google-sheets.js', () => ({
  batchGetSheetValues: vi.fn(async () => {
    reader.calls++;
    if (reader.partial) throw new Error('batch unavailable');
    return Object.fromEntries(MONITORING_DATA_SHEETS.map(sheet => [sheet, sheet === 'Рабочий реестр процедур' ? [[reader.changed ? 'changed' : 'initial']] : []]));
  }),
  getSheetDataFromSpreadsheet: vi.fn(async (_id: string, sheet: string) => {
    if (reader.partial && sheet === 'Процедуры в работе') throw new Error('temporary queue refusal');
    return sheet === 'Рабочий реестр процедур' ? [[reader.changed ? 'changed' : 'initial']] : [];
  }),
}));
vi.mock('./file-revision.js', () => ({ checkFileChanged: vi.fn(async () => 'same') }));
import { getMonitoringBook, refreshMonitoringBook, resetMonitoringState } from './monitoring.js';
beforeEach(() => { resetMonitoringState(); reader.partial = false; reader.changed = false; reader.calls = 0; });
it('retries a partial read even when Drive already acknowledged its revision, and retains the change for the final event', async () => {
  await getMonitoringBook();
  reader.partial = true; reader.changed = true;
  const partial = await refreshMonitoringBook({ askDrive: false });
  expect(partial.failed).toEqual({ 'Процедуры в работе': 'temporary queue refusal' });
  reader.partial = false;
  const recovered = await refreshMonitoringBook();
  expect(recovered.read).toBe(true);
  expect(recovered.failed).toEqual({});
  expect(recovered.changed).toContain('Рабочий реестр процедур');
  expect(reader.calls).toBe(3);
});
