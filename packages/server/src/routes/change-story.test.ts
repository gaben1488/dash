// Fastify inject-тесты GET /api/change-story — журнал изменений двух глубин.
/**
 * Охраняются обещания маршрута, а не форма ответа:
 *
 *   1. АДРЕС ПО № П/П. Запись журнала «J177 · № 38 · Услуги почтовой связи»
 *      уезжает на экран с № п/п 38, а не со строкой листа 177: строки
 *      двигаются, № п/п живёт вместе со своей закупкой (канон п.98б).
 *   2. ОДИН РАССКАЗ, НЕ ТРИ. Правки книги и пропажи из сравнения снимков
 *      лежат в одном списке с одной шкалой времени, и у каждой записи
 *      назван источник.
 *   3. ЧЕСТНАЯ ПУСТОТА. Книга, чей журнал не ответил, названа в gaps по
 *      имени: «правок не было» и «журнал не прочитан» — разные ответы.
 *   4. УДАЛЕНИЯ НЕ НАБЛЮДАЕМЫ. Признак deletionsUnobservable едет рядом с
 *      числами, а не подразумевается.
 *   5. РОД ПРАВКИ НАЗВАН. Деньги, сроки, комментарии, новые строки — то, чем
 *      читатель отвечает на вопрос «что именно поменялось».
 *   6. СВОД СЧИТАЕТСЯ ПО ВСЕМУ ОКНУ, а отбор сужает только показанный список.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const h = vi.hoisted(() => {
  const UER_ID = '15NEAE1zK0qc5li4BCwT4Jq-MH6uuA_SFFMG22ZrM4t4';

  /** Заполнение пустой строки целиком — живой вид добавления закупки. */
  const added = (row: number, seq: number, at: string): unknown[][] =>
    ['A', 'C', 'G', 'H', 'J', 'K', 'L'].map((c) => [
      'ВСЕ', `${c}${row}`, 'колонка', `№ ${seq} · Новая закупка`, '', 'значение', at, 'sidorov@aemr.ru',
    ]);

  const uerJournal: unknown[][] = [
    ['Лист', 'Ячейка', 'Столбец', 'Строка', 'Было', 'Стало', 'Время', 'Автор'],
    // Деньги: план вырос.
    ['ВСЕ', 'K177', 'ИТОГО 1', '№ 38 · Услуги почтовой связи', '100', '120', '20.08.2026 09:00:00', 'ivanova@aemr.ru'],
    // Сроки: появилась дата факта.
    ['ВСЕ', 'Q177', 'Фактический', '№ 38 · Услуги почтовой связи', '', '01.09.2026', '20.08.2026 09:30:00', 'petrov@aemr.ru'],
    // Комментарий ГРБСа.
    ['ВСЕ', 'AF200', 'Комментарий ГРБСа', '№ 41 · Ремонт кровли', '', 'согласовано', '19.08.2026 08:00:00', 'petrov@aemr.ru'],
    // Целая новая закупка одной минутой — должна свернуться в одно событие.
    ...added(300, 90, '18.08.2026 12:00:00'),
  ];

  return { UER_ID, uerJournal };
});

/** Сеть выключена; журнал отдаёт одна книга УЭР — остальные молчат. */
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

interface EntryDto {
  id: string;
  book: string;
  rowSeq: string | null;
  sheetRow: number | null;
  column: string | null;
  columnLabel: string | null;
  kind: string;
  before: string;
  after: string;
  author: string | null;
  at: string | null;
  subject: string | null;
  origin: string;
}

interface StoryDto {
  since: string;
  digest: {
    books: number;
    booksNamed: string[];
    rows: number;
    entries: number;
    byKind: Record<string, number>;
    authors: string[];
    firstAt: string | null;
    lastAt: string | null;
    emptiness: string;
  };
  gaps: Array<{ book: string; reason: string; detail: string; count?: number }>;
  deletionsUnobservable: boolean;
  note: string;
  comparison: { beforeAt: string; afterAt: string } | null;
  facets: { books: Array<{ book: string; count: number }>; authors: Array<{ author: string; count: number }> };
  total: number;
  shown: number;
  entries: EntryDto[];
}

