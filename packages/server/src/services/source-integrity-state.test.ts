/**
 * Durable source-integrity observations. An in-memory SQLite connection simulates
 * the same persistent database independently from each process-local Map.
 * Never contacts Google.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('./source-refresh.js', () => ({ setFormulaSink: vi.fn() }));

vi.mock('../config.js', () => ({
  config: { database: { url: 'file::memory:' } },
  DEPARTMENT_SPREADSHEETS: { 'УО': 'file-uo', 'УИО': 'file-uio' },
}));

import { db, schema } from '../db/index.js';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import {
  loadFormulaAudits, loadMetadataAudits, loadMetadataResults, saveFormulaAudit, saveMetadataResult,
} from './source-integrity-state.js';

const goodAt = '2026-10-22T02:00:00.000Z';
const failedAt = '2026-10-22T03:00:00.000Z';

beforeEach(() => {
  db.delete(schema.sourceIntegrityState).run();
  DEPARTMENT_SPREADSHEETS['УО'] = 'file-uo';
});

describe('durable source-integrity state', () => {
  it('restores the checked result, including findings, without reading Google', () => {
    const delivery = { book: 'УО', at: goodAt, cells: 70, handled: true, persisted: true };
    const verdict = {
      book: 'УО', at: goodAt, rowsJudged: 5,
      defects: [{ book: 'УО', kind: 'formula_overwritten' as const, cell: 'K6', column: 'K' as const, row: 6, rowSeq: '3', actual: '12', etalon: '=SUM(H6:J6)', etalonRow: 5 }],
    };
    saveFormulaAudit(delivery, verdict);
    expect(loadFormulaAudits()).toEqual([{ delivery, verdict }]);
  });

  it('keeps an earlier real verdict but records a later failed attempt (not clean)', () => {
    const verdict = { book: 'УО', at: goodAt, rowsJudged: 7, defects: [] };
    saveFormulaAudit({ book: 'УО', at: goodAt, cells: 22, handled: true, persisted: true }, verdict);
    saveFormulaAudit({
      book: 'УО', at: failedAt, cells: 19, handled: false, persisted: true,
      failedBecause: 'ошибка парсера',
    }, null);
    const [record] = loadFormulaAudits();
    expect(record.delivery).toMatchObject({ at: failedAt, handled: false, failedBecause: 'ошибка парсера' });
    expect(record.verdict).toEqual(verdict);
    expect(record.verdict?.at).not.toBe(record.delivery.at);
  });

  it('hydrates the real formula verdict cache after simulating a process restart', async () => {
    const delivery = { book: 'УО', at: goodAt, cells: 10, handled: true, persisted: true };
    const verdict = { book: 'УО', at: goodAt, rowsJudged: 5, defects: [] };
    saveFormulaAudit(delivery, verdict);
    const { resetFormulaVerdicts, restoreFormulaVerdicts, formulaVerdicts } =
      await import('./formula-sink.js');
    resetFormulaVerdicts(); // simulate loss of process-local Map
    expect(formulaVerdicts()).toEqual([]);
    restoreFormulaVerdicts(); // no external source access
    expect(formulaVerdicts()).toEqual([verdict]);
    resetFormulaVerdicts();
  });

  it('remembers metadata read failures, not an invented zero remarks', () => {
    const failed = { book: 'УИО', at: failedAt, read: false, skippedBecause: 'Google 403', remarks: [], persisted: true };
    saveMetadataResult(failed);
    expect(loadMetadataResults()).toEqual([failed]);
  });

  it('preserves a confirmed metadata drift across later Google failure', () => {
    const confirmed = {
      book: 'УО', at: goodAt, read: true, persisted: true,
      remarks: [{
        book: 'УО', kind: 'protection_removed' as const, column: 'Y',
        expected: 'защищено', actual: 'защиты нет', text: 'нет защиты Y',
      }],
    };
    const failed = {
      book: 'УО', at: failedAt, read: false, persisted: true,
      skippedBecause: 'временная ошибка Google', remarks: [],
    };
    saveMetadataResult(confirmed);
    saveMetadataResult(failed);
    expect(loadMetadataResults()).toEqual([failed]);
    expect(loadMetadataAudits()).toEqual([{ attempt: failed, lastConfirmed: confirmed }]);
  });

  it('restores metadata as unknown when the checker contract changes', () => {
    saveMetadataResult({ book: 'УО', at: goodAt, read: true, persisted: true, remarks: [] });
    db.update(schema.sourceIntegrityState).set({ checkerVersion: 'metadata-canon/old' })
      .where(eq(schema.sourceIntegrityState.id, 'metadata:УО')).run();
    expect(loadMetadataAudits()).toEqual([]);
  });

  it('refuses to restore evidence from a different source ID', () => {
    saveFormulaAudit(
      { book: 'УО', at: goodAt, cells: 11, handled: true, persisted: true },
      { book: 'УО', at: goodAt, rowsJudged: 2, defects: [] },
    );
    DEPARTMENT_SPREADSHEETS['УО'] = 'file-replaced';
    expect(loadFormulaAudits()).toEqual([]);
  });

  it('rejects legacy main formula verdicts after switching to integrated composite identifiers', () => {
    saveFormulaAudit(
      { book: 'УО', at: goodAt, cells: 3, handled: true, persisted: true },
      { book: 'УО', at: goodAt, rowsJudged: 1, defects: [] },
    );
    db.update(schema.sourceIntegrityState)
      .set({ checkerVersion: 'formula-integrity/1' })
      .where(eq(schema.sourceIntegrityState.id, 'formulas:УО')).run();
    expect(loadFormulaAudits()).toEqual([]);
  });

  it('fails closed on corrupted payload and old checker version', () => {
    saveFormulaAudit(
      { book: 'УО', at: goodAt, cells: 11, handled: true, persisted: true },
      { book: 'УО', at: goodAt, rowsJudged: 2, defects: [] },
    );
    db.update(schema.sourceIntegrityState).set({ stateJson: '{invalid' })
      .where(eq(schema.sourceIntegrityState.id, 'formulas:УО')).run();
    expect(loadFormulaAudits()).toEqual([]);
    saveFormulaAudit(
      { book: 'УО', at: goodAt, cells: 11, handled: true, persisted: true },
      { book: 'УО', at: goodAt, rowsJudged: 2, defects: [] },
    );
    db.update(schema.sourceIntegrityState).set({ checkerVersion: 'obsolete' })
      .where(eq(schema.sourceIntegrityState.id, 'formulas:УО')).run();
    expect(loadFormulaAudits()).toEqual([]);
  });
});
