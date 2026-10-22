// Fastify inject-тесты GET /api/text-hygiene (канон п.122 + п.98д).
/**
 * Охраняются обещания роута, а не оформление ответа:
 *
 *   1. Каждая находка — отдельная запись с адресом (лист · ячейка), родом,
 *      контекстом и ГОТОВЫМ значением ячейки: структура вместо простыни
 *      (п.122), детекторы — те же shared-функции, что у правила rule-book.
 *   2. Имя подведа (C) сличается со справочником: отступившее значение несёт
 *      fix = дословное имя справочника.
 *   3. Орфография — отдельной группой: слово, контекст, предложение словаря.
 *   4. Маркеры отсутствия «X/х/тире» дефектом не считаются (канон п.62).
 *   5. Пустота честная: книги без строк названы в booksSilent, а знаменатель
 *      cellsChecked позволяет экрану сказать «проверено N ячеек».
 *   6. Момент чтения назван (asOf) — канон п.58; повтор идёт из кэша.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHeavyRouteLimiter, HEAVY_ROUTE_RULES } from '../plugins/rate-limit.js';

const ORIGINAL_ENV = { ...process.env };

/** Сеть выключена целиком: роут обязан жить на кэше строк и не трогать книги. */
vi.mock('../services/google-sheets.js', () => ({
  batchGetCells: vi.fn(async () => { throw new Error('net off'); }),
  batchGetFormulas: vi.fn(async () => { throw new Error('net off'); }),
  getSheetData: vi.fn(async () => { throw new Error('net off'); }),
  getSheetDataFromSpreadsheet: vi.fn(async () => { throw new Error('net off'); }),
  getSpreadsheetMetadata: vi.fn(async () => { throw new Error('net off'); }),
  readDeptSheet: vi.fn(async () => { throw new Error('net off'); }),
  fetchSHDYUSheet: vi.fn(async () => { throw new Error('net off'); }),
}));

/** Синтетический кейс пропуска после «№» на основе нового имени R/E (10.10.2026).
 * Историческая подпись «МБДОУ ДС № 3 «Жар-Птица»» не должна превращаться
 * в опечатку и автоматически переписываться без контекста снимка. */
const ZHAR_CANON = 'МБДОУ "Детский сад № 3 "Жар-птица"';
const ZHAR_VARIANT = 'МБДОУ "Детский сад №3 "Жар-птица"';

/** Строка листа ГРБС: 34 колонки, ключевые ячейки по канону DEPT_COLUMNS. */
function sheetRow(
  id: string,
  subordinate: string,
  subject: string,
  epReason = '',
  finalComment = '',
): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[0] = id;            // A — № п/п
  r[2] = subordinate;   // C — учреждение
  r[6] = subject;       // G — предмет
  r[10] = 100;          // K — план
  r[11] = 'ЕП';         // L — способ
  r[12] = epReason;     // M — основание выбора ЕП
  r[31] = finalComment; // AF — фактический комментарий / ход исполнения
  if (id === '3') {
    r[3] = 'ифраструктура культуры';
    r[4] = 'Проведение меропиятий';
    r[20] = 'доовор заключен';
    r[30] = 'страхование ответсвенности';
    r[32] = 'учбная литература';
    r[33] = 'центализованной закупки';
  }
  r[16] = 'Х';          // Q — факта нет
  return r;
}

interface HygieneItemDto {
  cell: string;
  row: number;
  rowSeq: string | null;
  col: string;
  kind: string;
  label: string;
  context: string;
  fix: string;
}

interface ResponseDto {
  asOf: string;
  rowsSource: string;
  booksChecked: string[];
  booksSilent: string[];
  byDept: Array<{
    dept: string;
    deptLatin: string;
    sheet: string;
    items: HygieneItemDto[];
    countsByKind: Record<string, number>;
  }>;
  language: Array<{
    dept: string;
    cell: string;
    col: string;
    word: string;
    context: string;
    suggestion: string | null;
    confidence: string;
    fix: string;
  }>;
  totals: {
    rowsChecked: number;
    cellsChecked: number;
    hygieneFindings: number;
    languageFindings: number;
    countsByKind: Record<string, number>;
  };
  notes: string[];
}

