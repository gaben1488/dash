import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = { ...process.env };
let current: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  process.env = { ...env, NODE_ENV: 'test', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent', AEMR_API_KEY: '', GOOGLE_SHEETS_SPREADSHEET_ID: 'current' };
  vi.resetModules();
  current = await fixture();
});
afterEach(() => { process.env = { ...env }; vi.resetModules(); });

async function fixture() {
  const { db, schema } = await import('../db/index.js');
  const { config, DEPARTMENT_SPREADSHEETS } = await import('../config.js');
  const { MONITORING_DATA_SHEETS } = await import('@aemr/core');
  const { buildCellDict, DEPT_HEADER_ROWS } = await import('@aemr/shared');
  const snapshots = await import('./snapshot.js');
  const integrity = await import('../routes/integrity.js');
  const { pruneSnapshotsByRetention } = await import('./snapshot-retention.js');
  const { getWeeklyProcurementLineage } = await import('./weekly-lineage.js');
  const now = Date.parse('2026-10-16T00:00:00Z');
  const row = ['1', '', 'Организация', '', '', '', 'Предмет', '', '', '', '100', 'ЕП'];
  function control(id: string, createdAt: string) {
    const rowsByDept = Object.fromEntries(Object.keys(DEPARTMENT_SPREADSHEETS).map(name => [name, [row]]));
    const data = { id, spreadsheetId: 'current', createdAt, metadata: { targetYear: null }, rowsByDept,
      weeklyTableContext: { contract: 'dash-weekly-table-context-v1', sealedAt: createdAt,
        masters: Object.fromEntries(Object.keys(DEPARTMENT_SPREADSHEETS).map(name => [name, { formulasRead: true }])),
        monitoring: { sheets: Object.fromEntries(MONITORING_DATA_SHEETS.map(name => [name, []])) } } };
    db.insert(schema.snapshots).values({ id, spreadsheetId: 'current', createdAt, data: JSON.stringify(data) }).run();
    for (const name of Object.keys(rowsByDept)) db.insert(schema.procurementRows).values({ snapshotId: id,
      departmentId: name, rowIndex: DEPT_HEADER_ROWS + 1, cellsJson: JSON.stringify(buildCellDict(row)), createdAt }).run();
    expect(integrity.verifiedBaselineRows({ id, createdAt }).error).toBeNull();
  }
  function fillers(count: number, date: string, weekly: boolean) {
    for (let i = 0; i < count; i++) {
      const id = `legacy-${i}`, createdAt = new Date(Date.parse(date) + i * 1000).toISOString();
      db.insert(schema.snapshots).values({ id, spreadsheetId: 'current', createdAt,
        data: JSON.stringify({ id, createdAt, rowsByDept: {}, ...(weekly ? { weeklyTableContext: {} } : {}) }) }).run();
    }
  }
  function live() {
    snapshots.setDeptSheetCache(Object.fromEntries(Object.keys(DEPARTMENT_SPREADSHEETS).map(name => [name, { values: [[], [], [], row], formulas: [], sheetName: name }])));
    snapshots.setDeptLoadMeta(Object.fromEntries(Object.keys(DEPARTMENT_SPREADSHEETS).map(name => [name, { loadedAt: new Date(now).toISOString(), rowCount: 1, sheetName: name }])));
  }
  return { db, schema, snapshots, integrity, config, control, fillers, live, now, pruneSnapshotsByRetention, getWeeklyProcurementLineage };
}

describe('C07 — сохранённые legacy-попытки не закрывают доступ к пригодным донорам', () => {
  it('сырое чтение проходит больше 50 пустых кандидатов без удаления legacy', async () => {
    const f = current;
    f.control('raw-good', '2026-10-15T00:00:00.000Z');
    f.fillers(50, '2026-10-15T01:00:00Z', false);
    expect(f.pruneSnapshotsByRetention(new Date(f.now))).toBe(0);
    const { productCalendarDay } = await import('./product-calendar.js');
    const day = productCalendarDay(new Date('2026-10-15T00:00:00Z'), f.config.weeklySnapshot.utcOffsetHours);
    expect(f.snapshots.getSnapshotAtOrBefore(day)?.id).toBe('raw-good');
    expect(f.db.select().from(f.schema.snapshots).all()).toHaveLength(51);
  });

  it('integrity и lineage находят проверенные дни за 500 неполными попытками и сохраняют gap', async () => {
    const f = current;
    f.control('older-good', '2026-10-01T00:00:00.000Z');
    f.control('newer-good', '2026-10-08T00:00:00.000Z');
    f.fillers(500, '2026-10-15T01:00:00Z', true);
    expect(f.pruneSnapshotsByRetention(new Date(f.now))).toBe(0);
    f.live();
    expect(f.integrity.buildComparison(f.now).comparison).not.toBeNull();
    const result = f.getWeeklyProcurementLineage({ weeks: 2, limit: 20, offset: 0, now: f.now });
    expect(result.periods).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromId: 'older-good', toId: 'newer-good', status: 'checked' }),
      expect.objectContaining({ status: 'unavailable' }),
    ]));
    expect(f.db.select().from(f.schema.snapshots).all()).toHaveLength(502);
  });

  it('cron не объявляет неполную попытку завершённым контролем и находит старший проверенный день', async () => {
    const f = current;
    f.control('verified', '2026-10-08T06:00:00.000Z');
    f.fillers(500, '2026-10-15T01:00:00Z', true);
    const { collectSnapshotDays } = await import('./weekly-snapshot-cron.js');
    const { productCalendarDay } = await import('./product-calendar.js');
    const days = await collectSnapshotDays(productCalendarDay(new Date(f.now), 12), 12);
    expect(days).toEqual([productCalendarDay(new Date('2026-10-08T00:00:00Z'), 12)]);
  });

  it('последний проверенный срез дня остаётся основанием, более новые неполные попытки объяснены', async () => {
    const f = current;
    f.control('older-good', '2026-10-01T00:00:00.000Z');
    f.control('same-day-good', '2026-10-08T00:00:00.000Z');
    f.fillers(500, '2026-10-08T01:00:00Z', true);
    f.live();
    const result = f.getWeeklyProcurementLineage({ weeks: 1, limit: 20, offset: 0, now: f.now });
    expect(result.periods[0]).toMatchObject({ fromId: 'older-good', toId: 'same-day-good', status: 'checked', toAt: '2026-10-08T00:00:00.000Z' });
    expect(result.periods[0].notes.join(' ')).toContain('500');
    expect(f.integrity.buildComparison(f.now).note).toContain('500');
  });
});
