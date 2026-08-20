/**
 * Страж записи файла настроек (POST /api/settings/env).
 *
 * Реестр безопасности 05.06.2026, S-C1 («.env-инъекция», единственный пункт
 * степени CRITICAL): присланные поля уходили в файл настроек сырьём, закрытый
 * ключ вдобавок оборачивался в кавычки. Кавычка внутри присланного значения
 * закрывала строку раньше времени, и всё, что шло следом, файл читал как свои
 * собственные строки — включая AEMR_API_KEY, ключ доступа ко всему продукту.
 *
 * Тест проверяет отказы: ни одно испорченное поле не должно дойти до записи.
 * Успешный путь намеренно не проверяется — он переписывает настоящий файл
 * настроек репозитория. Что честное значение проходит проверку, видно из
 * последнего случая: настоящий PEM пропущен, отказ приходит на другое поле.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Запись подменена: даже если проверка полей однажды ослабнет, прогон тестов не
 * должен переписать настоящий файл настроек репозитория. Заодно это и есть
 * главное утверждение стража — до записи не дошёл ни один из случаев ниже.
 */
const writeFileSyncSpy = vi.hoisted(() => vi.fn());
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, writeFileSync: writeFileSyncSpy };
});

const ORIGINAL_ENV = { ...process.env };
const DEV_TOKEN = 'dev-token-для-теста';

/** Правдоподобный закрытый ключ: конверт PEM с переводами строк двумя знаками. */
const VALID_PEM =
  '-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ==\\n-----END PRIVATE KEY-----\\n';

let app: FastifyInstance;

async function post(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/settings/env',
    headers: { 'x-dev-token': DEV_TOKEN },
    payload,
  });
}

beforeAll(async () => {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'development',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    DEV_SETTINGS_TOKEN: DEV_TOKEN,
  };
  const { default: Fastify } = await import('fastify');
  const { settingsRoutes } = await import('./settings.js');
  app = Fastify({ logger: false });
  await app.register(settingsRoutes);
  await app.ready();
}, 60_000);

afterEach(() => {
  // Ни один случай ниже не имеет права дойти до записи файла настроек.
  expect(writeFileSyncSpy).not.toHaveBeenCalled();
});

afterAll(async () => {
  await app?.close();
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('запись файла настроек не даёт дописать чужие строки', () => {
  it('отвергает закрытый ключ с кавычкой и подложенной строкой', async () => {
    const res = await post({
      serviceAccountEmail: 'svc@example.test',
      privateKey: 'ключ"\nAEMR_API_KEY=подложенный-ключ\n"',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('success');
  });

  it('отвергает закрытый ключ без конверта PEM', async () => {
    const res = await post({
      serviceAccountEmail: 'svc@example.test',
      privateKey: 'просто длинная строка без начала и конца',
    });
    expect(res.statusCode).toBe(400);
  });

  it('отвергает опознаватель книги с переводом строки', async () => {
    const res = await post({
      spreadsheetId: 'id-книги\nAEMR_API_KEY=подложенный-ключ',
      serviceAccountEmail: 'svc@example.test',
      privateKey: VALID_PEM,
    });
    expect(res.statusCode).toBe(400);
  });

  it('отвергает порт и адрес узла с посторонними знаками', async () => {
    const port = await post({
      serviceAccountEmail: 'svc@example.test',
      privateKey: VALID_PEM,
      port: '3000\nAEMR_API_KEY=подложенный-ключ',
    });
    const host = await post({
      serviceAccountEmail: 'svc@example.test',
      privateKey: VALID_PEM,
      host: '0.0.0.0"\nAEMR_API_KEY=подложенный-ключ',
    });
    expect(port.statusCode).toBe(400);
    expect(host.statusCode).toBe(400);
  });

  it('без заголовка разработчика не проверяет даже форму полей', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/env',
      payload: { serviceAccountEmail: 'svc@example.test', privateKey: VALID_PEM },
    });
    expect(res.statusCode).toBe(403);
  });
});
