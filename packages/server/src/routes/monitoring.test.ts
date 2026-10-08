import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const GRIDS = new Map<string, unknown[][]>();
vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async (_id: string, sheet: string) => {
    const values = GRIDS.get(sheet);
    if (!values) throw new Error(`Не прочитан лист «${sheet}»`);
    return values;
  }),
}));

const MASTER = 'Рабочий реестр процедур';
function row(code: string, dept: string, nmck: number, result: string, stage: string, action = '', quality = ''): unknown[] {
  const r: unknown[] = Array(25).fill('');
  r[0] = code; r[4] = dept; r[5] = 'Синтетический заказчик'; r[6] = `${code} Синтетический предмет`;
  r[7] = nmck; r[8] = '01.09.2026'; r[9] = '20.09.2026'; r[10] = '10.10.2026'; r[11] = '15.10.2026';
  r[19] = result; r[22] = stage; r[23] = action; r[24] = quality;
  return r;
}
function summary(dept: string, count: number, nmck: number, price: number, savings: number, mb: number): unknown[] {
  const r: unknown[] = Array(18).fill(''); r[0] = dept; r[1] = count; r[6] = nmck;
  r[8] = price; r[9] = savings; r[13] = mb; return r;
}

describe('мониторинг нового рабочего реестра', () => {
  let app: FastifyInstance;
  let invalidateMonitoringCache: () => void;
  beforeAll(async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AEMR_API_KEY: '', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent' };
    const { MONITORING_MASTER_HEADERS } = await import('@aemr/core');
    const success = row('ЭА100-26', 'УО', 100_000, 'Состоялась', 'Состоялась', 'Дополнить сведения', 'Проверить: Разбивка не равна экономии — N:P');
    success[11] = '01.10.2026'; success[12] = 90_000; success[16] = 10_000; success[15] = 5_000; success[17] = 'Синтетический поставщик'; success[18] = '4101100000';
    const active = row('ЭА101-26', 'УЭР', 200_000, '', 'Объявлена', 'Подвести итоги'); active[12] = 5_000;
    const cancelled = row('ЭА102-26', 'УО', 30_000, 'Отмена по решению заказчика', 'Не состоялась');
    const broken = row('ЭЗК-120-26', 'УЭР', 10_000, '', 'Заявка в уполномоченном органе', 'Исправить: Код');
    const reissued = row('ЭА104-26', 'УО', 50_000, 'Нет заявок', 'Переоформлена'); reissued[21] = 'ЭА105-26';
    GRIDS.set(MASTER, [[], [...MONITORING_MASTER_HEADERS], success, active, cancelled, broken, reissued]);
    GRIDS.set('Сводный аналитический лист', [[], ['Управление'],
      summary('УЭР', 2, 210_000, 0, 0, 0), summary('УО', 3, 130_000, 90_000, 10_000, 5_000),
      summary('Итого', 5, 340_000, 90_000, 10_000, 5_000)]);
    GRIDS.set('Справочник заказчиков', [['№ п/п', 'ГРБС', 'Наименованиеучрежения', 'Сокращеное наименование учреждения'], [1, 'УО', 'Синтетический заказчик', 'Синтетический заказчик']]);
    // These contradictory legacy copies must never enter production reads.
    GRIDS.set('8. УО', [['h'], ['h'], ['legacy-price', 'legacy-result']]);
    GRIDS.set('25-26', [['legacy']]);
    ({ invalidateMonitoringCache } = await import('../services/monitoring.js'));
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const plan: unknown[] = Array(34).fill(''); plan[10] = 100; plan[24] = 90; plan[32] = 'ЭА100-26';
    setDeptSheetCache({ УО: { values: [['h'], ['h'], ['h'], plan], formulas: [], sheetName: 'ВСЕ' } });
    const { createApp } = await import('../app.js'); app = await createApp({ logger: false });
  }, 60_000);
  afterAll(async () => { await app.close(); process.env = { ...ORIGINAL_ENV }; });

  it('читает новый набор листов и сохраняет результат, адрес, единицу и неполноту', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/monitoring' });
    expect(response.statusCode).toBe(200); const b = response.json();
    expect(b.source).toMatchObject({ schema: 'canonical', moneyUnit: 'руб', sheetsExpected: 4 });
    expect(b.source.sheetsRead).toEqual([MASTER, 'Сводный аналитический лист', 'Справочник заказчиков']);
    expect(Object.keys(b.source.sheetsFailed)).toEqual(['Процедуры в работе']);
    expect(b.procedures).toHaveLength(5);
    expect(b.suppliers).toMatchObject({ rows: [], readAt: null, error: expect.any(String) });
    expect(b.procedures[0]).toMatchObject({ sheet: MASTER, row: 3, result: 'Состоялась', stage: 'awarded', auctionPrice: 90_000 });
    expect(b.procedures[1].stage).toBe('published');
    expect(b.procedures[2]).toMatchObject({ stage: 'no_result', auctionPrice: null, savingsTotal: null });
    expect(b.aggregates.nmckTotal).toBe(340_000);
  });
  it('отдаёт отдельные очереди и не поднимает требование переобъявления при отмене заказчиком', async () => {
    const b = (await app.inject({ method: 'GET', url: '/api/monitoring' })).json();
    expect(b.work.active).toHaveLength(2); expect(b.work.closed).toHaveLength(1);
    expect(b.work.closed[0].procedure.code).toBe('ЭА100-26');
    expect(b.signals.map((s: { kind: string }) => s.kind)).not.toContain('monitoring_no_successor');
    expect(b.signals.find((s: { kind: string }) => s.kind === 'monitoring_source_warning').addresses[0].address).toBe(`${MASTER}!N3`);
  });
  it('свод сравнивает те же корзины, переоформленные деньги не считает повторно', async () => {
    const b = (await app.inject({ method: 'GET', url: '/api/monitoring' })).json();
    expect(b.svod.book.total.controlGapRub).toBe(5_000);
    expect(b.svod.comparison.productTotals).toMatchObject({ count: 5, nmck: 340_000, price: 90_000 });
  });
  it('связи берёт из U/V единственного мастера', async () => {
    const b = (await app.inject({ method: 'GET', url: '/api/monitoring' })).json();
    expect(b.journal.rows).toHaveLength(5);
    expect(b.journal.edges).toContainEqual(expect.objectContaining({ from: 'ЭА104-26', to: 'ЭА105-26' }));
    expect(b.journal.rows.every((r: { sheet: string }) => r.sheet === MASTER)).toBe(true);
  });
  it('не теряет и не чинит искажённый код из колонки A', async () => {
    const b = (await app.inject({ method: 'GET', url: '/api/monitoring' })).json();
    expect(b.unparsedCodes[0]).toMatchObject({ sheet: MASTER, row: 6, text: 'ЭЗК-120-26', guess: 'ЭЗК120-26' });
    expect(b.procedures[3].code).toBeNull();
  });
  it('аналитика использует структурный результат, сохраняя знаменатель', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/monitoring/analytics' });
    expect(response.statusCode).toBe(200); const { analytics } = response.json();
    expect(analytics.reduction.portfolio.count).toBe(1);
    expect(analytics.reduction.portfolioPct).toBe(10);
    expect(analytics.unsuccessful.count).toBe(1);
  });
  it('внешняя сверка переводит тысячи в рубли и не дублирует мастер его журналом', async () => {
    const b = (await app.inject({ method: 'GET', url: '/api/monitoring/match' })).json();
    expect(b.matched[0].nmck).toMatchObject({ monitoringRub: 100_000, agrees: true });
    expect(b.matched[0].procedures).toHaveLength(1);
    expect(b.internal.applicable).toBe(false);
  });
  it('третью копию не выдаёт за независимое подтверждение', async () => {
    const b = (await app.inject({ method: 'GET', url: '/api/monitoring/triple' })).json();
    expect(b.applicable).toBe(false); expect(b.rows).toEqual([]);
  });
  it('отказ обязательного мастера не подменяет данными справочника', async () => {
    GRIDS.delete(MASTER); invalidateMonitoringCache();
    for (const url of ['/api/monitoring', '/api/monitoring/analytics', '/api/monitoring/match', '/api/monitoring/triple']) {
      const r = await app.inject({ method: 'GET', url }); expect(r.statusCode).toBe(503);
      expect(r.json().message).toContain('Рабочий реестр');
    }
  });
});
