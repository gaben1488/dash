/**
 * comment-annotations.test.ts — inject-тесты /api/annotations/comments и
 * /api/registry/buckets (пп. 72а, 74б, 78, 73в интервью 14.08.2026).
 *
 * Проверяется: правила ядра detectCommentInconsistencies доезжают до ответа
 * карточками с механизмом/адресом/действием; счётчики корзин считаются теми же
 * предикатами, что страницы-фильтры Реестра; служебные строки листа не шумят.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

/** Строка листа: 34 колонки, ключевые ячейки по канону DEPT_COLUMNS. */
function sheetRow(
  over: Partial<Record<'A' | 'C' | 'G' | 'K' | 'L' | 'N' | 'P' | 'Q' | 'U' | 'Y' | 'AF' | 'AG', unknown>>,
): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[0] = over.A ?? '1';
  r[2] = over.C ?? 'Х';
  r[6] = over.G ?? 'Закупка';
  r[10] = over.K ?? 100;
  r[11] = over.L ?? 'ЭА';
  r[13] = over.N ?? '';
  r[15] = over.P ?? 2026;
  r[16] = over.Q ?? 'Х';
  r[20] = over.U ?? '';
  r[24] = over.Y ?? 0;
  r[31] = over.AF ?? '';
  r[32] = over.AG ?? '';
  return r;
}

describe('/api/annotations/comments и /api/registry/buckets', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      PRODUCT_TZ_OFFSET_HOURS: '12',
    };

    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];
    setDeptSheetCache({
      'УЭР': {
        values: [
          ...headers,
          // Строка 4: этапность при заключённом (правило а) — Q заполнена,
          // AF описывает подачу заявок.
          sheetRow({
            A: '1', G: 'Заключённая с устаревшим комментарием', K: 250, L: 'ЭА',
            Q: '01.06.2026', AF: 'находится в стадии подачи заявок',
          }),
          // Строка 5: просроченное обещание (правило б) — Q заглушка,
          // обещание давно в прошлом.
          sheetRow({
            A: '2', G: 'Просроченное обещание', K: 80, L: 'ЕП',
            Q: 'Х', AF: 'договор будет заключен 01.06.2026',
          }),
          // Строка 6: посторонний текст в AG (правило г) + корзина «в течение
          // года» (ЕП, Q — заглушка, факт > 0).
          sheetRow({
            A: '3', G: 'Серия договоров с припиской в AG', K: 90, L: 'ЕП',
            Q: 'X', Y: 45.5, AG: 'ЭА152-26 уточняется',
          }),
          // Строка 7: не обеспечена финансированием (planYearMissing):
          // способ и план есть, года плана нет, дат нет.
          sheetRow({ A: '4', G: 'Без года плана', K: 500, L: 'ЭА', P: '', Q: 'Х' }),
          // Строка 8: чистая заключённая строка — ни аннотаций, ни корзин.
          sheetRow({ A: '5', G: 'Чистая строка', K: 60, L: 'ЭА', N: '01.03.2026', Q: '05.03.2026' }),
          // Служебная строка «Итого» — сканироваться не должна.
          sheetRow({ A: '', G: 'ИТОГО', K: 0, L: '' }),
        ],
        formulas: [],
        sheetName: 'УЭР',
      },
    });

    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('GET /api/annotations/comments: три правила доезжают карточками с механизмом, адресом и действием', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/annotations/comments' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.source).toBe('live');
    expect(body.rowsScanned).toBe(5); // «ИТОГО» не сканируется
    expect(body.total).toBe(3);
    expect(body.byKind).toEqual({
      stage_marker_when_signed: 1,
      past_promise_no_fact: 1,
      foreign_text_in_ag: 1,
    });

    const stage = body.annotations.find((a: { kind: string }) => a.kind === 'stage_marker_when_signed');
    expect(stage.dept).toBe('УЭР');
    expect(stage.sheetRow).toBe(4);
    expect(stage.cell).toBe('AF4');
    // Стандарт диагноста (п.53): механизм и действие — непустые русские фразы.
    expect(stage.mechanism).toContain('уже заключён');
    expect(stage.action).toContain('УЭР');

    const promise = body.annotations.find((a: { kind: string }) => a.kind === 'past_promise_no_fact');
    expect(promise.sheetRow).toBe(5);
    expect(promise.action).toContain('дату заключения');

    const foreign = body.annotations.find((a: { kind: string }) => a.kind === 'foreign_text_in_ag');
    expect(foreign.sheetRow).toBe(6);
    expect(foreign.cell).toBe('AG6');
  });

  it('GET /api/registry/buckets: счётчики корзин — теми же предикатами, что страницы Реестра', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/registry/buckets' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // «В течение года»: единственная строка 6 (ЕП + заглушка Q + факт 45,5).
    expect(body.yearlong.rows).toBe(1);
    expect(body.yearlong.planSum).toBe(90);
    // «Не обеспеченные финансированием»: единственная строка 7 (год плана пуст).
    expect(body.unfunded.rows).toBe(1);
    expect(body.unfunded.planSum).toBe(500);
    expect(typeof body.asOf).toBe('string');
  });
});
