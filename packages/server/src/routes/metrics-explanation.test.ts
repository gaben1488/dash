import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { runPipeline } from '@aemr/core';
import { DEPT_COLUMNS as C, MetricDetailSchema } from '@aemr/shared';
import { metricsRoutes } from './metrics.js';
import { getSnapshot } from '../services/snapshot.js';

vi.mock('../services/snapshot.js', () => ({ getSnapshot: vi.fn(), getMetricTrend: vi.fn(() => []) }));

function snapshot() {
  const rows = [true, false].map((fact, i) => {
    const r: unknown[] = Array(34).fill('');
    r[C.ID] = String(i + 1); r[C.SUBJECT] = 'Поставка'; r[C.METHOD] = 'ЭА';
    r[C.PLAN_YEAR] = 2026; r[C.PLAN_QUARTER] = 1; r[C.PLAN_DATE] = '15.01.2026';
    r[C.TOTAL_PLAN] = 100; r[C.FACT_DATE] = fact ? '20.01.2026' : '';
    r[C.TOTAL_FACT] = fact ? 80 : 0;
    return r;
  });
  return runPipeline({ batchGetData: [], sheetRows: { УО: [[], [], [], ...rows] },
    reportMap: [], rules: [], spreadsheetId: 'fixture', targetYear: 2026,
    asOf: new Date('2026-02-01T00:00:00Z') });
}

async function read(value: ReturnType<typeof snapshot>, key: string) {
  vi.mocked(getSnapshot).mockResolvedValue(value);
  const app = Fastify(); await app.register(metricsRoutes);
  try { return await app.inject(`/api/metrics/${key}`); }
  finally { await app.close(); }
}

