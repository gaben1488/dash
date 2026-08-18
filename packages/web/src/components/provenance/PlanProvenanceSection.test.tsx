// @vitest-environment jsdom
/**
 * Стражи секции «Откуда взялась плановая сумма» в карточке строки.
 *
 * Здесь проверяется не оформление ленты (это делает PlanProvenanceView.test),
 * а три обещания самой секции:
 *   1) природа величины названа СРАЗУ — до всякого запроса: пока не сказано,
 *      что стоит в плановой ячейке — начальная цена контракта или
 *      распределяемый лимит, — история её правок читается наполовину (п.102);
 *   2) журнал книги не читается зря: запрос уходит только при раскрытии;
 *   3) без «№ п/п» секция честно называет причину, а не показывает кнопку,
 *      которая обещала бы невозможное.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanProvenanceSection } from './PlanProvenanceSection';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const empty = {
  dept: 'УДТХ',
  deptLatin: 'udtx',
  deptName: 'Управление дорожного и транспортного хозяйства',
  sheetName: 'ВСЕ',
  rowSeq: 12,
  sheetRow: 15,
  subject: 'Содержание дорог',
  planNow: 500,
  factDate: null,
  method: 'ЭА',
  journalAvailable: true,
  journalRowKeyless: 0,
  events: [],
  summary: {
    retroCutTotal: 0, retroCutCount: 0,
    retroCutAfterFactTotal: null, retroCutAfterFactCount: null,
    clearedTotal: 0, unitFixCount: 0, scaleShiftCount: 0,
    dateInMoneyCount: 0, invalidValueCount: 0, defectMassExcluded: 0,
    firstKnownPlan: null, firstKnownAt: null,
    lastKnownPlan: null, lastKnownAt: null,
    planColumnObserved: null,
    note: 'УДТХ, строка № 12: сводка сервера.',
  },
  observability: {
    journalEntries: 34, coversRow: false, planEntries: 0,
    unparsedRowKeys: 0, unparsedCells: 0, note: 'подпись сервера',
  },
  ambiguity: null,
};

function stubFetch() {
  const spy = vi.fn(() => Promise.resolve(new Response(JSON.stringify(empty), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const flat = (): string => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('PlanProvenanceSection', () => {
  it('называет природу плановой величины книги до всякого запроса', () => {
    const spy = stubFetch();
    render(<PlanProvenanceSection deptId="УДТХ" rowSeq={12} planNow={500} planCell="K15" />);

    // У УДТХ в плановых столбцах лежит лимит, а не начальная цена контракта.
    expect(flat()).toContain('В книге УДТХ плановая сумма — распределяемый лимит');
    expect(flat()).toContain('ячейка K15');
    // Журнал книги не читается, пока секцию не раскрыли.
    expect(spy).not.toHaveBeenCalled();
  });

  it('по раскрытию читает журнал и показывает ленту с плашкой куцего журнала', async () => {
    const spy = stubFetch();
    render(<PlanProvenanceSection deptId="УДТХ" rowSeq={12} planNow={500} planCell="K15" />);

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeNull());

    const body = flat();
    expect(body).toContain('почти не ведётся');
    expect(body).toContain('нет ни одной записи об этой строке');
    expect(body).toContain('Задним числом план не снижали');
  });

  it('без «№ п/п» объясняет причину вместо кнопки', () => {
    const spy = stubFetch();
    render(<PlanProvenanceSection deptId="УДТХ" rowSeq={null} planNow={500} planCell="K15" />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(flat()).toContain('у строки нет «№ п/п» в колонке A');
    expect(spy).not.toHaveBeenCalled();
  });

  it('пустая плановая ячейка не показывается нулём', () => {
    stubFetch();
    render(<PlanProvenanceSection deptId="УДТХ" rowSeq={12} planNow={0} planCell="K15" />);
    expect(flat()).toContain('плана нет');
  });
});

/**
 * Отказы бывают двух разных родов, и путать их нельзя: «такой строки в книге
 * нет» — это находка про расхождение номеров (п.98б), повтор запроса её не
 * вылечит; «источник не прочитан» — временное молчание, повтор осмыслен.
 */
describe('PlanProvenanceSection — рода отказа различимы', () => {
  function stubStatus(status: number, message: string) {
    const spy = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ message, statusCode: status }),
      { status, headers: { 'Content-Type': 'application/json' } },
    )));
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('«номера нет в книге» показывается находкой с подсказкой и без кнопки повтора', async () => {
    stubStatus(404, 'В книге УКСиМП нет закупки с № п/п 155. На строке листа 155 стоит закупка '
      + 'с № п/п 534 («Опрессовка системы»): возможно, нужен именно он.');
    render(<PlanProvenanceSection deptId="УКСиМП" rowSeq={155} planNow={500} planCell="K155" />);

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeNull());

    const body = flat();
    expect(body).toContain('номер строки не найден в книге');
    expect(body).toContain('Опрессовка системы');
    expect(body).toContain('сверить № п/п закупки в книге и в реестре');
    // Повтор здесь ничего не изменит — обещать его было бы неправдой.
    expect(screen.queryByText(/Запросить ещё раз/)).toBeNull();
  });

  it('молчание источника даёт красную плашку с повтором', async () => {
    const spy = stubStatus(503, 'Строки книги УДТХ не прочитаны — обновите данные и повторите.');
    render(<PlanProvenanceSection deptId="УДТХ" rowSeq={12} planNow={500} planCell="K15" />);

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    await waitFor(() => expect(screen.queryByText(/Запросить ещё раз/)).not.toBeNull());
    expect(flat()).toContain('Строки книги УДТХ не прочитаны');

    fireEvent.click(screen.getByText(/Запросить ещё раз/));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
