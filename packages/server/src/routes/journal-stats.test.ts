/**
 * journal-stats.test.ts — страж статистики журнала за период.
 *
 * ЗАЧЕМ. Отсечка по времени и подсчёт переехали из памяти обработчика в базу:
 * раньше маршрут поднимал ВЕСЬ аудит-лог и ВСЮ историю замечаний со всеми
 * колонками и выбрасывал почти всё первой строкой цикла. Переезд имеет право
 * менять только скорость, поэтому здесь закреплена АРИФМЕТИКА: что попадает в
 * окно, что остаётся за ним, как считаются разные люди по двум таблицам сразу
 * и что смена статуса по-прежнему учитывается дважды (из аудит-лога и из
 * истории) — это прежнее поведение, а не новое решение.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

/** Внутри окна тридцати дней. */
const inside = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
/** Заведомо за окном. */
const outside = () => new Date(Date.now() - 400 * 86_400_000).toISOString();

describe('GET /api/journal/stats', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
    };

    const { db, schema } = await import('../db/index.js');

    db.insert(schema.auditLog).values([
      // В окне: две правки, ошибка ввода, создание замечания, смена статуса.
      // Двенадцать часов назад: попадает и в окно суток, и в окно тридцати дней.
      { action: 'cell_edit', timestamp: inside(0.5), userId: 'Иванова' },
      { action: 'edit', timestamp: inside(2), userId: 'Иванова' },
      { action: 'edit', timestamp: inside(3), userId: 'Петров' },
      { action: 'input_error', timestamp: inside(4), userId: 'Петров' },
      { action: 'issue_create', timestamp: inside(5), userId: null },
      { action: 'issue_status', timestamp: inside(6), userId: 'Петров' },
      // За окном — не считается ничем, включая уникального человека.
      { action: 'edit', timestamp: outside(), userId: 'Забытый' },
    ]).run();

    db.insert(schema.issues).values({
      id: 'ISS-1', severity: 'high', origin: 'pipeline', category: 'data',
      title: 'Замечание', status: 'open', detectedAt: inside(9),
    }).run();

    db.insert(schema.issueHistory).values([
      // В окне: закрыто и снято — обе идут в issueResolved.
      { issueId: 'ISS-1', fromStatus: 'open', toStatus: 'resolved', timestamp: inside(2), userId: 'Сидорова' },
      { issueId: 'ISS-1', fromStatus: 'open', toStatus: 'closed', timestamp: inside(3), userId: 'Иванова' },
      // В окне, но статус не «решено»: человек считается, событие — нет.
      { issueId: 'ISS-1', fromStatus: 'open', toStatus: 'in_progress', timestamp: inside(4), userId: 'Новикова' },
      // За окном.
      { issueId: 'ISS-1', fromStatus: 'open', toStatus: 'resolved', timestamp: outside(), userId: 'Забытая' },
    ]).run();

    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  async function stats(query = ''): Promise<Record<string, unknown>> {
    const res = await app.inject({ method: 'GET', url: `/api/journal/stats${query}` });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('считает только то, что попало в окно периода', async () => {
    const body = await stats();
    // Шесть записей аудит-лога в окне; седьмая (400 дней назад) не в счёт.
    expect(body.totalActions).toBe(6);
    expect(body.editCount).toBe(2);
    expect(body.errorCount).toBe(1);
    expect(body.issueCreated).toBe(1);
  });

  it('разные люди из двух таблиц сводятся в одно множество', async () => {
    const body = await stats();
    // Иванова, Петров (аудит) + Сидорова, Новикова (история); Иванова из
    // истории — тот же человек и второй раз не считается. «Забытые» за окном.
    expect(body.uniqueUsers).toBe(4);
  });

  it('смена статуса считается и из аудит-лога, и из истории — как раньше', async () => {
    const body = await stats();
    // 1 запись issue_status + 2 перехода в resolved/closed = 3.
    expect(body.issueResolved).toBe(3);
  });

  it('подпись периода склоняется по-русски', async () => {
    expect((await stats()).period).toBe('30 дней');
    expect((await stats('?days=1')).period).toBe('1 день');
    expect((await stats('?days=2')).period).toBe('2 дня');
  });

  it('бессмысленный период не роняет маршрут, а откатывается к тридцати дням', async () => {
    // ?days=abc раньше давал new Date(NaN).toISOString() → 500.
    expect((await stats('?days=abc')).period).toBe('30 дней');
    expect((await stats('?days=-5')).period).toBe('30 дней');
  });

  it('узкое окно отсекает даже свежие записи', async () => {
    // Сутки: в окне остаётся одна правка (1 день назад) — граница живая, а не
    // декоративная.
    const body = await stats('?days=1');
    expect(body.totalActions).toBe(1);
  });
});
