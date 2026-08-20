/**
 * Ограничение частоты тяжёлых обращений.
 *
 * Охраняются три обещания:
 *   1. Шквал на дорогом маршруте отсекается — но ровно после порога, ни одним
 *      обращением раньше (иначе ограничение мешает работать).
 *   2. Отказ честный: код 429, срок повтора и в заголовке, и в тексте, текст
 *      русский, без внутренних обозначений и без латиницы.
 *   3. Обычные маршруты ограничение не трогает.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  createHeavyRouteLimiter,
  registerHeavyRouteRateLimit,
  pluralRu,
  HEAVY_ROUTE_RULES,
  type HeavyRouteRule,
} from './rate-limit.js';

const REFRESH_RULE: HeavyRouteRule = {
  methods: ['POST'],
  path: /^\/api\/refresh$/,
  limit: 2,
  windowMs: 60_000,
  subject: 'Обновление данных',
  why: 'каждая перечитка поднимает все книги управлений',
};

describe('счётчик окна', () => {
  it('пропускает ровно столько обращений, сколько разрешено, и отказывает следующему', () => {
    const limiter = createHeavyRouteLimiter([REFRESH_RULE]);
    const now = 1_000_000;

    expect(limiter.check('POST', '/api/refresh', 'клиент', now)).toBeNull();
    expect(limiter.check('POST', '/api/refresh', 'клиент', now + 10)).toBeNull();

    const refusal = limiter.check('POST', '/api/refresh', 'клиент', now + 20);
    expect(refusal).not.toBeNull();
    expect(refusal?.retryAfterSeconds).toBe(60);
  });

  it('после окна счёт начинается заново', () => {
    const limiter = createHeavyRouteLimiter([REFRESH_RULE]);
    const now = 1_000_000;

    limiter.check('POST', '/api/refresh', 'клиент', now);
    limiter.check('POST', '/api/refresh', 'клиент', now);
    expect(limiter.check('POST', '/api/refresh', 'клиент', now)).not.toBeNull();

    expect(limiter.check('POST', '/api/refresh', 'клиент', now + 60_001)).toBeNull();
  });

  it('превышение не отодвигает срок повтора — стучащий клиент не наказывает сам себя', () => {
    const limiter = createHeavyRouteLimiter([REFRESH_RULE]);
    const now = 1_000_000;
    limiter.check('POST', '/api/refresh', 'клиент', now);
    limiter.check('POST', '/api/refresh', 'клиент', now);

    const first = limiter.check('POST', '/api/refresh', 'клиент', now + 30_000);
    const second = limiter.check('POST', '/api/refresh', 'клиент', now + 40_000);
    expect(first?.retryAfterSeconds).toBe(30);
    expect(second?.retryAfterSeconds).toBe(20);
  });

  it('окна разных клиентов независимы', () => {
    const limiter = createHeavyRouteLimiter([REFRESH_RULE]);
    const now = 1_000_000;
    limiter.check('POST', '/api/refresh', 'первый', now);
    limiter.check('POST', '/api/refresh', 'первый', now);
    expect(limiter.check('POST', '/api/refresh', 'первый', now)).not.toBeNull();
    expect(limiter.check('POST', '/api/refresh', 'второй', now)).toBeNull();
  });

  it('маршрут вне списка тяжёлых не ограничивается', () => {
    const limiter = createHeavyRouteLimiter([REFRESH_RULE]);
    for (let i = 0; i < 50; i++) {
      expect(limiter.check('GET', '/api/dashboard', 'клиент', 1_000_000)).toBeNull();
    }
  });

  it('метод учитывается: чтение того же пути под правило записи не подпадает', () => {
    const limiter = createHeavyRouteLimiter([REFRESH_RULE]);
    for (let i = 0; i < 10; i++) {
      expect(limiter.check('GET', '/api/refresh', 'клиент', 1_000_000)).toBeNull();
    }
  });

  it('проверки разных источников делят одно окно — дорога суммарная частота', () => {
    const rule: HeavyRouteRule = {
      methods: ['POST'],
      path: /^\/api\/sources\/[^/]+\/test$/,
      limit: 1,
      windowMs: 60_000,
      subject: 'Проверка источника',
      why: 'каждая проверка обращается к таблице-источнику',
    };
    const limiter = createHeavyRouteLimiter([rule]);
    expect(limiter.check('POST', '/api/sources/УО/test', 'клиент', 1)).toBeNull();
    expect(limiter.check('POST', '/api/sources/УД/test', 'клиент', 2)).not.toBeNull();
  });
});

describe('текст отказа', () => {
  it('русский, называет причину и срок повтора, без латиницы', () => {
    const limiter = createHeavyRouteLimiter([REFRESH_RULE]);
    limiter.check('POST', '/api/refresh', 'клиент', 0);
    limiter.check('POST', '/api/refresh', 'клиент', 0);
    const refusal = limiter.check('POST', '/api/refresh', 'клиент', 59_000);

    expect(refusal?.message).toBe(
      'Обновление данных выполняется не чаще 2 раз в минуту: каждая перечитка ' +
        'поднимает все книги управлений. Повторите через 1 секунду.',
    );
    expect(refusal?.message).not.toMatch(/[A-Za-z]/);
  });

  it('склоняет секунды по-русски', () => {
    expect(pluralRu(1, 'секунду', 'секунды', 'секунд')).toBe('секунду');
    expect(pluralRu(3, 'секунду', 'секунды', 'секунд')).toBe('секунды');
    expect(pluralRu(11, 'секунду', 'секунды', 'секунд')).toBe('секунд');
    expect(pluralRu(21, 'секунду', 'секунды', 'секунд')).toBe('секунду');
    expect(pluralRu(60, 'секунду', 'секунды', 'секунд')).toBe('секунд');
  });
});

describe('боевые пороги', () => {
  it('накрывают перечитку снимка и чтение всех книг', () => {
    const limiter = createHeavyRouteLimiter(HEAVY_ROUTE_RULES);
    const covered = [
      ['POST', '/api/refresh'],
      ['POST', '/api/sources/validate-all'],
      ['POST', '/api/sources/%D0%A3%D0%9E/validate'],
      ['GET', '/api/changes'],
      ['GET', '/api/provenance/health'],
      ['GET', '/api/workload'],
      ['GET', '/api/text-hygiene'],
    ] as const;

    for (const [method, path] of covered) {
      // Порог заведомо превышаем: правило должно существовать для маршрута.
      let refused = false;
      for (let i = 0; i < 40 && !refused; i++) {
        refused = limiter.check(method, path, 'клиент', 1_000_000) !== null;
      }
      expect(refused, `${method} ${path} должен иметь порог`).toBe(true);
    }
  });
});

describe('ответ сервера', () => {
  async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    registerHeavyRouteRateLimit(app, [REFRESH_RULE]);
    app.post('/api/refresh', async () => ({ refreshed: true }));
    app.get('/api/dashboard', async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  it('на превышение отвечает 429 с заголовком срока повтора и русским текстом', async () => {
    const app = await buildApp();
    try {
      await app.inject({ method: 'POST', url: '/api/refresh' });
      await app.inject({ method: 'POST', url: '/api/refresh' });
      const refused = await app.inject({ method: 'POST', url: '/api/refresh' });

      expect(refused.statusCode).toBe(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);

      const body = refused.json<{ error: string; message: string; retryAfterSeconds: number }>();
      expect(body.error).toBe('Слишком часто');
      expect(body.message).toMatch(/Повторите через/);
      expect(body.message).not.toMatch(/[A-Za-z]/);
      expect(body.retryAfterSeconds).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('обычный маршрут не ограничивается', async () => {
    const app = await buildApp();
    try {
      for (let i = 0; i < 10; i++) {
        const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
        expect(res.statusCode).toBe(200);
      }
    } finally {
      await app.close();
    }
  });

  it('строка запроса не обходит ограничение', async () => {
    const app = await buildApp();
    try {
      await app.inject({ method: 'POST', url: '/api/refresh?quick=true' });
      await app.inject({ method: 'POST', url: '/api/refresh?quick=true' });
      const refused = await app.inject({ method: 'POST', url: '/api/refresh?quick=false' });
      expect(refused.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