describe('GET /api/text-hygiene', () => {
  let app: FastifyInstance;
  let body: ResponseDto;

  beforeAll(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
    };

    const { setDeptSheetCache, setDeptLoadMeta } = await import('../services/snapshot.js');
    setDeptLoadMeta({ УЭР: { loadedAt: '2026-10-10T12:00:00Z', rowCount: 4, sheetName: 'ВСЕ' }, УИО: { loadedAt: '2026-10-10T12:00:00Z', rowCount: 1, sheetName: 'УИО' } });
    const headers = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];
    setDeptSheetCache({
      // УЭР: три рода дефектов + опечатка в M. Строки листа: шапка 3 → данные с 4-й.
      'УЭР': {
        values: [
          ...headers,
          sheetRow('1', ZHAR_VARIANT, 'Поставка бумаги'),                    // C4: не по справочнику
          // Чистые имена — ДОСЛОВНО из справочника: близкое-но-не-точное имя
          // само стало бы находкой registry_mismatch и зашумило бы счётчики.
          sheetRow('2', ZHAR_CANON, 'Поставка  канцелярии'),                 // G5: двойной пробел
          sheetRow('3', ZHAR_CANON, 'Покупка хор. Товаров', 'закупка катриджей у единственного поставщика',
            'Кемонт картриджей в связи со сменой наименования'), // M6 + AF6: опечатка и защищённое слово
          sheetRow('4', 'Х', 'x'),                                           // маркеры отсутствия — молчание
        ],
        formulas: [],
        sheetName: 'УЭР',
      },
      // УИО: чистая книга — участвует в знаменателе, но не в находках.
      'УИО': {
        values: [
          ...headers,
          sheetRow('1', 'Х', 'Оценка имущества'),
        ],
        formulas: [],
        sheetName: 'УИО',
      },
    });

    const { createApp } = await import('../app.js');
    const { resetTextHygieneCache } = await import('./text-hygiene.js');
    resetTextHygieneCache();
    app = await createApp({ logger: false });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/text-hygiene' });
    expect(res.statusCode).toBe(200);
    body = res.json<ResponseDto>();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  it('называет момент чтения и источник строк (канон п.58)', () => {
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false);
    expect(body.rowsSource).toBe('live');
    expect(body.booksChecked).toContain('УЭР');
    expect(body.booksChecked).toContain('УИО');
  });

  it('каждая находка — запись с адресом, родом, контекстом и готовым значением', () => {
    const uer = body.byDept.find((d) => d.dept === 'УЭР');
    expect(uer, 'книга УЭР должна нести находки').toBeDefined();
    // Лист книги УЭР по реестру ГРБС — «ВСЕ» (управление + подвед).
    expect(uer!.sheet).toBe('ВСЕ');

    const doubleSpace = uer!.items.find((i) => i.kind === 'double_space');
    expect(doubleSpace).toBeDefined();
    expect(doubleSpace!.cell).toBe('G5');
    expect(doubleSpace!.row).toBe(5);
    expect(doubleSpace!.rowSeq).toBe('2');
    expect(doubleSpace!.context).toContain('Поставка  канц');
    expect(doubleSpace!.fix).toBe('Поставка канцелярии');
  });

  it('имя подведа сличается со справочником: fix — дословное имя канона', () => {
    const uer = body.byDept.find((d) => d.dept === 'УЭР')!;
    const mismatch = uer.items.find((i) => i.kind === 'registry_mismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch!.cell).toBe('C4');
    expect(mismatch!.fix).toBe(ZHAR_CANON);
    expect(uer.countsByKind.registry_mismatch).toBe(1);
  });

  it('орфография — отдельной группой: слово, контекст, предложение словаря', () => {
    const typo = body.language.find((l) => l.word === 'катриджей');
    expect(typo, 'опечатка «катриджей» должна быть найдена').toBeDefined();
    expect(typo!.dept).toBe('УЭР');
    expect(typo!.col).toBe('M');
    expect(typo!.cell).toBe('M6');
    expect(typo!.suggestion).toBe('картриджей');
    expect(typo!.context).toContain('катриджей');
    expect(typo!.fix).toContain('картриджей');
    expect(body.totals.languageFindings).toBeGreaterThanOrEqual(1);
  });

  it('находит «хор. товаров» как «хоз. товаров» даже при коротком сокращении', () => {
    const found = body.language.find(item => item.cell === 'G6' && item.word === 'хор.');
    expect(found).toBeDefined();
    expect(found?.suggestion).toBe('хоз.');
    expect(found?.fix).toBe('Покупка хоз. Товаров');
  });

  it('AF тоже проходит проверенную орфографию, но «сменой» не заменяется на «сметной»', () => {
    const af = body.language.find(item => item.dept === 'УЭР' && item.cell === 'AF6' && item.word === 'Кемонт');
    expect(af).toBeDefined();
    expect(af?.col).toBe('AF');
    expect(af?.suggestion).toBe('Ремонт');
    expect(af?.fix).toContain('Ремонт картриджей в связи со сменой наименования');
    expect(af?.fix).not.toContain('сметной');
    expect(body.language.some(item => item.col === 'AF' && item.word === 'сменой')).toBe(false);
  });

  it('проверяет D/E/U/AE/AG/AH без повторного счёта C/G', () => {
    for (const col of ['D', 'E', 'U', 'AE', 'AG', 'AH']) {
      expect(body.language.some(item => item.cell === `${col}6`)).toBe(true);
    }
    expect(body.notes.join(' ')).toContain('A:AH');
    expect(body.notes.join(' ')).toContain('Зеркала, технические листы и история');
  });

  it('маркеры отсутствия «X/х» дефектом не считаются (канон п.62)', () => {
    const uer = body.byDept.find((d) => d.dept === 'УЭР')!;
    expect(uer.items.some((i) => i.row === 7)).toBe(false);
  });

  it('пустота честная: чистая книга — в знаменателе, непрочитанные — названы', () => {
    // УИО прочитана и чиста — её нет в byDept, но её ячейки в cellsChecked.
    expect(body.byDept.some((d) => d.dept === 'УИО')).toBe(false);
    expect(body.totals.cellsChecked).toBeGreaterThan(0);
    expect(body.totals.rowsChecked).toBe(5);
    // Остальные книги реестра без строк — названы поимённо, а не пропали.
    expect(body.booksSilent.length).toBeGreaterThan(0);
    expect(body.notes.join(' ')).toContain('Не прочитаны строки книг');
  });

  it('счётчики по родам сходятся с находками', () => {
    const total = Object.values(body.totals.countsByKind).reduce((a, b) => a + b, 0);
    expect(total).toBe(body.totals.hygieneFindings);
    expect(body.totals.countsByKind.registry_mismatch).toBe(1);
    expect(body.totals.countsByKind.double_space).toBe(1);
  });

  it('второй запрос отдаётся из окна кэша — счёт не повторяется', async () => {
    const again = await app.inject({ method: 'GET', url: '/api/text-hygiene' });
    expect(again.statusCode).toBe(200);
    expect(again.json<ResponseDto>().asOf).toBe(body.asOf);
  });

  it('перечитка книг гасит находку без ?refresh: кэш привязан к моменту чтения книг', async () => {
    // Прецедент 20.08.2026: владелец исправил ячейку, вебхук перечитал книги,
    // а раздел до пяти минут показывал находку из старого пересчёта.
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];
    setDeptSheetCache({
      'УЭР': {
        values: [
          ...headers,
          sheetRow('1', ZHAR_VARIANT, 'Поставка бумаги'),      // C4: находка остаётся
          sheetRow('2', ZHAR_CANON, 'Поставка канцелярии'),    // G5: двойной пробел ИСПРАВЛЕН
        ],
        formulas: [],
        sheetName: 'УЭР',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/text-hygiene' });
    expect(res.statusCode).toBe(200);
    const fresh = res.json<ResponseDto>();
    // Ответ пересчитан по свежим книгам, а не отдан из пятиминутного окна.
    const uer = fresh.byDept.find((d) => d.dept === 'УЭР');
    expect(uer?.items.some((i) => i.kind === 'double_space')).toBe(false);
    expect(uer?.items.some((i) => i.kind === 'registry_mismatch')).toBe(true);
  });

  it('?refresh=true перечитывает САМИ книги, а не пересчитывает старый кэш', async () => {
    const { setDeptSheetCache, setSourceRefresher } = await import('../services/snapshot.js');
    const headers = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];
    // Перечитчик изображает вебхук-цикл: книга приходит уже исправленной.
    const reread = vi.fn(async () => {
      setDeptSheetCache({
        'УЭР': {
          values: [...headers, sheetRow('1', ZHAR_CANON, 'Поставка бумаги')], // C4 исправлена
          formulas: [],
          sheetName: 'УЭР',
        },
      });
    });
    setSourceRefresher(reread);

    const res = await app.inject({ method: 'GET', url: '/api/text-hygiene?refresh=true' });
    expect(res.statusCode).toBe(200);
    expect(reread).toHaveBeenCalledTimes(1);
    const fresh = res.json<ResponseDto>();
    // Находка погасла СРАЗУ: счёт шёл по перечитанной книге.
    expect(fresh.byDept.some((d) => d.items.some((i) => i.kind === 'registry_mismatch'))).toBe(false);
  });

  it('живой пример УКСиМП: адрес находки — строка ЛИСТА 174, а не 171 (позиция среди данных)', async () => {
    // Страж класса «двойной срез шапки / номер выборки вместо номера листа».
    // Живой случай, выверенный по книге УКСиМП 20.08.2026: ячейка G174
    // (№ п/п 171) несёт «выполнение работ (проведение противопожарных␣␣работ)»
    // с двойным пробелом. В массиве данных (шапка в 3 строки уже срезана) эта
    // строка стоит 171-й (индекс 170): перепутав основание счёта, роут назвал
    // бы её G171 — на три строки выше настоящей ячейки книги. Дамп той же
    // книги от 17.08 держал её на строке 173 (№ п/п 170): лист живёт, потому
    // адрес обязан рождаться от номера строки листа на момент чтения.
    const { setDeptSheetCache } = await import('../services/snapshot.js');
    const headers = [new Array(34).fill('h'), new Array(34).fill('h'), new Array(34).fill('h')];
    const { setDeptLoadMeta } = await import('../services/snapshot.js');
    setDeptLoadMeta({ УКСиМП: { loadedAt: '2026-10-10T12:00:00Z', rowCount: 171, sheetName: 'ВСЕ' } });
    const filler = Array.from({ length: 170 }, (_, i) => sheetRow(String(i + 1), 'Х', 'Поставка воды'));
    setDeptSheetCache({
      'УКСиМП': {
        values: [
          ...headers,
          ...filler,
          // 171-я строка данных = строка листа 174 (3 шапки + 171).
          sheetRow('171', 'Х', 'выполнение работ (проведение противопожарных  работ)'),
        ],
        formulas: [],
        sheetName: 'ВСЕ',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/text-hygiene' });
    expect(res.statusCode).toBe(200);
    const fresh = res.json<ResponseDto>();
    const uksimp = fresh.byDept.find((d) => d.dept === 'УКСиМП');
    expect(uksimp, 'книга УКСиМП должна нести находку').toBeDefined();
    expect(uksimp!.sheet).toBe('ВСЕ');

    const finding = uksimp!.items.find((i) => i.kind === 'double_space');
    expect(finding).toBeDefined();
    // Номер строки ЛИСТА и «№ п/п» из колонки A — двойной адрес (п.98б).
    expect(finding!.cell).toBe('G174');
    expect(finding!.row).toBe(174);
    expect(finding!.rowSeq).toBe('171');
    // Регресс-ловушка: адрес НЕ от позиции в выборке (171 = 174 − 3 шапки).
    expect(uksimp!.items.some((i) => i.row === 171)).toBe(false);
  });

  it('маршрут прикрыт порогом частоты: счёт по всем книгам не бесплатен', () => {
    const limiter = createHeavyRouteLimiter(HEAVY_ROUTE_RULES);
    let refused = false;
    for (let i = 0; i < 60 && !refused; i++) {
      refused = limiter.check('GET', '/api/text-hygiene', 'клиент', 1_000_000) !== null;
    }
    expect(refused).toBe(true);
  });
});

// Публичный API: поля вне прежних G/M/AF не теряются, адреса сохраняются.
