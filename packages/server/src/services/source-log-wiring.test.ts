/**
 * Страж подключения журнала источников к журналу приложения.
 *
 * ЦЕНА ДЕФЕКТА. Модуль source-log.ts написан затем, чтобы чтения книг шли через
 * pino, а не через console: у строки должны быть уровень, время и поля, иначе её
 * нельзя ни отфильтровать, ни сопоставить с запросом. Подмена приёмника описана
 * в самом модуле как «одна строка при старте приложения» — и этой строки не
 * было НИГДЕ. Весь журнал источников (сколько строк, откуда, за сколько, почему
 * отказ) сыпался в консоль мимо журнала сервера, и снаружи это неотличимо от
 * работающей наблюдаемости: строки-то видно, пока смотришь в консоль руками.
 *
 * Проверка поведенческая: поднимаем приложение со своим приёмником журнала и
 * смотрим, куда уходит запись о чтении источника. Проверять наличие вызова в
 * тексте app.ts бессмысленно — вызов легко есть, а эффекта нет.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

vi.mock('./google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

describe('журнал источников подключён к журналу приложения', () => {
  let app: FastifyInstance;
  let heard: Array<{ level: string; fields: Record<string, unknown>; msg: string }>;
  let logSourceRead: (what: string, fields: { rows?: number; ms: number }) => void;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };

    heard = [];
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
    await app.ready();

    // Слушаем ИМЕННО журнал приложения: приёмник получил ссылку на `app.log`
    // при старте, поэтому подмена метода здесь ловит всё, что через него идёт.
    // Проверять наличие вызова в тексте app.ts бессмысленно — вызов легко
    // есть, а эффекта нет.
    for (const level of ['info', 'warn', 'error'] as const) {
      vi.spyOn(app.log, level).mockImplementation(((fields: Record<string, unknown>, msg: string) => {
        heard.push({ level, fields, msg });
      }) as never);
    }

    ({ logSourceRead } = await import('./source-log.js'));
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  it('запись о чтении источника уходит в журнал приложения, а не в консоль', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    logSourceRead('чтение листа «ВСЕ»', { rows: 673, ms: 412 });
    const wentToConsole = consoleLog.mock.calls.length;
    consoleLog.mockRestore();

    const entry = heard.find((e) => e.msg.includes('чтение листа «ВСЕ»'));
    expect(entry, 'запись о чтении не дошла до журнала приложения').toBeDefined();
    expect(entry?.level).toBe('info');
    // Два числа, ради которых журнал и заводят.
    expect(entry?.fields.rows).toBe(673);
    expect(entry?.fields.ms).toBe(412);
    expect(wentToConsole).toBe(0);
  });

  it('после закрытия приложения приёмник возвращается к консоли', async () => {
    await app.close();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    logSourceRead('чтение листа «СВОД»', { rows: 12, ms: 5 });
    const wentToConsole = consoleLog.mock.calls.length;
    consoleLog.mockRestore();

    // Держать ссылку на журнал закрытого приложения незачем, а чтения бывают
    // и после него — разовыми скриптами.
    expect(wentToConsole).toBe(1);
  });
});
