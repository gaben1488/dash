// Fastify inject-тесты GET /api/workload (канон п.103 и п.105).
/**
 * Охраняются обещания роута, а не оформление ответа:
 *
 *   1. Нагрузка измеряется ОТНОШЕНИЯМИ (правок на строку, строк на
 *      учреждение), а не абсолютом: 33 тысячи записей у книги с 44
 *      учреждениями и 13 записей у книги с одной организацией сравнимы
 *      только так.
 *   2. Книга, чей журнал не прочитан, НЕ выдаётся за книгу без правок:
 *      меры пусты, признак наблюдаемости — null, а не «слепой», и причина
 *      названа словами.
 *   3. Добавление закупки — ОДНО событие, а не десять правок: журнал пишет
 *      ячейки, род события восстанавливается группировкой.
 *   4. Удаления строк объявлены НЕ НАБЛЮДАЕМЫМИ: ноль удалений в ответе
 *      означает «журнал их не видит», и признак deletionsUnobservable
 *      обязан ехать рядом с числами.
 *   5. Момент чтения назван (asOf) — канон п.58.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHeavyRouteLimiter, HEAVY_ROUTE_RULES } from '../plugins/rate-limit.js';

const ORIGINAL_ENV = { ...process.env };

/**
 * Идентификаторы книг продублированы здесь намеренно: фабрика vi.mock
 * поднимается выше импортов и обычных переменных модуля не видит. Страж
 * расхождения — первый тест: он требует, чтобы обе книги нашлись в ответе.
 */
const h = vi.hoisted(() => {
  const UER_ID = '15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4';

  /** Заполнение пустой строки целиком — живой вид добавления закупки. */
  const added = (row: number, at: string): unknown[][] =>
    ['A', 'C', 'G', 'H', 'J', 'K', 'L'].map((c) => [
      'ВСЕ', `${c}${row}`, 'колонка', `№ ${row}`, '', 'значение', at, 'оператор@aemr.ru',
    ]);

  /** Обнуление занятой строки — очистка (НЕ удаление: строка осталась). */
  const cleared = (row: number, at: string): unknown[][] =>
    ['C', 'G', 'H', 'J', 'K', 'L'].map((c) => [
      'ВСЕ', `${c}${row}`, 'колонка', `№ ${row}`, 'было', '', at, 'оператор@aemr.ru',
    ]);

  const uerJournal: unknown[][] = [
    ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'],
    ...added(4, '09.04.2026 16:08:00'),
    ...cleared(5, '10.05.2026 11:00:00'),
    // Две точечные правки одной минуты — это правки, а не событие строки.
    ['ВСЕ', 'N6', 'План', '№ 6', '15.08.2026', '20.08.2026', '11.08.2026 09:00:00', 'оператор@aemr.ru'],
    ['ВСЕ', 'Q6', 'Факт', '№ 6', '', '11.08.2026', '11.08.2026 09:00:00', 'оператор@aemr.ru'],
    // Google-serial в колонке времени — живая форма (46248.6623103 = 14.08.2026).
    ['ВСЕ', 'K6', 'ИТОГО 1', '№ 6', '100', '90', '46248.6623103', 'оператор@aemr.ru'],
  ];

  return { UER_ID, uerJournal };
});

/**
 * Сеть выключена целиком; журнал отдаёт только книга УЭР. Остальные семь книг
 * молчат — ровно та картина, ради различения которой роут и написан.
 */
vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async (spreadsheetId: string, sheetName: string) => {
    if (spreadsheetId === h.UER_ID && sheetName === '_ChangeLog') return h.uerJournal;
    throw new Error('net off');
  }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

/** Строка листа ГРБС: 34 колонки, ключевые ячейки по канону DEPT_COLUMNS. */
function sheetRow(id: string, subordinate: string, subject: string): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[0] = id;            // A — № п/п
  r[2] = subordinate;   // C — учреждение
  r[6] = subject;       // G — предмет
  r[10] = 100;          // K — план
  r[11] = 'ЭА';         // L — способ
  r[16] = 'Х';          // Q — факта нет
  return r;
}

interface WorkloadBookDto {
  dept: string;
  rows: number | null;
  subordinates: number | null;
  journalEntries: number | null;
  editsPerRow: number | null;
  rowsPerSubordinate: number | null;
  observability: string | null;
  journalAvailable: boolean;
  rowsAvailable: boolean;
  events: { added: number; cleared: number; edits: number } | null;
  note: string;
}

interface WorkloadDto {
  asOf: string;
  rowsSource: string;
  booksTotal: number;
  booksMeasured: number;
  booksSilent: string[];
  books: WorkloadBookDto[];
  totals: { rows: number; subordinates: number; journalEntries: number };
  blindDepts: string[];
  rowsPerSubordinateSpread: number | null;
  events: {
    added: number; cleared: number; edits: number;
    deletionsUnobservable: boolean; countedBooks: string[]; note: string;
  };
  notes: string[];
}

