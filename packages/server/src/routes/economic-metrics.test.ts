/**
 * GET /api/analytics/economic — контракт подачи экономических метрик.
 *
 * Проверяются четыре обязательства роута, а не арифметика ядра (она закрыта
 * характеризационными тестами @aemr/core):
 *   1. у каждого процента на экране есть числитель и знаменатель;
 *   2. итог района собран ИЗ СТРОК, а не усреднением процентов ГРБС —
 *      фикстура нарочно устроена так, что среднее даёт другую зону;
 *   3. пустой знаменатель даёт null и подпись «вердикта нет», а не ноль
 *      и не зелёную зону;
 *   4. срез прошлой недели читается из снимка той недели, а не из живого кэша.
 *
 * Фикстура калибрована вручную (все числа ниже сходятся на бумаге):
 *   УО, 2026: план 700 (ФБ 280 / КБ 280 / МБ 140), факт 676 (280 / 260 / 136),
 *             из них четвёртый квартал — 388 → навес 57,40 % (красная зона),
 *             освоение ФБ 100 % против КБ 92,86 % → разрыв 7,14 п.п. (жёлтая),
 *             одна строка из четырёх заключена кварталом позже плана → 75 %.
 *   УО, 2025: одна строка только за счёт местного бюджета — сравнивать
 *             источники не с чем, разрыв обязан быть без вердикта.
 *   УИО, 2026: план 240, факт 240, четвёртого квартала нет; у одной строки
 *             квартал факта выводится из даты заключения.
 *   Район, 2026: навес 388 / 916 = 42,36 % (жёлтая зона) — ни красная зона
 *             УО, ни среднее долей ГРБС (28,7 %) с этим числом не совпадают.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEPT_COLUMNS, dayNumberOf } from '@aemr/shared';
import type { DataSnapshot } from '@aemr/shared';

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

interface RowSpec {
  id: string;
  planQuarter: number;
  planYear: number;
  /** Пусто — квартал факта роут выведет из даты заключения. */
  factQuarter?: number;
  factYear?: number;
  factDate: string;
  plan: [fb: number, kb: number, mb: number];
  fact: [fb: number, kb: number, mb: number];
}

/** Синтетическая строка книги ГРБС (34 колонки) — формат фикстур продукта. */
function makeRow(spec: RowSpec): unknown[] {
  const row: unknown[] = new Array(34).fill('');
  row[COL.ID] = spec.id;
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.SUBJECT] = `Закупка ${spec.id}`;
  row[COL.METHOD] = 'ЭА';
  row[COL.FB_PLAN] = spec.plan[0];
  row[COL.KB_PLAN] = spec.plan[1];
  row[COL.MB_PLAN] = spec.plan[2];
  row[COL.TOTAL_PLAN] = spec.plan[0] + spec.plan[1] + spec.plan[2];
  row[COL.PLAN_DATE] = `15.01.${spec.planYear}`;
  row[COL.PLAN_QUARTER] = spec.planQuarter;
  row[COL.PLAN_YEAR] = spec.planYear;
  row[COL.FACT_DATE] = spec.factDate;
  row[COL.FACT_QUARTER] = spec.factQuarter ?? '';
  row[COL.FACT_YEAR] = spec.factYear ?? '';
  row[COL.FB_FACT] = spec.fact[0];
  row[COL.KB_FACT] = spec.fact[1];
  row[COL.MB_FACT] = spec.fact[2];
  row[COL.TOTAL_FACT] = spec.fact[0] + spec.fact[1] + spec.fact[2];
  return row;
}

/** Шапка книги ГРБС — три строки, их срезает канонический collectRowsByDept. */
const HEADERS = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];

