/**
 * provenance.test.ts — Fastify inject-тесты /api/provenance/* (канон п.102).
 *
 * Проверяется контракт доставки провенанса плановых сумм наружу:
 *   • история плановых ячеек одной строки с разделением «исправление единиц»
 *     и «ретро-снижение плана» (складывать их нельзя: перевод рублей в тысячи
 *     план не уменьшает);
 *   • признак «правка сделана уже ПОСЛЕ заключения» — прямой след изъятия
 *     экономии перераспределением;
 *   • 404 на неизвестный № п/п — с подсказкой против путаницы «№ п/п против
 *     номера строки листа» (канон п.98б);
 *   • 503, когда книг нет ни в живом кэше, ни в снимке;
 *   • сводка наблюдаемости отдаёт ВСЕ восемь книг и отличает «журнал пуст» от
 *     «журнал не прочитан» — главное требование честности п.102.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

/**
 * Идентификатор книги УЭР дублируется здесь намеренно: фабрика vi.mock
 * поднимается выше импортов и не может читать обычные переменные модуля.
 * Страж расхождения — первый тест: если канон DEPARTMENT_SPREADSHEETS сменит
 * идентификатор, тест упадёт вслух, а не станет молча проверять пустоту.
 */
const h = vi.hoisted(() => {
  const UER_SPREADSHEET_ID = '15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4';

  /**
   * Живой лист «_ChangeLog» восьмиколоночной схемы:
   * Лист │ Ячейка │ Столбец │ Строка │ Было │ Стало │ Время │ Автор.
   * Значения и формы чисел взяты с натуры (замер 18.08): экспонента
   * «3.497500217E7» и парный перевод рублей в тысячи — живой случай УО H28.
   */
  const journalRows: unknown[][] = [
    ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'],
    // Ретро-снижение плана чужой строки (№ 26): 1 116,72 → 12,00.
    ['ВСЕ', 'K5', 'ИТОГО 1', '№ 26 · Опрессовка системы', '1116.72', '12.00', '08.04.2026 10:00:00', 'a@aemr.ru'],
    // Исправление единиц, шаг 1: тысячи → рубли.
    ['ВСЕ', 'H4', 'ФБ 1', '№ 25 · Капитальный ремонт учебных классов', '34975.0', '34975002.17', '05.08.2026 16:52:26', 'b@aemr.ru'],
    // Исправление единиц, шаг 2: рубли (экспонентой) → тысячи.
    ['ВСЕ', 'H4', 'ФБ 1', '№ 25 · Капитальный ремонт учебных классов', '3.497500217E7', '34975.00217', '05.08.2026 17:17:20', 'b@aemr.ru'],
    // Настоящее ретро-снижение ИТОГО уже ПОСЛЕ заключения (Q = 05.08.2026).
    ['ВСЕ', 'K4', 'ИТОГО 1', '№ 25 · Капитальный ремонт учебных классов', '40000', '34975.00217', '06.08.2026 09:00:00', 'b@aemr.ru'],
    // Правка НЕплановой ячейки: строку журнал видит, плана она не касается.
    ['ВСЕ', 'G4', 'Предмет', '№ 25 · Капитальный ремонт учебных классов', 'Старое', 'Новое', '06.08.2026 09:05:00', 'b@aemr.ru'],
  ];

  return { UER_SPREADSHEET_ID, journalRows };
});

/**
 * Сеть выключена целиком; журнал отдаётся только для книги УЭР — остальные
 * семь книг молчат, и это ровно та картина, ради различения которой написан
 * блок observability: молчащая книга не равна книге без правок.
 */
vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async (spreadsheetId: string, sheetName: string) => {
    if (spreadsheetId === h.UER_SPREADSHEET_ID && sheetName === '_ChangeLog') {
      return h.journalRows;
    }
    throw new Error('net off');
  }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

/** Строка листа ГРБС: 34 колонки, ключевые ячейки по канону DEPT_COLUMNS. */
function sheetRow(over: Partial<Record<'A' | 'G' | 'H' | 'K' | 'L' | 'N' | 'Q', unknown>>): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[0] = over.A ?? '1';
  r[6] = over.G ?? 'Закупка';
  r[7] = over.H ?? '';
  r[10] = over.K ?? 100;
  r[11] = over.L ?? 'ЭА';
  r[13] = over.N ?? '';
  r[16] = over.Q ?? 'Х';
  return r;
}

