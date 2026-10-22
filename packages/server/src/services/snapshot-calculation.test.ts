import { createServer, get } from 'node:http';
import { setImmediate } from 'node:timers';
import { describe, expect, it } from 'vitest';
import { REPORT_MAP } from '@aemr/shared';
import { calculateSnapshot, runSnapshotCalculation, type SnapshotCalculationInput } from './snapshot-calculation.js';
import { calculationDigest, currentCalculationContextMatches } from './snapshot-calculation-context.js';

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
    if (['ingestMs', 'officialNormalizeMs', 'checksAndCalculationMs', 'deltaMs', 'trustMs', 'pipelineDurationMs', 'readDurationMs', 'computedAt', 'detectedAt', 'readAt'].includes(key)) return '<measurement>';
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


it('records reproducible calculation inputs separately from the product calendar day', () => {
  const source = input();
  const first = calculateSnapshot(structuredClone(source));
  const again = calculateSnapshot(structuredClone(source));
  expect(first.metadata.calculationContext).toEqual(again.metadata.calculationContext);
  expect(first.metadata.calculationContext).toMatchObject({
    contract: 'aemr-calculation-context-v1',
    calendar: { asOf: source.asOf!.toISOString(), utcOffsetHours: 12 },
    scope: { targetYear: 2026, officialYear: 2026 },
    decisions: 'not-applied', access: 'full-dataset',
  });
  const modified = structuredClone(source);
  modified.sheetRows.УЭР[3][7] = 101;
  expect(calculateSnapshot(modified).metadata.calculationContext?.id)
    .not.toBe(first.metadata.calculationContext?.id);
  const nextDay = calculateSnapshot({ ...source, asOf: new Date('2026-10-19T00:00:00Z') });
  expect(nextDay.metadata.calculationContext?.id).not.toBe(first.metadata.calculationContext?.id);
  expect(nextDay.metadata.calculationContext?.sources).toEqual(first.metadata.calculationContext?.sources);
});


it('keeps frozen threshold observations independent of later dictionary edits', async () => {
  const { THRESHOLD_REGISTRY } = await import('@aemr/shared');
  const source = input();
  const before = calculateSnapshot(source);
  const key = 'economy.highSharePct';
  const original = THRESHOLD_REGISTRY[key];
  try {
    (THRESHOLD_REGISTRY as Record<string, typeof original>)[key] = { ...original, value: 26 };
    const after = calculateSnapshot(source);
    expect(after.metadata.calculationContext?.thresholds[key].value).toBe(26);
    expect(before.metadata.calculationContext?.thresholds[key].value).toBe(25);
    expect(after.metadata.calculationContext?.id).not.toBe(before.metadata.calculationContext?.id);
  } finally { (THRESHOLD_REGISTRY as Record<string, typeof original>)[key] = original; }
});


it('rejects changed required source semantics before producing financial results', async () => {
  const { DEPT_COLUMNS, DEPT_HEADER_LABELS } = await import('@aemr/shared');
  const source = input();
  const header: string[] = [];
  for (const [key, column] of Object.entries(DEPT_COLUMNS)) header[column] = DEPT_HEADER_LABELS[key as keyof typeof DEPT_COLUMNS];
  header[DEPT_COLUMNS.METHOD] = 'Другой смысл колонки';
  source.sheetRows.УЭР[2] = header;
  expect(() => calculateSnapshot(source)).toThrow('MASTER_SOURCE_REQUIRED_MEANING_CHANGED:L');
});

it('C08.02: a saved live context is reusable within the Kamchatka day, not across midnight', () => {
  const source = input();
  const snapshot = calculateSnapshot(source);
  expect(currentCalculationContextMatches(snapshot, new Date('2026-10-18T00:00:01Z'))).toBe(true);
  expect(currentCalculationContextMatches(snapshot, new Date('2026-10-18T11:59:59Z'))).toBe(true);
  // Midnight in Kamchatka (+12:00) is 12:00 UTC on the preceding UTC date.
  expect(currentCalculationContextMatches(snapshot, new Date('2026-10-18T12:00:00Z'))).toBe(false);
  expect(currentCalculationContextMatches(snapshot, new Date('2026-10-18T00:00:00Z'))).toBe(true);
  expect(currentCalculationContextMatches(snapshot, new Date('2026-10-17T23:59:59Z'))).toBe(false);
  expect(currentCalculationContextMatches(snapshot, new Date(Number.NaN))).toBe(false);
  // Replaying the original input is still deterministic; live revalidation
  // must never overwrite the historical observation or its rules.
  expect(calculateSnapshot(structuredClone(source)).metadata.calculationContext)
    .toEqual(snapshot.metadata.calculationContext);
});

it('C08.02: rejects changed rules, source profiles, scoped access and tampered context even with a resealed ID', () => {
  const original = calculateSnapshot(input());
  const now = new Date('2026-10-18T00:00:01Z');
  expect(currentCalculationContextMatches(original, now)).toBe(true);

  const changed = (patch: (context: NonNullable<typeof original.metadata.calculationContext>) => void) => {
    const candidate = structuredClone(original);
    const context = candidate.metadata.calculationContext!;
    patch(context);
    const { id: _priorId, ...evidence } = context;
    context.id = calculationDigest(evidence);
    return candidate;
  };

  expect(currentCalculationContextMatches(changed(c => { c.semantics = 'another-rule-revision'; }), now)).toBe(false);
  expect(currentCalculationContextMatches(changed(c => { c.sources.profiles = 'another-source-profile'; }), now)).toBe(false);
  expect(currentCalculationContextMatches(changed(c => { c.scope.targetYear = 2025; }), now)).toBe(false);
  expect(currentCalculationContextMatches(changed(c => { c.calendar.utcOffsetHours = 3; }), now)).toBe(false);
  expect(currentCalculationContextMatches(changed(c => { c.calendar.productDay += 1; }), now)).toBe(false);
  expect(currentCalculationContextMatches(changed(c => { c.thresholds['economy.highSharePct'].value += 1; }), now)).toBe(false);
  expect(currentCalculationContextMatches(changed(c => { Object.assign(c, { access: 'restricted' }); }), now)).toBe(false);
  expect(currentCalculationContextMatches(changed(c => { Object.assign(c, { decisions: 'applied' }); }), now)).toBe(false);

  const altered = structuredClone(original);
  altered.metadata.calculationContext!.calendar.asOf = '2026-10-18T00:00:02.000Z';
  expect(currentCalculationContextMatches(altered, now)).toBe(false);
  const missing = structuredClone(original);
  delete missing.metadata.calculationContext;
  expect(currentCalculationContextMatches(missing, now)).toBe(false);
});
