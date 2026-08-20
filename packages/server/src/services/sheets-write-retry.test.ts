/**
 * Страж записи в источник: повтор при временном отказе и след в журнале.
 *
 * ЗАЧЕМ. Правка ячейки была ЕДИНСТВЕННЫМ обращением к Google без повторов — и
 * при этом самым обидным для человека: чтение он повторит обновлением страницы,
 * а правку уже сделал, и на ответ «слишком часто» она просто пропадала. Повтор
 * здесь безопасен потому, что действие не складывается с предыдущим: «в ячейке
 * должно стоять вот это» даёт один и тот же итог, сколько его ни повторяй.
 *
 * Вторая половина стража — журнал. Правка уходила в книгу молча: чтения видно,
 * а собственное изменение продукта невидимо, и разбор «кто поменял число»
 * упирался в пустоту. При этом в журнал не должно попасть само значение: в
 * ячейки вводят и суммы, и фамилии.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const update = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: function GoogleAuth() { /* мок: экземпляр в тесте не используется */ } },
    sheets: () => ({ spreadsheets: { values: { update } } }),
  },
}));

vi.mock('../config.js', () => ({
  config: {
    google: {
      spreadsheetId: 'main',
      serviceAccountEmail: 'writer@example.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nzzz\n-----END PRIVATE KEY-----',
      apiKey: '',
    },
    cache: { ttlSeconds: 300 },
  },
  isDemoMode: false,
}));

/** Отказ googleapis: числовой код в `status`, как его отдаёт библиотека. */
const failure = (status: number): Error => Object.assign(new Error(`status ${status}`), { status });

const okResponse = { data: { updatedRange: 'ВСЕ!L178', updatedCells: 1 } };

describe('запись в ячейку книги', () => {
  let logged: Array<{ level: string; fields: Record<string, unknown>; msg: string }>;

  beforeEach(async () => {
    vi.resetModules();
    update.mockReset();
    logged = [];
    const { setSourceLogger } = await import('./source-log.js');
    setSourceLogger({
      info: (fields, msg) => logged.push({ level: 'info', fields, msg }),
      warn: (fields, msg) => logged.push({ level: 'warn', fields, msg }),
      error: (fields, msg) => logged.push({ level: 'error', fields, msg }),
    });
  });

  afterEach(async () => {
    const { setSourceLogger } = await import('./source-log.js');
    setSourceLogger(null);
  });

  it('«слишком часто» лечится паузой, а не потерей правки', async () => {
    update.mockRejectedValueOnce(failure(429)).mockResolvedValueOnce(okResponse);
    const { writeCellValue } = await import('./google-sheets.js');

    const result = await writeCellValue('book-1', 'ВСЕ', 'L178', '01.08.2026');

    expect(update).toHaveBeenCalledTimes(2);
    expect(result.updatedCells).toBe(1);
    // Пауза названа вслух: молчание на секунду неотличимо от зависания.
    expect(logged.some((l) => l.level === 'warn' && /повтор/.test(l.msg))).toBe(true);
  }, 30_000);

  it('поломка на стороне Google тоже повторяется', async () => {
    update.mockRejectedValueOnce(failure(503)).mockResolvedValueOnce(okResponse);
    const { writeCellValue } = await import('./google-sheets.js');

    await expect(writeCellValue('book-1', 'ВСЕ', 'L178', 100)).resolves.toMatchObject({ updatedCells: 1 });
    expect(update).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('«доступа нет» отдаётся сразу — паузой это не лечится', async () => {
    update.mockRejectedValue(failure(403));
    const { writeCellValue } = await import('./google-sheets.js');

    await expect(writeCellValue('book-1', 'ВСЕ', 'L178', 100)).rejects.toThrow();
    // Ровно одна попытка: три по двадцать секунд не выдадут прав, которых нет.
    expect(update).toHaveBeenCalledTimes(1);
    const failed = logged.find((l) => /не прочитан/.test(l.msg));
    expect(failed?.fields.reason).toBe('нет доступа к книге');
  }, 30_000);

  it('удачная правка оставляет след в журнале — без самого значения', async () => {
    update.mockResolvedValue(okResponse);
    const { writeCellValue } = await import('./google-sheets.js');

    await writeCellValue('book-1', 'ВСЕ', 'L178', 'Иванова Мария Петровна');

    const entry = logged.find((l) => l.level === 'info' && /Источник изменён/.test(l.msg));
    expect(entry).toBeDefined();
    expect(entry?.fields.cells).toBe(1);
    expect(typeof entry?.fields.ms).toBe('number');
    // Ни в тексте, ни в полях записи нет ни значения ячейки, ни адреса книги.
    const dump = JSON.stringify(logged);
    expect(dump).not.toContain('Иванова');
    expect(dump).not.toContain('book-1');
  }, 30_000);
});
