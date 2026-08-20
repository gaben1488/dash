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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Среда выставляется до импорта: config.js читает её при первом импорте.
process.env.NODE_ENV = 'test';
process.env.AEMR_API_KEY = '';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';

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

/**
 * Приложение и лист-фикстура строятся ОДИН раз на файл.
 *
 * Прежде каждый тест звал vi.resetModules() и поднимал Fastify заново:
 * четыре полных сборки графа сервера давали 50+ секунд и плавающий
 * таймаут под нагрузкой — тест падал не из-за логики, а из-за занятого
 * процессора. Все четыре теста работают с одной и той же фикстурой
 * (3 строки заголовка + 2 строки данных, валидные строки листа 2..5),
 * изоляция между ними нужна только по счётчику вызовов записи — его и
 * сбрасываем.
 */
const DATA_ROWS = 2;
let app: FastifyInstance;

beforeAll(async () => {
  const [{ setDeptSheetCache }, { createApp: build }] = await Promise.all([
    import('./services/snapshot.js'),
    import('./app.js'),
  ]);

  const rows = Array.from({ length: DATA_ROWS }, (_, i) => makeDataRow(i + 1));
  setDeptSheetCache({
    УО: { values: [[], [], [], ...rows], formulas: [], sheetName: 'ВСЕ' },
  });

  app = await build({ logger: false });
  await app.ready();
}, /* Шов 18 реестра швов (сверка 18.08.2026): холодная сборка всего графа
   сервера ради этой проверки укладывалась в 64 секунды при пределе в 60 — набор
   падал на подготовке, а не на существе. Предел поднят с запасом; сокращать его
   имеет смысл только вместе с отказом поднимать приложение целиком. */ 120_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => writeCellValue.mockClear());

describe('PUT /api/rows/:deptId/:rowIndex/field — верхняя граница строки', () => {
  it('отклоняет строку за пределами листа и НЕ пишет в таблицу', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/rows/uo/99999/field',
        payload: { field: 'G', value: 'вписано мимо данных' },
      });

      expect(res.statusCode).toBe(400);
      expect(writeCellValue).not.toHaveBeenCalled();
  }, 30_000);

  it('отклоняет первую строку сразу за последней (граница на единицу)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/rows/uo/6/field',
        payload: { field: 'G', value: 'off-by-one' },
      });

      expect(res.statusCode).toBe(400);
      expect(writeCellValue).not.toHaveBeenCalled();
  }, 30_000);

  it('пропускает последнюю существующую строку', async () => {
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
  }, 30_000);
});

describe('POST /api/data/rows (batch) — та же верхняя граница', () => {
  it('отклоняет запись за пределами листа и НЕ пишет в таблицу', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/data/rows',
        payload: { rows: [{ deptId: 'uo', rowIndex: 99999, changes: { G: 'мимо' } }] },
      });

      // Разбор пакета — поштучный, но код ответа отличает «сохранено всё» от
      // «сохранено не всё» (реестр багов 09.07.2026, п.16): раньше здесь
      // стояло 200 и ответ не отличался от полного успеха.
      expect(res.statusCode).toBe(207);
      const body = res.json<{ results: Array<{ success: boolean; error?: string }> }>();
      expect(body.results[0].success).toBe(false);
      expect(writeCellValue).not.toHaveBeenCalled();
  }, 30_000);
});