const UO_ROWS = [
  ...HEADERS,
  makeRow({ id: 'uo-1', planQuarter: 1, planYear: 2026, factQuarter: 1, factYear: 2026,
    factDate: '10.02.2026', plan: [40, 40, 20], fact: [40, 36, 19] }),
  makeRow({ id: 'uo-2', planQuarter: 2, planYear: 2026, factQuarter: 2, factYear: 2026,
    factDate: '10.05.2026', plan: [40, 40, 20], fact: [40, 37, 20] }),
  // Заключена третьим кварталом при плане на второй — единственное опоздание.
  makeRow({ id: 'uo-3', planQuarter: 2, planYear: 2026, factQuarter: 3, factYear: 2026,
    factDate: '10.08.2026', plan: [40, 40, 20], fact: [40, 37, 19] }),
  makeRow({ id: 'uo-4', planQuarter: 4, planYear: 2026, factQuarter: 4, factYear: 2026,
    factDate: '20.12.2026', plan: [160, 160, 80], fact: [160, 150, 78] }),
  // Прошлый год: только местный бюджет — сравнивать источники не с чем.
  makeRow({ id: 'uo-2025', planQuarter: 4, planYear: 2025, factQuarter: 4, factYear: 2025,
    factDate: '20.12.2025', plan: [0, 0, 1000], fact: [0, 0, 1000] }),
];

const UIO_ROWS = [
  ...HEADERS,
  makeRow({ id: 'uio-1', planQuarter: 1, planYear: 2026, factQuarter: 1, factYear: 2026,
    factDate: '10.03.2026', plan: [0, 50, 50], fact: [0, 50, 50] }),
  makeRow({ id: 'uio-2', planQuarter: 2, planYear: 2026, factQuarter: 2, factYear: 2026,
    factDate: '10.06.2026', plan: [0, 50, 50], fact: [0, 50, 50] }),
  // Квартал факта не проставлен: роут обязан вывести его из даты и сказать об этом.
  makeRow({ id: 'uio-3', planQuarter: 3, planYear: 2026,
    factDate: '10.09.2026', plan: [0, 20, 20], fact: [0, 20, 20] }),
];

// ── Форма ответа глазами клиента ─────────────────────────────────────

interface MetricView {
  label: string;
  value: number | null;
  unit: string;
  numerator: number | null;
  denominator: number | null;
  zone: 'normal' | 'yellow' | 'red' | null;
  zoneLabel: string;
  caveats: string[];
  grade?: 'A' | 'B' | 'C' | 'D' | null;
  medianValue?: number | null;
  meanShiftQuarters?: number | null;
  byCount?: { value: number | null; numerator: number; denominator: number };
  bySource?: Record<string, { value: number | null; numerator: number; denominator: number }>;
  widestPair?: [string, string] | null;
}

interface ScopeView {
  dept: string | null;
  name: string;
  metrics: Record<string, MetricView>;
}

interface EconomicResponse {
  period: { year: number; asOfDay: number; asOfDate: string; live: boolean; selectionLabel?: string };
  district: ScopeView;
  departments: ScopeView[];
  notes: string[];
}

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

/** Роут поднимается отдельным приложением: чужой app.ts тест не трогает. */
async function buildApp(): Promise<FastifyInstance> {
  const { economicMetricsRoutes } = await import('./economic-metrics.js');
  const app = Fastify({ logger: false });
  await app.register(economicMetricsRoutes);
  await app.ready();
  return app;
}

