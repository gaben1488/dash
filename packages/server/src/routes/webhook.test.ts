import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Страж приёмника push-уведомлений Drive (канон п.66, домен п.69а):
 * без настроенного секрета маршрут закрыт наглухо; чужой POST без секрета
 * отклоняется; подтверждение канала не запускает перечитку; настоящее
 * изменение взводит ОДНУ отложенную перечитку на серию уведомлений.
 */
const refreshAllSources = vi.fn(async () => ({ loaded: ['УО'], failed: [], svodOk: true, at: 'x' }));

vi.mock('../services/source-refresh.js', () => ({
  refreshAllSources: () => refreshAllSources(),
}));

const webhookConfig: { publicUrl?: string; secret?: string } = {};

vi.mock('../config.js', () => ({
  config: {
    webhook: webhookConfig,
  },
}));

// Книга «Ежедневный мониторинг» живёт вне цикла refreshAllSources, поэтому
// вебхук сбрасывает её кэш отдельно. В тесте сервис заглушён: настоящий при
// импорте тянет полный config (здесь он подменён огрызком) и клиент Google.
const invalidateMonitoringCache = vi.fn();
vi.mock('../services/monitoring.js', () => ({
  invalidateMonitoringCache: () => invalidateMonitoringCache(),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { webhookRoutes } = await import('./webhook.js');
  app = Fastify({ logger: false });
  webhookRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(async () => {
  const { cancelPendingWebhookRefresh } = await import('./webhook.js');
  cancelPendingWebhookRefresh();
  refreshAllSources.mockClear();
  vi.useRealTimers();
});

function post(headers: Record<string, string>) {
  return app.inject({ method: 'POST', url: '/api/webhook/drive', headers });
}

describe('POST /api/webhook/drive', () => {
  it('без настроенного секрета маршрут закрыт (404), перечитка не запускается', async () => {
    delete webhookConfig.secret;
    const res = await post({ 'x-goog-channel-token': 'что-угодно' });
    expect(res.statusCode).toBe(404);
    expect(refreshAllSources).not.toHaveBeenCalled();
  });

  it('уведомление с неверным токеном канала отклоняется (403)', async () => {
    webhookConfig.secret = 'верный-секрет';
    const res = await post({ 'x-goog-channel-token': 'чужой', 'x-goog-resource-state': 'update' });
    expect(res.statusCode).toBe(403);
    expect(refreshAllSources).not.toHaveBeenCalled();
  });

  it('секрет канала сверяется целиком: ни общее начало, ни отсутствие заголовка не проходят', async () => {
    // Реестр безопасности 05.06.2026, LOW-1: маршрут открыт без ключа доступа,
    // поэтому сверка секрета сравнением строк подсказывала подбирающему, где
    // расходится первый знак. Теперь сверка идёт за постоянное время; здесь
    // проверяется её итог — отказ во всех трёх случаях.
    webhookConfig.secret = 'верный-секрет';
    const prefix = await post({ 'x-goog-channel-token': 'верный', 'x-goog-resource-state': 'update' });
    const longer = await post({ 'x-goog-channel-token': 'верный-секрет-хвост', 'x-goog-resource-state': 'update' });
    const missing = await post({ 'x-goog-resource-state': 'update' });

    expect([prefix.statusCode, longer.statusCode, missing.statusCode]).toEqual([403, 403, 403]);
    expect(refreshAllSources).not.toHaveBeenCalled();
  });

  it('подтверждение канала (sync) принимается без перечитки', async () => {
    webhookConfig.secret = 'верный-секрет';
    const res = await post({ 'x-goog-channel-token': 'верный-секрет', 'x-goog-resource-state': 'sync' });
    expect(res.statusCode).toBe(200);
    expect(refreshAllSources).not.toHaveBeenCalled();
  });

  it('серия изменений схлопывается в одну отложенную перечитку', async () => {
    vi.useFakeTimers();
    webhookConfig.secret = 'верный-секрет';
    for (let i = 0; i < 5; i++) {
      const res = await post({ 'x-goog-channel-token': 'верный-секрет', 'x-goog-resource-state': 'update' });
      expect(res.statusCode).toBe(200);
    }
    expect(refreshAllSources).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refreshAllSources).toHaveBeenCalledTimes(1);
  });
});
