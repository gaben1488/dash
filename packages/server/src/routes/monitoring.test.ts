/**
 * monitoring.test.ts — inject-тесты трёх роутов «Реестра процедур определения
 * поставщика» (канон п.69в/п.101а, спека
 * docs/superpowers/specs/2026-08-18-monitoring-tab-spec-v2.md).
 *
 * Проверяется контракт вкладки целиком, а не один реестр:
 *  — GET /api/monitoring: строки листов управлений, свод с контролем и парой
 *    «книга ↔ продукт», переходящий реестр с родословной, справочник,
 *    листы-предки, сигналы, честная неполнота и адреса искажений;
 *  — GET /api/monitoring/analytics: три коэффициента снижения, каждый со
 *    своим знаменателем, воронка, сезонность по выбранной дате;
 *  — GET /api/monitoring/match: сверка с книгами ГРБС (тысячи против рублей)
 *    и внутренняя сверка «лист ↔ 25-26».
 *
 * Сеть замокана на уровне google-sheets: фикстурные гриды повторяют раскладку
 * листов книги (у листов управлений шапка — две строки, у «25-26» — одна).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

/**
 * Гриды по имени листа; тест меняет содержимое между сценариями.
 * Отсутствие имени в карте = лист «не прочитался» (отказ источника).
 */
const GRIDS = new Map<string, unknown[][]>();

vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async (_id: string, sheetName: string) => {
    const grid = GRIDS.get(sheetName);
    if (!grid) throw new Error(`Таблица-источник не ответила: чтение листа «${sheetName}»`);
    return grid;
  }),
}));

/** Строка листа управления (16 колонок раскладки спеки §1.1). */
function row(over: {
  customer?: string; subject?: string; nmck?: unknown;
  application?: string; publication?: string; deadline?: string; auction?: string;
  price?: unknown; savings?: unknown; mb?: unknown; check?: string; winner?: string;
}): unknown[] {
  const r: unknown[] = new Array(16).fill('');
  r[0] = 1;
  r[1] = over.customer ?? 'МКУ ЦЭР';
  r[2] = over.subject ?? '';
  r[3] = over.nmck ?? '';
  r[4] = over.application ?? '';
  r[5] = over.publication ?? '';
  r[6] = over.deadline ?? '';
  r[7] = over.auction ?? '';
  r[8] = over.price ?? '';
  r[9] = over.savings ?? '';
  r[10] = over.check ?? '';
  r[11] = over.mb ?? '';
  r[14] = over.winner ?? '';
  return r;
}

/** Строка листа «25-26»: судьба в колонке A, победитель в K. */
function journalRow(over: {
  fate?: string; subject?: string; nmck?: unknown; price?: unknown; winner?: string;
}): unknown[] {
  const r: unknown[] = new Array(14).fill('');
  r[0] = over.fate ?? '';
  r[1] = 'УД АЕМР';
  r[2] = over.subject ?? '';
  r[3] = over.nmck ?? '';
  r[8] = over.price ?? '';
  r[10] = over.winner ?? '';
  return r;
}

const HEADERS: unknown[][] = [new Array(16).fill('ш'), new Array(16).fill('ш')];

