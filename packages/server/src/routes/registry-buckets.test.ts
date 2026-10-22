import Fastify from 'fastify';
import { findDept, REGISTRY_BUCKETS } from '@aemr/shared';
import { buildRowDto } from '../services/rows-dto.js';
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
 it('API и DTO Реестра используют один предикат корзины «в течение года»', async () => {
  const epPayment = row('3');
  epPayment[16] = 'X'; // Q: сырая заглушка заключения
  epPayment[24] = 45;  // Y: факт, тыс. руб.
  const regular = row('4'); regular[16] = '2026-10-01'; regular[24] = 30;
  const competitive = row('5'); competitive[11] = 'ЭА'; competitive[16] = 'X'; competitive[24] = 45;
  fixture.rows = { УКСиМП: [epPayment, regular, competitive] };
  const response = await app.inject('/api/registry/buckets');
  expect(response.statusCode).toBe(200);
  const rows = fixture.rows['УКСиМП'].map((r, idx) =>
    buildRowDto(r, idx, { deptId: findDept('УКСиМП')!.id }));
  const matching = rows.filter(REGISTRY_BUCKETS.yearlong.predicate);
  expect(matching.map(r => r.id)).toEqual(['3']);
  expect(response.json().yearlong).toEqual({ rows: matching.length, planSum: 100 });
 });
 it('отсутствие данных остаётся 503, а не нулём состояния', async () => {
  fixture.rows = {}; expect((await app.inject('/api/registry/buckets')).statusCode).toBe(503);
 });
});
