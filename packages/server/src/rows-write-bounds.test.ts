/**
 * Границы записи в живую Google-таблицу.
 *
 * Инвариант: запись разрешена только в существующую строку данных.
 * Нижняя граница (idx >= 2, строка 1 — заголовок) уже проверялась; ВЕРХНЕЙ не было:
 * PUT /api/rows/uo/99999/field проходил валидацию и звал writeCellValue('G99999')
 * на боевой таблице — за пределами данных, потенциально по итоговым/формульным строкам.
 * Кэш при этом молча не обновлялся (values[idx-1] === undefined), поэтому сервер
 * выглядел согласованным, а таблица уже была испорчена.
 *
 * Регрессия P0 (bug-hunt 2026-07-09, CONFIRMED двумя линзами): rows.ts:410 (single) и :573 (batch).
 * GET-собрат (rows.ts:334) границу проверял всегда — асимметрия и была багом.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const writeCellValue = vi.fn(async () => ({ updatedCells: 1 }));

vi.mock('./services/google-sheets.js', () => ({
  writeCellValue,
  getSheetData: vi.fn(async () => []),
  getSheetDataFromSpreadsheet: vi.fn(async () => []),
  readDeptSheet: vi.fn(async () => ({ values: [], formulas: [], sheetName: 'ВСЕ' })),
  resolveDeptSheetName: vi.fn(async () => 'ВСЕ'),
}));

/** Лист: 3 строки заголовка + N строк данных. Валидные для записи sheet-строки: 2..(3+N). */
function makeDataRow(id: number): unknown[] {
  const row = Array<unknown>(32).fill('');
  row[0] = id; // A
  row[6] = `Закупка ${id}`; // G
  return row;
}

async function createApp(dataRowCount: number): Promise<FastifyInstance> {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
  };

  const [{ setDeptSheetCache }, { createApp: build }] = await Promise.all([
    import('./services/snapshot.js'),
    import('./app.js'),
  ]);

  const rows = Array.from({ length: dataRowCount }, (_, i) => makeDataRow(i + 1));
  setDeptSheetCache({
    УО: { values: [[], [], [], ...rows], formulas: [], sheetName: 'ВСЕ' },
  });

  return build({ logger: false });
}

beforeEach(() => writeCellValue.mockClear());
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('PUT /api/rows/:deptId/:rowIndex/field — верхняя граница строки', () => {
  it('отклоняет строку за пределами листа и НЕ пишет в таблицу', async () => {
    const app = await createApp(2); // валидные строки: 2..5
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/rows/uo/99999/field',
        payload: { field: 'G', value: 'вписано мимо данных' },
      });

      expect(res.statusCode).toBe(400);
      expect(writeCellValue).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }, 30_000);

  it('отклоняет первую строку сразу за последней (граница на единицу)', async () => {
    const app = await createApp(2); // последняя валидная — 5
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/rows/uo/6/field',
        payload: { field: 'G', value: 'off-by-one' },
      });

      expect(res.statusCode).toBe(400);
      expect(writeCellValue).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }, 30_000);

  it('пропускает последнюю существующую строку', async () => {
    const app = await createApp(2); // последняя валидная — 5
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/rows/uo/5/field',
        payload: { field: 'G', value: 'валидная правка' },
      });

      expect(res.statusCode).toBe(200);
      expect(writeCellValue).toHaveBeenCalledTimes(1);
      expect(writeCellValue).toHaveBeenCalledWith(
        expect.any(String), 'ВСЕ', 'G5', 'валидная правка',
      );
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe('POST /api/data/rows (batch) — та же верхняя граница', () => {
  it('отклоняет запись за пределами листа и НЕ пишет в таблицу', async () => {
    const app = await createApp(2);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/data/rows',
        payload: { rows: [{ deptId: 'uo', rowIndex: 99999, changes: { G: 'мимо' } }] },
      });

      expect(res.statusCode).toBe(200); // batch отвечает поштучно
      const body = res.json<{ results: Array<{ success: boolean; error?: string }> }>();
      expect(body.results[0].success).toBe(false);
      expect(writeCellValue).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  }, 30_000);
});
