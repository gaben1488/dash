/**
 * GET /api/report — контракт периода (фаза 3 карты оси времени,
 * docs/superpowers/specs/2026-08-07-time-axis-map.md §4).
 *
 * Главный инвариант волны: СТАРЫЙ запрос обязан работать как прежде. Поэтому
 * тесты идут парами — сперва прежняя форма (year/quarter/asOf), затем новая
 * (years/quarters/months/week), и отдельно проверяется, что ответ на старую
 * форму не обзавёлся ни одним новым ключом.
 *
 * Фикстура — та же калибровка, что в report.test.ts (УЭР 1 кв: план 15 /
 * факт 6 → 40.00%), плюс 2 кв 2026 (8/2) и 2025 год (4/1): без вторых чисел
 * мультисрез невозможно отличить от повторённого первого. Сеть замокана
 * «в отказ» — лист СВОД недоступен, отчёт отдаётся без официальной колонки.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEPT_COLUMNS, dayNumberOf, floorToThursday } from '@aemr/shared';
import type { DataSnapshot } from '@aemr/shared';
import type { Report } from '@aemr/core';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

const COL = DEPT_COLUMNS;

/** Синтетическая строка ГРБС-листа (32 колонки, формат фикстур core). */
function makeRow(id: string, method: string, year: number, quarter: number, factDate: string): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = id;
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.SUBJECT] = 'Закупка ' + id;
  row[COL.METHOD] = method;
  row[COL.PLAN_DATE] = `15.01.${year}`;
  row[COL.PLAN_QUARTER] = quarter;
  row[COL.PLAN_YEAR] = year;
  row[COL.FACT_DATE] = factDate;
  return row;
}

/** n строк плана квартала q года year, из них первые withFact — заключённые. */
function planRows(
  prefix: string,
  n: number,
  withFact: number,
  year: number,
  q: number,
  method: string,
  factDate: string,
): unknown[][] {
  return Array.from({ length: n }, (_, i) =>
    makeRow(`${prefix}-${i + 1}`, method, year, q, i < withFact ? factDate : ''),
  );
}

const HEADERS = [new Array(32).fill('h'), new Array(32).fill('h'), new Array(32).fill('h')];

/**
 * Книга УЭР: 2026 Q1 — 15/6 (эталон 40.00%), 2026 Q2 — 8/2, 2025 Q1 — 4/1.
 * Год 2026 = 23/8 как сумма плановых кварталов, год 2025 = 4/1.
 */
const UER_ROWS = [
  ...HEADERS,
  ...planRows('uer-kp', 10, 4, 2026, 1, 'ЭА', '20.02.2026'),
  ...planRows('uer-ep', 5, 2, 2026, 1, 'ЕП', '20.02.2026'),
  ...planRows('uer-q2', 8, 2, 2026, 2, 'ЭА', '20.05.2026'),
  ...planRows('uer-2025', 4, 1, 2025, 1, 'ЭА', '20.02.2025'),
];

/** Тело ответа: Report + методология + ссылка + (новая форма) срезы выбора. */
type SliceResponse = Omit<Report, 'period'> & {
  period: Report['period'] & { asOfDay: number; live: boolean };
};
type ReportResponse = SliceResponse & {
  methodology: string;
  svodOnlineUrl?: string;
  selectionLabel?: string;
  periods?: SliceResponse[];
};

/** Минимальный DataSnapshot со строками-атомами — форма snapshots.data. */
function makeSnapshot(
  id: string,
  createdAt: string,
  rowsByDept: Record<string, unknown[][]>,
): DataSnapshot {
  return {
    id,
    spreadsheetId: 'test-spreadsheet',
    createdAt,
    officialMetrics: {},
    calculatedMetrics: {},
    deltas: [],
    issues: [],
    trust: { overall: 100, components: [], grade: 'A', computedAt: createdAt, basedOnSnapshot: id },
    rowCount: Object.values(rowsByDept).reduce((n, rows) => n + rows.length, 0),
    rowsByDept,
    metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
  };
}