describe('GET /api/workload', () => {
  let app: FastifyInstance;
  let body: WorkloadDto;

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
      // УЭР: 4 закупки на 2 учреждения, журнал прочитан → книга измерима.
      'УЭР': {
        values: [
          ...headers,
          sheetRow('1', 'МКУ ЦЭР', 'Обслуживание сети'),
          sheetRow('2', 'МКУ ЦЭР', 'Канцелярия'),
          sheetRow('3', 'Х', 'Закупка самого управления'),
          sheetRow('4', '', 'Ещё закупка управления'),
        ],
        formulas: [],
        sheetName: 'УЭР',
      },
      // УИО: строки есть, а журнал книги не читается → меры пустые, но честные.
      'УИО': {
        values: [
          ...headers,
          sheetRow('1', 'Х', 'Оценка имущества'),
          sheetRow('2', 'Х', 'Кадастровые работы'),
        ],
        formulas: [],
        sheetName: 'УИО',
      },
    });

    const { createApp } = await import('../app.js');
    const { resetWorkloadCache } = await import('./workload.js');
    resetWorkloadCache();
    app = await createApp({ logger: false });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/workload' });
    expect(res.statusCode).toBe(200);
    body = res.json<WorkloadDto>();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  const bookOf = (dept: string): WorkloadBookDto => {
    const found = body.books.find((b) => b.dept === dept);
    expect(found, `книга ${dept} должна быть в ответе`).toBeDefined();
    return found!;
  };

  it('отвечает по всем восьми книгам реестра и называет момент чтения', () => {
    expect(body.booksTotal).toBe(8);
    expect(body.books).toHaveLength(8);
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false);
    expect(body.rowsSource).toBe('live');
  });

  it('нагрузка меряется отношениями: правок на строку и строк на учреждение', () => {
    const uer = bookOf('УЭР');
    expect(uer.rows).toBe(4);
    // Колонка C: «МКУ ЦЭР» + само управление («Х» и пусто — один и тот же дом).
    expect(uer.subordinates).toBe(2);
    expect(uer.rowsPerSubordinate).toBe(2);
    expect(uer.journalEntries).toBe(16);
    expect(uer.editsPerRow).toBe(4);
    expect(uer.observability).toBe('rich');
  });

  it('книга с непрочитанным журналом не выдаётся за книгу без правок', () => {
    const uio = bookOf('УИО');
    expect(uio.rowsAvailable).toBe(true);
    expect(uio.journalAvailable).toBe(false);
    // Ноль правок был бы враньём — здесь пустота, и она названа.
    expect(uio.journalEntries).toBeNull();
    expect(uio.editsPerRow).toBeNull();
    expect(uio.observability).toBeNull();
    expect(uio.events).toBeNull();
    expect(uio.note).toContain('не «правок не было»');
    expect(body.booksSilent).toContain('УИО');
    expect(body.booksMeasured).toBe(1);
  });

  it('книга без строк и без журнала объясняет, что мерить было нечего', () => {
    const ud = bookOf('УД');
    expect(ud.rowsAvailable).toBe(false);
    expect(ud.rows).toBeNull();
    expect(ud.note).toContain('не отсутствие работы');
  });

  it('добавление закупки — одно событие, а не семь правок', () => {
    const uer = bookOf('УЭР');
    expect(uer.events).toEqual({ added: 1, cleared: 1, edits: 3 });
    expect(body.events.added).toBe(1);
    expect(body.events.cleared).toBe(1);
    expect(body.events.countedBooks).toEqual(['УЭР']);
  });

  it('удаления строк объявлены ненаблюдаемыми — ноль здесь не «не случалось»', () => {
    expect(body.events.deletionsUnobservable).toBe(true);
    expect(body.events.note).toContain('Удаление');
    expect(body.events.note).toContain('снимков');
  });

  it('измеримые книги идут первыми, неизмеримые — в хвосте без выдуманного места', () => {
    expect(body.books[0].dept).toBe('УЭР');
    const measuredCount = body.books.filter((b) => b.observability !== null).length;
    expect(measuredCount).toBe(1);
    expect(body.books.slice(1).every((b) => b.rowsPerSubordinate === null)).toBe(true);
  });

  it('подписи говорят о трудоёмкости, а не о вине', () => {
    const joined = body.notes.join(' ');
    expect(joined).toContain('не рейтинг вины');
    expect(joined).toContain('Журнал не прочитан');
  });

  it('второй запрос отдаётся из окна кэша — журналы книг не читаются заново', async () => {
    const again = await app.inject({ method: 'GET', url: '/api/workload' });
    expect(again.statusCode).toBe(200);
    expect(again.json<WorkloadDto>().asOf).toBe(body.asOf);
  });

  it('маршрут прикрыт порогом частоты: он читает журналы всех книг', () => {
    const limiter = createHeavyRouteLimiter(HEAVY_ROUTE_RULES);
    let refused = false;
    for (let i = 0; i < 40 && !refused; i++) {
      refused = limiter.check('GET', '/api/workload', 'клиент', 1_000_000) !== null;
    }
    expect(refused).toBe(true);
  });
});
