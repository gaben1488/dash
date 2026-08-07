/**
 * Страж продуктового вида серверных ответов (зона «Серверные ответы»).
 *
 * Что охраняется — ровно три обещания, каждое из которых уже нарушалось:
 *   1. Текст ошибки — по-русски и с действием; ни одного внутреннего ключа
 *      (статуса «wont_fix», обозначения колонки «K», имени поля «spreadsheetId»).
 *   2. Код ответа осмыслен: 404 — нет такого, 400 — неверный параметр,
 *      403 — запрещено правилом, 503 — источник недоступен.
 *   3. Фильтр журнала не притворяется: правка ячейки попадает в тип «edit»,
 *      по которому веб рисует чип, — раньше счётчик всегда показывал ноль.
 *
 * Плюс удалённый дубль /api/history: маршрут должен отвечать 404, а его
 * возможность (?limit) — жить в /api/history/snapshots.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.AEMR_API_KEY = '';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';

// Сеть в тесте запрещена: снимок обязан честно падать в демо, а не ходить в
// живые книги с машинных учёток разработчика.
vi.mock('../google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('network disabled in test'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('network disabled in test'); }),
  getSheetData: vi.fn(async () => { throw new Error('network disabled in test'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('network disabled in test'); }),
}));

const writeCellValue = vi.fn(async () => ({ updatedCells: 1, updatedRange: 'ВСЕ!G5' }));

vi.mock('../services/google-sheets.js', () => ({
  writeCellValue,
  getSheetData: vi.fn(async () => []),
  getSheetDataFromSpreadsheet: vi.fn(async () => []),
  readDeptSheet: vi.fn(async () => ({ values: [], formulas: [], sheetName: 'ВСЕ' })),
  resolveDeptSheetName: vi.fn(async () => 'ВСЕ'),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('network disabled in test'); }),
}));

/** Лист-фикстура: 3 строки шапки + 2 строки данных (валидные строки 2..5). */
function makeDataRow(id: number): unknown[] {
  const row = Array<unknown>(34).fill('');
  row[0] = id;
  row[6] = `Закупка ${id}`;
  return row;
}

let app: FastifyInstance;

beforeAll(async () => {
  const [{ setDeptSheetCache }, { createApp }] = await Promise.all([
    import('../services/snapshot.js'),
    import('../app.js'),
  ]);

  setDeptSheetCache({
    УО: { values: [[], [], [], makeDataRow(1), makeDataRow(2)], formulas: [], sheetName: 'ВСЕ' },
  });

  app = await createApp({ logger: false });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('удалённые и дублирующие маршруты', () => {
  it('GET /api/history больше не существует — дубль снят', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/history' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/history/snapshots принимает ?limit — возможность дубля не потеряна', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/history/snapshots?limit=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json<unknown[]>().length).toBeLessThanOrEqual(1);
  });
});

describe('тексты ошибок — по-русски, без внутренних обозначений', () => {
  it('неизвестное управление → 404 и человеческая фраза', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rows/нет-такого' });
    expect(res.statusCode).toBe(404);
    const { error } = res.json<{ error: string }>();
    expect(error).toContain('Управление');
    expect(error).not.toMatch(/Отдел/);
  });

  it('формульный столбец → 403 и подпись из шапки книги, а не буква колонки', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/rows/uo/5/field',
      payload: { field: 'K', value: 100 },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json<{ error: string; reason: string }>();
    expect(body.reason).toContain('ИТОГО 1');
    expect(body.reason).not.toMatch(/Колонка K\b/);
    expect(body.reason).toMatch(/[а-яё]/i);
  });

  it('числовой столбец с текстом → 400 и подпись столбца из шапки', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/rows/uo/5/field',
      payload: { field: 'H', value: 'не число' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain('ФБ 1');
  });

  it('несуществующий столбец → 400, сырое обозначение только в технической подсказке', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/rows/uo/5/field',
      payload: { field: 'ZZ', value: 'что-то' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; details?: string }>();
    expect(body.error).not.toMatch(/[A-Za-z]/);
    expect(body.details).toContain('ZZ');
  });

  it('строка за пределами книги → 400 и объяснение, сколько строк есть', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/rows/uo/99999/field',
      payload: { field: 'G', value: 'мимо' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/строк/i);
  });

  it('смена статуса несуществующего замечания → 404, а не выдуманная запись', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/issues/нет-такого-замечания/status',
      payload: { status: 'acknowledged' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toContain('не найдено');
  });

  it('недопустимый переход статуса → 400 и названия состояний, а не ключи', async () => {
    // demo-issue-001 живёт в демо-снимке со статусом «Открыто»; переход
    // «Открыто» → «Исправлено» правилами не предусмотрен.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/issues/demo-issue-001/status',
      payload: { status: 'resolved' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; allowed: string[]; allowedLabels: string[] }>();
    expect(body.error).toContain('Открыто');
    expect(body.error).toContain('Исправлено');
    expect(body.error).not.toMatch(/\b(open|resolved|wont_fix|false_positive|in_progress)\b/);
    // Машинный список ключей остаётся — по нему клиент рисует кнопки.
    expect(body.allowed).toContain('acknowledged');
    expect(body.allowedLabels).toContain('Принято');
  });

  it('комментарий к несуществующему замечанию → 404, а не «Комментарий добавлен»', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/issues/нет-такого-замечания/comment',
      payload: { comment: 'проверка' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toContain('не найдено');
  });
});

describe('журнал — фильтр по правкам считает настоящие правки', () => {
  it('cell_edit попадает в тип edit и в счётчик, а действие названо по-русски', async () => {
    const { db, schema } = await import('../db/index.js');
    db.insert(schema.auditLog).values({
      action: 'cell_edit',
      entity: 'row',
      entityId: 'uo:5:G',
      details: 'проверка счётчика',
      timestamp: new Date().toISOString(),
    }).run();

    const res = await app.inject({ method: 'GET', url: '/api/journal?action=edit' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      entries: Array<{ type: string; action: string }>;
      counts: { byAction: Record<string, number> };
    }>();

    expect(body.counts.byAction.edit).toBeGreaterThan(0);
    const edit = body.entries.find((e) => e.type === 'edit');
    expect(edit?.action).toBe('Правка ячейки');
  });
});
