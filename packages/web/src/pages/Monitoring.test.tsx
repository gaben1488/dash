// @vitest-environment jsdom
/**
 * Стражи вкладки «Мониторинг · Реестр процедур определения поставщика»
 * (канон п.101а, спека 2026-08-18-monitoring-tab-spec-v2).
 *
 * Проверяются ОБЕЩАНИЯ экрана, а не его оформление:
 *   1) перенесена форма книги: название п.101а, надшапка «Экономия, руб.» над
 *      МБ/КБ/ФБ, деньги подписаны рублями (книги управлений — тысячи);
 *   2) режимы листов открываются все, включая те, чьих разделов сервер ещё не
 *      отдаёт: такая кнопка ведёт к пустоте с причиной, а не исчезает;
 *   3) разрезы и поиск действительно режут, а когда срезали всё — экран
 *      говорит «это отбор экрана», а не «в книге пусто»;
 *   4) три пустоты различаются словами: отказ чтения ≠ пустая книга ≠ отбор;
 *   5) строка раскрывается в карточку с путём, деньгами и победителем;
 *   6) ответ читается в той форме, в какой его отдаёт ядро: дата парой
 *      {raw, iso}, победитель разобранной ячейкой.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const fetchJSON = vi.fn();

vi.mock('../api', () => ({
  fetchJSON: (url: string) => fetchJSON(url),
  api: {},
  humanizeRequestError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { TooltipProvider } from '../components/ui/tooltip';
import { useStore } from '../store';
import { MonitoringPage } from './Monitoring';

// jsdom не реализует ResizeObserver, а Radix меряет им поповер подсказки БЗ.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  fetchJSON.mockReset();
  // Фильтр шапки живёт в общем хранилище: не сбросить — соседний тест
  // получит чужой срез управления и упадёт на пустом реестре.
  useStore.setState({ selectedDepartments: new Set<string>() });
  try {
    window.localStorage.clear();
  } catch {
    /* хранилища нет — сбрасывать нечего */
  }
});

/** Дата в той форме, в какой её отдаёт ядро: написание книги плюс разбор. */
const date = (raw: string, iso: string | null) => ({ raw, iso });

/** Строка ответа в форме ядра: победитель — разобранная ячейка, не строка. */
function proc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sheet: '1. УЭР', row: 3, ordinal: 2, dept: 'УЭР', customer: 'МКУ ЦЭР',
    code: 'ЭЗК426-25', method: 'ЭЗК', year: 2025, subject: 'Поставка шатров',
    nmck: 446_700,
    applicationDate: date('22.12.2025', '2025-12-22'),
    publicationDate: date('24.12.2025', '2025-12-24'),
    deadlineDate: date('13.01.2026', '2026-01-13'),
    auctionDate: date('15.01.2026', '2026-01-15'),
    auctionPrice: 413_364,
    savingsTotal: 33_336, savingsMb: 33_336, savingsKb: null, savingsFb: null,
    savingsSplitSum: 33_336, selfCheck: 'верно', controlAgrees: true, controlGapRub: 0,
    winner: {
      raw: 'ИП Дойняк-Новый\nИНН 5040123456',
      name: 'ИП Дойняк-Новый', inn: '5040123456',
      outcome: 'supplier', outcomeText: null, innRepeated: false,
    },
    comment: null, stage: 'awarded', reductionRub: 33_336, reductionPct: 7.46,
    joint: false,
    durations: { toPublication: 2, toDeadline: 20, toAuction: 2, total: 24 },
    defects: [],
    ...over,
  };
}

const SECOND = proc({
  sheet: '8. УО', row: 7, ordinal: 1, dept: 'УО', customer: 'МБОУ ЕСШ №1',
  code: 'ЭА11-26', method: 'ЭА', year: 2026, subject: 'Ремонт кровли',
  nmck: 2_250_000, auctionPrice: null, auctionDate: null, stage: 'published',
  reductionRub: null, reductionPct: null, savingsTotal: null, savingsMb: null,
  savingsSplitSum: null, selfCheck: null, controlAgrees: null, controlGapRub: null,
  winner: { raw: '', name: null, inn: null, outcome: 'empty', outcomeText: null, innRepeated: false },
  durations: { toPublication: 2, toDeadline: 20, toAuction: null, total: null },
  defects: [
    { kind: 'missing-stage', address: '8. УО!H7', note: 'Даты торгов в строке нет: этап пути не измеряется.' },
  ],
});

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: {
      bookName: 'Ежедневный мониторинг',
      readAt: '2026-08-18T02:00:00.000Z',
      moneyUnit: 'руб',
      sheetsRead: ['1. УЭР', '8. УО'],
      sheetsFailed: {},
    },
    procedures: [proc(), SECOND],
    aggregates: null,
    unparsedCodes: [],
    notes: ['Деньги книги мониторинга — в рублях (книги управлений ведутся в тысячах рублей).'],
    ...over,
  };
}

