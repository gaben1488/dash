/**
 * Страж единой формы отказа.
 *
 * Охраняются обещания:
 *   1. Прежние поля остались на прежних местах: `error`, `message`,
 *      `statusCode`. На них опирается `packages/web/src/api.ts` (класс
 *      `ApiError` кладёт тело в поле `body`) и существующие прогоны.
 *   2. Добавлены `code` (устойчивое слово для ветвления) и `requestId` (та же
 *      отметка, что в журнале сервера).
 *   3. Отказ от 500 и выше не пересказывает внутренности: ни сообщения, ни
 *      стека, ни путей файлов, ни адресов книг.
 *   4. Ошибка, объявившая себя показываемой (`expose`), сохраняет свой русский
 *      текст — молчащий источник не должен превращаться в «Internal server
 *      error».
 *   5. Непройденная проверка запроса называет, ГДЕ именно она не прошла.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildErrorBody, codeForStatus, registerErrorShape, sendNotFound } from './error-shape.js';

const SECRET = '/srv/aemr/packages/server/src/secret-path.ts';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  registerErrorShape(app, { exposeStack: false });
  app.setNotFoundHandler(async (request, reply) => sendNotFound(request, reply));

  app.get('/api/boom', async () => {
    throw new Error(`внутренняя подробность: ${SECRET}`);
  });
  app.get('/api/not-found', async () => {
    const err = Object.assign(new Error('Управление «УХ» не заведено.'), { statusCode: 404 });
    throw err;
  });
  app.get('/api/silent-source', async () => {
    const err = Object.assign(
      new Error('Книга управления не прочитана — обновите данные и повторите.'),
      { statusCode: 503, expose: true },
    );
    throw err;
  });
  app.post(
    '/api/validated',
    {
      schema: {
        body: {
          type: 'object',
          required: ['deptId'],
          properties: { deptId: { type: 'string' } },
        },
      },
    },
    async () => ({ ok: true }),
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('отказ от 500 и выше', () => {
  it('не выносит наружу ни текста ошибки, ни стека, ни путей файлов', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    const body = res.json<Record<string, unknown>>();

    expect(res.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(body).not.toHaveProperty('stack');
    expect(JSON.stringify(body)).not.toContain('secret-path.ts');
  });

  it('называет устойчивое слово и отметку запроса — по ним ищут в журнале', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    const body = res.json<Record<string, unknown>>();

    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.statusCode).toBe(500);
    expect(typeof body.requestId).toBe('string');
    expect(String(body.requestId).length).toBeGreaterThan(0);
  });

  it('стек показывается только там, где среда названа средой разработки', () => {
    const err = Object.assign(new Error('внутри'), { stack: 'на стеке видно всё' });
    expect(buildErrorBody(err, { id: 'req-1' }, false)).not.toHaveProperty('stack');
    expect(buildErrorBody(err, { id: 'req-1' }, true).stack).toBe('на стеке видно всё');
  });
});

describe('отказ ниже 500 и объявленный показываемым', () => {
  it('сохраняет свой русский текст: он и есть объяснение для читателя', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/not-found' });
    const body = res.json<Record<string, unknown>>();

    expect(res.statusCode).toBe(404);
    expect(body.message).toBe('Управление «УХ» не заведено.');
    expect(body.code).toBe('NOT_FOUND');
  });

  it('молчащий источник (expose) остаётся объяснённым, хотя это 503', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/silent-source' });
    const body = res.json<Record<string, unknown>>();

    expect(res.statusCode).toBe(503);
    expect(body.message).toContain('обновите данные');
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('непройденная проверка запроса', () => {
  it('называет место, а не только факт', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/validated', payload: {} });
    const body = res.json<{ code: string; details: Array<{ at: string; message: string }> }>();

    expect(res.statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details.length).toBeGreaterThan(0);
    expect(body.details[0].at).toContain('body');
  });
});

describe('нет такого адреса', () => {
  it('отвечает той же формой, что и остальные отказы, и не пересказывает маршрут', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/такого-нет' });
    const body = res.json<Record<string, unknown>>();

    expect(res.statusCode).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.statusCode).toBe(404);
    expect(typeof body.message).toBe('string');
    // Прежний ответ по умолчанию пересказывал разобранный маршрут
    // («Route GET:/api/… not found»); внутренностям маршрутизации наружу делать нечего.
    expect(JSON.stringify(body)).not.toContain('Route');
  });
});

describe('соответствие кода состоянию', () => {
  it('известные состояния переводятся в свои слова', () => {
    expect(codeForStatus(400)).toBe('BAD_REQUEST');
    expect(codeForStatus(401)).toBe('UNAUTHORIZED');
    expect(codeForStatus(403)).toBe('FORBIDDEN');
    expect(codeForStatus(404)).toBe('NOT_FOUND');
    expect(codeForStatus(413)).toBe('PAYLOAD_TOO_LARGE');
    expect(codeForStatus(429)).toBe('TOO_MANY_REQUESTS');
    expect(codeForStatus(503)).toBe('SERVICE_UNAVAILABLE');
  });

  it('незнакомое 4xx — «запрос отклонён», незнакомое 5xx — «внутренняя»', () => {
    expect(codeForStatus(418)).toBe('BAD_REQUEST');
    expect(codeForStatus(507)).toBe('INTERNAL_ERROR');
  });
});
