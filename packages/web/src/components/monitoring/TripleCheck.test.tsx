// @vitest-environment jsdom
/**
 * Стражи раздела «Сверка трёх источников».
 *
 * Проверяются ОБЕЩАНИЯ читателю, а не оформление:
 *   1) три пустоты различимы и ведут к трём разным поступкам (п.36):
 *      «расхождений нет», «книга не прочитана», «сопоставлять нечего»;
 *   2) одна карточка на класс, адреса — внутри неё (п.53);
 *   3) у расхождения виден ответ (п.119): числа трёх сторон рядом, под
 *      каждым — адрес его строки, и названо, кто отстал;
 *   4) родословная названа до чисел (п.104): какие книги, на какой момент,
 *      сколько строк каждая дала;
 *   5) сумма закупок класса не выдаётся за разрыв — эти деньги не потеряны.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TripleCheck } from './TripleCheck';
import type { TriplePayload, TripleRow, TripleState } from '../../lib/monitoring/triple-contract';

afterEach(cleanup);

function money(book: number | null, sheet: number | null, journal: number | null, outlier: 'book' | 'sheet' | 'journal' | null = null) {
  return {
    bookRub: book, sheetRub: sheet, journalRub: journal,
    sidesPresent: [], pairs: [], maxAbsDeltaRub: null, agrees: null, outlier,
  };
}

const nothing = money(null, null, null);

function payloadWith(rows: TripleRow[], over: Partial<TriplePayload> = {}): TriplePayload {
  return {
    source: {
      bookName: 'Ежедневный мониторинг',
      readAt: '2026-08-21T01:07:30.159Z',
      moneyUnit: 'руб',
      sheetsRead: ['8. УО'],
      sheetsFailed: {}, sheetsExpected: 14,
    },
    books: { read: ['УО', 'УЭР'] },
    summary: {
      codesTotal: rows.length, allThreeSides: 0, twoSides: 0, oneSide: 0, clean: 0, byKind: {},
    },
    rows,
    orphans: [],
    notes: [],
    ...over,
  };
}

const divergedRow: TripleRow = {
  code: 'ЭА54-26',
  subject: 'Капитальный ремонт пищеблока',
  bookRows: [{
    dept: 'УО', sheet: 'УО', row: 1889, subject: 'Капитальный ремонт пищеблока',
    subordinate: 'МБОУ ЕСШ № 1', planTotalThousands: 90_000, factTotalThousands: null,
    economyTotalThousands: null,
  }],
  sheetRows: [{
    side: 'sheet', sheet: '8. УО', row: 44, dept: 'УО', customer: 'МБОУ ЕСШ № 1',
    code: 'ЭА54-26', subject: 'Капитальный ремонт пищеблока',
    nmckRub: 44_270_850, priceRub: null, savingsRub: null, stage: null, joint: false,
  }],
  journalRows: [{
    side: 'journal', sheet: '25-26', row: 119, dept: null, customer: 'МБОУ ЕСШ № 1',
    code: 'ЭА54-26', subject: 'Капитальный ремонт пищеблока',
    nmckRub: 44_270_850, priceRub: null, savingsRub: null, stage: null, joint: false,
  }],
  plan: money(90_000_000, 44_270_850, 44_270_850, 'book'),
  fact: nothing,
  savings: nothing,
  subjectSimilarity: 1,
  departments: ['УО'],
  subordinates: ['МБОУ ЕСШ № 1'],
  findings: [{
    kind: 'plan-differs',
    code: 'ЭА54-26',
    addresses: ['УО!K1889', '8. УО!D44', '25-26!D119'],
    deltaRub: 45_729_150,
    note: 'Начальная цена книги управления и начальная цена мониторинга разошлись.',
    expected: false,
  }],
};

const absentRow: TripleRow = {
  ...divergedRow,
  code: 'ЭА99-26',
  bookRows: [],
  plan: money(null, 4_000_000, 4_000_000),
  departments: [],
  findings: [{
    kind: 'no-pair-in-books',
    code: 'ЭА99-26',
    addresses: ['8. УО!D44'],
    deltaRub: null,
    note: 'Строки плана закупок с этим номером ни в одной книге ГРБС нет.',
    expected: false,
  }],
};

function show(state: TripleState) {
  render(
    <TripleCheck
      state={state}
      deptScope={null}
      scopeLabel="весь реестр книги"
      onReload={() => {}}
    />,
  );
}

describe('три честные пустоты', () => {
  it('«расхождений нет» — вывод о данных, а не отсутствие проверки', () => {
    show({ kind: 'clean', payload: payloadWith([{ ...divergedRow, findings: [] }]) });
    expect(screen.getByText(/Расхождений нет/u)).toBeTruthy();
    expect(screen.getByText(/три книги говорят одно и то же/u)).toBeTruthy();
  });

  it('«книга не прочитана» — состояние источника, и так и сказано', () => {
    show({ kind: 'book-unread', message: 'не прочитана' });
    expect(screen.getByText(/не прочитана/u)).toBeTruthy();
    // Именно этой фразы здесь быть не должно: вывода о закупках нет.
    expect(screen.queryByText(/Расхождений нет/u)).toBeNull();
    expect(screen.getByText(/Прочитать книги заново/u)).toBeTruthy();
  });

  it('«сопоставлять нечего» отличается от «расхождений нет»', () => {
    show({ kind: 'no-codes', payload: payloadWith([]) });
    expect(screen.getByText(/у строк нет номеров процедур/u)).toBeTruthy();
    expect(screen.queryByText(/Расхождений нет/u)).toBeNull();
  });

  it('перечитать книги предлагается кнопкой, и она нажимается', () => {
    const onReload = vi.fn();
    render(
      <TripleCheck
        state={{ kind: 'book-unread', message: 'не прочитана' }}
        deptScope={null}
        scopeLabel="весь реестр книги"
        onReload={onReload}
      />,
    );
    fireEvent.click(screen.getByText(/Прочитать книги заново/u));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe('родословная над числами (п.104)', () => {
  it('называет книги, момент чтения и сколько строк дала каждая сторона', () => {
    show({ kind: 'ok', payload: payloadWith([divergedRow]) });
    expect(screen.getByText(/Что с чем сверялось/u)).toBeTruthy();
    expect(screen.getByText(/Книги: УО, УЭР/u)).toBeTruthy();
    expect(screen.getByText(/Книга мониторинга прочитана/u)).toBeTruthy();
    // По одной строке от каждой из трёх сторон.
    expect(screen.getAllByText('1 строка')).toHaveLength(3);
  });

  it('непрочитанные листы названы поимённо, а не спрятаны', () => {
    show({
      kind: 'ok',
      payload: payloadWith([divergedRow], {
        source: {
          bookName: 'Ежедневный мониторинг', readAt: '2026-08-21T01:07:30.159Z',
          moneyUnit: 'руб', sheetsRead: [], sheetsFailed: { '25-26': 'отказ чтения' }, sheetsExpected: 14,
        },
      }),
    });
    expect(screen.getByText(/Прочитаны не все листы: 25-26/u)).toBeTruthy();
  });
});

describe('одна карточка на класс, ответ — внутри (п.53, п.119)', () => {
  it('заголовок класса называет число закупок и разрыв', () => {
    show({ kind: 'ok', payload: payloadWith([divergedRow]) });
    expect(screen.getByText('Начальные цены разошлись')).toBeTruthy();
    expect(screen.getByText(/1 закупка · разрыв 45 729 150 руб\./u)).toBeTruthy();
  });

  it('раскрытая карточка показывает три числа, адреса и того, кто отстал', () => {
    show({ kind: 'ok', payload: payloadWith([divergedRow]) });
    fireEvent.click(screen.getByText('Начальные цены разошлись'));

    expect(screen.getByText('ЭА54-26')).toBeTruthy();
    expect(screen.getByText('УО · МБОУ ЕСШ № 1')).toBeTruthy();
    // Числа трёх сторон стоят рядом — сравнивать, листая книги, не надо.
    expect(screen.getByText('90 000 000,00')).toBeTruthy();
    expect(screen.getAllByText('44 270 850,00')).toHaveLength(2);
    // Под каждым числом — адрес его строки.
    expect(screen.getByText('УО!1889')).toBeTruthy();
    expect(screen.getByText('8. УО!44')).toBeTruthy();
    expect(screen.getByText('25-26!119')).toBeTruthy();
    // Ответ «кто отстал» — то, ради чего заводилась третья запись.
    expect(screen.getByText(/отстала — книга ГРБС/u)).toBeTruthy();
    expect(screen.getByText(/Что делать:/u)).toBeTruthy();
  });

  it('класс про отсутствие записи показывает сумму закупок, а не разрыв', () => {
    show({ kind: 'ok', payload: payloadWith([absentRow]) });
    // Число названо и в заголовке класса, и в пояснении сводки — но ни разу
    // не как разрыв: эти деньги записаны в одной книге, а не потеряны.
    expect(screen.getAllByText(/начальная цена 4 000 000 руб\./u).length).toBeGreaterThan(0);
    expect(screen.queryByText(/разрыв 4 000 000/u)).toBeNull();

    fireEvent.click(screen.getByText('Нет строки в книгах ГРБС'));
    // Сторона книги ГРБС отсутствует — так и написано, а не прочерком.
    expect(screen.getByText('записи нет')).toBeTruthy();
  });

  it('сводка не выдаёт сумму закупок за потерянные деньги', () => {
    show({ kind: 'ok', payload: payloadWith([divergedRow, absentRow]) });
    expect(screen.getByText('разрыв, руб.')).toBeTruthy();
    expect(screen.getByText(/Это НЕ потерянные деньги/u)).toBeTruthy();
  });
});

describe('изоляция организаций (п.127)', () => {
  it('срез управления, в котором закупок нет, отличается от «расхождений нет»', () => {
    render(
      <TripleCheck
        state={{ kind: 'ok', payload: payloadWith([divergedRow]) }}
        deptScope={new Set(['УЭР'])}
        scopeLabel="лист «УЭР»"
        onReload={() => {}}
      />,
    );
    expect(screen.getByText(/В выбранном срезе закупок нет/u)).toBeTruthy();
    expect(screen.getByText(/лист «УЭР»/u)).toBeTruthy();
    expect(screen.queryByText(/Расхождений нет/u)).toBeNull();
  });
});

describe('номер с опечаткой (сироты сверки)', () => {
  it('догадка показывается, но связью не становится', () => {
    show({
      kind: 'ok',
      payload: payloadWith([divergedRow], {
        orphans: [{
          side: 'book',
          address: 'УО!AG412',
          text: 'ЭA152-26',
          guess: 'ЭА152-26',
          note: 'Латинская «A» вместо русской «А».',
          subjectCandidate: { code: 'ЭА152-26', similarity: 0.82 },
        }],
      }),
    });
    expect(screen.getByText(/Номер процедуры набран с опечаткой/u)).toBeTruthy();
    expect(screen.getByText(/это подсказка, а не связь/u)).toBeTruthy();
    expect(screen.getByText(/совпадение слов\s*82 %/u)).toBeTruthy();
  });
});