describe('GET /api/report — период: старая форма и мультизначения', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    setDeptSheetCache({ УЭР: { values: UER_ROWS, formulas: [], sheetName: 'УЭР' } });
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  const get = async (url: string): Promise<ReportResponse> => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    return res.json<ReportResponse>();
  };

  it('старый запрос year+quarter: прежние числа и НИ ОДНОГО нового ключа', async () => {
    const body = await get('/api/report?year=2026&quarter=1');
    expect(body.period.year).toBe(2026);
    expect(body.period.quarter).toBe(1);
    expect(body.period.live).toBe(true);

    const uer = body.grbsBlocks.find((b) => b.dept === 'УЭР');
    expect(uer!.quarter.execution.planCount).toBe(15);
    expect(uer!.quarter.execution.doneCount).toBe(6);
    expect(uer!.quarter.execution.pct).toBeCloseTo(40.0, 2);

    // Ответ старой формы не обзавёлся полями новой: клиенты, разбирающие
    // ключи ответа целиком, не должны увидеть изменения контракта.
    expect('periods' in body).toBe(false);
    expect('selectionLabel' in body).toBe(false);
    // Порядок ключей тоже прежний: period первым, methodology и ссылка — в хвосте.
    const keys = Object.keys(body);
    expect(keys[0]).toBe('period');
    expect(keys.slice(-2)).toEqual(['methodology', 'svodOnlineUrl']);
  }, 30_000);

  it('старый запрос без параметров: прямой эфир, срез — сегодня по календарю продукта', async () => {
    const body = await get('/api/report');
    const { productCalendarDay } = await import('../services/product-calendar.js');
    const { config } = await import('../config.js');
    const today = productCalendarDay(new Date(), config.weeklySnapshot.utcOffsetHours);
    expect(body.period.live).toBe(true);
    expect(body.period.asOfDay).toBe(today);
    const now = new Date(today * 86_400_000);
    expect(body.period.year).toBe(now.getUTCFullYear());
    expect(body.period.quarter).toBe(Math.floor(now.getUTCMonth() / 3) + 1);
  }, 30_000);

  it('старый запрос asOf: архив, дата уважается как задана (без флора к четвергу)', async () => {
    const body = await get('/api/report?asOf=2026-02-10&year=2026&quarter=1');
    expect(body.period.live).toBe(false);
    expect(body.period.asOfDay).toBe(dayNumberOf('2026-02-10'));
  }, 30_000);

  it('quarters=2026:1 даёт ТОТ ЖЕ ответ, что year=2026&quarter=1', async () => {
    const legacy = await get('/api/report?year=2026&quarter=1');
    const modern = await get('/api/report?quarters=2026:1');
    // Новая форма — обобщение старой, а не второй расчёт: корень ответа
    // обязан совпасть дословно, отличаются только поля выбора.
    const rest = { ...modern } as Record<string, unknown>;
    delete rest.periods;
    delete rest.selectionLabel;
    expect(rest).toEqual(legacy);
    expect(modern.periods).toHaveLength(1);
  }, 30_000);

  it('мультиквартал: по отчёту на каждый квартал, числа считаны отдельно', async () => {
    const body = await get('/api/report?quarters=2026:1,2026:2');
    expect(body.periods).toHaveLength(2);
    const [q1, q2] = body.periods!;
    expect(q1.period.quarter).toBe(1);
    expect(q2.period.quarter).toBe(2);
    expect(q1.period.year).toBe(2026);
    expect(q2.period.year).toBe(2026);

    // Каждый срез — свой счёт: 15/6 против 8/2. Совпади числа — значит один
    // отчёт продублирован, а второй квартал молча потерян.
    expect(q1.integralSummary.quarter.total.planCount).toBe(15);
    expect(q1.integralSummary.quarter.total.doneCount).toBe(6);
    expect(q2.integralSummary.quarter.total.planCount).toBe(8);
    expect(q2.integralSummary.quarter.total.doneCount).toBe(2);
    // Проценты по срезам не складываются: у каждого свой знаменатель.
    expect(q1.integralSummary.quarter.total.pct).toBeCloseTo(40.0, 2);
    expect(q2.integralSummary.quarter.total.pct).toBeCloseTo(25.0, 2);

    // Корень ответа = первый срез (совместимость со старым клиентом).
    expect(body.period.quarter).toBe(1);
    expect(body.integralSummary.quarter.total.planCount).toBe(15);
    // Подпись выбора — из канонического резолвера, не собрана роутом.
    expect(body.selectionLabel).toContain('2026');
    expect(body.selectionLabel).toContain('кв.');
  }, 30_000);

  it('мультигод: срез на каждый год, годовые числа не смешаны', async () => {
    const body = await get('/api/report?years=2025,2026');
    expect(body.periods).toHaveLength(2);
    const [y2025, y2026] = body.periods!;
    expect(y2025.period.year).toBe(2025);
    expect(y2026.period.year).toBe(2026);
    // Год = сумма плановых кварталов: 2025 — 4/1, 2026 — (15+8)/(6+2).
    expect(y2025.integralSummary.year.total.planCount).toBe(4);
    expect(y2025.integralSummary.year.total.doneCount).toBe(1);
    expect(y2026.integralSummary.year.total.planCount).toBe(23);
    expect(y2026.integralSummary.year.total.doneCount).toBe(8);
  }, 30_000);

  it('месяц: срез приведён к своему кварталу и об этом сказано плашкой', async () => {
    const body = await get('/api/report?months=2026:5');
    expect(body.periods).toHaveLength(1);
    expect(body.period.year).toBe(2026);
    expect(body.period.quarter).toBe(2);
    // Молчаливой подмены месяца кварталом быть не должно — читатель узнаёт
    // о ней из примечаний (ядро отчёта месяцы пока не считает).
    expect(body.notes.some((n) => n.includes('Выбор месяца 2026:5') && n.includes('2 кв.'))).toBe(true);
  }, 30_000);

  it('квартал поглощает свой месяц: 2026:1 + месяц февраль = один срез', async () => {
    // Канонизация резолвера (@aemr/shared): месяц внутри выбранного квартала
    // отдельным ключом не становится — иначе февраль посчитался бы дважды.
    const body = await get('/api/report?quarters=2026:1&months=2026:2');
    expect(body.periods).toHaveLength(1);
    expect(body.periods![0].period.quarter).toBe(1);
  }, 30_000);

  it('неделя-срез: архив на четверг выбранной недели', async () => {
    // 16.03.2026 — понедельник; срез недели — её четверг 19.03.2026.
    const body = await get('/api/report?week=2026-03-16');
    expect(body.period.live).toBe(false);
    expect(body.period.asOfDay).toBe(dayNumberOf('2026-03-19'));
    expect(body.period.year).toBe(2026);
    expect(body.period.quarter).toBe(1);
    // Снимка той недели в этой БД нет — честная плашка вместо тихой подмены.
    expect(body.notes.some((n) => n.includes('Снимка на 19.03.2026 нет'))).toBe(true);
    expect(body.selectionLabel).toContain('срез 2026-03-19');
  }, 30_000);

  it('неделя в будущем клампится к последнему прошедшему четвергу', async () => {
    const { productCalendarDay } = await import('../services/product-calendar.js');
    const { config } = await import('../config.js');
    const today = productCalendarDay(new Date(), config.weeklySnapshot.utcOffsetHours);
    const body = await get('/api/report?week=2099-01-05');
    // Будущий четверг не адресуем: он вернул бы сегодняшние числа под чужой датой.
    expect(body.period.asOfDay).toBe(floorToThursday(today));
    expect(body.period.live).toBe(false);
  }, 30_000);

  it('мусор в новых параметрах → 400 с русским объяснением', async () => {
    const bad = async (url: string, fragment: string) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ message: string }>();
      expect(body.message).toContain(fragment);
    };
    await bad('/api/report?years=1999', 'не является годом');
    await bad('/api/report?years=позапрошлый', 'не является годом');
    await bad('/api/report?quarters=2026:9', 'ГОД:КВАРТАЛ');
    await bad('/api/report?quarters=2026', 'ГОД:КВАРТАЛ');
    await bad('/api/report?months=2026:13', 'ГОД:МЕСЯЦ');
    await bad('/api/report?week=2026-06-31', 'не является датой формата YYYY-MM-DD');
    await bad('/api/report?week=позавчера', 'не является датой формата YYYY-MM-DD');
  }, 30_000);

  it('старые сообщения об ошибках сохранены дословно', async () => {
    const message = async (url: string) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
      return res.json<{ message: string }>().message;
    };
    expect(await message('/api/report?quarter=5')).toBe('Параметр quarter «5» не является кварталом 1..4.');
    expect(await message('/api/report?year=1999')).toBe('Параметр year «1999» вне диапазона 2020..2100.');
    expect(await message('/api/report?asOf=garbage'))
      .toBe('Параметр asOf «garbage» не является датой формата YYYY-MM-DD.');
  }, 30_000);

  it('смешение форм и двух срезов → 400, а не тихий выбор победителя', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/api/report?year=2026&quarters=2026:1' });
    expect(res1.statusCode).toBe(400);
    expect(res1.json<{ message: string }>().message).toContain('нельзя задавать вместе');

    const res2 = await app.inject({ method: 'GET', url: '/api/report?asOf=2026-02-10&week=2026-03-16' });
    expect(res2.statusCode).toBe(400);
    expect(res2.json<{ message: string }>().message).toContain('asOf и week');
  }, 30_000);

  it('слишком широкий выбор → 400: один GET не превращается в десятки пересчётов', async () => {
    const years = Array.from({ length: 13 }, (_, i) => 2020 + i).join(',');
    const res = await app.inject({ method: 'GET', url: `/api/report?years=${years}` });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toContain('слишком много периодов');
  }, 30_000);

  it('пустое значение нового параметра = параметр не задан', async () => {
    // Клиент с пустой осью времени шлёт `years=`; отказывать на этом не за что.
    const body = await get('/api/report?years=&quarters=');
    expect(body.period.live).toBe(true);
    expect('periods' in body).toBe(false);
  }, 30_000);
});

