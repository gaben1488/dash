import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { reconciliationRoutes } from './reconciliation.js';
import { getSnapshot } from '../services/snapshot.js';

vi.mock('../services/snapshot.js', () => ({
  getSnapshot: vi.fn(), getSHDYUCache: vi.fn(), getSHDYULoadError: vi.fn(),
  getSHDYURawRowCount: vi.fn(), getSHDYUOfficialYear: vi.fn(),
}));
const C = DEPT_COLUMNS;
function row(approved: boolean) {
  const r: unknown[] = Array(34).fill('');
  r[C.ID] = '1'; r[C.SUBJECT] = 'Тестовая закупка'; r[C.METHOD] = 'ЭА';
  r[C.PLAN_YEAR] = 2026; r[C.TOTAL_PLAN] = 500; r[C.TOTAL_FACT] = 400;
  r[C.FACT_DATE] = '01.01.2026'; r[C.PLAN_QUARTER] = '';
  r[C.ECONOMY_FB] = 2; r[C.ECONOMY_KB] = 3; r[C.ECONOMY_MB] = 1;
  r[C.FLAG] = approved ? 'да' : '';
  return r;
}
async function read(rows: unknown[][], economy: number) {
  vi.mocked(getSnapshot).mockReturnValue({ officialMetrics: {}, deltas: [],
    calculatedMetrics: { 'grbs.uo.year.economy_total': { numericValue: economy } },
    rowsByDept: { УО: rows },
  } as unknown as ReturnType<typeof getSnapshot>);
  const app = Fastify();
  await app.register(reconciliationRoutes);
  try { return (await app.inject('/api/reconciliation')).json().reconciliation.rows.find((r: { department: string }) => r.department === 'УО'); }
  finally { await app.close(); }
}
describe('economy explanation follows AD-approved budget columns, never fact', () => {
  it('rejects a malformed period before reading data for another scope', async () => {
    const app = Fastify();
    await app.register(reconciliationRoutes);
    vi.mocked(getSnapshot).mockClear();
    try {
      for (const query of ['year=2026junk', 'year=1999', 'year=2026&year=2025']) {
        const response = await app.inject(`/api/reconciliation?${query}`);
        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe('INVALID_SCOPE');
      }
      expect(getSnapshot).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('actual GET excludes profitable but unapproved row and attributes approved Z+AA+AB', async () => {
    const response = await read([row(false), row(true)], 6);
    const groups = response.rootCauses.filter((g: { metrics: string[] }) => g.metrics.includes('УО.economy_total'));
    const witnesses = groups.flatMap((g: { cause: { rows: unknown[] } }) => g.cause.rows);
    expect(witnesses).toEqual([{ sheet: 'УО', row: 5, cell: 'Z5:AB5', delta: 6 }]);
    expect(groups[0].cause.explanation).toContain('Z+AA+AB');
    expect(groups[0].cause.explanation).toContain('AD');
    expect(response.ecoTotalCalculated).toBe(6);
    expect(response.ecoTotalOfficial).toBe(0);
  });
  it('actual GET leaves unexplained economy unknown when no source row has AD approval', async () => {
    const response = await read([row(false)], 6);
    const groups = response.rootCauses.filter((g: { metrics: string[] }) => g.metrics.includes('УО.economy_total'));
    expect(groups.every((g: { cause: { class: string } }) => g.cause.class === 'unknown')).toBe(true);
    expect(groups.flatMap((g: { cause: { rows: unknown[] } }) => g.cause.rows)).toEqual([]);
  });
  it('one approved source row is not attributed twice to missing year and missing quarter', async () => {
    const r = row(true); r[C.PLAN_YEAR] = '';
    const response = await read([r], 6);
    const groups = response.rootCauses.filter((g: { metrics: string[] }) => g.metrics.includes('УО.economy_total'));
    expect(groups.flatMap((g: { cause: { rows: unknown[] } }) => g.cause.rows))
      .toEqual([{ sheet: 'УО', row: 4, cell: 'Z4:AB4', delta: 6 }]);
  });

});
