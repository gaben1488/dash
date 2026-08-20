// @vitest-environment jsdom
/**
 * Стражи полосы живого оповещения.
 *
 * Полоса — единственное место, где продукт сам заговаривает с читателем не по
 * его запросу. Поэтому у неё жёсткие обязанности: молчать, когда новостей нет;
 * называть механизм («книга УО обновилась: 3 строки»), а не тревожить; обновлять
 * данные мягко, без перезагрузки страницы; уметь закрыться, ничего не обновив.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiveUpdateBar } from './LiveUpdateBar';
import { countWord, liveDetail, liveHeadline, plural, relativeMoment, rowChangeHint, changedRowKeys } from './live-text';
import { closeLiveEvents, reduceLive, resetLiveEvents, type LiveState } from '../../hooks/useLiveEvents';

/** Подмена состояния эфира: компонент читает его через хук. */
const liveState = vi.hoisted(() => ({ current: null as unknown }));
const acknowledge = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useLiveEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useLiveEvents')>();
  return {
    ...actual,
    useLiveEvents: () => liveState.current,
  };
});

const quickRefresh = vi.fn(async () => {});
vi.mock('../../store', () => ({
  useStore: Object.assign(
    (selector: (s: { loading: boolean }) => unknown) => selector({ loading: false }),
    { getState: () => ({ quickRefresh }) },
  ),
}));

const EMPTY: LiveState = {
  connected: true,
  lastEventAt: null,
  books: [],
  newIssues: 0,
  snapshotRebuilt: false,
  recentRows: [],
};

function setLive(state: LiveState) {
  liveState.current = {
    ...state,
    hasNews: state.books.length > 0 || state.newIssues > 0 || state.snapshotRebuilt,
    acknowledge,
  };
}

afterEach(() => {
  cleanup();
  resetLiveEvents();
  closeLiveEvents();
  quickRefresh.mockClear();
  acknowledge.mockClear();
});

describe('полоса живого оповещения', () => {
  it('новостей нет — полосы нет: тишина, а не «всё по-прежнему»', () => {
    setLive(EMPTY);
    const { container } = render(<LiveUpdateBar />);
    expect(container.innerHTML).toBe('');
  });

  it('называет книгу и что в ней изменилось, по-русски и без тревоги', () => {
    setLive(reduceLive(EMPTY, {
      kind: 'book-updated', book: 'УО', changedRows: 3, addedRows: 0, removedRows: 0,
      rowsTotal: 512, origin: 'webhook', at: new Date().toISOString(),
    }));
    render(<LiveUpdateBar />);

    expect(screen.getByText('Книга УО обновилась')).toBeTruthy();
    expect(screen.getByText(/3 строки/)).toBeTruthy();
    expect(screen.getByText(/изменение замечено сразу/)).toBeTruthy();
  });

  it('замечания названы вместе со строками', () => {
    const withBook = reduceLive(EMPTY, {
      kind: 'book-updated', book: 'УО', changedRows: 1, addedRows: 0, removedRows: 0,
      rowsTotal: 512, origin: 'cycle', at: new Date().toISOString(),
    });
    setLive(reduceLive(withBook, { kind: 'issues-appeared', added: 1, total: 215, at: new Date().toISOString() }));
    render(<LiveUpdateBar />);

    expect(screen.getByText(/1 строка, новых замечаний 1/)).toBeTruthy();
  });

  it('кнопка обновляет данные мягко: перечитка снимка, страница на месте', async () => {
    setLive(reduceLive(EMPTY, {
      kind: 'book-updated', book: 'УО', changedRows: 2, addedRows: 0, removedRows: 0,
      rowsTotal: 512, origin: 'webhook', at: new Date().toISOString(),
    }));
    render(<LiveUpdateBar />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Обновить/ })); });

    await waitFor(() => expect(quickRefresh).toHaveBeenCalledTimes(1));
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it('полосу можно закрыть, ничего не обновляя, — это законный выбор', async () => {
    setLive(reduceLive(EMPTY, {
      kind: 'book-updated', book: 'УО', changedRows: 2, addedRows: 0, removedRows: 0,
      rowsTotal: 512, origin: 'webhook', at: '2026-08-18T04:00:00.000Z',
    }));
    const { container } = render(<LiveUpdateBar />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Скрыть оповещение/ })); });

    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeNull());
    expect(quickRefresh).not.toHaveBeenCalled();
  });

  it('оповещение объявлено вежливо: role=status и aria-live=polite, не alert', () => {
    setLive(reduceLive(EMPTY, {
      kind: 'book-updated', book: 'УО', changedRows: 1, addedRows: 0, removedRows: 0,
      rowsTotal: 512, origin: 'webhook', at: new Date().toISOString(),
    }));
    render(<LiveUpdateBar />);

    const bar = screen.getByRole('status');
    expect(bar.getAttribute('aria-live')).toBe('polite');
  });
});