describe('GET /api/report — неделя-срез читает снимок той недели', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache, saveSnapshot } = await import('../services/snapshot.js');
    // Живой кэш НАРОЧНО с другими числами: возьми роут живые данные вместо
    // снимка — числа выдадут подмену и тест её поймает.
    setDeptSheetCache({ УЭР: { values: UER_ROWS, formulas: [], sheetName: 'УЭР' } });
    await saveSnapshot(
      makeSnapshot('snap-week', '2026-03-19T08:00:00.000Z', {
        УЭР: planRows('snap-kp', 10, 3, 2026, 1, 'ЭА', '20.02.2026'),
      }),
    );
    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('week + quarters — законное сочетание: период задаёт что, неделя — по какому снимку', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/report?quarters=2026:1&week=2026-03-16' });
    expect(res.statusCode).toBe(200);
    const body = res.json<ReportResponse>();
    expect(body.period.asOfDay).toBe(dayNumberOf('2026-03-19'));
    const uer = body.grbsBlocks.find((b) => b.dept === 'УЭР');
    // Снимок (10/3), а не живой кэш (15/6) — история не переписана.
    expect(uer!.quarter.execution.planCount).toBe(10);
    expect(uer!.quarter.execution.doneCount).toBe(3);
    expect(body.notes.some((n) => n.includes('снимка 19.03.2026'))).toBe(true);
  }, 30_000);
});

