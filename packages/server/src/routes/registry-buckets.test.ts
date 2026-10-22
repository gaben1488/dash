import Fastify from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rows: {} as Record<string, unknown[][]> }));
vi.mock('../services/dept-rows.js', () => ({ readDeptRows: async () => ({ rowsByDept: fixture.rows, source: 'snapshot', asOf: '2026-10-12T00:00:00Z' }) }));
import { registryBucketsRoutes } from './registry-buckets.js';
const app = Fastify();
await app.register(registryBucketsRoutes);
afterAll(() => app.close());
function row(id: string, comment = '') { const r = Array(34).fill(''); r[0] = id; r[6] = 'Синтетическая потребность'; r[10] = 100; r[11] = 'ЕП'; r[31] = comment; return r; }
describe('корзина финансирования — состояние, не число замечаний', () => {
 it('включает инициативы в полный счёт и показывает их отдельно без удвоения плана', async () => {
  fixture.rows = { УКСиМП: [row('1'), row('2', 'просто хотелки')] };
  const data = (await app.inject('/api/registry/buckets')).json();
  expect(data.unfunded).toEqual({ rows: 2, planSum: 200, initiativeRows: 1 });
  expect(data.source).toBe('snapshot'); expect(data.asOf).toBe('2026-10-12T00:00:00Z');
 });
 it('отсутствие данных остаётся 503, а не нулём состояния', async () => {
  fixture.rows = {}; expect((await app.inject('/api/registry/buckets')).statusCode).toBe(503);
 });
});
