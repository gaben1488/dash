/**
 * triple-check.test.ts — тройная сверка одной закупки (требование владельца
 * 21.08.2026: сверять не только движок против листа, а данные по закупкам).
 *
 * Проверяются четыре обещания.
 *  1. Единицы переводятся один раз: книга ГРБС — тысячи, книга мониторинга —
 *     рубли, сравнение идёт в рублях.
 *  2. Третья запись отвечает на вопрос, на который двусторонняя сверка не
 *     отвечает: КТО из троих отстал (outlier).
 *  3. Расхождение называется классом из закрытого словаря и несёт адрес.
 *  4. Продукт не чинит книгу: искажённый код не соединяется молча, кандидат
 *     по предмету только показывается.
 */
import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import {
  bookSide,
  compareTriple,
  subjectSimilarity,
  tripleCheck,
  type TripleFindingKind,
  type TripleMonitoringRow,
} from './triple-check.js';

/** Строка книги ГРБС: предмет в G, план в K, факт в Y, экономия в AC, код в AG. */
function bookRow(
  code: string,
  subject: string,
  planThousands: unknown,
  factThousands: unknown,
  economyThousands: unknown = '',
  subordinate: unknown = '',
): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[DEPT_COLUMNS.SUBORDINATE] = subordinate;
  r[DEPT_COLUMNS.SUBJECT] = subject;
  r[DEPT_COLUMNS.TOTAL_PLAN] = planThousands;
  r[DEPT_COLUMNS.TOTAL_FACT] = factThousands;
  r[DEPT_COLUMNS.ECONOMY_TOTAL] = economyThousands;
  r[DEPT_COLUMNS.COMMENT_UER] = code;
  return r;
}

function monRow(
  side: 'sheet' | 'journal',
  row: number,
  code: string | null,
  subject: string,
  nmck: number | null,
  price: number | null,
  savings: number | null,
  extra: Partial<TripleMonitoringRow> = {},
): TripleMonitoringRow {
  return {
    side,
    sheet: side === 'sheet' ? '1. УЭР' : '25-26',
    row,
    dept: null,
    customer: null,
    code,
    codeNote: null,
    subject,
    nmckRub: nmck,
    priceRub: price,
    savingsRub: savings,
    stage: null,
    joint: false,
    ...extra,
  };
}

function kinds(result: ReturnType<typeof tripleCheck>, code: string): TripleFindingKind[] {
  return (result.rows.find((r) => r.code === code)?.findings ?? []).map((f) => f.kind);
}

describe('compareTriple — три числа одной величины', () => {
  it('переводит тысячи книги в рубли и признаёт согласие в пределах шага тысяч', () => {
    // 1 234,56 тыс. = 1 234 560 руб.; расхождение в 4 рубля — след хранения.
    const m = compareTriple(1_234_560, 1_234_564, 1_234_564);
    expect(m.agrees).toBe(true);
    expect(m.sidesPresent).toEqual(['book', 'sheet', 'journal']);
  });

  it('называет отставшую сторону, когда две записи держат одно число', () => {
    const m = compareTriple(1_000_000, 1_000_000, 900_000);
    expect(m.agrees).toBe(false);
    expect(m.outlier).toBe('journal');
    expect(m.maxAbsDeltaRub).toBe(100_000);
  });

  it('не выбирает виноватого, когда расходятся все трое', () => {
    const m = compareTriple(1_000_000, 900_000, 800_000);
    expect(m.agrees).toBe(false);
    expect(m.outlier).toBeNull();
  });

  it('пустая сторона — не провал сверки, а отсутствие сравнения', () => {
    const m = compareTriple(null, 500_000, 500_000);
    expect(m.agrees).toBe(true);
    expect(m.sidesPresent).toEqual(['sheet', 'journal']);
    expect(m.pairs.filter((p) => p.agrees === null)).toHaveLength(2);
  });

  it('рубли листа и реестра сверяются строже книги: 60 копеек — расхождение', () => {
    const m = compareTriple(null, 1_000_000.6, 1_000_000);
    expect(m.agrees).toBe(false);
  });
});

describe('предмет как второй ключ', () => {
  it('короткая формулировка книги внутри подробной формулировки мониторинга — та же закупка', () => {
    const sim = subjectSimilarity(
      'Поставка молока',
      'Поставка молока и кисломолочной продукции в образовательные учреждения района',
    );
    expect(sim).toBe(1);
  });

  it('разные закупки под одним номером видны низкой схожестью', () => {
    const sim = subjectSimilarity('Поставка бензина А92', 'Ремонт кровли здания администрации');
    expect(sim).toBe(0);
  });
});