describe('вкладка «Реестр процедур определения поставщика»', () => {
  let app: FastifyInstance;
  let invalidateMonitoringCache: () => void;

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
    };

    // УЭР: состоялась со снижением 33 336 и объявленная без итога (НМЦК текстом).
    GRIDS.set('1. УЭР', [
      ...HEADERS,
      row({
        subject: 'ЭЗК426-25 Поставка брендированных шатров', nmck: 446_700,
        application: '22.12.2025', publication: '24.12.2025',
        deadline: '13.01.2026', auction: '15.01.2026',
        price: 413_364, savings: 33_336, mb: 33_336, check: 'верно',
        winner: 'ИП ДОЙНЯК-НОВЫЙ ДМИТРИЙ ОЛЕГОВИЧ\nИНН 541003717453',
      }),
      row({ subject: 'ЭА11-26 Ремонт кровли', nmck: '2 250 000,00', publication: '05.02.2026' }),
    ]);
    // УО: торги без результата, искажённый код и строка с «ошибкой» контроля.
    GRIDS.set('8. УО', [
      ...HEADERS,
      row({
        customer: 'МБОУ ЕСШ №1', subject: 'ЭА10-26 Поставка бумаги', nmck: 100_000,
        publication: '01.02.2026', auction: '20.02.2026', price: 0,
        winner: 'Не состоялся (0 заявок)',
      }),
      row({ customer: 'МБОУ ЕСШ №2', subject: 'ЭЗК-120-26 Стройматериалы', nmck: 10_000 }),
      row({
        customer: 'МБОУ ЕСШ №1', subject: 'ЭА20-26 Учебники', nmck: 780_000,
        publication: '01.03.2026', auction: '15.03.2026',
        price: 700_000, savings: 80_000, mb: 30_000, check: 'ошибка',
        winner: 'ООО «БИТ»\nИНН 4101100000',
      }),
    ]);
    // Свод книги: НМЦК занижен на текстовую ячейку, контроля разбивки нет.
    GRIDS.set('СВОДНЫЙ', [
      ['Общая информация по проведённым ЭА', '', '', '', '', '', '', '', ''],
      ['№', 'Управление', 'Кол-во', 'НМЦК', 'Цена аукциона', 'Экономия', '', '', ''],
      ['', '', '', '', '', 'ВСЕГО', 'МБ', 'КБ', 'ФБ'],
      [1, 'УЭР АЕМР', 1, 446_700, 413_364, 33_336, 33_336, '', ''],
      [2, 'УО АЕМР', 2, 890_000, 700_000, 80_000, 30_000, '', ''],
      ['Итого:', '', 3, 1_336_700, 1_113_364, 113_336, 63_336, '', ''],
    ]);
    // Переходящий реестр: родословная ЭА10-26 → ЭА30-26 и своя цена по ЭА20-26.
    GRIDS.set('25-26', [
      new Array(14).fill('ш'),
      journalRow({
        fate: 'Новая закупка ЭА30-26', subject: 'ЭА10-26 Поставка бумаги',
        nmck: 100_000, price: 0, winner: 'Не состоялся (0 заявок)',
      }),
      journalRow({
        fate: 'После доработки ЭА10-26', subject: 'ЭА30-26 Поставка бумаги повторно',
        nmck: 100_000, price: 95_000, winner: 'ООО «БИТ»\nИНН 4101100000',
      }),
      // Та же процедура, что на листе УО, но цена отличается на тысячу.
      journalRow({ subject: 'ЭА20-26 Учебники', nmck: 780_000, price: 699_000 }),
    ]);
    GRIDS.set('Перечень ГРБС', [
      ['№ п/п', 'ГРБС', 'Наименованиеучрежения', 'Сокращеное наименование учреждения'],
      [1, 'УО', 'муниципальное бюджетное общеобразовательное учреждение «ЕСШ №1»', 'МБОУ ЕСШ №1'],
    ]);
    // Остальные шесть листов управлений в этом сценарии «не прочитались».

    ({ invalidateMonitoringCache } = await import('../services/monitoring.js'));

    // Книга ГРБС УЭР: код процедуры в AG, план и факт — в тысячах рублей.
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const bookHeaders = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];
    const bookRow = (code: string, plan: number, fact: number): unknown[] => {
      const r: unknown[] = new Array(34).fill('');
      r[10] = plan;
      r[24] = fact;
      r[32] = code;
      return r;
    };
    setDeptSheetCache({
      'УЭР': {
        values: [
          ...bookHeaders,
          bookRow('ЭЗК426-25', 446.7, 413.364),
          bookRow('ЭА777-26', 100, 0),
        ],
        formulas: [],
        sheetName: 'ВСЕ',
      },
    });

    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
  }, 60_000);

  afterAll(async () => {
    await app.close();
    process.env = { ...ORIGINAL_ENV };
  });

  describe('GET /api/monitoring', () => {
    it('отдаёт реестр процедур с адресами, стадиями и деньгами в рублях', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/monitoring' });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.source.bookName).toBe('Ежедневный мониторинг');
      expect(body.source.moneyUnit).toBe('руб');
      expect(typeof body.source.readAt).toBe('string');
      // Порядок листов — канонический порядок книги, не порядок ответов сети.
      expect(body.source.sheetsRead).toEqual(['1. УЭР', '8. УО', 'СВОДНЫЙ', '25-26', 'Перечень ГРБС']);
      expect(body.source.sheetsExpected).toBe(11);

      expect(body.procedures).toHaveLength(5);
      expect(body.procedures[0]).toMatchObject({
        sheet: '1. УЭР', row: 3, dept: 'УЭР', code: 'ЭЗК426-25', method: 'ЭЗК',
        stage: 'awarded', nmck: 446_700, auctionPrice: 413_364, reductionRub: 33_336,
      });
      // Победитель разобран на имя и ИНН — разрез «по победителю» возможен.
      expect(body.procedures[0].winner).toMatchObject({
        inn: '541003717453', outcome: 'supplier',
      });
      expect(body.procedures[1]).toMatchObject({ stage: 'published', nmck: 2_250_000 });
      expect(body.procedures[2]).toMatchObject({ dept: 'УО', stage: 'no_result' });

      expect(body.aggregates.total).toBe(5);
      expect(body.aggregates.awarded.savingsTotal).toBe(113_336);
    });

    it('свод показан вместе с контролем разбивки и парой «книга ↔ продукт»', async () => {
      const body = (await app.inject({ method: 'GET', url: '/api/monitoring' })).json();

      const uo = body.svod.book.rows.find((r: { dept: string }) => r.dept === 'УО');
      // Контроля «ВСЕГО = МБ+КБ+ФБ» на своде книги нет — продукт его добавляет.
      expect(uo).toMatchObject({ controlAgrees: false, controlGapRub: 50_000 });
      expect(body.svod.book.total.controlGapRub).toBe(50_000);

      const comparison = body.svod.comparison.rows.find((r: { dept: string }) => r.dept === 'УО');
      expect(comparison.book.nmck).toBe(890_000);
      // Наш счёт видит и текстовую сумму, и строку без цены: 100 000 + 10 000 + 780 000.
      expect(comparison.product.nmck).toBe(890_000);
      expect(body.svod.comparison.productTotals.nmck).toBe(3_586_700);
      expect(body.notes.join(' ')).toContain('Свод книги и наш счёт по листам расходятся');
    });

    it('переходящий реестр отдаёт судьбу процедуры и цепочку переобъявлений', async () => {
      const body = (await app.inject({ method: 'GET', url: '/api/monitoring' })).json();

      expect(body.journal.rows).toHaveLength(3);
      expect(body.journal.rows[0]).toMatchObject({
        code: 'ЭА10-26', fate: 'new-purchase', fateText: 'Новая закупка ЭА30-26',
      });
      expect(body.journal.edges).toContainEqual(
        expect.objectContaining({ from: 'ЭА10-26', to: 'ЭА30-26' }),
      );
      expect(body.journal.chains[0].codes).toEqual(['ЭА10-26', 'ЭА30-26']);
    });

    it('справочник и листы-предки переносятся вместе с их дефектами формы', async () => {
      const body = (await app.inject({ method: 'GET', url: '/api/monitoring' })).json();

      expect(body.directory.entries).toHaveLength(1);
      // Написания заказчика, которых справочник не знает, — по убыванию частоты.
      expect(body.directory.customersOutside[0]).toMatchObject({ name: 'МКУ ЦЭР', count: 2 });
      expect(body.ancestors.sheets).toHaveLength(3);
      expect(body.ancestors.missingFields).toContain('Кол-во заявок от поставщиков');
    });

    it('сигналы приходят карточками диагноста: механизм, адрес, действие', async () => {
      const body = (await app.inject({ method: 'GET', url: '/api/monitoring' })).json();

      const kinds = body.signals.map((s: { kind: string }) => s.kind);
      expect(kinds).toContain('monitoring_broken_code');
      expect(kinds).toContain('monitoring_control_error');
      expect(kinds).toContain('monitoring_svod_gap');

      const brokenCode = body.signals.find((s: { kind: string }) => s.kind === 'monitoring_broken_code');
      expect(brokenCode.addresses[0].address).toBe('8. УО!C4');
      expect(brokenCode.mechanism.length).toBeGreaterThan(20);
      expect(brokenCode.action.length).toBeGreaterThan(10);
    });

    it('честная неполнота: непрочитанные листы названы поимённо, а не замолчаны', async () => {
      const body = (await app.inject({ method: 'GET', url: '/api/monitoring' })).json();

      const failedNames = Object.keys(body.source.sheetsFailed);
      expect(failedNames).toHaveLength(6);
      expect(failedNames).toContain('6. УД');
      expect(body.notes.join(' ')).toContain('Листы не прочитаны');
      // Подпись единицы денег — правило волны: рубли, книги ГРБС — тысячи.
      expect(body.notes.join(' ')).toContain('в рублях');
    });

    it('искажённый код процедуры — сигнал с адресом, строка из реестра не выпадает', async () => {
      const body = (await app.inject({ method: 'GET', url: '/api/monitoring' })).json();

      // Диагноз искажения (волна 20.08): догадка ПОКАЗЫВАЕТСЯ читателю
      // (guess + note), но НЕ применяется — код в реестр не чинится молча.
      expect(body.unparsedCodes).toEqual([
        {
          sheet: '8. УО', row: 4, text: 'ЭЗК-120-26 Стройматериалы',
          guess: 'ЭЗК120-26', note: 'лишний дефис после букв семейства',
        },
      ]);
      const broken = body.procedures.find(
        (p: { row: number; sheet: string }) => p.sheet === '8. УО' && p.row === 4,
      );
      expect(broken).toBeDefined();
      expect(broken.code).toBeNull();
    });
  });

  describe('GET /api/monitoring/analytics', () => {
    it('отдаёт три коэффициента снижения с разными знаменателями', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/monitoring/analytics' });
      expect(res.statusCode).toBe(200);
      const { analytics, notes, source } = res.json();

      expect(source.moneyUnit).toBe('руб');
      // Портфельный: (446 700 + 780 000 − 413 364 − 700 000) ÷ 1 226 700.
      expect(analytics.reduction.portfolioPct).toBeCloseTo(9.2392, 3);
      expect(analytics.reduction.portfolio.count).toBe(2);
      // Построчный: (7,4627 + 10,2564) ÷ 2.
      expect(analytics.reduction.rowMeanPct).toBeCloseTo(8.8596, 3);
      expect(analytics.reduction.reducedCount).toBe(2);
      expect(notes.join(' ')).toContain('знаменатели у них разные');
    });

    it('воронка, гистограмма и сроки этапов приходят одним ответом', async () => {
      const { analytics } = (await app.inject({ method: 'GET', url: '/api/monitoring/analytics' })).json();

      expect(analytics.funnel.steps).toHaveLength(5);
      expect(analytics.funnel.total).toBe(5);
      expect(analytics.histogram).toHaveLength(7);
      expect(analytics.durations).toHaveLength(4);
      expect(analytics.suppliers.uniqueCount).toBe(2);
      expect(analytics.unsuccessful.count).toBe(1);
      expect(analytics.anomalies.some((a: { kind: string }) => a.kind === 'zero-price')).toBe(true);
    });

    it('основание сезонности выбирается запросом и называется в оговорках', async () => {
      const byAuction = (await app.inject({
        method: 'GET', url: '/api/monitoring/analytics?basis=auction',
      })).json();
      expect(byAuction.analytics.seasonality.basis).toBe('auction');
      expect(byAuction.notes.join(' ')).toContain('по дате проведения торгов');

      const byPublication = (await app.inject({ method: 'GET', url: '/api/monitoring/analytics' })).json();
      expect(byPublication.analytics.seasonality.basis).toBe('publication');
    });
  });

  describe('GET /api/monitoring/match', () => {
    it('сверяет книгу ГРБС с мониторингом построчно, переводя тысячи в рубли', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/monitoring/match' });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.books.read).toEqual(['УЭР']);
      expect(body.summary.matched).toBe(1);
      expect(body.matched[0]).toMatchObject({ code: 'ЭЗК426-25' });
      expect(body.matched[0].nmck).toMatchObject({
        bookRub: 446_700, monitoringRub: 446_700, agrees: true,
      });
      expect(body.notes.join(' ')).toContain('умножены на тысячу');
    });

    it('коды без пары раскладываются по классам исходов с адресами', async () => {
      const body = (await app.inject({ method: 'GET', url: '/api/monitoring/match' })).json();

      expect(body.bookOnly.map((b: { code: string }) => b.code)).toEqual(['ЭА777-26']);
      expect(body.summary.monitoringOnly).toBeGreaterThan(0);
      const signal = body.signals.find((s: { kind: string }) => s.kind === 'monitoring_map_book_only');
      // Адрес — строка листа книги как её видит человек: шапка занимает три
      // строки, ЭА777-26 идёт второй строкой данных.
      expect(signal.addresses[0].address).toBe('УЭР:5');
    });

    it('внутренняя сверка «лист ↔ 25-26» показывает обе стороны и не выбирает правую', async () => {
      const body = (await app.inject({ method: 'GET', url: '/api/monitoring/match' })).json();

      const differing = body.internal.rows.find(
        (r: { code: string }) => r.code === 'ЭА20-26',
      );
      expect(differing.kind).toBe('sums-differ');
      expect(differing.priceDeltaRub).toBe(1_000);
      expect(differing.sheetRows[0]).toMatchObject({ sheet: '8. УО', row: 5 });
      expect(differing.journalRows[0]).toMatchObject({ sheet: '25-26', row: 4 });
      expect(differing.note).toContain('решение человека');

      // Процедура, живущая только в переходящем реестре, названа своим классом.
      expect(body.internal.counts['journal-only']).toBeGreaterThan(0);
    });
  });

  describe('отказ источника', () => {
    it('полный отказ книги — 503 с русской причиной на всех трёх роутах', async () => {
      GRIDS.clear();
      invalidateMonitoringCache();

      for (const url of ['/api/monitoring', '/api/monitoring/analytics', '/api/monitoring/match']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(503);
        expect(res.json().message).toContain('Ежедневный мониторинг');
      }
    });
  });
});
