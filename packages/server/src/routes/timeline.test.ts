/**
 * timeline.test.ts — Fastify inject-тесты /api/timeline/* (канон п.75б-в).
 *
 * Проверяется: таймлайн одной строки из трёх источников (журнал правок из
 * changelog_entries, наблюдения из снимков SQL, живой кэш книги), структурная
 * просрочка, честные подписи глубины истории, «близкие к реализации» с
 * риск-контекстом, коды ошибок.
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


/** «дд.мм.гггг» из номера суток — формат ячеек N/Q двух книг из восьми. */
function ruDateOfDay(day: number): string {
  const d = new Date(day * 86_400_000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

/** Строка листа УЭР: 34 колонки, ключевые ячейки по канону DEPT_COLUMNS. */
function sheetRow(over: Partial<Record<'A' | 'C' | 'G' | 'K' | 'L' | 'N' | 'Q' | 'U' | 'AG', unknown>>): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[0] = over.A ?? '1';
  r[2] = over.C ?? 'Х';
  r[6] = over.G ?? 'Закупка';
  r[10] = over.K ?? 100;
  r[11] = over.L ?? 'ЭА';
  r[13] = over.N ?? '';
  r[16] = over.Q ?? 'Х';
  r[20] = over.U ?? 'Х';
  r[32] = over.AG ?? '';
  return r;
}

describe('/api/timeline/*', () => {
  let app: FastifyInstance;
  let asOfDay: number;

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

    const { productCalendarDay } = await import('@aemr/shared');
    asOfDay = productCalendarDay(new Date(), 12);

    // Живой кэш книги УЭР: шапка 3 строки, данные со строки 4.
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];
    setDeptSheetCache({
      'УЭР': {
        values: [
          ...headers,
          // Строка листа 4: просрочена (план 30 дней назад, заключения нет),
          // живая причина в U, номер процедуры в AG.
          sheetRow({
            A: '1', G: 'Просроченная закупка', K: '250,5', L: 'ЭА',
            N: ruDateOfDay(asOfDay - 30), Q: 'Х',
            U: 'отсутствует финансирование, закупка переносится',
            AG: 'ЭА152-26',
          }),
          // Строка листа 5: близкая (план через 10 дней).
          sheetRow({ A: '2', G: 'Близкая закупка', K: 80, L: 'ЕП', N: ruDateOfDay(asOfDay + 10), Q: 'X' }),
          // Строка листа 6: заключена — в «близкие» не входит.
          sheetRow({ A: '3', G: 'Заключённая закупка', K: 90, L: 'ЭА', N: ruDateOfDay(asOfDay - 40), Q: ruDateOfDay(asOfDay - 35) }),
          // Строка листа 7: план далеко (за окном 30 дней).
          sheetRow({ A: '4', G: 'Дальняя закупка', K: 60, L: 'ЭА', N: ruDateOfDay(asOfDay + 200), Q: 'Х' }),
        ],
        formulas: [],
        sheetName: 'УЭР',
      },
    });

    // Записи журнала: две правки нашей строки 4 (N и L), одна чужой строки
    // (N5 попадает в таймлайн строки 5, не 4) и одна вне канона видов (G4).
    // Таблицу заводит схема проекта (db/ddl.ts); раньше её приходилось
    // создавать здесь вручную — ровно потому, что в схеме её не было вовсе.
    const { db, schema } = await import('../db/index.js');
    const recordedAt = new Date().toISOString();
    const entry = (cell: string, oldValue: string, newValue: string, atMs: number) => ({
      id: `УЭР|ВСЕ|${cell}|${atMs}|test@example.ru`,
      dept: 'УЭР', sheet: 'ВСЕ', cell,
      attribute: null, oldValue, newValue, atMs,
      author: 'test@example.ru', recordedAt,
    });
    db.insert(schema.changelogEntries).values([
      entry('N4', ruDateOfDay(asOfDay - 60), ruDateOfDay(asOfDay - 30), Date.UTC(2026, 7, 6, 10, 0, 0)),
      entry('L4', 'ЕП', 'ЭА', Date.UTC(2026, 7, 6, 11, 0, 0)),
      entry('N5', ruDateOfDay(asOfDay + 3), ruDateOfDay(asOfDay + 10), Date.UTC(2026, 7, 7, 10, 0, 0)),
      // Правка ХВОСТА формулировки предмета — НЕ смена жильца (п.117:
      // первые 12 знаков совпадают, отсечка истории не рождается).
      entry('G4', 'Просроченная закупка', 'Просроченная закупка (уточнение формулировки)', Date.UTC(2026, 7, 7, 11, 0, 0)),
    ]).run();

    // Сохранённый снимок со строкой-атомом строки 4: другая плановая дата —
    // дифф «снимок → живое» должен дать plan_date_changed.
    const snapCreatedAt = '2026-08-01T00:00:00.000Z';
    db.insert(schema.snapshots).values({
      id: 'snap-timeline-1',
      spreadsheetId: 'test',
      createdAt: snapCreatedAt,
    }).run();
    const oldCells: Record<string, unknown> = {};
    const oldRow = sheetRow({
      A: '1', G: 'Просроченная закупка', K: '250,5', L: 'ЭА',
      N: ruDateOfDay(asOfDay - 60), Q: 'Х',
    });
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    [...letters, 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH'].forEach((letter, i) => {
      oldCells[letter] = oldRow[i] ?? null;
    });
    db.insert(schema.procurementRows).values({
      snapshotId: 'snap-timeline-1',
      departmentId: 'uer',
      rowIndex: 4,
      cellsJson: JSON.stringify(oldCells),
      createdAt: snapCreatedAt,
    }).run();

    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
    // Роут регистрирует интеграционная волна; тест поднимает его сам,
    // чтобы проверять контракт, не дожидаясь гейта.
    const { timelineRoutes } = await import('./timeline.js');
    if (!app.hasRoute({ method: 'GET', url: '/api/timeline/upcoming' })) {
      await app.register(timelineRoutes);
    }
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  describe('GET /api/timeline/:deptId/:sheetRow', () => {
    it('собирает журнал + дифф снимка + структурную просрочку, отсортировано и с покрытием', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/timeline/УЭР/4' });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.rowKey).toBe('УЭР:4');
      expect(body.plannedDate).toBe(new Date((asOfDay - 30) * 86_400_000).toISOString().slice(0, 10));

      const kinds = body.events.map((e: { kind: string }) => e.kind);
      // Журнал: правка N4 и L4 (G4 вне канона видов, N5 — чужая строка).
      expect(body.events.filter((e: { source: string }) => e.source === 'журнал')).toHaveLength(2);
      // Правка хвоста формулировки предмета отсечку истории не породила (п.117).
      expect(body.identityCutAt).toBeNull();
      expect(kinds).toContain('plan_date_changed');
      expect(kinds).toContain('method_changed');
      // Дифф «снимок 01.08 → живое»: плановая дата сдвинулась −60 → −30.
      const planFromSnapshot = body.events.find(
        (e: { kind: string; source: string }) => e.kind === 'plan_date_changed' && e.source === 'снимок',
      );
      expect(planFromSnapshot).toBeDefined();
      // Просрочка — структурно: план прошёл, заключения нет.
      const overdue = body.events.find((e: { kind: string }) => e.kind === 'overdue_started');
      expect(overdue).toBeDefined();
      expect(overdue.to).toBeUndefined();
      // Наблюдения видны как события.
      expect(kinds).toContain('snapshot_observed');

      // Сортировка по времени.
      const at = body.events.map((e: { at: string }) => Date.parse(e.at));
      expect([...at].sort((a: number, b: number) => a - b)).toEqual(at);

      // Покрытие источников — честное.
      expect(body.coverage.journalAvailable).toBe(true);
      // Правок этой строки в журнале три (N4, L4, G4); в события попали две —
      // G (предмет) вне канона видов таймлайна.
      expect(body.coverage.journalEntries).toBe(3);
      expect(body.coverage.snapshotObservations).toBeGreaterThanOrEqual(2); // снимок SQL + живое
      expect(Array.isArray(body.coverage.weekSliceDates)).toBe(true);
      // Синтетическая строка в архивных срезах недель не жила.
      expect(body.coverage.weekSliceDates).toEqual([]);
      expect(body.historySince).toBeTruthy();
      expect(body.historyNote).toContain('История ведётся с');
    });

    it('строка без истории: только живое состояние, historyNote говорит об этом', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/timeline/УЭР/7' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.historySince).toBeNull();
      expect(body.historyNote).toContain('Истории по этой строке нет');
      // Плановая дата впереди, заключения нет — просрочки нет.
      expect(body.events.filter((e: { kind: string }) => e.kind === 'overdue_started')).toHaveLength(0);
    });

    it('заключённая позже плана строка несёт закрытую просрочку (to = дата заключения)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/timeline/УЭР/6' });
      expect(res.statusCode).toBe(200);
      const overdue = res.json().events.find((e: { kind: string }) => e.kind === 'overdue_started');
      expect(overdue).toBeDefined();
      expect(overdue.to).toBe(new Date((asOfDay - 35) * 86_400_000).toISOString().slice(0, 10));
    });

    it('латинский id управления принимается наравне с кириллическим', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/timeline/uer/4' });
      expect(res.statusCode).toBe(200);
      expect(res.json().rowKey).toBe('УЭР:4');
    });

    it('404 — неизвестное управление; 400 — строка из шапки; 404 — строки нигде нет', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/timeline/НЕТУ/4' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/api/timeline/УЭР/2' })).statusCode).toBe(400);
      expect((await app.inject({ method: 'GET', url: '/api/timeline/УЭР/9999' })).statusCode).toBe(404);
    });
  });

  describe('GET /api/timeline/upcoming', () => {
    it('окно 30 дней: просроченная и близкая входят, заключённая и дальняя — нет', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/timeline/upcoming?days=30' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.days).toBe(30);
      expect(body.monitoringLinked).toBe(false);

      const subjects = body.rows.map((r: { subject: string }) => r.subject);
      expect(subjects).toContain('Просроченная закупка');
      expect(subjects).toContain('Близкая закупка');
      expect(subjects).not.toContain('Заключённая закупка');
      expect(subjects).not.toContain('Дальняя закупка');

      // Самая горящая — сверху.
      expect(subjects[0]).toBe('Просроченная закупка');

      const hot = body.rows.find((r: { subject: string }) => r.subject === 'Просроченная закупка');
      expect(hot).toMatchObject({
        rowKey: 'УЭР:4',
        overdue: true,
        daysToPlan: -30,
        procedureCode: 'ЭА152-26',
        monitoringStage: null,
        hasLiveReason: true,
      });
      expect(hot.reason).toMatchObject({ id: 'no-funding', kind: 'live', cell: 'U4' });
      expect(hot.planSum).toBeCloseTo(250.5, 2);

      const near = body.rows.find((r: { subject: string }) => r.subject === 'Близкая закупка');
      expect(near).toMatchObject({ overdue: false, daysToPlan: 10, reason: null, hasLiveReason: false });
    });

    it('days по умолчанию = 14; мусорный days — 400 с русским сообщением', async () => {
      const ok = await app.inject({ method: 'GET', url: '/api/timeline/upcoming' });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().days).toBe(14);

      const bad = await app.inject({ method: 'GET', url: '/api/timeline/upcoming?days=abc' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().message).toContain('days');
    });
  });
});