describe('calculated metric detail', () => {
  it('supports district and method month totals without mixing their scope', async () => {
    const value = snapshot();
    for (const key of ['competitive.q1.count', 'competitive.m1.count', 'grbs.uo.kp.m1.count']) {
      const response = await read(value, key);
      expect(response.statusCode).toBe(200);
      expect(response.json().explanation).toMatchObject({ status: 'available', value: 2,
        rows: [{ sheet: 'УО', row: 4 }, { sheet: 'УО', row: 5 }] });
    }
  });

  it('explains the actual month-by-method intersection rather than a quarter fallback', async () => {
    const value = snapshot();
    const result = await read(value, 'grbs.uo.kp.m1.count');
    expect(result.statusCode).toBe(200);
    expect(result.json().explanation).toMatchObject({
      status: 'available', value: 2,
      resultContext: { scope: { department: 'uo', method: 'competitive', period: 'm1' } },
      rows: [{ sheet: 'УО', row: 4 }, { sheet: 'УО', row: 5 }],
    });
  });

  it('reproduces annual figures from four planned quarters, excluding undated orphan rows', async () => {
    const value = snapshot();
    const orphan: unknown[] = Array(34).fill('');
    orphan[C.ID] = 'orphan'; orphan[C.SUBJECT] = 'Поставка';
    orphan[C.METHOD] = 'ЭА'; orphan[C.PLAN_YEAR] = 2026;
    orphan[C.PLAN_DATE] = '12.05.2026'; orphan[C.TOTAL_PLAN] = 500;
    value.rowsByDept!['УО']!.push(orphan);
    // Annual published count is based on Q1-Q4. A row without a quarter
    // must not be silently added by the evidence replay.
    const result = await read(value, 'grbs.uo.year.plan_count');
    expect(result.json().explanation).toMatchObject({
      status: 'available', value: 2,
      rows: [{ sheet: 'УО', row: 4 }, { sheet: 'УО', row: 5 }],
    });
  });

  it('rejects a changed snapshot and malformed year before attaching evidence', async () => {
    const value = snapshot();
    expect((await read(value, 'grbs.uo.q1.exec_count_pct?snapshotId=older')).statusCode).toBe(409);
    expect((await read(value, 'grbs.uo.q1.exec_count_pct?year=2026junk')).statusCode).toBe(400);
  });
  it('opens a calculated-only metric and traces numerator and denominator to snapshot rows', async () => {
    const value = snapshot();
    const response = await read(value, 'grbs.uo.q1.exec_count_pct');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(MetricDetailSchema.safeParse(body).success).toBe(true);
    expect(body.calculated.numericValue).toBe(0.5);
    expect(body.explanation).toMatchObject({ status: 'available', snapshotId: value.id, value: 0.5,
      rows: [{ sheet: 'УО', row: 4 }, { sheet: 'УО', row: 5 }],
      operands: [
        { key: 'fact_count', unit: 'count', value: 1, rows: [{ sheet: 'УО', row: 4 }] },
        { key: 'plan_count', unit: 'count', value: 2, rows: [{ sheet: 'УО', row: 4 }, { sheet: 'УО', row: 5 }] },
      ] });
  });

  it('ties a visible number to its actual grain, scope, dependencies and snapshot', async () => {
    const value = snapshot();
    const response = await read(value, 'grbs.uo.q1.exec_count_pct');
    expect(response.statusCode).toBe(200);
    expect(response.json().explanation.resultContext).toEqual({
      grain: 'department_sheet_row',
      scope: { sourceSheets: ['УО'], department: 'uo', method: null, period: 'q1', year: 2026 },
      dependencies: ['fact_count', 'plan_count'],
      formula: 'fact_count / plan_count (нет базы → null; результат — доля, 1 соответствует 100%)',
      version: {
        snapshotId: value.id, calculationContextId: null, semanticsHash: null,
        sourceContentHash: null, sourceProfilesHash: null,
        status: 'legacy_without_context',
      },
    });
    const method = await read(value, 'competitive.m1.count');
    expect(method.json().explanation.resultContext.scope).toEqual({
      sourceSheets: ['УО'], department: null, method: 'competitive', period: 'm1', year: 2026,
    });
    expect(method.json().explanation.resultContext.dependencies).toEqual([]);
  });

  it('never assigns current rules to a numerically equal snapshot with a different captured version', async () => {
    const value = snapshot();
    value.metadata.calculationContext = {
      contract: 'aemr-calculation-context-v1', id: 'old-context',
      sources: { content: 'old-source', profiles: 'old-profiles' },
      semantics: 'old-executable-rules', thresholds: {},
      calendar: { asOf: value.createdAt, productDay: 20747, utcOffsetHours: 12, weeklyCutoffHour: 0 },
      scope: { targetYear: 2026, officialYear: null },
      decisions: 'not-applied', access: 'full-dataset',
    };
    const response = await read(value, 'grbs.uo.q1.exec_count_pct');
    expect(response.json().calculated.numericValue).toBe(0.5);
    expect(response.json().explanation).toEqual({
      status: 'unavailable', reason: 'CALCULATION_CONTEXT_CHANGED',
    });
  });

  it('keeps money operands in the source unit of thousands of rubles', async () => {
    const response = await read(snapshot(), 'grbs.uo.q1.execution_pct');
    expect(response.json().explanation.operands).toMatchObject([
      { key: 'fact_total', unit: 'currency', value: 80 },
      { key: 'plan_total', unit: 'currency', value: 200 },
    ]);
  });

  it('does not substitute another period or new evidence for an incompatible saved result', async () => {
    const value = snapshot();
    value.calculatedMetrics['grbs.uo.q1.exec_count_pct']!.numericValue = 0.9;
    const response = await read(value, 'grbs.uo.q1.exec_count_pct');
    expect(response.json().explanation).toEqual({ status: 'unavailable', reason: 'SAVED_RESULT_NOT_REPRODUCED' });
    expect((await read(value, 'not_a_metric')).statusCode).toBe(404);
  });

  it('does not call missing retained rows an empty successful check', async () => {
    const value = snapshot(); delete value.rowsByDept;
    const response = await read(value, 'grbs.uo.q1.exec_count_pct');
    expect(response.json().explanation).toEqual({ status: 'unavailable', reason: 'SOURCE_ROWS_NOT_RETAINED' });
  });
});