describe('GET /api/analytics/economic — годовой разрез, зоны и провенанс', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    setDeptSheetCache({
      УО: { values: UO_ROWS, formulas: [], sheetName: 'ВСЕ' },
      УИО: { values: UIO_ROWS, formulas: [], sheetName: 'УИО' },
    });
    app = await buildApp();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  const get = async (url: string): Promise<EconomicResponse> => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    return res.json<EconomicResponse>();
  };

  const deptOf = (body: EconomicResponse, short: string): ScopeView => {
    const found = body.departments.find((d) => d.dept === short);
    expect(found, short).toBeDefined();
    return found!;
  };

  it('год без даты среза — прямой эфир: гейт факта не режет декабрьские заключения', async () => {
    const body = await get('/api/analytics/economic?year=2026');
    expect(body.period.year).toBe(2026);
    expect(body.period.live).toBe(true);
    // Декабрьская строка датирована позже «сегодня» и в эфире обязана считаться:
    // официальный лист её тоже уже показывает. Появись гейт — навес станет нулём.
    expect(deptOf(body, 'УО').metrics.december_overhang.numerator).toBe(388);
    expect(body.departments.map((d) => d.dept)).toEqual(['УИО', 'УО']);
  }, 30_000);

  it('декабрьский навес: доля денег с раскрытым отношением и красная зона', async () => {
    const uo = deptOf(await get('/api/analytics/economic?year=2026'), 'УО');
    const m = uo.metrics.december_overhang;
    expect(m.label).toBe('Декабрьский навес');
    expect(m.numerator).toBe(388);
    expect(m.denominator).toBe(676);
    expect(m.value).toBeCloseTo(57.396, 2);
    expect(m.unit).toBe('%');
    expect(m.zone).toBe('red');
    expect(m.zoneLabel).toBe('Критический навес');
    // Доля по числу процедур — рядом и со своим знаменателем: одна из четырёх.
    expect(m.byCount).toEqual({ value: 25, numerator: 1, denominator: 4 });
  }, 30_000);

  it('точность планирования: оценка PEFA, медиана и суммы периметра', async () => {
    const uo = deptOf(await get('/api/analytics/economic?year=2026'), 'УО');
    const m = uo.metrics.planning_accuracy;
    expect(m.numerator).toBe(24);
    expect(m.denominator).toBe(700);
    expect(m.value).toBeCloseTo(3.4286, 3);
    expect(m.grade).toBe('A');
    expect(m.zone).toBe('normal');
    // Медиана построчного отклонения выдаётся рядом с агрегатом: агрегат в
    // норме при большой медиане означал бы, что ошибки строк гасят друг друга.
    expect(m.medianValue).toBeCloseTo(3.5, 6);
    expect(m.caveats.some((c) => c.includes('Медиана построчного отклонения'))).toBe(true);
  }, 30_000);

  it('разрыв освоения: своего числителя нет, зато источники раскрыты поимённо', async () => {
    const uo = deptOf(await get('/api/analytics/economic?year=2026'), 'УО');
    const m = uo.metrics.source_execution_gap;
    expect(m.unit).toBe('п.п.');
    expect(m.value).toBeCloseTo(7.1428, 3);
    expect(m.zone).toBe('yellow');
    expect(m.zoneLabel).toBe('Источники расходятся');
    // Числитель у разности долей выдуман быть не может — вместо него null и
    // честная оговорка, а числа раскрыты по каждому источнику.
    expect(m.numerator).toBeNull();
    expect(m.denominator).toBeNull();
    expect(m.caveats[0]).toContain('разность двух долей');
    expect(m.bySource!['ФБ']).toEqual({ value: 100, numerator: 280, denominator: 280 });
    expect(m.bySource!['КБ'].numerator).toBe(260);
    expect(m.bySource!['КБ'].denominator).toBe(280);
    expect(m.bySource!['КБ'].value).toBeCloseTo(92.857, 2);
    expect(m.widestPair).toEqual(['ФБ', 'КБ']);
  }, 30_000);

  it('соблюдение планового квартала: доля в срок и средний сдвиг', async () => {
    const uo = deptOf(await get('/api/analytics/economic?year=2026'), 'УО');
    const m = uo.metrics.quarter_compliance;
    expect(m.numerator).toBe(3);
    expect(m.denominator).toBe(4);
    expect(m.value).toBe(75);
    expect(m.zone).toBe('yellow');
    expect(m.meanShiftQuarters).toBeCloseTo(0.25, 6);
  }, 30_000);

  it('квартал факта, выведенный из даты заключения, назван оговоркой', async () => {
    const uio = deptOf(await get('/api/analytics/economic?year=2026'), 'УИО');
    const caveats = uio.metrics.december_overhang.caveats;
    expect(caveats.some((c) => c.includes('выведен из даты заключения'))).toBe(true);
    // Навеса у УИО нет вовсе — и это норма, а не отсутствие данных.
    expect(uio.metrics.december_overhang.value).toBe(0);
    expect(uio.metrics.december_overhang.denominator).toBe(240);
    expect(uio.metrics.december_overhang.zone).toBe('normal');
  }, 30_000);

  it('итог района собран из строк, а не усреднением процентов ГРБС', async () => {
    const body = await get('/api/analytics/economic?year=2026');
    const district = body.district;
    expect(district.dept).toBeNull();
    expect(district.name).toBe('Итог по району');

    const m = district.metrics.december_overhang;
    expect(m.numerator).toBe(388);
    expect(m.denominator).toBe(916);
    expect(m.value).toBeCloseTo(42.358, 2);
    expect(m.zone).toBe('yellow');

    // Три проверки одного правила. Район не равен худшему ГРБС (57,40 %),
    // не равен среднему долей ГРБС (28,70 %) — он равен отношению слитых
    // числителя и знаменателя. Совпади он с любым из первых двух — значит
    // проценты где-то сложили или усреднили.
    const uo = deptOf(body, 'УО').metrics.december_overhang.value!;
    const uio = deptOf(body, 'УИО').metrics.december_overhang.value!;
    expect(m.value).not.toBeCloseTo(uo, 2);
    expect(m.value).not.toBeCloseTo((uo + uio) / 2, 2);
    expect(m.value).toBeCloseTo((m.numerator! / m.denominator!) * 100, 6);
  }, 30_000);

  it('порог разрыва берётся у ядра: ровно 5 п.п. по району — уже жёлтая зона', async () => {
    const m = (await get('/api/analytics/economic?year=2026')).district.metrics.source_execution_gap;
    // Район: ФБ 280/280 = 100 %, КБ 380/400 = 95 % — разность ровно 5 п.п.
    // Норма у ядра строго меньше пяти, поэтому граница обязана быть жёлтой.
    expect(m.value).toBeCloseTo(5, 6);
    expect(m.zone).toBe('yellow');
  }, 30_000);

  it('у каждого процента на экране есть числитель и знаменатель', async () => {
    const body = await get('/api/analytics/economic?year=2026');
    const scopes = [body.district, ...body.departments];
    let checked = 0;
    for (const scope of scopes) {
      for (const [key, metric] of Object.entries(scope.metrics)) {
        if (metric.unit !== '%' || metric.value === null) continue;
        checked += 1;
        expect(metric.numerator, `${scope.name}/${key}`).not.toBeNull();
        expect(metric.denominator, `${scope.name}/${key}`).toBeGreaterThan(0);
        expect(metric.value, `${scope.name}/${key}`)
          .toBeCloseTo((metric.numerator! / metric.denominator!) * 100, 6);
        // Подпись зоны — человеческая, без внутренних ключей метрики.
        expect(metric.zoneLabel, `${scope.name}/${key}`).not.toContain(key);
        expect(metric.zoneLabel, `${scope.name}/${key}`).toMatch(/[А-Яа-яЁё]/);
      }
    }
    // Петля не должна быть вакуумной: процентных метрик в ответе много.
    expect(checked).toBeGreaterThan(5);
  }, 30_000);

  it('нечего сравнивать — вердикта нет: ноль и зелёная зона запрещены', async () => {
    const body = await get('/api/analytics/economic?year=2025');
    expect(body.period.year).toBe(2025);

    // У прошлогодней строки только местный бюджет: сравнивать его не с чем.
    const uo = deptOf(body, 'УО').metrics.source_execution_gap;
    expect(uo.value).toBeNull();
    expect(uo.zone).toBeNull();
    expect(uo.zoneLabel).toBe('Вердикта нет: считать не из чего');
    expect(uo.caveats.some((c) => c.includes('вне сравнения') && c.includes('ФБ'))).toBe(true);
    expect(uo.bySource!['МБ']).toEqual({ value: 100, numerator: 1000, denominator: 1000 });

    // Весь год этого ГРБС — одна декабрьская строка: навес стопроцентный.
    const overhang = deptOf(body, 'УО').metrics.december_overhang;
    expect(overhang.value).toBe(100);
    expect(overhang.zone).toBe('red');

    // У УИО за 2025 год строк нет вовсе: не ноль процентов, а «нечего считать».
    const uio = deptOf(body, 'УИО').metrics.december_overhang;
    expect(uio.value).toBeNull();
    expect(uio.denominator).toBe(0);
    expect(uio.zone).toBeNull();
    expect(uio.zoneLabel).toBe('Вердикта нет: считать не из чего');
  }, 30_000);

  it('квартал выбора не влияет на годовые метрики — и роут говорит об этом', async () => {
    const body = await get('/api/analytics/economic?quarters=2026:1');
    expect(body.period.year).toBe(2026);
    expect(body.period.selectionLabel).toContain('2026');
    expect(body.notes.some((n) => n.includes('Метрики годовые'))).toBe(true);
    // Числа при этом ровно те же, что у годового запроса: молчаливой подмены
    // периметра квартальным срезом не происходит.
    expect(deptOf(body, 'УО').metrics.december_overhang.denominator).toBe(676);
  }, 30_000);

  it('мусор в параметре периода → 400 с русским объяснением', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/economic?year=1999' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toBe(
      'Параметр year «1999» вне диапазона 2020..2100.',
    );
  }, 30_000);
});

