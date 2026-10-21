import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { DEPT_HEADER_ROWS } from '@aemr/shared';
const env = { ...process.env };
let service: typeof import('./source-row-observations.js');
let database: typeof import('../db/index.js');
beforeAll(async () => {
  vi.resetModules();
  process.env = { ...env, NODE_ENV: 'test', SQLITE_PATH: ':memory:' };
  service = await import('./source-row-observations.js');
  database = await import('../db/index.js');
});
afterAll(() => { process.env = env; vi.resetModules(); });

it('сохраняет семь отсутствующих ручных номеров, исключает сдвиги и дубли webhook, откатывается при отказе принятия', () => {
  const numbers = [1094, 1506, 1507, 1510, 1512, 1514, 1518];
  const row = (n: number) => { const r: unknown[] = []; r[0] = n; r[2] = 'Учреждение'; r[6] = `Предмет ${n}`; r[10] = 100; r[11] = 'ЕП'; return r; };
  const header = Array.from({ length: DEPT_HEADER_ROWS }, () => []);
  const before = { values: [...header, row(1000), ...numbers.map(row), row(1600)] };
  const after = { values: [...header, row(1000), row(1600)] };
  const at = '2026-10-21T04:53:12.000Z';
  expect(() => database.db.transaction(() => {
    service.saveSourceRowObservations('УО', before, after, 'before', 'after', at);
    throw new Error('acceptance failed');
  })).toThrow('acceptance failed');
  expect(service.readSourceRowObservations(0)).toHaveLength(0);
  for (let n = 0; n < 2; n++) database.db.transaction(() => {
    service.saveSourceRowObservations('УО', before, after, 'before', 'after', at);
  });
  const entries = service.readSourceRowObservations(0);
  expect(entries).toHaveLength(7);
  expect(entries.map(e => e.rowSeq).sort()).toEqual(numbers.map(String).sort());
  expect(entries.every(e => e.at === null && e.author === null && e.observedAt === at)).toBe(true);
  expect(entries.some(e => e.rowSeq === '1600')).toBe(false);
});
