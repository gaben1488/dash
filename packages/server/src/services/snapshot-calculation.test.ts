import { createServer, get } from 'node:http';
import { setImmediate } from 'node:timers';
import { describe, expect, it } from 'vitest';
import { REPORT_MAP } from '@aemr/shared';
import { calculateSnapshot, runSnapshotCalculation, type SnapshotCalculationInput } from './snapshot-calculation.js';

function input(): SnapshotCalculationInput {
  const row: unknown[] = Array(34).fill('');
  Object.assign(row, { 0: '173/1', 1: 'УЭР АЕМР', 3: 'ТД', 6: 'Учебная закупка',
    7: 100, 10: 100, 11: 'ЭА', 13: '12.10.2026', 14: 4, 15: 2026,
    16: '15.10.2026', 21: 80, 24: 80, 25: 20, 29: 'да' });
  return { asOf: new Date('2026-10-18T00:00:00Z'), batchGetData: [],
    sheetRows: { УЭР: [[], [], [], row] }, sheetFormulas: { УЭР: [[], [], [], []] },
    reportMap: REPORT_MAP, spreadsheetId: 'synthetic-worker-input', targetYear: 2026, officialYear: 2026 };
}

function semantic(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (['pipelineDurationMs', 'readDurationMs', 'computedAt', 'detectedAt', 'readAt'].includes(key)) return '<measurement>';
    if (key === 'basedOnSnapshot') return '<snapshot-id>';
    return item;
  }));
}

describe('чистый расчёт снимка вне HTTP-потока', () => {
  it('обслуживает настоящий HTTP до завершения расчёта', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_REQUIRED');
    let finished = false;
    const reading = new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        get(`http://127.0.0.1:${address.port}`, response => {
          response.resume(); response.once('end', resolve);
        }).once('error', reject);
      });
    });
    const calculation = runSnapshotCalculation(input()).finally(() => { finished = true; });
    void calculation.catch(() => {});
    try {
      await reading;
      expect(finished).toBe(false);
    } finally {
      try { await calculation; }
      finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    }
  });

  it('сохраняет полный смысл прежнего расчёта, даты, строки и формулы', async () => {
    const source = input();
    const captured = structuredClone(source);
    const before = calculateSnapshot(structuredClone(source));
    const after = await runSnapshotCalculation(source);
    const expected = semantic(before) as Record<string, unknown>;
    const actual = semantic(after) as Record<string, unknown>;
    delete expected.id; delete actual.id;
    expect(actual).toEqual(expected);
    expect(after.createdAt).toBe(source.asOf!.toISOString());
    expect(source).toEqual(captured);
    expect(source.sheetRows.УЭР[3][0]).toBe('173/1');
  });

  it('отказывает при невалидном clock, не выдаёт нулевой снимок', async () => {
    await expect(runSnapshotCalculation({ ...input(), asOf: new Date(Number.NaN) })).rejects.toThrow();
  });
});