describe('GET /api/analytics/economic — данных нет', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    app = await buildApp();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('пустой кэш книг → 503 и честное объяснение, а не нули', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/economic?year=2026' });
    // Нулевые метрики на пустом кэше читались бы как «навеса нет, план точен» —
    // отказ честнее выдуманного благополучия.
    expect(res.statusCode).toBe(503);
    expect(res.json<{ message: string }>().message).toContain('Кэш книг ГРБС пуст');
  }, 30_000);
});

describe('GET /api/analytics/economic — срез прошлой недели читает снимок', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { setDeptSheetCache, saveSnapshot } = await import('../services/snapshot.js');
    // Живой кэш НАРОЧНО с другими числами: возьми роут живые данные вместо
    // снимка — план 700 против 300 выдаст подмену.
    setDeptSheetCache({ УО: { values: UO_ROWS, formulas: [], sheetName: 'ВСЕ' } });
    await saveSnapshot(
      makeSnapshot('snap-week', '2026-03-19T08:00:00.000Z', {
        УО: [
          makeRow({ id: 'snap-1', planQuarter: 1, planYear: 2026, factQuarter: 1, factYear: 2026,
            factDate: '10.02.2026', plan: [0, 0, 200], fact: [0, 0, 180] }),
          makeRow({ id: 'snap-2', planQuarter: 1, planYear: 2026, factQuarter: 1, factYear: 2026,
            factDate: '05.03.2026', plan: [0, 0, 100], fact: [0, 0, 100] }),
        ],
      }),
    );
    app = await buildApp();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('неделя-срез: числа из снимка той недели, история не переписана', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analytics/economic?years=2026&week=2026-03-16',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<EconomicResponse>();
    // 16.03.2026 — понедельник; срез недели — её четверг 19.03.2026.
    expect(body.period.live).toBe(false);
    expect(body.period.asOfDay).toBe(dayNumberOf('2026-03-19'));
    expect(body.period.asOfDate).toBe('19.03.2026');

    const uo = body.departments.find((d) => d.dept === 'УО')!;
    // План снимка 300, а не живые 700 — прошлое не пересчитано по сегодняшним книгам.
    expect(uo.metrics.planning_accuracy.denominator).toBe(300);
    expect(uo.metrics.planning_accuracy.numerator).toBe(20);
    expect(uo.metrics.december_overhang.denominator).toBe(280);
    expect(body.notes.some((n) => n.includes('из снимка 19.03.2026'))).toBe(true);
  }, 30_000);
});
