import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Среда выставляется до импорта: config.js читает её при первом импорте.
process.env.NODE_ENV = 'test';
process.env.AEMR_API_KEY = '';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';

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

/**
 * Приложение и лист-фикстура строятся ОДИН раз на файл.
 *
 * Прежде тест звал vi.resetModules() и поднимал Fastify внутри самого теста:
 * полная пересборка графа сервера стоит ~8 секунд в одиночку и уходит за
 * тридцать под параллельной нагрузкой — падение было по занятому процессору,
 * а не по логике (тот же класс уже разобран в rows-write-bounds.test.ts).
 * Изоляция по модулям здесь не нужна: vitest и так даёт файлу свой граф,
 * а фикстура у обоих запросов одна.
 */
let app: FastifyInstance;

beforeAll(async () => {
  const [{ setDeptSheetCache }, { createApp }] = await Promise.all([
    import('./services/snapshot.js'),
    import('./app.js'),
  ]);

  setDeptSheetCache({
    УО: {
      values: [
        [],
        [],
        [],
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
      ],
      formulas: [],
      sheetName: 'ВСЕ',
    },
  });

  app = await createApp({ logger: false });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('GET /api/rows/:deptId activity filter', () => {
  it('канон п.30: оба ТД-ключа фильтра отдают текущую деятельность целиком', async () => {
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

    // Страж класса п.30 (интервью 14.08.2026): срез «ТД-ПМ» упразднён —
    // графа программы (D) не делит ТД. Раньше current_non_program («ТД»)
    // выкидывал строку 1 (ТД с программой) — ТД-ПМ-строки пропадали из
    // «ТД» при этом варианте фильтра. Теперь оба ключа = вся ТД.
    expect(currentProgramBody.signals.total).toBe(2);
    expect(currentProgramBody.rows.map((r) => r.id)).toEqual([1, 2]);
    expect(currentNonProgramBody.signals.total).toBe(2);
    expect(currentNonProgramBody.rows.map((r) => r.id)).toEqual([1, 2]);
  }, 30_000);
});
