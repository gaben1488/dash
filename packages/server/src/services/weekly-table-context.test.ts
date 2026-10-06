import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
    GOOGLE_PRIVATE_KEY: '',
    GOOGLE_API_KEY: '',
  };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

async function fixture(options: {
  mismatchBook?: string;
  formulasMissingBook?: string;
  monitoringMissing?: boolean;
} = {}) {
  const [{ db, schema }, snapshotModule, configModule, core] = await Promise.all([
    import('../db/index.js'),
    import('./snapshot.js'),
    import('../config.js'),
    import('@aemr/core'),
  ]);
  const createdAt = '2026-07-22T20:01:00.000Z';
  const rowsByDept: Record<string, unknown[][]> = {};
  const cache: Record<string, {
    values: unknown[][]; formulas: unknown[][]; sheetName: string;
    startRow: number; formulasRead: boolean;
  }> = {};
  const meta: Record<string, { loadedAt: string; rowCount: number; sheetName: string }> = {};

  for (const name of Object.keys(configModule.DEPARTMENT_SPREADSHEETS)) {
    const row = [name, 'данные'];
    rowsByDept[name] = [row];
    const cachedRow = name === options.mismatchBook ? [name, 'другие данные'] : row;
    cache[name] = {
      values: [['шапка 1'], ['шапка 2'], ['шапка 3'], cachedRow],
      formulas: [[], [], [], ['', '=1+1']],
      sheetName: 'ВСЕ',
      startRow: 1,
      formulasRead: name !== options.formulasMissingBook,
    };
    meta[name] = { loadedAt: createdAt, rowCount: 4, sheetName: 'ВСЕ' };
  }
  snapshotModule.setDeptSheetCache(cache);
  snapshotModule.setDeptLoadMeta(meta);

  const snapshot = {
    id: 'weekly-source',
    spreadsheetId: 'test',
    createdAt,
    officialMetrics: {}, calculatedMetrics: {}, deltas: [], issues: [],
    trust: { overall: 100, components: [], grade: 'A', computedAt: createdAt, basedOnSnapshot: 'weekly-source' },
    rowCount: 8,
    rowsByDept,
    metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
  };
  db.insert(schema.snapshots).values({
    id: snapshot.id,
    spreadsheetId: snapshot.spreadsheetId,
    createdAt,
    data: JSON.stringify(snapshot),
  }).run();

  const monitoringNames = options.monitoringMissing
    ? core.MONITORING_DATA_SHEETS.slice(1)
    : core.MONITORING_DATA_SHEETS;
  const monitoringSheets = Object.fromEntries(
    monitoringNames.map((name) => [name, [[name, 'строка']]]),
  );
  const monitoring = {
    readAt: createdAt,
    version: 7,
    sheets: monitoringSheets,
    failed: {},
    expectedSheets: core.MONITORING_DATA_SHEETS.length,
  };
  const readContext = () => {
    const row = db.select({ data: schema.snapshots.data }).from(schema.snapshots).get();
    if (!row?.data) return undefined;
    return JSON.parse(row.data).weeklyTableContext;
  };
  return { snapshotModule, monitoring, createdAt, readContext };
}

describe('sealWeeklyTableContext — недельный snapshot таблиц', () => {
  it('привязывает шапки, формулы и все процедурные листы к тому же snapshot.id', async () => {
    const { snapshotModule, monitoring, createdAt, readContext } = await fixture();

    await expect(snapshotModule.sealWeeklyTableContext('weekly-source', monitoring)).resolves.toBe(true);
    const context = readContext();
    expect(context.contract).toBe('dash-weekly-table-context-v1');
    expect(Object.keys(context.masters)).toHaveLength(8);
    expect(context.masters.УЭР.headerRows).toHaveLength(3);
    expect(context.masters.УЭР.formulasRead).toBe(true);
    expect(context.masters.УЭР.loadedAt).toBe(createdAt);
    expect(Object.keys(context.monitoring.sheets)).toEqual(['Рабочий реестр процедур', 'Процедуры в работе', 'Сводный аналитический лист', 'Справочник заказчиков']);
    expect(context.monitoring.version).toBe(7);
    expect(snapshotModule.getWeeklySnapshotHistory().map((row) => row.id)).toContain('weekly-source');
  });

  it('несовпадение хотя бы одной master-строки с уже сохранённым rowsByDept запрещает seal', async () => {
    const { snapshotModule, monitoring, readContext } = await fixture({ mismatchBook: 'УО' });

    await expect(snapshotModule.sealWeeklyTableContext('weekly-source', monitoring)).resolves.toBe(false);
    expect(readContext()).toBeUndefined();
    expect(snapshotModule.getWeeklySnapshotHistory()).toEqual([]);
  });

  it('отсутствие формульного чтения хотя бы одной книги запрещает seal', async () => {
    const { snapshotModule, monitoring, readContext } = await fixture({ formulasMissingBook: 'УФБП' });

    await expect(snapshotModule.sealWeeklyTableContext('weekly-source', monitoring)).resolves.toBe(false);
    expect(readContext()).toBeUndefined();
  });

  it('неполный процедурный периметр запрещает seal независимо от заявленного expectedSheets', async () => {
    const { snapshotModule, monitoring, readContext } = await fixture({ monitoringMissing: true });
    monitoring.expectedSheets = Object.keys(monitoring.sheets).length;

    await expect(snapshotModule.sealWeeklyTableContext('weekly-source', monitoring)).resolves.toBe(false);
    expect(readContext()).toBeUndefined();
  });
});
