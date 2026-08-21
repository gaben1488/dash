/**
 * triple-view.test.ts — выводы раздела «Сверка трёх источников».
 *
 * Проверяются обещания, которые читает начальница управления, а не разметка:
 *  1. одна карточка на класс, внутри — адреса (п.53);
 *  2. деньги класса не смешиваются: разрыв — отдельно, сумма закупок —
 *     отдельно, иначе «нет строки в книге» читалось бы как потеря;
 *  3. сводка под фильтром управления считает срез, а не район (п.127);
 *  4. форма («доли совместной закупки») не попадает в расхождения.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  groupFindings, orgPhrase, overviewOf, scopeTripleRows, sideAddresses, subjectOf,
} from './triple-view';
import { normalizeTriple, type TripleRow } from './triple-contract';

/** Величина одной стороны — минимальная форма TripleMoney для сборки строки. */
function money(book: number | null, sheet: number | null, journal: number | null) {
  const sides = [
    ['book', book], ['sheet', sheet], ['journal', journal],
  ] as const;
  return {
    bookRub: book, sheetRub: sheet, journalRub: journal,
    sidesPresent: sides.filter(([, v]) => v !== null).map(([s]) => s),
    pairs: [],
    maxAbsDeltaRub: null,
    agrees: null,
    outlier: null,
  };
}

function row(over: Partial<TripleRow> & { code: string }): TripleRow {
  return {
    subject: 'Ремонт кровли',
    bookRows: [],
    sheetRows: [],
    journalRows: [],
    plan: money(null, null, null),
    fact: money(null, null, null),
    savings: money(null, null, null),
    subjectSimilarity: null,
    departments: [],
    subordinates: [],
    findings: [],
    ...over,
  } as TripleRow;
}

const bookRow = (dept: string, sheet: string, n: number) => ({
  dept, sheet, row: n, subject: 'Ремонт кровли', subordinate: 'МБОУ СШ № 1',
  planTotalThousands: null, factTotalThousands: null, economyTotalThousands: null,
});

const monRow = (side: 'sheet' | 'journal', sheet: string, n: number, dept: string | null) => ({
  side, sheet, row: n, dept, customer: 'МБОУ СШ № 1', code: 'ЭА1-26',
  subject: 'Ремонт кровли', nmckRub: null, priceRub: null, savingsRub: null,
  stage: null, joint: false,
});