describe('parsePeriodQuery / resolvePeriodParams — чистый разбор', () => {
  /** Продуктовый день 2026-08-07 (пятница) — фиксированное «сегодня» тестов. */
  const TODAY = dayNumberOf('2026-08-07')!;

  it('пустой запрос: эфир, срез — сегодня, один срез из даты', async () => {
    const { parsePeriodQuery, resolvePeriodParams } = await import('../services/period-params.js');
    const parsed = parsePeriodQuery({});
    expect(parsed.errors).toEqual([]);
    expect(parsed.hasSelection).toBe(false);
    const r = resolvePeriodParams(parsed, { todayDay: TODAY });
    expect(r.live).toBe(true);
    expect(r.asOfDay).toBe(TODAY);
    expect(r.slices).toEqual([{ year: 2026, quarter: 3, from: null }]);
  });

  it('легаси quarter без года: год берётся из даты среза (прежнее поведение)', async () => {
    const { parsePeriodQuery, resolvePeriodParams } = await import('../services/period-params.js');
    const r = resolvePeriodParams(parsePeriodQuery({ quarter: '2' }), { todayDay: TODAY });
    expect(r.slices).toEqual([{ year: 2026, quarter: 2, from: null }]);
    expect(r.live).toBe(true);
  });

  it('повторённый ключ query склеивается: ?years=2025&years=2026', async () => {
    const { parsePeriodQuery, resolvePeriodParams } = await import('../services/period-params.js');
    const parsed = parsePeriodQuery({ years: ['2025', '2026'] });
    expect(parsed.errors).toEqual([]);
    const r = resolvePeriodParams(parsed, { todayDay: TODAY });
    expect(r.slices.map((s) => s.year)).toEqual([2025, 2026]);
  });

  it('четыре квартала схлопываются в год целиком (канонизация shared)', async () => {
    const { parsePeriodQuery, resolvePeriodParams } = await import('../services/period-params.js');
    const parsed = parsePeriodQuery({ quarters: '2026:1,2026:2,2026:3,2026:4' });
    const r = resolvePeriodParams(parsed, { todayDay: TODAY });
    expect(r.slices).toHaveLength(1);
    expect(r.slices[0].from?.kind).toBe('year');
  });

  it('неделя не трогает период: quarters + week дают срез квартала на четверг', async () => {
    const { parsePeriodQuery, resolvePeriodParams } = await import('../services/period-params.js');
    const parsed = parsePeriodQuery({ quarters: '2026:1', week: '2026-03-18' });
    const r = resolvePeriodParams(parsed, { todayDay: TODAY });
    expect(r.slices).toEqual([{ year: 2026, quarter: 1, from: { kind: 'quarter', year: 2026, quarter: 1 } }]);
    expect(r.asOfDay).toBe(dayNumberOf('2026-03-19'));
    expect(r.live).toBe(false);
  });

  it('год плана: строгий разбор для API, мягкий — для фильтров', async () => {
    const { parsePlanYear, parseYearFilterParam, isPlanYear } = await import('../services/period-params.js');
    expect(parsePlanYear('2026')).toBe(2026);
    expect(parsePlanYear('2026abc')).toBeNull();
    expect(parsePlanYear('1999')).toBeNull();
    expect(parsePlanYear(undefined)).toBeNull();
    // Мягкий разбор повторяет поведение действующих копий по роутам: 'all' и
    // мусор выключают фильтр, а parseInt прощает хвост.
    expect(parseYearFilterParam('all')).toBeUndefined();
    expect(parseYearFilterParam('2026abc')).toBe(2026);
    expect(parseYearFilterParam('1999')).toBeUndefined();
    expect(isPlanYear(2026)).toBe(true);
    expect(isPlanYear(2026.5)).toBe(false);
  });
});
