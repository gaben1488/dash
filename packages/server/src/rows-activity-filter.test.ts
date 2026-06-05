import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

type RowsResponse = {
  rows: Array<{ id: unknown; subject: unknown }>;
  signals: { total: number };
};

function makeDeptRow(overrides: {
  id: number;
  programName: string;
  type: string;
  subject: string;
}): unknown[] {
  const row = Array<unknown>(32).fill('');
  row[0] = overrides.id; // A
  row[3] = overrides.programName; // D: program name
  row[5] = overrides.type; // F: activity type
  row[6] = overrides.subject; // G
  row[10] = 100; // K
  row[11] = 'ЕП'; // L
  row[13] = '01.01.2026'; // N
  return row;
}

async function createRowsApp(rows: unknown[][]): Promise<FastifyInstance> {
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
  };

  const [{ setDeptSheetCache }, { createApp }] = await Promise.all([
    import('./services/snapshot.js'),
    import('./app.js'),
  ]);

  setDeptSheetCache({
    УО: {
      values: [[], [], [], ...rows],
      formulas: [],
      sheetName: 'ВСЕ',
    },
  });

  return createApp({ logger: false });
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('GET /api/rows/:deptId activity filter', () => {
  it('splits current activity by column D program name', async () => {
    const app = await createRowsApp([
      makeDeptRow({
        id: 1,
        type: 'Текущая деятельность',
        programName: 'Муниципальная программа «Развитие»',
        subject: 'Program-backed purchase',
      }),
      makeDeptRow({
        id: 2,
        type: 'Текущая деятельность',
        programName: 'Х',
        subject: 'Non-program purchase',
      }),
    ]);

    try {
      const currentProgram = await app.inject({
        method: 'GET',
        url: '/api/rows/uo?activity=current_program&limit=100',
      });
      const currentNonProgram = await app.inject({
        method: 'GET',
        url: '/api/rows/uo?activity=current_non_program&limit=100',
      });

      expect(currentProgram.statusCode).toBe(200);
      expect(currentNonProgram.statusCode).toBe(200);

      const currentProgramBody = currentProgram.json<RowsResponse>();
      const currentNonProgramBody = currentNonProgram.json<RowsResponse>();

      expect(currentProgramBody.signals.total).toBe(1);
      expect(currentProgramBody.rows.map((r) => r.id)).toEqual([1]);
      expect(currentNonProgramBody.signals.total).toBe(1);
      expect(currentNonProgramBody.rows.map((r) => r.id)).toEqual([2]);
    } finally {
      await app.close();
    }
  }, 30_000);
});
