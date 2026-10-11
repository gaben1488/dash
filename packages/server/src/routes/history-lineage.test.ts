/**
 * Сквозной контракт недельной истории: SQL-снимки → проверка их атомов →
 * контекстные события → реальный HTTP-маршрут. Все значения синтетические.
 * Никаких Google-обращений, новых таблиц или записи в production.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ENV = { ...process.env };
const PREVIOUS = '2026-10-01T06:00:00.000Z';
const CURRENT = '2026-10-08T06:00:00.000Z';

describe('GET /api/history/procurement-lineage — восстановление из сохранённого контроля', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env = {
      ...ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      PRODUCT_TZ_OFFSET_HOURS: '12',
      LOG_LEVEL: 'silent',
    };
    vi.resetModules();

    const { db, schema } = await import('../db/index.js');
    const { DEPARTMENT_SPREADSHEETS } = await import('../config.js');
    const { MONITORING_DATA_SHEETS } = await import('@aemr/core');
    const { buildCellDict, findDept } = await import('@aemr/shared');
    const departments = Object.keys(DEPARTMENT_SPREADSHEETS);
    expect(departments).toHaveLength(8);

    const row = (seq: string): unknown[] => {
      const cells = new Array<unknown>(32).fill('');
      cells[0] = seq;
      cells[2] = 'МБОУ СОШ № 1';
      cells[6] = 'Учебные пособия';
      cells[10] = 100;
      cells[11] = 'ЕП';
      return cells;
    };

    const context = (at: string) => ({
      contract: 'dash-weekly-table-context-v1',
      sealedAt: at,
      masters: Object.fromEntries(departments.map((name) => [
        name, { formulasRead: true },
      ])),
      monitoring: {
        readAt: at,
        version: 7,
        sheets: Object.fromEntries(MONITORING_DATA_SHEETS.map((name) => [
          name, [[name]],
        ])),
      },
    });
    const rowsByDept = (updated: boolean) => Object.fromEntries(
      departments.map((name) => [
        name,
        [row(updated && name === 'УО' ? '15' : '10')],
      ]),
    );
    const first = rowsByDept(false);
    const second = rowsByDept(true);

    db.insert(schema.snapshots).values([
      {
        id: 'week-1', spreadsheetId: 'synthetic',
        createdAt: PREVIOUS,
        data: JSON.stringify({ rowsByDept: first, weeklyTableContext: context(PREVIOUS) }),
      },
      {
        id: 'week-2', spreadsheetId: 'synthetic',
        createdAt: CURRENT,
        data: JSON.stringify({ rowsByDept: second, weeklyTableContext: context(CURRENT) }),
      },
    ]).run();

    const atoms = (id: string, at: string, source: Record<string, unknown[][]>) =>
      departments.map((name) => ({
        snapshotId: id,
        departmentId: findDept(name)!.latinId,
        rowIndex: 4,
        cellsJson: JSON.stringify(buildCellDict(source[name][0])),
        subject: 'Учебные пособия',
        planAmount: 100,
        factAmount: null,
        createdAt: at,
      }));
    db.insert(schema.procurementRows).values([
      ...atoms('week-1', PREVIOUS, first),
      ...atoms('week-2', CURRENT, second),
    ]).run();

    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = ENV;
    vi.resetModules();
  });

  it('видит недельную гипотезу перенумерации, не выдаёт её за доказанное удаление', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/history/procurement-lineage?book=%D0%A3%D0%9E&weeks=1&limit=1',
    });
    expect(res.statusCode).toBe(200);
    const data = res.json<{
      source: string; anchorId: string | null; total: number; nextOffset: number | null;
      periods: Array<{ status: string; fromId: string; toId: string }>;
      events: Array<{ entry: {
        kind: string; rowSeq: string; relatedRowSeq: string;
        author: string | null; at: string | null; comparisonEvidence: { baselineId: string };
      } }>;
    }>();
    expect(data.source).toBe('confirmed-weekly-snapshots');
    expect(data.anchorId).toBe('week-2');
    expect(data.periods).toMatchObject([{ fromId: 'week-1', toId: 'week-2', status: 'checked' }]);
    expect(data.total).toBe(1);
    expect(data.nextOffset).toBeNull();
    expect(data.events[0].entry).toMatchObject({
      kind: 'row-identity-candidate',
      rowSeq: '10', relatedRowSeq: '15',
      author: null, at: null,
      comparisonEvidence: { baselineId: 'week-1' },
    });
  });

  it('фильтр книги изолирует чужие номера; якорь фиксирует страницу истории', async () => {
    const other = await app.inject({
      method: 'GET',
      url: '/api/history/procurement-lineage?book=%D0%A3%D0%A4%D0%91%D0%9F&anchor=week-2',
    });
    expect(other.statusCode).toBe(200);
    const body = other.json<{ anchorId: string; total: number; periods: unknown[] }>();
    expect(body.anchorId).toBe('week-2');
    expect(body.total).toBe(0);
    expect(body.periods).toHaveLength(1);
  });
});
