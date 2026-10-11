/**
 * Сквозной страж: последний контрольный четверг → действующие книги в кэше.
 * Нельзя подменять текущую сторону суточным SQL-снимком, смешивать отсутствующий
 * источник с нулём пропаж или называть вероятную перенумерацию доказанной.
 * Все данные теста вымышленные; Google и production не используются.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV = { ...process.env };
const CONTROL_AT = '2026-10-08T06:00:00.000Z';
const CURRENT_AT = '2026-10-11T08:00:00.000Z';
const NOW = Date.parse('2026-10-11T08:30:00.000Z');

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
      SQLITE_PATH: ':memory:',
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

    // Исторический недельный контроль: все восемь masters, у каждого атом.
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
          weeklyTableContext: { contract: 'dash-weekly-table-context-v1' },
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
      cellsJson: JSON.stringify({
        A: '10', C: 'МБОУ СОШ № 1', G: 'Ремонт кровли', L: 'ЕП',
      }),
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
    process.env = ENV;
    vi.resetModules();
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
});
