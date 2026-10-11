// @vitest-environment jsdom
/**
 * Стражи ПОДРОБНОЙ глубины журнала изменений.
 *
 * Экран обязан:
 *   • вести адрес № п/п, а не позиционным номером строки листа (п.98б);
 *   • говорить, чего источник не видит в принципе (удаление строки), — всегда,
 *     а не только когда пропаж не нашлось;
 *   • различать «правок не было» и «журнал не прочитан»;
 *   • называть отказ сервера словами, а не показывать пустой список;
 *   • уметь провалиться к самой закупке в Реестре, неся книгу и № п/п.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChangeStoryResponse } from '../../lib/changes/change-story-client';
import { ChangeJournal } from './ChangeJournal';

const navigateTo = vi.hoisted(() => vi.fn());
const answer = vi.hoisted(() => ({ current: null as unknown, fail: false }));

vi.mock('../../store', () => ({
  useStore: (selector: (s: { navigateTo: unknown }) => unknown) => selector({ navigateTo }),
}));

vi.mock('../../hooks/useLiveEvents', () => ({
  useLiveEvents: () => ({
    connected: false, lastEventAt: null, books: [], newIssues: 0,
    snapshotRebuilt: false, recentRows: [], hasNews: false, acknowledge: () => {},
  }),
}));

vi.mock('../../lib/changes/change-story-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/changes/change-story-client')>();
  return {
    ...actual,
    fetchChangeStory: vi.fn(async () => {
      if (answer.fail) throw new Error('сервер молчит');
      return answer.current as ChangeStoryResponse;
    }),
  };
});

const story = (over: Partial<ChangeStoryResponse> = {}): ChangeStoryResponse => ({
  since: '2026-08-14',
  digest: {
    books: 1, booksNamed: ['УО'], rows: 2, entries: 2,
    byKind: {
      money: 1, dates: 0, comment: 0, method: 0, subject: 0, flag: 0,
      'row-added': 0, 'row-vanished': 1, 'row-identity-candidate': 0, 'row-cleared': 0, other: 0,
    },
    authors: ['ivanova@aemr.ru'],
    firstAt: '2026-08-20T09:00:00', lastAt: '2026-08-20T09:00:00',
    emptiness: 'none',
  },
  gaps: [],
  deletionsUnobservable: true,
  note: '',
  comparison: {
    baselineId: 'test-weekly-control',
    beforeAt: '2026-08-14T00:00:00Z',
    afterAt: '2026-08-21T00:00:00Z',
    oldestCurrentAt: '2026-08-21T00:00:00Z',
  },
  facets: { books: [{ book: 'УО', count: 2 }], authors: [{ author: 'ivanova@aemr.ru', count: 1 }] },
  total: 2,
  shown: 2,
  entries: [
    {
      id: 'a', book: 'УО', sheet: 'ВСЕ', rowSeq: '38', sheetRow: 177,
      column: 'K', columnLabel: 'ИТОГО 1', kind: 'money',
      before: '100', after: '120', author: 'ivanova@aemr.ru',
      at: '2026-08-20T09:00:00', atMs: Date.parse('2026-08-20T09:00:00Z'),
      subject: 'Услуги почтовой связи', subordinate: null, origin: 'book-journal',
    },
    {
      id: 'b', book: 'УО', sheet: 'ВСЕ', rowSeq: '212', sheetRow: 240,
      column: null, columnLabel: null, kind: 'row-vanished',
      before: 'Ремонт кровли', after: '', author: null,
      at: null, atMs: null,
      subject: 'Ремонт кровли', subordinate: 'МБОУ школа № 3', origin: 'snapshot-diff',
    },
  ],
  ...over,
});

afterEach(() => {
  cleanup();
  navigateTo.mockClear();
  answer.fail = false;
});

describe('ChangeJournal — подробная глубина', () => {
  it('свёрнутый журнал не рисуется вовсе и книг не читает', () => {
    answer.current = story();
    const { container } = render(<ChangeJournal open={false} onClose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('адрес правки ведёт № п/п, а колонка названа человеческим именем', async () => {
    answer.current = story();
    render(<ChangeJournal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/№ п\/п 38/)).toBeTruthy());
    expect(screen.getByText(/ИТОГО 1/)).toBeTruthy();
    expect(screen.getByText('100 → 120')).toBeTruthy();
  });

  it('отсутствие прежнего номера описано без выдуманного доказательства удаления', async () => {
    answer.current = story();
    render(<ChangeJournal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Прежний № не найден: Ремонт кровли; причина не установлена/)).toBeTruthy());
    expect(screen.getByText(/из сверки текущих книг с недельным контролем/)).toBeTruthy();
  });

  it('граница источника произносится всегда: удаление строки журнал не видит', async () => {
    answer.current = story();
    render(<ChangeJournal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Удаление строки книга не записывает/)).toBeTruthy());
  });

  it('прежний номер ищет похожие закупки, действующий номер открывает точный поиск', async () => {
    answer.current = story();
    const onClose = vi.fn();
    render(<ChangeJournal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('поиск в Реестре')).toBeTruthy());
    fireEvent.click(screen.getByText('поиск в Реестре'));
    expect(navigateTo).toHaveBeenCalledWith('data', { department: 'УО', search: 'Ремонт кровли' });
    fireEvent.click(screen.getByText('в Реестре'));
    expect(navigateTo).toHaveBeenCalledWith('data', { department: 'УО', search: '38' });
    expect(onClose).toHaveBeenCalled();
  });

  it('«правок не было» и «журнал не прочитан» — разные сообщения', async () => {
    answer.current = story({
      entries: [], total: 0, shown: 0,
      digest: { ...story().digest, entries: 0, rows: 0, books: 0, booksNamed: [], authors: [], firstAt: null, lastAt: null, emptiness: 'unknown' },
      gaps: [{ book: 'УО', reason: 'journal-unread', detail: 'Журнал правок книги «УО» не прочитан.' }],
      facets: { books: [], authors: [] },
    });
    render(<ChangeJournal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/О правках ничего не известно/)).toBeTruthy());
    expect(screen.getByText(/не «правок не было»/)).toBeTruthy();
    expect(screen.getByText(/Журнал правок книги «УО» не прочитан/)).toBeTruthy();
  });

  it('отказ сервера назван словами, а не показан пустым списком', async () => {
    answer.fail = true;
    render(<ChangeJournal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/не прочитан — сервер не ответил/)).toBeTruthy());
  });

  it('закрывается по Escape', async () => {
    answer.current = story();
    const onClose = vi.fn();
    render(<ChangeJournal open onClose={onClose} />);
    await waitFor(() => expect(screen.getByText(/№ п\/п 38/)).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('в шапке стоит краткая глубина — те же фразы, что в узле провенанса', async () => {
    answer.current = story();
    render(<ChangeJournal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('2 правки в книге УО, затронуто 2 закупки')).toBeTruthy());
    expect(screen.getByText(/прежних номеров не найдено — 1/)).toBeTruthy();
  });
});
describe('гипотеза смены номера', () => {
  it('ведёт в Реестр на текущий номер кандидата, сохраняя исходный номер в записи', async () => {
    answer.current = story({
      entries: [{
        ...story().entries[1],
        id: 'hypothesis',
        kind: 'row-identity-candidate',
        rowSeq: '212',
        relatedRowSeq: '305',
        before: '212',
        after: '305',
      }],
      total: 1,
      shown: 1,
    });
    render(<ChangeJournal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Возможная смена № 212 → № 305/)).toBeTruthy());
    fireEvent.click(screen.getByText('в Реестре'));
    expect(navigateTo).toHaveBeenCalledWith('data', { department: 'УО', search: '305' });
  });
});