describe('/api/provenance/*', () => {
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

    // Живой кэш книги УЭР: шапка 3 строки, данные со строки 4.
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];
    setDeptSheetCache({
      'УЭР': {
        values: [
          ...headers,
          // Строка листа 4 — № п/п 25: заключена 05.08.2026, план правился.
          sheetRow({
            A: '25', G: 'Капитальный ремонт учебных классов',
            H: '34975.00217', K: '34975,00217', L: 'ЭА',
            N: '01.07.2026', Q: '05.08.2026',
          }),
          // Строка листа 5 — № п/п 26: план снижен задним числом, факта нет.
          sheetRow({ A: '26', G: 'Опрессовка системы', K: 12, L: 'ЕП', N: '01.09.2026', Q: 'Х' }),
          // Строки листа 6 и 7 — один и тот же № п/п 99 (канон п.98з: живые
          // повторы порядковых номеров). Журнал ключует правки номером, значит
          // историю этих двух закупок он физически не различает.
          sheetRow({ A: '99', G: 'Первая закупка-двойник', K: 50 }),
          sheetRow({ A: '99', G: 'Вторая закупка-двойник', K: 60 }),
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

  describe('GET /api/provenance/:deptId/:rowSeq', () => {
    it('идентификатор книги УЭР в тесте совпадает с каноном источников', async () => {
      const { DEPARTMENT_SPREADSHEETS } = await import('../config.js');
      expect(DEPARTMENT_SPREADSHEETS['УЭР']).toBe(h.UER_SPREADSHEET_ID);
    });

    it('отдаёт 200 с событиями плана, разделяя исправление единиц и ретро-снижение', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/provenance/УЭР/25' });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.dept).toBe('УЭР');
      expect(body.rowSeq).toBe(25);
      // № п/п 25 стоит на строке ЛИСТА 4 — числа разные, и роут их не путает.
      expect(body.sheetRow).toBe(4);
      expect(body.subject).toBe('Капитальный ремонт учебных классов');
      expect(body.planNow).toBeCloseTo(34975.00217, 5);
      expect(body.factDate).toBe('2026-08-05');
      expect(body.journalAvailable).toBe(true);

      // Три правки плановых ячеек: две по H4 и одна по K4. Правка предмета
      // (G4) в провенанс плана не попадает — выдавать её за правку суммы нечестно.
      expect(body.events).toHaveLength(3);
      const kinds = body.events.map((e: { kind: string }) => e.kind);
      expect(kinds.filter((k: string) => k === 'unit-fix')).toHaveLength(2);
      expect(kinds.filter((k: string) => k === 'retro-cut')).toHaveLength(1);

      // Экспонента журнала прочитана как число, а не как текст: иначе шаг
      // «3.497500217E7 → 34975.00217» осел бы в ретро-снижениях.
      const secondFix = body.events.find(
        (e: { cell: string; at: string }) => e.cell === 'H4' && e.at === '2026-08-05T17:17:20',
      );
      expect(secondFix.kind).toBe('unit-fix');
      expect(secondFix.was).toBeCloseTo(34975002.17, 2);

      // Сортировка по времени.
      const at = body.events.map((e: { at: string }) => e.at);
      expect([...at].sort()).toEqual(at);

      // Сводка: в «ушедший план» входит только настоящее снижение.
      expect(body.summary.retroCutCount).toBe(1);
      expect(body.summary.retroCutTotal).toBeCloseTo(5024.99783, 5);
      expect(body.summary.unitFixCount).toBe(2);
      // Правка 06.08 сделана уже после заключения 05.08 — признак изъятия.
      expect(body.summary.retroCutAfterFactCount).toBe(1);
      expect(body.summary.note).toContain('задним числом');
      expect(body.summary.note).toContain('УЭР');

      // Наблюдаемость: журнал прочитан, строка покрыта, плановых правок три.
      expect(body.observability.journalEntries).toBe(5);
      expect(body.observability.coversRow).toBe(true);
      expect(body.observability.planEntries).toBe(3);
      expect(body.ambiguity).toBeNull();
    });

    it('строка без правок плана честно отличает «правок не было» от молчания журнала', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/provenance/УЭР/26' });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.events).toHaveLength(1);
      expect(body.events[0].kind).toBe('retro-cut');
      expect(body.events[0].cell).toBe('K5');
      // Факта нет (Q = «Х») — судить о «после заключения» не о чем.
      expect(body.events[0].factAtEdit).toBeNull();
      expect(body.summary.retroCutAfterFactCount).toBeNull();
      expect(body.observability.note).toContain('ведётся');
    });

    it('называет повтор № п/п: журнал ключует номером и двойников не различает', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/provenance/УЭР/99' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ambiguity).not.toBeNull();
      expect(body.ambiguity.sheetRows).toEqual([6, 7]);
      expect(body.ambiguity.note).toContain('развести номера');
    });

    it('отдаёт 404 на неизвестный № п/п', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/provenance/УЭР/9999' });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toContain('№ п/п 9999');
    });

    it('в 404 подсказывает настоящий № п/п, если спросили номер строки листа', async () => {
      // На строке ЛИСТА 4 стоит закупка с № п/п 25 — это живая путаница п.98б.
      const res = await app.inject({ method: 'GET', url: '/api/provenance/УЭР/4' });
      expect(res.statusCode).toBe(404);
      const message = res.json().message;
      expect(message).toContain('строке листа 4');
      expect(message).toContain('№ п/п 25');
    });

    it('отдаёт 404 на неизвестное управление и 400 на нечисловой номер', async () => {
      const unknownDept = await app.inject({ method: 'GET', url: '/api/provenance/УХХХ/1' });
      expect(unknownDept.statusCode).toBe(404);

      const badSeq = await app.inject({ method: 'GET', url: '/api/provenance/УЭР/abc' });
      expect(badSeq.statusCode).toBe(400);
      expect(badSeq.json().message).toContain('№ п/п');
    });

    it('отдаёт 503, когда книги нет ни в живом кэше, ни в снимке', async () => {
      // УИО в кэш не клали, сеть выключена, снимка со строками нет.
      const res = await app.inject({ method: 'GET', url: '/api/provenance/УИО/1' });
      expect(res.statusCode).toBe(503);
      expect(res.json().message).toContain('не прочитаны');
    }, 30_000);
  });

  describe('GET /api/provenance/health', () => {
    it('отдаёт все восемь книг и отличает пустой журнал от непрочитанного', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/provenance/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.booksTotal).toBe(8);
      expect(body.books).toHaveLength(8);
      const depts = body.books.map((b: { dept: string }) => b.dept).sort();
      expect(depts).toEqual(['УАГЗО', 'УД', 'УДТХ', 'УИО', 'УКСиМП', 'УО', 'УФБП', 'УЭР'].sort());

      // Единственная прочитанная книга — УЭР; остальные семь молчат, и роут
      // называет их поимённо, а не выдаёт их молчание за отсутствие правок.
      expect(body.booksRead).toBe(1);
      expect(body.booksSilent).toHaveLength(7);
      expect(body.booksSilent).not.toContain('УЭР');
      expect(body.note).toContain('не просмотрен');

      const uer = body.books.find((b: { dept: string }) => b.dept === 'УЭР');
      expect(uer.journalAvailable).toBe(true);
      expect(uer.journalEntries).toBe(5);
      expect(uer.rows).toBe(4);
      // Журнал знает о двух строках из четырёх: двойники № 99 не правились.
      expect(uer.rowsCovered).toBe(2);
      expect(uer.coveragePercent).toBe(50);
      expect(uer.provenance.retroCutCount).toBe(2);
      expect(uer.provenance.unitFixCount).toBe(2);
      expect(uer.note).toContain('журнал покрывает');

      const uio = body.books.find((b: { dept: string }) => b.dept === 'УИО');
      expect(uio.journalAvailable).toBe(false);
      expect(uio.journalEntries).toBe(0);
      expect(uio.provenance).toBeNull();
      // Ключевое требование п.102: непрочитанная книга не смеет выглядеть как
      // книга без правок — подпись прямо ОТРИЦАЕТ оба ложных прочтения.
      expect(uio.note).toContain('не читается');
      expect(uio.note).toContain('Это не «правок не было»');
      expect(uio.note).toContain('не «журнал не ведётся»');

      // Итоги считаются только по тому, что видно.
      expect(body.retroCutCount).toBe(2);
      expect(body.unitFixCount).toBe(2);
      expect(body.note).toContain('исправлений единиц');
    }, 30_000);
  });
});
