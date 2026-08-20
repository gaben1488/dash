import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Сравнение ключей за постоянное время.
 *
 * Реестр безопасности 05.06.2026, раздел LOW: здесь стоял ранний выход
 * `a.length !== b.length` — он отвечал мгновенно на любую неверную длину и
 * медленнее на верную, то есть по времени ответа сообщал длину настоящего
 * ключа. Теперь сравниваются свёртки постоянной длины: время не зависит ни от
 * длины присланного ключа, ни от того, на каком знаке он разошёлся.
 */
export function safeCompare(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/**
 * Public routes that skip auth.
 * /api/webhook/drive: Google не умеет ни basic auth, ни Bearer — приёмник
 * защищён собственным секретом канала (X-Goog-Channel-Token, см. routes/webhook.ts)
 * и отвечает 404, пока секрет не настроен.
 */
const PUBLIC_PATHS = new Set(['/api/health', '/api/webhook/drive']);

/**
 * Register API key authentication hook.
 * - Production requires AEMR_API_KEY and fails closed if it is absent.
 * - Development/test may run without AEMR_API_KEY, with a warning.
 * - If set → all /api/* routes require `Authorization: Bearer <key>`.
 * - /api/health is always public.
 */
export function registerAuthHook(app: FastifyInstance): void {
  // Публичный read-only деплой (напр. бесплатное демо на Render для начальства):
  // ключ не требуется, ВСЕ чтения (GET/HEAD/OPTIONS) открыты, но любая мутация
  // (POST/PUT/PATCH/DELETE) на /api/* отклоняется 403 — защищает исходные
  // Google-таблицы и БД от анонимной записи, когда URL публичен. Ветка раньше
  // key-логики и раньше fail-closed на отсутствие ключа в production.
  if (process.env.AEMR_PUBLIC_READONLY === 'true') {
    app.log.warn('AEMR_PUBLIC_READONLY=true — публичный режим только для чтения: чтения открыты, запись в источник заблокирована, API-ключ не требуется');
    // Безопасные не-GET (перечитка/проверка, НЕ пишут в Google-таблицы/конфиг) — разрешены,
    // чтобы публичный просмотр мог обновлять данные. Всё остальное, что МУТИРУЕТ источник
    // (правка ячеек, батч-сохранение, смена источника, .env, маппинг, статусы) — 403.
    const READONLY_ALLOWED_NON_GET = [
      /^\/api\/refresh$/,                       // перечитка снапшота из Google (в таблицы не пишет)
      /^\/api\/sources\/[^/]+\/test$/,          // тест-чтение источника
      /^\/api\/sources\/[^/]+\/validate$/,      // валидация источника (чтение)
      /^\/api\/sources\/validate-all$/,         // валидация всех источников (чтение)
      /^\/api\/mapping\/validate$/,             // проверка маппинга (чтение)
    ];
    app.addHook('onRequest', async (request, reply) => {
      const url = request.url.split('?')[0];
      if (!url.startsWith('/api/')) return;
      const method = request.method.toUpperCase();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
      if (READONLY_ALLOWED_NON_GET.some((re) => re.test(url))) return;
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Публичный просмотр: изменение данных отключено',
      });
    });
    return;
  }

  const apiKey = config.auth.apiKey;

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AEMR_API_KEY is required when NODE_ENV=production');
    }
    app.log.warn('AEMR_API_KEY not set; API authentication disabled for non-production runtime');
    return;
  }

  app.log.info('API key authentication enabled');

  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0]; // strip query params

    // Skip auth for public routes and non-API routes
    if (PUBLIC_PATHS.has(url) || !url.startsWith('/api/')) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7); // strip "Bearer "
    if (!safeCompare(token, apiKey)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid API key' });
    }
  });
}