describe('GET /api/change-story', () => {
  let app: FastifyInstance;
  let body: StoryDto;

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

    const { createApp } = await import('../app.js');
    app = await createApp({ logger: false });
    await app.ready();

    // Окно берётся заведомо широким: тест проверяет сведение источников,
    // а не попадание живых дат в текущую неделю продукта.
    const res = await app.inject({ method: 'GET', url: '/api/change-story?since=2026-01-01' });
    expect(res.statusCode).toBe(200);
    body = res.json<StoryDto>();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  it('адрес правки — по № п/п, номер строки листа идёт вторым', () => {
    const money = body.entries.find((e) => e.column === 'K');
    expect(money?.rowSeq).toBe('38');
    expect(money?.sheetRow).toBe(177);
    expect(money?.subject).toBe('Услуги почтовой связи');
  });

  it('род правки назван человеческим словом, а не буквой колонки', () => {
    const byKind = body.digest.byKind;
    expect(byKind.money).toBe(1);
    expect(byKind.dates).toBe(1);
    expect(byKind.comment).toBe(1);
    const dates = body.entries.find((e) => e.column === 'Q');
    expect(dates?.columnLabel).toBe('Фактическая дата');
  });

  it('добавление закупки — ОДНО событие, а не семь правок', () => {
    const addedEvents = body.entries.filter((e) => e.kind === 'row-added');
    expect(addedEvents).toHaveLength(1);
    expect(addedEvents[0].rowSeq).toBe('90');
    expect(addedEvents[0].column).toBeNull();
  });

  it('книга, чей журнал не прочитан, названа по имени, а не молчит', () => {
    const unread = body.gaps.filter((g) => g.reason === 'journal-unread');
    expect(unread.length).toBeGreaterThan(0);
    expect(unread[0].detail).toContain('не прочитан');
    expect(unread.some((g) => g.book === 'УЭР')).toBe(false);
  });

  it('отсутствие пары снимков названо вслух — исчезнувшие сравнивать не с чем', () => {
    expect(body.comparison).toBeNull();
    expect(body.gaps.some((g) => g.reason === 'no-previous-snapshot')).toBe(true);
  });

  it('неудаляемость строк журналом объявлена рядом с числами', () => {
    expect(body.deletionsUnobservable).toBe(true);
    expect(body.note).toContain('Удаление строки журнал не записывает');
  });

  it('свод отвечает на «сколько книг, сколько закупок, кем и когда»', () => {
    expect(body.digest.books).toBe(1);
    expect(body.digest.booksNamed).toEqual(['УЭР']);
    expect(body.digest.rows).toBe(3);
    expect(body.digest.authors).toEqual(['ivanova@aemr.ru', 'petrov@aemr.ru', 'sidorov@aemr.ru']);
    expect(body.digest.firstAt).toBe('2026-08-18T12:00:00');
    expect(body.digest.lastAt).toBe('2026-08-20T09:30:00');
    expect(body.digest.emptiness).toBe('none');
  });

  it('у каждой записи назван источник', () => {
    expect(body.entries.every((e) => e.origin === 'book-journal')).toBe(true);
  });

  it('порядок — свежие сверху', () => {
    const moments = body.entries.map((e) => e.at).filter((a): a is string => a !== null);
    expect([...moments].sort().reverse()).toEqual(moments);
  });

  it('отбор по роду сужает список, но не свод', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/change-story?since=2026-01-01&kind=money' });
    const filtered = res.json<StoryDto>();
    expect(filtered.total).toBe(1);
    expect(filtered.entries[0].kind).toBe('money');
    // Краткая глубина отвечает на «что вообще случилось», а не «что осталось».
    expect(filtered.digest.entries).toBe(body.digest.entries);
  });

  it('отбор по автору и поиск по предмету закупки', async () => {
    const byAuthor = await app.inject({ method: 'GET', url: '/api/change-story?since=2026-01-01&author=petrov@aemr.ru' });
    expect(byAuthor.json<StoryDto>().total).toBe(2);

    const bySubject = await app.inject({ method: 'GET', url: `/api/change-story?since=2026-01-01&q=${encodeURIComponent('кровл')}` });
    const found = bySubject.json<StoryDto>();
    expect(found.total).toBe(1);
    expect(found.entries[0].rowSeq).toBe('41');
  });

  it('чипы отбора считаются по всему окну', () => {
    expect(body.facets.books).toEqual([{ book: 'УЭР', count: body.digest.entries }]);
    expect(body.facets.authors[0].count).toBeGreaterThan(0);
  });

  it('битая дата окна отвергается с объяснением, а не молча стартует с чужой', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/change-story?since=2026-06-31' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toContain('не является датой');
  });

  it('неизвестный род правки отвергается, а не молчит', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/change-story?since=2026-01-01&kind=выдумка' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toContain('неизвестен');
  });
});
