/**
 * Сквозной страж: последний контрольный четверг → действующие книги в кэше.
 * Нельзя подменять текущую сторону суточным SQL-снимком, смешивать отсутствующий
 * источник с нулём пропаж или называть вероятную перенумерацию доказанной.
 * Все данные теста вымышленные; Google и production не используются.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const databaseDir = mkdtempSync(join(tmpdir(), 'weekly-validation-'));
const databasePath = join(databaseDir, 'test.db');

const ENV = { ...process.env };
const CONTROL_AT = '2026-10-08T06:00:00.000Z';
const CURRENT_AT = '2026-10-12T08:00:00.000Z';
const NOW = Date.parse('2026-10-12T08:30:00.000Z');

describe('контрольная сверка с действующими книгами', () => {
  let snapshot: typeof import('../services/snapshot.js');
  let integrity: typeof import('./integrity.js');
  let dbModule: typeof import('../db/index.js');
  let departmentNames: string[];

  const sheet = (number: string): unknown[][] => {
    const r = new Array<unknown>(32).fill('');
    r[0] = number;
    r[2] = 'МБОУ СОШ № 1';
    r[6] = 'Ремонт кровли';
    r[10] = 100;
    r[11] = 'ЕП';
    return [[], [], [], r];
  };

  beforeAll(async () => {
    process.env = {
      ...ENV,
      NODE_ENV: 'test',
      SQLITE_PATH: databasePath,
      PRODUCT_TZ_OFFSET_HOURS: '12',
      LOG_LEVEL: 'silent',
    };
    vi.resetModules();
    dbModule = await import('../db/index.js');
    const config = await import('../config.js');
    const shared = await import('@aemr/shared');
    snapshot = await import('../services/snapshot.js');
    integrity = await import('./integrity.js');
    departmentNames = Object.keys(config.DEPARTMENT_SPREADSHEETS);
    expect(departmentNames).toHaveLength(8);

    // Контрольный снимок с реальным sealed-contract и всеми восемью книгами.
    const core = await import('@aemr/core');
    const baselineRows = Object.fromEntries(departmentNames.map((name) => [
      name, [sheet('10')[3]],
    ]));
    const weeklyContext = {
      contract: 'dash-weekly-table-context-v1',
      sealedAt: CONTROL_AT,
      masters: Object.fromEntries(departmentNames.map((name) => [
        name, { formulasRead: true },
      ])),
      monitoring: {
        readAt: CONTROL_AT,
        version: 7,
        sheets: Object.fromEntries(core.MONITORING_DATA_SHEETS.map((name) => [name, [[name]]])),
      },
    };

    dbModule.db.insert(dbModule.schema.snapshots).values([
      {
        id: 'control-previous',
        spreadsheetId: 'test',
        createdAt: '2026-10-01T06:00:00.000Z',
        data: JSON.stringify({
          weeklyTableContext: { contract: 'dash-weekly-table-context-v1' },
        }),
      },
      {
        id: 'control-latest',
        spreadsheetId: 'test',
        createdAt: CONTROL_AT,
        data: JSON.stringify({
          weeklyTableContext: weeklyContext,
          rowsByDept: baselineRows,
        }),
      },
      {
        id: 'daily-not-control',
        spreadsheetId: 'test',
        createdAt: '2026-10-10T07:00:00.000Z',
        data: JSON.stringify({ rowsByDept: { УО: [] } }),
      },
    ]).run();

    const rows = departmentNames.map((name) => ({
      snapshotId: 'control-latest',
      departmentId: shared.findDept(name)!.latinId,
      rowIndex: 4,
      cellsJson: JSON.stringify(shared.buildCellDict(sheet('10')[3])),
      subject: 'Ремонт кровли',
      planAmount: 100,
      factAmount: null,
      createdAt: CONTROL_AT,
    }));
    dbModule.db.insert(dbModule.schema.procurementRows).values(rows).run();
  });

  beforeEach(() => {
    const current = Object.fromEntries(departmentNames.map((name) => [
      name,
      { sheetName: 'ВСЕ', values: sheet(name === 'УО' ? '15' : '10'), formulas: [] },
    ]));
    snapshot.setDeptSheetCache(current);
    snapshot.setDeptLoadMeta(Object.fromEntries(departmentNames.map((name) => [
      name, { loadedAt: CURRENT_AT, sheetName: 'ВСЕ', rowCount: 4 },
    ])));
    integrity.resetIntegrityCache();
  });

  afterAll(() => {
    dbModule.db.$client.close();
    rmSync(databaseDir, { recursive: true, force: true });
    process.env = ENV;
    vi.resetModules();
  });

  it('reuses verified baseline reads without sharing mutable results', () => {
    const ref = { id: 'control-latest', createdAt: CONTROL_AT };
    const select = vi.spyOn(dbModule.db, 'select');
    try {
      const first = integrity.verifiedBaselineRows(ref);
      expect(first.error).toBeNull();
      const expected = structuredClone(first.rows);
      const reads = select.mock.calls.length;
      const row = [...first.rows.values()].flat()[0];
      expect(row).toBeDefined();
      row!.subject = 'caller mutation';
      first.rows.clear();
      expect(integrity.verifiedBaselineRows(ref).rows).toEqual(expected);
      expect(select).toHaveBeenCalledTimes(reads);
    } finally { select.mockRestore(); }
  });

  it('revalidates a baseline after external writes and does not retain rolled-back validation', () => {
    const ref = { id: 'control-latest', createdAt: CONTROL_AT };
    expect(integrity.verifiedBaselineRows(ref).error).toBeNull();
    const external = new Database(databasePath);
    const original = external.prepare('SELECT data FROM snapshots WHERE id=?').pluck().get(ref.id) as string;
    try {
      external.prepare('UPDATE snapshots SET data=? WHERE id=?').run('{}', ref.id);
      expect(integrity.verifiedBaselineRows(ref).error).not.toBeNull();
    } finally {
      external.prepare('UPDATE snapshots SET data=? WHERE id=?').run(original, ref.id);
      external.close();
    }
    expect(integrity.verifiedBaselineRows(ref).error).toBeNull();
    const connection = dbModule.db.$client;
    connection.exec('BEGIN');
    try {
      connection.prepare('UPDATE snapshots SET data=? WHERE id=?').run('{}', ref.id);
      expect(integrity.verifiedBaselineRows(ref).error).not.toBeNull();
    } finally { connection.exec('ROLLBACK'); }
    expect(integrity.verifiedBaselineRows(ref).error).toBeNull();
  });

  it('сопоставляет текущее чтение с последним sealed-контролем, не с вчерашним SQL-снимком', () => {
    const { comparison, note } = integrity.buildComparison(NOW);
    expect(note).toBe('');
    expect(comparison?.baselineId).toBe('control-latest');
    expect(comparison?.beforeAt).toBe(CONTROL_AT);
    expect(comparison?.afterAt).toBe(CURRENT_AT);
    expect(comparison?.oldestCurrentAt).toBe(CURRENT_AT);
    expect(comparison?.unavailableBooks).toEqual([]);
    expect(comparison?.vanishedTotal).toBe(1);
    const uo = comparison?.books.find((x) => x.dept === 'УО');
    expect(uo?.vanished[0]?.rowSeq).toBe('10');
    expect(uo?.identityCandidates).toEqual([
      expect.objectContaining({ beforeRowSeq: '10', afterRowSeq: '15', status: 'needs-review' }),
    ]);
  });

  it('HTTP-кэш переключает недельную базу на границе понедельника без ожидания TTL', async () => {
    snapshot.setDeptLoadMeta(Object.fromEntries(departmentNames.map((name) => [
      name, { loadedAt: '2026-10-11T11:59:58Z', sheetName: 'ВСЕ', rowCount: 4 },
    ])));
    const app = (await import('fastify')).default({ logger: false });
    await app.register(integrity.integrityRoutes);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T11:59:59Z'));
    try {
      const sunday = await app.inject({ url: '/api/integrity' });
      expect(sunday.statusCode).toBe(200);
      expect(sunday.json().comparison).toBeNull();
      clock.mockReturnValue(Date.parse('2026-10-11T12:00:00Z'));
      const monday = await app.inject({ url: '/api/integrity' });
      expect(monday.statusCode).toBe(200);
      expect(monday.json().comparison?.baselineId).toBe('control-latest');
    } finally {
      clock.mockRestore();
      await app.close();
    }
  });

  it('незавершённая новая попытка не заслоняет последний полностью проверенный контроль', () => {
    const id = 'control-incomplete-newer';
    dbModule.db.insert(dbModule.schema.snapshots).values({
      id, spreadsheetId: 'test', createdAt: '2026-10-08T07:00:00.000Z',
      data: JSON.stringify({ weeklyTableContext: { contract: 'dash-weekly-table-context-v1' } }),
    }).run();
    try {
      const result = integrity.buildComparison(NOW);
      expect(result.comparison?.baselineId).toBe('control-latest');
      expect(result.comparison?.beforeAt).toBe(CONTROL_AT);
      expect(result.comparison?.vanishedTotal).toBe(1);
      expect(result.note).toContain('неполных');
    } finally {
      dbModule.db.delete(dbModule.schema.snapshots).where(eq(dbModule.schema.snapshots.id, id)).run();
    }
  });

  it('отказ текущей книги даёт неполную сверку, а не ложное исчезновение', () => {
    snapshot.setDeptSheetCache({}, ['УО']);
    snapshot.setDeptLoadMeta({
      УО: { loadedAt: CURRENT_AT, sheetName: 'ВСЕ', rowCount: 0, error: 'таймаут' },
    });
    const { comparison, note } = integrity.buildComparison(NOW);
    expect(comparison).not.toBeNull();
    expect(comparison?.vanishedTotal).toBe(0);
    expect(comparison?.unavailableBooks).toContainEqual(expect.objectContaining({ dept: 'УО' }));
    expect(note).toContain('частичное');
  });

  it('книга, прочитанная до контрольного среза, не считается текущей', () => {
    snapshot.setDeptLoadMeta({
      УО: { loadedAt: '2026-10-07T06:00:00.000Z', sheetName: 'ВСЕ', rowCount: 4 },
    });
    const { comparison } = integrity.buildComparison(NOW);
    expect(comparison?.vanishedTotal).toBe(0);
    expect(comparison?.unavailableBooks.some((x) => x.dept === 'УО')).toBe(true);
  });

  it('устаревший кэш без принудительной перечитки не выдаётся за сейчас', () => {
    snapshot.setDeptLoadMeta({
      УО: { loadedAt: '2026-10-09T06:00:00.000Z', sheetName: 'ВСЕ', rowCount: 4 },
    });
    const { comparison } = integrity.buildComparison(NOW);
    expect(comparison?.vanishedTotal).toBe(0);
    expect(comparison?.unavailableBooks).toContainEqual(expect.objectContaining({
      dept: 'УО', reason: expect.stringContaining('устарело'),
    }));
  });
  it('контроль без строки-атома не даёт ложной сверки даже при наличии текущих книг', () => {
    const id = 'control-latest';
    const old = dbModule.db.select({ data: dbModule.schema.snapshots.data })
      .from(dbModule.schema.snapshots).where(eq(dbModule.schema.snapshots.id, id)).get();
    expect(old?.data).toBeTruthy();
    const parsed = JSON.parse(old!.data!) as Record<string, unknown>;
    const prior = parsed.weeklyTableContext;
    try {
      dbModule.db.update(dbModule.schema.snapshots)
        .set({ data: JSON.stringify({ ...parsed, weeklyTableContext: { contract: 'dash-weekly-table-context-v1' } }) })
        .where(eq(dbModule.schema.snapshots.id, id)).run();
      const result = integrity.buildComparison(NOW);
      expect(result.comparison).toBeNull();
      expect(result.note).toContain('не пригоден');
    } finally {
      dbModule.db.update(dbModule.schema.snapshots)
        .set({ data: JSON.stringify({ ...parsed, weeklyTableContext: prior }) })
        .where(eq(dbModule.schema.snapshots.id, id)).run();
    }
  });

});

describe('контекстная смена без перенумерации', () => {
  it('фиксируется в Core и при сверке с недельным контролем', async () => {
    // Это отдельный инвариант ядра: совпадение A не является доказательством
    // неизменности закупки. Тест контракта не касается Google и БД.
    const before = [{
      rowSeq: '10', sheetRow: 4, subject: 'Ремонт кровли', subordinate: 'МБОУ СОШ № 1', method: 'ЕП', planSum: 100,
    }];
    const after = [{
      rowSeq: '10', sheetRow: 4, subject: 'Канцелярские товары', subordinate: 'МБОУ СОШ № 1', method: 'ЕП', planSum: 100,
    }];
    expect((await import('@aemr/core')).diffSnapshots(before, after).contextChanged?.[0]).toMatchObject({
      rowSeq: '10', beforeSubject: 'Ремонт кровли', afterSubject: 'Канцелярские товары',
    });
  });
});