describe('tripleCheck — классы расхождений', () => {
  const readAt = '2026-08-21T09:00:00.000Z';

  it('все три записи сходятся — расхождений нет', () => {
    const result = tripleCheck({
      readAt,
      bookRows: bookSide({ УЭР: [bookRow('ЭА152-26', 'Ремонт кровли', '1000', '900', '100')] }),
      sheetRows: [monRow('sheet', 7, 'ЭА152-26', 'Ремонт кровли здания', 1_000_000, 900_000, 100_000)],
      journalRows: [monRow('journal', 12, 'ЭА152-26', 'Ремонт кровли здания', 1_000_000, 900_000, 100_000)],
    });
    expect(kinds(result, 'ЭА152-26')).toEqual([]);
    expect(result.summary.allThreeSides).toBe(1);
    expect(result.summary.clean).toBe(1);
    expect(result.readAt).toBe(readAt);
  });

  it('отставшая книга ГРБС по факту — расхождение с указанием стороны', () => {
    const result = tripleCheck({
      bookRows: bookSide({ УЭР: [bookRow('ЭА152-26', 'Ремонт кровли', '1000', '1000', '')] }),
      sheetRows: [monRow('sheet', 7, 'ЭА152-26', 'Ремонт кровли здания', 1_000_000, 900_000, 100_000)],
      journalRows: [monRow('journal', 12, 'ЭА152-26', 'Ремонт кровли здания', 1_000_000, 900_000, 100_000)],
    });
    expect(kinds(result, 'ЭА152-26')).toContain('fact-differs');
    const row = result.rows[0];
    expect(row.fact.outlier).toBe('book');
    const finding = row.findings.find((f) => f.kind === 'fact-differs');
    expect(finding?.deltaRub).toBe(100_000);
    expect(finding?.note).toContain('книга ГРБС');
  });

  it('нет пары в мониторинге и нет строки книги — разные классы', () => {
    const result = tripleCheck({
      bookRows: bookSide({ УЭР: [bookRow('ЭА1-26', 'Бензин', '100', '', '')] }),
      sheetRows: [monRow('sheet', 7, 'ЭА2-26', 'Дрова', 200_000, null, null)],
      journalRows: [],
    });
    expect(kinds(result, 'ЭА1-26')).toContain('no-pair-in-monitoring');
    expect(kinds(result, 'ЭА2-26')).toContain('no-pair-in-books');
    expect(kinds(result, 'ЭА2-26')).toContain('no-journal-record');
  });

  it('экономия, внесённая рукой, ловится сверкой с разностью и несёт адрес ячейки', () => {
    const result = tripleCheck({
      bookRows: [],
      sheetRows: [monRow('sheet', 9, 'ЭА3-26', 'Стол письменный', 100_000, 90_000, 5_000)],
      journalRows: [],
    });
    const finding = result.rows[0].findings.find((f) => f.kind === 'savings-not-difference');
    expect(finding).toBeDefined();
    expect(finding?.addresses).toEqual(['1. УЭР!J9']);
    expect(finding?.deltaRub).toBe(-5_000);
  });

  it('торги без результата не считаются ошибкой экономии', () => {
    const result = tripleCheck({
      bookRows: [],
      sheetRows: [monRow('sheet', 9, 'ЭА4-26', 'Отлов животных', 100_000, 0, 0)],
      journalRows: [],
    });
    expect(kinds(result, 'ЭА4-26')).not.toContain('savings-not-difference');
  });

  it('факт в книге ГРБС при пустой цене победителя — отдельный класс', () => {
    const result = tripleCheck({
      bookRows: bookSide({ УЭР: [bookRow('ЭА5-26', 'Бензин А92', '500', '480', '')] }),
      sheetRows: [monRow('sheet', 11, 'ЭА5-26', 'Бензин А92 для нужд учреждения', 500_000, null, null)],
      journalRows: [],
    });
    const finding = result.rows[0].findings.find((f) => f.kind === 'winner-price-missing');
    expect(finding?.addresses).toEqual(['1. УЭР!I11']);
  });

  it('один номер в разных книгах — доли совместной закупки, а не аномалия', () => {
    const result = tripleCheck({
      bookRows: bookSide({
        УЭР: [bookRow('ЭАС258-26', 'Охрана школ', '600', '', '')],
        УО: [bookRow('ЭАС258-26', 'Охрана школ', '400', '', '')],
      }),
      sheetRows: [monRow('sheet', 20, 'ЭАС258-26', 'Охрана школ', 1_000_000, null, null, { joint: true })],
      journalRows: [monRow('journal', 30, 'ЭАС258-26', 'Охрана школ', 1_000_000, null, null, { joint: true })],
    });
    const finding = result.rows[0].findings.find((f) => f.kind === 'joint-shares');
    expect(finding?.expected).toBe(true);
    expect(kinds(result, 'ЭАС258-26')).not.toContain('duplicate-in-book');
  });

  it('один номер дважды в ОДНОЙ книге — аномалия заполнения', () => {
    const result = tripleCheck({
      bookRows: bookSide({
        УДТХ: [bookRow('ЭА138-26', 'Ремонт дороги', '600', '', ''), bookRow('ЭА138-26', 'Ремонт дороги', '400', '', '')],
      }),
      sheetRows: [monRow('sheet', 20, 'ЭА138-26', 'Ремонт дороги', 1_000_000, null, null)],
      journalRows: [],
    });
    expect(kinds(result, 'ЭА138-26')).toContain('duplicate-in-book');
    // Пока дубль не разобран, суммы книги в сравнение не идут: сложить две
    // строки значило бы выдумать ответ на вопрос «какую K сверять».
    expect(result.rows[0].plan.bookRub).toBeNull();
    expect(kinds(result, 'ЭА138-26')).not.toContain('plan-differs');
  });

  it('повтор строки на одном листе мониторинга не удваивает закупку', () => {
    const result = tripleCheck({
      bookRows: bookSide({ УД: [bookRow('ЭА166-26', 'Поставка картриджей', '61,2', '23,55', '37,65')] }),
      sheetRows: [
        monRow('sheet', 79, 'ЭА166-26', 'Поставка картриджей', 61_200, 23_552, 37_648),
        monRow('sheet', 87, 'ЭА166-26', 'Поставка картриджей', 61_200, 23_552, 37_648),
      ],
      journalRows: [monRow('journal', 231, 'ЭА166-26', 'Поставка картриджей', 61_200, 23_552, 37_648)],
    });
    expect(kinds(result, 'ЭА166-26')).toContain('duplicate-in-monitoring');
    // Сторона листа в сравнение не идёт — иначе она «отстала» бы вдвое.
    expect(result.rows[0].plan.sheetRub).toBeNull();
    expect(kinds(result, 'ЭА166-26')).not.toContain('plan-differs');
  });

  it('искажённый код не соединяется молча: строка уходит в сироты с догадкой', () => {
    const result = tripleCheck({
      bookRows: bookSide({ УЭР: [bookRow('ЭКЗ301-26', 'Приобретение квартиры', '100', '', '')] }),
      sheetRows: [monRow('sheet', 7, 'ЭЗК301-26', 'Приобретение квартиры для детей-сирот', 100_000, null, null)],
      journalRows: [],
    });
    expect(result.rows.find((r) => r.code === 'ЭКЗ301-26')).toBeUndefined();
    const orphan = result.orphans[0];
    expect(orphan.guess).toBe('ЭЗК301-26');
    expect(orphan.address).toBe('УЭР!AG4');
    expect(result.summary.byKind['code-distorted']).toBe(1);
  });

  it('код совпал, а предметы разные — второй ключ говорит вслух', () => {
    const result = tripleCheck({
      bookRows: bookSide({ УЭР: [bookRow('ЭА9-26', 'Поставка бензина А92', '100', '', '')] }),
      sheetRows: [monRow('sheet', 7, 'ЭА9-26', 'Ремонт кровли здания администрации', 100_000, null, null)],
      journalRows: [],
    });
    const finding = result.rows[0].findings.find((f) => f.kind === 'subject-mismatch');
    expect(finding).toBeDefined();
    expect(finding?.addresses).toContain('УЭР!G4');
  });

  it('строка сверки несёт управление и учреждение — фильтрам есть что изолировать', () => {
    // Канон п.119: сигнал показывает, по какому ГРБС и по какой организации
    // внутри него он сработал. Книга УО ведёт десятки учреждений одной
    // сеткой, поэтому «расхождение в книге УО» без имени школы адресует
    // в пустоту.
    const result = tripleCheck({
      bookRows: bookSide({
        УО: [bookRow('ЭА152-26', 'Поставка бумаги', 1000, 900, 100, 'МБОУ «Елизовская средняя школа №1»')],
      }),
      sheetRows: [monRow('sheet', 12, 'ЭА152-26', 'Поставка бумаги', 1_000_000, 900_000, 100_000)],
      journalRows: [],
    });
    const row = result.rows.find((r) => r.code === 'ЭА152-26');
    expect(row?.departments).toEqual(['УО']);
    expect(row?.subordinates).toEqual(['МБОУ «Елизовская средняя школа №1»']);
  });

  it('адрес строки книги — тот, что видит человек: шапка в три строки', () => {
    const rows = bookSide({ УЭР: [bookRow('ЭА1-26', 'Бензин', '100', '', '')] }, { УЭР: 'УЭР' });
    expect(rows[0].row).toBe(4);
  });
});