/** Ответы сервера: реестр отдаётся, сверка ещё не поднята (роут отвечает 404). */
function serve(registry: unknown): void {
  fetchJSON.mockImplementation((url: string) => (url.startsWith('/monitoring/match')
    ? Promise.reject(new Error('Not Found'))
    : Promise.resolve(registry)));
}

function renderPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <MonitoringPage />
    </TooltipProvider>,
  );
}

describe('Мониторинг: форма книги перенесена', () => {
  it('называется по канону, подписывает рубли и показывает момент чтения книги', async () => {
    serve(payload());
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Мониторинг · Реестр процедур определения поставщика' }),
    ).toBeTruthy();
    // Единица денег — не мелочь: книги управлений ведутся в тысячах, и
    // подпись стоит и в шапке, и в оговорках сервера под таблицей.
    expect(screen.getAllByText(/в рублях/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/данные книги на/u).length).toBeGreaterThan(0);
  });

  it('держит надшапку «Экономия, руб.» над МБ/КБ/ФБ — они доли экономии, а не НМЦК', async () => {
    serve(payload());
    renderPage();

    const registry = await screen.findByRole('region', { name: 'Реестр процедур' });
    // Гармошка бюджетов (п.128) входит свёрнутой: сначала «по бюджетам»,
    // и только потом надшапка обязана накрывать пять колонок.
    fireEvent.click(within(registry).getByRole('button', { name: 'по бюджетам' }));
    const group = within(registry).getByText('Экономия, руб.').closest('th');
    expect(group?.getAttribute('colspan')).toBe('5');
    for (const sub of ['ВСЕГО', 'проверка', 'МБ', 'КБ', 'ФБ']) {
      expect(within(registry).getByText(sub)).toBeTruthy();
    }
  });

  it('свёрнутая гармошка бюджетов держит два столбца и прячет МБ/КБ/ФБ', async () => {
    serve(payload());
    renderPage();

    const registry = await screen.findByRole('region', { name: 'Реестр процедур' });
    const group = within(registry).getByText('Экономия, руб.').closest('th');
    expect(group?.getAttribute('colspan')).toBe('2');
    expect(within(registry).queryByText('МБ')).toBeNull();
  });

  it('показывает строки книги с кодом, НМЦК и стадией', async () => {
    serve(payload());
    renderPage();

    const registry = await screen.findByRole('region', { name: 'Реестр процедур' });
    // Строка живёт дважды: таблицей на широком экране и карточкой на узком.
    expect(within(registry).getAllByText('ЭЗК426-25').length).toBeGreaterThan(0);
    expect(within(registry).getAllByText('ЭА11-26').length).toBeGreaterThan(0);
    expect(within(registry).getAllByText('446 700').length).toBeGreaterThan(0);
  });

  it('раскрывает строку в карточку с путём, деньгами и победителем', async () => {
    serve(payload());
    renderPage();

    const registry = await screen.findByRole('region', { name: 'Реестр процедур' });
    fireEvent.click(within(registry).getAllByText('ЭЗК426-25')[0]);

    await waitFor(() => expect(screen.getAllByText('Путь процедуры').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Деньги, руб.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ИП Дойняк-Новый').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ИНН 5040123456/u).length).toBeGreaterThan(0);
    // Дата пришла парой {raw, iso} — на экран уходит письмо книги.
    expect(screen.getAllByText('24.12.2025').length).toBeGreaterThan(0);
  });
});

describe('Мониторинг: разрезы и поиск', () => {
  it('поиск оставляет совпавшие строки и говорит, сколько показано', async () => {
    serve(payload());
    renderPage();

    const search = await screen.findByLabelText('Поиск по реестру');
    fireEvent.change(search, { target: { value: 'кровли' } });

    await waitFor(() => {
      const registry = screen.getByRole('region', { name: 'Реестр процедур' });
      expect(within(registry).queryAllByText('ЭЗК426-25')).toHaveLength(0);
      expect(within(registry).getAllByText('ЭА11-26').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/показано 1 из 2/u)).toBeTruthy();
  });

  it('разрез по стадии режет реестр, а сняв все разрезы — возвращает строки', async () => {
    serve(payload());
    renderPage();

    const stage = await screen.findByLabelText('Стадия');
    fireEvent.change(stage, { target: { value: 'awarded' } });

    await waitFor(() => {
      const registry = screen.getByRole('region', { name: 'Реестр процедур' });
      expect(within(registry).queryAllByText('ЭА11-26')).toHaveLength(0);
    });

    fireEvent.click(screen.getByText('снять все'));
    await waitFor(() => {
      const registry = screen.getByRole('region', { name: 'Реестр процедур' });
      expect(within(registry).getAllByText('ЭА11-26').length).toBeGreaterThan(0);
    });
  });

  it('когда разрезы срезали всё, говорит про отбор экрана, а не про пустую книгу', async () => {
    serve(payload());
    renderPage();

    const search = await screen.findByLabelText('Поиск по реестру');
    fireEvent.change(search, { target: { value: 'такой строки в книге нет' } });

    expect(await screen.findByText('Под выбранные разрезы не попала ни одна процедура')).toBeTruthy();
    expect(screen.getByText(/отбор экрана, а не пустота книги/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Снять все разрезы' })).toBeTruthy();
  });
});

describe('Мониторинг: режимы листов', () => {
  it('оставляет в ряду лист, которого сервер ещё не отдаёт, и объясняет пустоту', async () => {
    serve(payload());
    renderPage();

    const tabs = await screen.findByRole('navigation', { name: /Листы книги/u });
    fireEvent.click(within(tabs).getByRole('button', { name: /Сводный/u }));

    expect(await screen.findByText('Лист «СВОДНЫЙ» сервер пока не отдаёт')).toBeTruthy();
    expect(screen.getByText(/незаконченная труба чтения, а не пустой лист/u)).toBeTruthy();
  });

  it('в ряду листов больше нет второй линейки управлений', async () => {
    serve(payload());
    renderPage();

    const tabs = await screen.findByRole('navigation', { name: /Листы книги/u });
    expect(within(tabs).queryByRole('button', { name: /8\. УО/u })).toBeNull();
  });

  it('выбранное в шапке управление сужает реестр до своих строк', async () => {
    // Отдельной кнопки листа управления в ряду больше нет (п.128-1):
    // срез даёт глобальный фильтр шапки — изоляция п.127.
    useStore.setState({ selectedDepartments: new Set(['УО']) });
    serve(payload());
    renderPage();

    await waitFor(() => {
      const registry = screen.getByRole('region', { name: 'Реестр процедур' });
      expect(within(registry).queryAllByText('ЭЗК426-25')).toHaveLength(0);
      expect(within(registry).getAllByText('ЭА11-26').length).toBeGreaterThan(0);
    });
  });

  it('режим листов-предков показывает поля, которых форме не хватает', async () => {
    serve(payload());
    renderPage();

    const tabs = await screen.findByRole('navigation', { name: /Листы книги/u });
    fireEvent.click(within(tabs).getByRole('button', { name: /Листы-предки/u }));

    expect(await screen.findByText(/Чего рабочей форме не хватает/u)).toBeTruthy();
    expect(screen.getAllByText('Кол-во заявок от поставщиков').length).toBeGreaterThan(0);
  });

  it('показывает свод книги рядом с расчётом продукта, когда лист пришёл', async () => {
    serve(payload({
      svod: {
        rows: [{
          dept: 'УДТХ', sheet: '5. УДТХиРКИ', bookLabel: 'УДТХиРКИ АЕМР',
          book: { count: 40, nmck: 229_452_023.5, price: null, savingsTotal: 1, mb: 1, kb: 0, fb: 0 },
          product: { count: 41, nmck: 303_422_920.85, price: null, savingsTotal: 1, mb: 1, kb: 0, fb: 0 },
          budgetGap: 0,
          divergenceNote: 'Сумма процедуры ЭА291-26 записана в книге текстом, и формула СУММ её не видит.',
        }],
        total: {
          dept: '', sheet: '', bookLabel: 'Итого',
          book: { count: 40, nmck: 229_452_023.5, price: null, savingsTotal: 1, mb: 1, kb: 0, fb: 0 },
          product: { count: 41, nmck: 303_422_920.85, price: null, savingsTotal: 1, mb: 1, kb: 0, fb: 0 },
          budgetGap: 9_001_582.73, divergenceNote: null,
        },
        notes: [],
      },
    }));
    renderPage();

    const tabs = await screen.findByRole('navigation', { name: /Листы книги/u });
    fireEvent.click(within(tabs).getByRole('button', { name: /Сводный/u }));

    const svod = await screen.findByRole('region', { name: 'Свод книги' });
    // Оба числа стоят рядом: книжное и продуктовое — вместе с причиной разницы.
    // Числа стоят и в строке управления, и в итоге — важно, что оба вида
    // числа (книжное и продуктовое) показаны, а не одно вместо другого.
    expect(within(svod).getAllByText('229 452 024').length).toBeGreaterThan(0);
    expect(within(svod).getAllByText('303 422 921').length).toBeGreaterThan(0);
    expect(within(svod).getByText(/формула СУММ её не видит/u)).toBeTruthy();
    // Контроль, которого своду книги не хватает.
    expect(within(svod).getByText('9 001 583')).toBeTruthy();
  });
});

describe('Мониторинг: три разные пустоты', () => {
  it('отказ чтения объявляется отказом, а не пустой книгой', async () => {
    fetchJSON.mockRejectedValue(new Error('Книга недоступна'));
    renderPage();

    expect(await screen.findByText('Книга «Ежедневный мониторинг» не прочитана')).toBeTruthy();
    expect(screen.getByText(/отказ чтения, а не «в книге пусто»/u)).toBeTruthy();
  });

  it('прочитанная, но пустая книга объявляется пустой книгой', async () => {
    serve(payload({ procedures: [] }));
    renderPage();

    expect(
      await screen.findByText('На прочитанных листах книги нет ни одной строки процедуры'),
    ).toBeTruthy();
    expect(screen.getByText(/пустота самой книги, а не отказ чтения/u)).toBeTruthy();
  });
});