describe('фразы прямого эфира', () => {
  it('числительные согласованы: 1 строка, 3 строки, 11 строк', () => {
    expect(countWord(1, 'строка', 'строки', 'строк')).toBe('1 строка');
    expect(countWord(3, 'строка', 'строки', 'строк')).toBe('3 строки');
    expect(countWord(11, 'строка', 'строки', 'строк')).toBe('11 строк');
    expect(countWord(22, 'строка', 'строки', 'строк')).toBe('22 строки');
    expect(plural(0, 'строка', 'строки', 'строк')).toBe('строк');
  });

  it('давность называется словами и грубой шкалой', () => {
    const now = Date.parse('2026-08-18T04:00:00.000Z');
    expect(relativeMoment('2026-08-18T03:59:50.000Z', now)).toBe('только что');
    expect(relativeMoment('2026-08-18T03:55:00.000Z', now)).toBe('5 минут назад');
    expect(relativeMoment('2026-08-18T02:00:00.000Z', now)).toBe('2 часа назад');
    expect(relativeMoment(null, now)).toBe('пока не обновлялось');
  });

  it('несколько книг названы счётом, а не перечислением на пол-экрана', () => {
    const books = ['УО', 'УКСиМП', 'УД'].map((book) => ({
      book, changedRows: 1, addedRows: 0, removedRows: 0, rowsTotal: 10,
      origin: 'cycle' as const, at: '2026-08-18T04:00:00.000Z',
    }));
    expect(liveHeadline(books)).toBe('Обновились 3 книги');
    expect(liveDetail(books, 0)).toBe('3 строки');
  });

  it('пустое не проговаривается: «изменилось 0 строк» сообщением не является', () => {
    expect(liveDetail([], 0)).toBe('');
  });

  it('подпись к строке называет колонку по шапке и автора, если он известен', () => {
    const row = {
      book: 'УО', sheetRow: 158, column: 'L', columnLabel: 'Способ определения поставщика',
      before: 'ЕП', after: 'ЭА', author: 'ivanova@example.ru', at: '2026-08-18T04:00:00.000Z',
    };
    expect(rowChangeHint(row)).toBe('«Способ определения поставщика»: было ЕП → стало ЭА, правил ivanova@example.ru');
  });

  it('автор неизвестен — никого не назначаем', () => {
    const row = { book: 'УО', sheetRow: 158, column: 'L', before: '', after: 'ЭА', at: '2026-08-18T04:00:00.000Z' };
    expect(rowChangeHint(row)).toBe('колонка L: было пусто → стало ЭА');
  });

  it('ключи подсветки собираются по книге и строке листа', () => {
    const keys = changedRowKeys([
      { book: 'УО', sheetRow: 158, column: 'L', before: '', after: 'ЭА', at: '2026-08-18T04:00:00.000Z' },
    ]);
    expect(keys.has('УО#158')).toBe(true);
    expect(keys.has('УО#159')).toBe(false);
  });
});
