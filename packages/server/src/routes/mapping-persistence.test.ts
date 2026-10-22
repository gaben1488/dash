import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { REPORT_MAP } from '@aemr/shared';

const databaseFailure = vi.hoisted(() => vi.fn(() => { throw new Error('SQLite unavailable'); }));
const readFailure = vi.hoisted(() => vi.fn(() => { throw new Error('SQLite unavailable'); }));

vi.mock('../db/index.js', () => ({
  db: { transaction: databaseFailure, select: readFailure },
  schema: {},
}));
vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => []),
}));

import { mappingRoutes } from './mapping.js';

describe('mapping API never pretends changes persisted after a DB failure', () => {
  it('GET does not show default mapping as if it had read an inaccessible override DB', async () => {
    const app = Fastify({ logger: false });
    try {
      await app.register(mappingRoutes);
      const result = await app.inject({ method: 'GET', url: '/api/mapping' });
      expect(result.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it('PUT cannot respond success:true when its transaction fails', async () => {
    const app = Fastify({ logger: false });
    try {
      await app.register(mappingRoutes);
      const key = REPORT_MAP[0].metricKey;
      const result = await app.inject({
        method: 'PUT', url: `/api/mapping/${encodeURIComponent(key)}`,
        payload: { cellRef: 'A25' },
      });
      expect(result.statusCode).toBe(503);
      expect(result.json<{ success: boolean }>().success).toBe(false);
      expect(databaseFailure).toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('reset cannot respond success:true after failed delete or audit', async () => {
    const app = Fastify({ logger: false });
    try {
      await app.register(mappingRoutes);
      const result = await app.inject({ method: 'POST', url: '/api/mapping/reset' });
      expect(result.statusCode).toBe(503);
      expect(result.json<{ success: boolean }>().success).toBe(false);
    } finally {
      await app.close();
    }
  });
});
