/**
 * Срок ответа источника.
 *
 * Без срока зависший запрос к Google держит обработчик бесконечно: сокет жив,
 * обещание не разрешается, а вместе с ним стоит и работа, ради которой
 * читателю открыли страницу. Охраняются три обещания:
 *   1. Зависший источник отпускает обработчик по сроку, а не «когда-нибудь».
 *   2. Отказ по сроку опознаётся как недоступность источника (503 и русский
 *      текст), а не как внутренняя поломка продукта.
 *   3. Молчание источника прекращает перебор имён-кандидатов: три имени по
 *      сроку каждое превратили бы двадцать секунд в минуту на одно управление.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEPARTMENT_REGISTRY } from '@aemr/shared';

// Срок читается при загрузке модуля — переменная ставится до импорта.
process.env.AEMR_SHEETS_TIMEOUT_MS = '200';

const valuesGet = vi.fn();
const valuesBatchGet = vi.fn();
const gridGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(() => ({
      spreadsheets: {
        values: { get: valuesGet, batchGet: valuesBatchGet, update: vi.fn() },
        get: gridGet,
      },
    })),
    // Настоящая функция, а не стрелочная: getSheetsApi вызывает её через new.
    auth: { GoogleAuth: vi.fn(function GoogleAuth() { return {}; }) },
  },
}));

/** Обещание, которое не разрешится никогда, — источник «завис». */
function neverResolves(): Promise<never> {
  return new Promise<never>(() => {});
}

beforeEach(() => {
  valuesGet.mockReset();
  valuesBatchGet.mockReset();
  gridGet.mockReset();
  const master = DEPARTMENT_REGISTRY.find(dept => dept.id === 'УО')!;
  gridGet.mockResolvedValue({ data: { sheets: [{ properties: {
    sheetId: master.source.sheetId, title: 'ВСЕ', gridProperties: { columnCount: 34 },
  } }] } });
});

afterEach(() => {
  vi.resetModules();
});

describe('зависший источник', () => {
  it('отпускает обработчик по сроку с русским текстом и кодом «источник недоступен»', async () => {
    valuesGet.mockImplementation(neverResolves);
    const { getSheetData, SheetsUnavailableError } = await import('./google-sheets.js');

    const started = Date.now();
    const failure = await getSheetData('СВОД ТД-ПМ').catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(SheetsUnavailableError);
    const err = failure as InstanceType<typeof SheetsUnavailableError>;
    expect(err.statusCode).toBe(503);
    expect(err.expose).toBe(true);
    expect(err.message).toBe(
      'Таблица-источник не ответила за 200 мс: чтение листа «СВОД ТД-ПМ». Повторите позже.',
    );
    expect(err.message).not.toMatch(/[A-Za-z]/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('в срок передаёт запрос вместе со сроком, чтобы сокет действительно оборвался', async () => {
    valuesGet.mockResolvedValue({ data: { values: [['строка']] } });
    const { getSheetData, SHEETS_TIMEOUT_MS } = await import('./google-sheets.js');

    await expect(getSheetData('СВОД ТД-ПМ')).resolves.toEqual([['строка']]);
    expect(valuesGet.mock.calls[0][1]).toEqual({ timeout: SHEETS_TIMEOUT_MS });
  });

  it('успешный ответ проходит без изменений — срок не создаёт ложных отказов', async () => {
    valuesBatchGet.mockResolvedValue({ data: { valueRanges: [{ range: 'A1', values: [[7]] }] } });
    const { batchGetCells } = await import('./google-sheets.js');

    await expect(batchGetCells(['A1'])).resolves.toEqual([{ range: 'A1', values: [[7]] }]);
  });
});



describe('complete Google Sheets batch response contract', () => {
  it('does not silently substitute an absent main-book range with an empty sheet', async () => {
    valuesBatchGet.mockResolvedValue({ data: { valueRanges: [{ range: "'УО'!A1:AH", values: [[1]] }] } });
    const { batchGetSheetValues } = await import('./google-sheets.js');
    await expect(batchGetSheetValues(['УО', 'УЭР'])).rejects.toThrow('SHEETS_RANGE_RESPONSE_INCOMPLETE');
  });

  it('rejects a dropped required value or formula range before calculating KPIs', async () => {
    valuesBatchGet.mockResolvedValue({ data: { valueRanges: [{ range: 'A1', values: [[7]] }] } });
    const { batchGetCells, batchGetFormulas } = await import('./google-sheets.js');
    await expect(batchGetCells(['A1', 'B2'])).rejects.toThrow('SHEETS_RANGE_RESPONSE_INCOMPLETE');
    await expect(batchGetFormulas(['A1', 'B2'])).rejects.toThrow('SHEETS_RANGE_RESPONSE_INCOMPLETE');
  });

  it('rejects missing workbook value and formula sheets instead of building a partial book', async () => {
    valuesBatchGet.mockResolvedValue({ data: { valueRanges: [] } });
    const { fetchWorkbook } = await import('./google-sheets.js');
    await expect(fetchWorkbook()).rejects.toThrow('SHEETS_RANGE_RESPONSE_INCOMPLETE');
  });

  it('still accepts an explicitly returned empty range as a legitimate empty sheet', async () => {
    valuesBatchGet.mockResolvedValue({ data: { valueRanges: [{ range: "'УО'!A1:AH" }] } });
    const { batchGetSheetValues } = await import('./google-sheets.js');
    await expect(batchGetSheetValues(['УО'])).resolves.toEqual({ УО: [] });
  });
});

it('records a real mocked Sheets read as nested google time in its own HTTP request', async () => {
  valuesGet.mockResolvedValue({ data: { values: [['ячейка']] } });
  const [{ default: Fastify }, { registerRequestTiming, requestStage }, { getSheetData }] = await Promise.all([
    import('fastify'), import('../plugins/request-timing.js'), import('./google-sheets.js'),
  ]);
  const app = Fastify();
  registerRequestTiming(app);
  app.get('/source', request => requestStage(request, 'model', async () => ({
    count: (await getSheetData('СВОД ТД-ПМ')).length,
  })));
  try {
    const response = await app.inject('/source?source=PRIVATE_DO_NOT_LOG');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ count: 1 });
    expect(String(response.headers['server-timing'])).toContain('google;dur=');
    expect(String(response.headers['server-timing'])).toContain('model;dur=');
    expect(String(response.headers['server-timing'])).not.toContain('PRIVATE_DO_NOT_LOG');
  } finally {
    await app.close();
  }
});

describe('перебор имён листа при молчании источника', () => {
  it('останавливается на первом кандидате, а не умножает срок на их число', async () => {
    valuesGet.mockImplementation(neverResolves);
    const { readDeptSheet } = await import('./google-sheets.js');

    await expect(readDeptSheet('УО', 'книга-управления')).rejects.toThrow(/не ответила/);

    const sheetsTried = new Set(
      valuesGet.mock.calls.map((call) => String((call[0] as { range: string }).range).split('!')[0]),
    );
    expect(sheetsTried.size).toBe(1);
  });

  it('в списке отказов управления остаётся причина «не ответила», а не «лист не найден»', async () => {
    valuesGet.mockImplementation(neverResolves);
    const { fetchDepartmentSpreadsheets } = await import('./google-sheets.js');

    const { data, errors } = await fetchDepartmentSpreadsheets({ УО: 'книга-управления' });

    expect(data).toEqual({});
    expect(errors['УО']).toMatch(/не ответила/);
    expect(errors['УО']).not.toMatch(/^No readable sheet found/);
  });
});