describe('группировка расхождений по классам', () => {
  it('одна карточка на класс, а закупки внутри — от крупной к мелкой', () => {
    const rows = [
      row({
        code: 'ЭА1-26',
        plan: money(1_000_000, 1_000_000, null),
        findings: [{
          kind: 'plan-differs', code: 'ЭА1-26', addresses: ['УО!K10', '8. УО!D5'],
          deltaRub: 500, note: 'Начальные цены разошлись.', expected: false,
        }],
      }),
      row({
        code: 'ЭА2-26',
        plan: money(9_000_000, 9_000_000, null),
        findings: [{
          kind: 'plan-differs', code: 'ЭА2-26', addresses: ['УО!K11'],
          deltaRub: 90_000, note: 'Начальные цены разошлись.', expected: false,
        }],
      }),
    ];

    const groups = groupFindings(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('plan-differs');
    expect(groups[0].items.map((i) => i.row.code)).toEqual(['ЭА2-26', 'ЭА1-26']);
    // Разрыв класса — сумма модулей, а не разность: два расхождения по 90 000
    // и 500 стоят вместе 90 500, куда бы ни смотрел знак.
    expect(groups[0].deltaSumRub).toBe(90_500);
  });

  it('класс про отсутствие записи не выдаёт сумму закупок за разрыв', () => {
    const rows = [row({
      code: 'ЭА3-26',
      plan: money(null, 4_000_000, null),
      findings: [{
        kind: 'no-pair-in-books', code: 'ЭА3-26', addresses: ['8. УО!D7'],
        deltaRub: null, note: 'Строки плана с этим номером нет.', expected: false,
      }],
    })];

    const [group] = groupFindings(rows);
    // Разрыва нет — сравнивать не с чем; размер вопроса измеряется начальной ценой.
    expect(group.deltaSumRub).toBeNull();
    expect(group.amountSumRub).toBe(4_000_000);
  });

  it('форма заполнения уходит вниз и в расхождения не попадает', () => {
    const rows = [
      row({
        code: 'ЭАС1-26',
        findings: [{
          kind: 'joint-shares', code: 'ЭАС1-26', addresses: ['УО!K1', 'УЭР!K2'],
          deltaRub: null, note: 'Доли совместной закупки.', expected: true,
        }],
      }),
      row({
        code: 'ЭА4-26',
        findings: [{
          kind: 'plan-differs', code: 'ЭА4-26', addresses: ['УО!K3'],
          deltaRub: 10_000, note: 'Начальные цены разошлись.', expected: false,
        }],
      }),
    ];

    const groups = groupFindings(rows);
    expect(groups.map((g) => g.kind)).toEqual(['plan-differs', 'joint-shares']);
    expect(groups[1].expected).toBe(true);
    expect(groups[1].guide?.todo).toMatch(/это форма, а не ошибка/u);
  });

  it('тот же класс без пометки о совместной закупке — вопрос, а не форма', () => {
    // Живой случай: номер стоит в двух книгах, а признака совместной закупки
    // нет ни на листе, ни в реестре. Совет «делать ничего не надо» здесь
    // закрыл бы глаза ровно там, где номер мог уехать в чужую книгу.
    const [group] = groupFindings([row({
      code: 'ЭА6-26',
      findings: [{
        kind: 'joint-shares', code: 'ЭА6-26', addresses: ['УО!AG1', 'УЭР!AG2'],
        deltaRub: null, note: 'Признака совместной закупки нет.', expected: false,
      }],
    })]);
    expect(group.expected).toBe(false);
    expect(group.guide?.todo).toMatch(/уехал в чужую книгу/u);
  });

  it('незнакомый класс сервера не теряется, а встаёт в конец', () => {
    const groups = groupFindings([row({
      code: 'ЭА5-26',
      findings: [
        { kind: 'plan-differs', code: null, addresses: ['УО!K4'], deltaRub: 1, note: '', expected: false },
        { kind: 'нечто-новое', code: null, addresses: ['УО!K5'], deltaRub: null, note: '', expected: false },
      ],
    })]);
    expect(groups.map((g) => g.kind)).toEqual(['plan-differs', 'нечто-новое']);
    // Подписи у незнакомого класса нет — показывается ключ, но строка живёт.
    expect(groups[1].label).toBe('нечто-новое');
  });
});

describe('сводка', () => {
  const payload = {
    source: { bookName: '', readAt: '', moneyUnit: 'руб', sheetsRead: [], sheetsFailed: {}, sheetsExpected: 14 },
    books: { read: ['УО'] },
    summary: { codesTotal: 3, allThreeSides: 1, twoSides: 1, oneSide: 1, clean: 1, byKind: {} },
    rows: [] as TripleRow[],
    orphans: [],
    notes: [],
  };

  it('закупка, где различие — только форма, считается сошедшейся', () => {
    const rows = [
      row({ code: 'A', findings: [] }),
      row({
        code: 'B',
        findings: [{
          kind: 'joint-shares', code: 'B', addresses: [], deltaRub: null, note: '', expected: true,
        }],
      }),
      row({
        code: 'C',
        plan: money(null, 2_000_000, null),
        findings: [{
          kind: 'plan-differs', code: 'C', addresses: [], deltaRub: 700, note: '', expected: false,
        }],
      }),
    ];
    const o = overviewOf({ ...payload, rows }, rows);
    expect(o.agreed).toBe(2);
    expect(o.expectedOnly).toBe(1);
    expect(o.diverged).toBe(1);
    expect(o.deltaSumRub).toBe(700);
    // Деньги разошедшихся — начальная цена самой закупки, а не разрыв.
    expect(o.divergedAmountRub).toBe(2_000_000);
  });

  it('под фильтром управления счётчик закупок считает срез, а не район', () => {
    const all = [
      row({ code: 'A', departments: ['УО'] }),
      row({ code: 'B', departments: ['УЭР'] }),
      row({ code: 'C', departments: ['УЭР'] }),
    ];
    const scoped = scopeTripleRows(all, new Set(['УО']));
    expect(scoped.map((r) => r.code)).toEqual(['A']);
    // Сводка сервера говорит про весь район (3) — под срезом она соврала бы.
    expect(overviewOf({ ...payload, rows: all }, scoped).codesTotal).toBe(1);
    expect(overviewOf({ ...payload, rows: all }, all).codesTotal).toBe(3);
  });

  it('стороны считаются по самим записям строки', () => {
    const rows = [row({
      code: 'A',
      bookRows: [bookRow('УО', 'УО', 10)],
      sheetRows: [monRow('sheet', '8. УО', 5, 'УО')],
      journalRows: [monRow('journal', '25-26', 7, null)],
    })];
    const o = overviewOf({ ...payload, rows }, rows);
    expect(o.allThreeSides).toBe(1);
    expect(o.twoSides).toBe(0);
  });
});

describe('изоляция организаций (п.127)', () => {
  it('закупка без стороны книги ГРБС остаётся в срезе по листу управления', () => {
    // Самый интересный класс — «нет строки в книгах ГРБС»: у него книги ГРБС
    // и нет, и срез по управлению обязан брать управление у листа мониторинга,
    // иначе класс исчезал бы ровно там, где он важен.
    const rows = [row({
      code: 'A',
      departments: [],
      sheetRows: [monRow('sheet', '8. УО', 5, 'УО')],
    })];
    expect(scopeTripleRows(rows, new Set(['УО'])).map((r) => r.code)).toEqual(['A']);
    expect(scopeTripleRows(rows, new Set(['УЭР']))).toHaveLength(0);
  });

  it('закупка только из районного реестра «25-26» ни одному управлению не приписывается', () => {
    const rows = [row({ code: 'A', journalRows: [monRow('journal', '25-26', 3, null)] })];
    expect(scopeTripleRows(rows, new Set(['УО']))).toHaveLength(0);
    expect(scopeTripleRows(rows, null)).toHaveLength(1);
  });

  it('организация называется парой «ГРБС · учреждение»', () => {
    expect(orgPhrase(row({
      code: 'A', departments: ['УО'], subordinates: ['МБОУ СШ № 1'],
    }))).toBe('УО · МБОУ СШ № 1');
    // «Х» в колонке заказчика книги — заглушка, а не имя учреждения.
    expect(orgPhrase(row({ code: 'A', departments: ['УДТХ'], subordinates: ['Х'] })))
      .toBe('УДТХ');
  });
});

describe('какая величина обсуждается', () => {
  const r = row({
    code: 'A',
    plan: money(1, 2, 3),
    fact: money(4, 5, 6),
    savings: money(7, 8, 9),
  });

  it('класс называет свою величину, а класс про отсутствие — начальную цену', () => {
    expect(subjectOf('plan-differs', r).money.bookRub).toBe(1);
    expect(subjectOf('fact-differs', r).money.bookRub).toBe(4);
    expect(subjectOf('winner-price-missing', r).money.bookRub).toBe(4);
    expect(subjectOf('savings-differ', r).money.bookRub).toBe(7);
    expect(subjectOf('no-pair-in-books', r).money.bookRub).toBe(1);
    expect(subjectOf('no-pair-in-books', r).label).toBe('начальная цена');
  });

  it('адреса собираются по всем строкам каждой стороны', () => {
    const withRows = row({
      code: 'A',
      bookRows: [bookRow('УО', 'УО', 2414), bookRow('УЭР', 'УЭР', 47)],
      sheetRows: [monRow('sheet', '8. УО', 102, 'УО')],
      journalRows: [],
    });
    expect(sideAddresses(withRows)).toEqual({
      book: ['УО!2414', 'УЭР!47'],
      sheet: ['8. УО!102'],
      journal: [],
    });
  });
});

describe('запрос сверки', () => {
  it('обработчик ошибки не падает сам, когда модуль запросов подменён', async () => {
    // Страничные тесты подменяют модуль `api` целиком, и обращение к
    // классу-заглушке внутри `catch` бросало исключение прямо в обработчике
    // ошибки — то есть ровно там, где падать нельзя ни при каких условиях.
    // Код ответа читается ПОЛЕМ, и потому переживает любую подмену.
    vi.resetModules();
    vi.doMock('../../api', () => ({
      fetchJSON: () => Promise.reject(Object.assign(new Error('нет книги'), { status: 503 })),
    }));
    const { fetchMonitoringTriple } = await import('./triple-contract');
    await expect(fetchMonitoringTriple()).resolves.toMatchObject({ kind: 'book-unread' });
    vi.doUnmock('../../api');
    vi.resetModules();
  });

  it('роут, которого ещё нет, отличается от книги, которую не прочитали', async () => {
    vi.resetModules();
    vi.doMock('../../api', () => ({
      fetchJSON: () => Promise.reject(Object.assign(new Error('нет роута'), { status: 404 })),
    }));
    const { fetchMonitoringTriple } = await import('./triple-contract');
    await expect(fetchMonitoringTriple()).resolves.toMatchObject({ kind: 'not-wired' });
    vi.doUnmock('../../api');
    vi.resetModules();
  });
});

describe('чтение ответа сервера', () => {
  it('ответ без единого раздела — не «сверка чиста», а отсутствие ответа', () => {
    expect(normalizeTriple({})).toBeNull();
    expect(normalizeTriple(null)).toBeNull();
  });

  it('ноль в цене победителя остаётся нулём, а не превращается в пустоту', () => {
    const payload = normalizeTriple({
      summary: { codesTotal: 1 },
      rows: [{
        code: 'ЭА1-26',
        fact: { bookRub: 0, sheetRub: null, journalRub: null },
        findings: [{ kind: 'fact-differs', addresses: ['УО!Y1'], note: '' }],
      }],
    });
    expect(payload?.rows[0].fact.bookRub).toBe(0);
    expect(payload?.rows[0].fact.sheetRub).toBeNull();
    // Стороны выведены по самим числам: ноль — сторона, null — нет.
    expect(payload?.rows[0].fact.sidesPresent).toEqual(['book']);
  });
});
