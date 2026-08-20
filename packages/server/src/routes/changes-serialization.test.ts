/**
 * Повторяемый замер: стоит ли объявлять форму ответа на самом длинном чтении.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. Документация Fastify (Guides/Getting-Started.md, «Serialize
 * your data») советует объявлять форму ответа и обещает сборку вдвое-втрое
 * быстрее общего `JSON.stringify`. Совет выглядит бесспорным, и следующий, кто
 * откроет `routes/changes.ts`, почти наверняка захочет его применить. Здесь
 * лежит причина, по которой этого делать не нужно, — не мнением, а числом,
 * которое можно перепроверить одной командой.
 *
 * ЗАМЕР НА ЭТОЙ МАШИНЕ (Node 22, 20 тыс. записей, чередующиеся прогоны):
 *   общий сериализатор ≈ 399 мс, объявленная форма ≈ 567 мс (0.70×).
 * То же соотношение держится на 200 и 2000 записей и на латинских данных вместо
 * кириллических. Обещание документации относится к более старым сборкам V8.
 *
 * ЧТО ОХРАНЯЕТСЯ ЗДЕСЬ:
 *   1. Оба способа собирают БАЙТ В БАЙТ одинаковый ответ — то есть выбор между
 *      ними и правда только про цену, а не про содержимое.
 *   2. Ответ несёт ровно те поля, которые читает веб (`getChanges` в
 *      `packages/web/src/api.ts` и `components/report/ChangesSection`).
 *   3. Соотношение цен печатается в прогоне. Перевернётся на новой версии Node
 *      или Fastify — это будет видно, и решение можно будет пересмотреть.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';

/** Порядок величины настоящего ответа: журналы восьми книг — десятки тысяч записей. */
const RECORD_COUNT = 20_000;

interface ChangeRow {
  dept: string;
  sheet: string;
  cell: string;
  attribute: string;
  oldValue: string;
  newValue: string;
  atMs: number;
  author: string;
}

const DEPTS = ['УО', 'УКСиМП', 'УЗО', 'УК', 'УСП', 'УЭР', 'УЖКХ', 'УА'];

const RECORDS: ChangeRow[] = Array.from({ length: RECORD_COUNT }, (_, i) => ({
  dept: DEPTS[i % DEPTS.length],
  sheet: 'ВСЕ',
  cell: `G${i + 4}`,
  attribute: 'Способ определения поставщика',
  oldValue: `Электронный аукцион №${i}`,
  newValue: `Закупка у единственного поставщика №${i}`,
  atMs: 1_755_000_000_000 + i * 1000,
  author: `Сотрудник ${i % 37}`,
}));

const BODY = { since: '2026-08-14', total: RECORDS.length, source: 'db', records: RECORDS };

/**
 * Форма, которую советует документация. Живёт здесь, в замере, а не в маршруте:
 * применять её на этом маршруте по итогам замера решено НЕ применять.
 */
const CANDIDATE_SCHEMA = {
  200: {
    type: 'object',
    additionalProperties: false,
    properties: {
      since: { type: 'string' },
      total: { type: 'number' },
      source: { type: 'string' },
      failedDepts: { type: 'array', items: { type: 'string' } },
      records: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dept: { type: 'string' },
            sheet: { type: 'string' },
            cell: { type: 'string' },
            attribute: { type: 'string' },
            oldValue: { type: 'string' },
            newValue: { type: 'string' },
            atMs: { type: 'number' },
            author: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

let schemaApp: FastifyInstance;
let plainApp: FastifyInstance;

beforeAll(async () => {
  schemaApp = Fastify({ logger: false });
  schemaApp.get('/api/changes', { schema: { response: CANDIDATE_SCHEMA } }, async () => BODY);
  await schemaApp.ready();

  plainApp = Fastify({ logger: false });
  plainApp.get('/api/changes', async () => BODY);
  await plainApp.ready();
}, 60_000);

afterAll(async () => {
  await schemaApp?.close();
  await plainApp?.close();
});

const hit = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/changes' });

describe('сборка ответа /api/changes', () => {
  it('оба способа дают байт в байт одинаковое тело', async () => {
    const withSchema = await hit(schemaApp);
    const withoutSchema = await hit(plainApp);

    expect(withSchema.statusCode).toBe(200);
    expect(withSchema.body).toBe(withoutSchema.body);
  }, 60_000);

  it('ответ несёт ровно те поля, которые читает веб', async () => {
    const body = (await hit(plainApp)).json<typeof BODY>();

    expect(body.since).toBe(BODY.since);
    expect(body.total).toBe(RECORD_COUNT);
    expect(body.source).toBe('db');
    expect(body.records).toHaveLength(RECORD_COUNT);
    // Восемь полей записи — тот же состав, что объявлен в packages/web/src/api.ts.
    expect(Object.keys(body.records[0]).sort()).toEqual(
      ['atMs', 'attribute', 'author', 'cell', 'dept', 'newValue', 'oldValue', 'sheet'].sort(),
    );
    expect(body.records.at(-1)).toEqual(BODY.records.at(-1));
  }, 60_000);

  it('цена сборки замеряется и печатается: решение опирается на число, а не на обещание', async () => {
    // Прогоны чередуются: разогрев и уборка мусора иначе приписываются той
    // стороне, которая идёт второй, и замер измеряет порядок, а не сборку.
    for (let i = 0; i < 3; i++) {
      await hit(plainApp);
      await hit(schemaApp);
    }

    const rounds = 8;
    let plainTotal = 0;
    let schemaTotal = 0;
    for (let i = 0; i < rounds; i++) {
      let at = performance.now();
      await hit(plainApp);
      plainTotal += performance.now() - at;

      at = performance.now();
      await hit(schemaApp);
      schemaTotal += performance.now() - at;
    }

    const plainMs = plainTotal / rounds;
    const schemaMs = schemaTotal / rounds;
    const bytes = (await hit(plainApp)).body.length;

    console.log(
      `Сборка /api/changes (${RECORD_COUNT} записей, ${bytes} Б, среднее по ${rounds} чередующимся прогонам): ` +
        `общий сериализатор ${plainMs.toFixed(1)} мс, объявленная форма ${schemaMs.toFixed(1)} мс ` +
        `(${(plainMs / schemaMs).toFixed(2)}×). ` +
        `Обещание документации — 2–3× в пользу объявленной формы; на Node 22 оно не подтверждается.`,
    );

    // Утверждение здесь ровно одно и намеренно слабое: замер состоялся и дал
    // осмысленные числа. Сторону победителя закреплять в прогоне нельзя — она
    // зависит от версии Node, и прогон превратился бы в ложную тревогу при
    // обновлении. Вывод из чисел делает человек, читая строку выше.
    expect(plainMs).toBeGreaterThan(0);
    expect(schemaMs).toBeGreaterThan(0);
  }, 180_000);
});
