/**
 * Стражи повтора обращений к таблице-источнику.
 *
 * Реестр багов 09.07.2026, PLAUSIBLE: «нет повторов с задержкой при 48
 * одновременных запросах» — на пике Google отвечал «слишком часто», и целое
 * управление выпадало из снимка. Стражи держат обе границы: временный отказ
 * повторяется с растущей паузой, а отказ по правам и молчание источника — нет,
 * иначе ожидание множится втрое без единого шанса на успех.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  withSheetsRetry,
  isRetryableSheetsError,
  retryDelayMs,
  retryAfterMs,
  SHEETS_RETRY_BASE_DELAY_MS,
} from './sheets-retry.js';
import { SheetsUnavailableError } from './google-sheets.js';

const noSleep = async (): Promise<void> => {};
const noJitter = (): number => 0;

const err = (status: number, headers?: Record<string, unknown>): Error =>
  Object.assign(new Error(`status ${status}`), { status, response: { headers } });

describe('isRetryableSheetsError', () => {
  it('«слишком часто» и поломка на стороне Google — временные', () => {
    expect(isRetryableSheetsError(err(429))).toBe(true);
    expect(isRetryableSheetsError(err(500))).toBe(true);
    expect(isRetryableSheetsError(err(503))).toBe(true);
  });

  it('«доступа нет» не проходит само — повторять нечего', () => {
    expect(isRetryableSheetsError(err(403))).toBe(false);
  });

  it('«листа нет» и молчание источника повтору не подлежат', () => {
    expect(isRetryableSheetsError(err(404))).toBe(false);
    expect(isRetryableSheetsError(new SheetsUnavailableError('источник молчит'))).toBe(false);
    expect(isRetryableSheetsError(new Error('обычная ошибка'))).toBe(false);
  });
});

describe('retryDelayMs / retryAfterMs', () => {
  it('пауза удваивается от попытки к попытке', () => {
    expect(retryDelayMs(0, noJitter)).toBe(SHEETS_RETRY_BASE_DELAY_MS);
    expect(retryDelayMs(1, noJitter)).toBe(SHEETS_RETRY_BASE_DELAY_MS * 2);
    expect(retryDelayMs(2, noJitter)).toBe(SHEETS_RETRY_BASE_DELAY_MS * 4);
  });

  it('случайная добавка разводит одновременно отказавшие книги во времени', () => {
    // Без добавки девять книг вернулись бы к Google в одну и ту же миллисекунду.
    expect(retryDelayMs(0, () => 1)).toBeGreaterThan(retryDelayMs(0, noJitter));
  });

  it('срок, названный самим Google, читается из заголовка', () => {
    expect(retryAfterMs(err(429, { 'retry-after': '2' }))).toBe(2000);
    expect(retryAfterMs(err(429, { 'retry-after': 'через вторник' }))).toBeUndefined();
    expect(retryAfterMs(err(429))).toBeUndefined();
  });
});

describe('withSheetsRetry', () => {
  it('после «слишком часто» спрашивает ещё раз и отдаёт ответ, а не роняет управление', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(err(429))
      .mockResolvedValueOnce(['данные']);

    const result = await withSheetsRetry('чтение листа «ВСЕ»', run, {
      sleep: noSleep,
      random: noJitter,
    });

    expect(result).toEqual(['данные']);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('ждёт между попытками ровно рассчитанную паузу', async () => {
    const waited: number[] = [];
    const run = vi.fn()
      .mockRejectedValueOnce(err(503))
      .mockRejectedValueOnce(err(503))
      .mockResolvedValueOnce('ok');

    await withSheetsRetry('чтение основной книги', run, {
      sleep: async (ms: number) => { waited.push(ms); },
      random: noJitter,
    });

    expect(waited).toEqual([SHEETS_RETRY_BASE_DELAY_MS, SHEETS_RETRY_BASE_DELAY_MS * 2]);
  });

  it('слушает срок из заголовка Retry-After вместо своего расчёта', async () => {
    const waited: number[] = [];
    const run = vi.fn()
      .mockRejectedValueOnce(err(429, { 'retry-after': '3' }))
      .mockResolvedValueOnce('ok');

    await withSheetsRetry('чтение листа', run, {
      sleep: async (ms: number) => { waited.push(ms); },
      random: noJitter,
    });

    expect(waited).toEqual([3000]);
  });

  it('«доступа нет» отдаётся сразу — повтор только утроил бы ожидание', async () => {
    const run = vi.fn().mockRejectedValue(err(403));

    await expect(
      withSheetsRetry('чтение листа', run, { sleep: noSleep, random: noJitter }),
    ).rejects.toMatchObject({ status: 403 });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('молчание источника не повторяется: три срока по двадцать секунд — минута на управление', async () => {
    const run = vi.fn().mockRejectedValue(new SheetsUnavailableError('источник молчит'));

    await expect(
      withSheetsRetry('чтение листа', run, { sleep: noSleep, random: noJitter }),
    ).rejects.toBeInstanceOf(SheetsUnavailableError);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('исчерпав попытки, отдаёт последнюю ошибку как есть — она не превращается в «листа нет»', async () => {
    const run = vi.fn().mockRejectedValue(err(429));

    await expect(
      withSheetsRetry('чтение листа', run, { sleep: noSleep, random: noJitter }),
    ).rejects.toMatchObject({ status: 429 });

    expect(run).toHaveBeenCalledTimes(3);
  });

  it('сообщает о каждом повторе — иначе тихая пауза выглядит как зависание', async () => {
    const retries: number[] = [];
    const run = vi.fn()
      .mockRejectedValueOnce(err(429))
      .mockRejectedValueOnce(err(429))
      .mockResolvedValueOnce('ok');

    await withSheetsRetry('чтение листа «ВСЕ»', run, {
      sleep: noSleep,
      random: noJitter,
      onRetry: ({ attempt }) => { retries.push(attempt); },
    });

    expect(retries).toEqual([1, 2]);
  });
});
