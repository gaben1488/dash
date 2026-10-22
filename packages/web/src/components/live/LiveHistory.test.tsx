// @vitest-environment jsdom
/**
 * Страж свежести журнала угла (канон пульс-2, п.11 второго круга).
 *
 * Класс: журнал читался ОДИН раз на вкладку — вкладка живёт часами, эфир
 * приносит правки, а раскрытый журнал показывал утро. Правило: журнал
 * перечитывается при КАЖДОМ раскрытии (запрос — только по жесту читателя),
 * и момент чтения назван подписью «журнал на чч:мм», а не угадывается.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiveHistory } from './LiveHistory';
import { fetchChangeStory, type ChangeStoryResponse } from '../../lib/changes/change-story-client';
import { useStore } from '../../store';
import { acknowledgeLiveEvents, ingestLiveEvent, resetLiveEvents } from '../../hooks/useLiveEvents';

vi.mock('../../lib/changes/change-story-client', () => ({ fetchChangeStory: vi.fn() }));

const getChangesMock = vi.mocked(fetchChangeStory);

const journalRecord = {
  dept: 'УО',
  sheet: 'УО',
  cell: 'N5',
  attribute: 'plan_date',
  oldValue: '01.09.2026',
  newValue: '15.09.2026',
  atMs: Date.now(),
  author: 'И. Иванов',
};

beforeEach(() => {
  resetLiveEvents();
  useStore.setState({ lastRefreshed: null });
  // Поток эфира в страже не нужен: соединение висит вечно и молчит.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  getChangesMock.mockReset();
  getChangesMock.mockResolvedValue({ since: '2026-10-08', total: 125, entries: [{ id: 'one', book: 'УО', sheet: 'УО', rowSeq: '5', sheetRow: 5, column: 'N', columnLabel: 'Плановая дата', kind: 'date', before: journalRecord.oldValue, after: journalRecord.newValue, author: journalRecord.author, at: '2026-10-10T09:00:00', atMs: journalRecord.atMs, origin: 'book-journal' }], gaps: [] } as unknown as ChangeStoryResponse);
  // Без единой правки с открытия вкладки угол молчит целиком — кормим эфир.
  ingestLiveEvent({
    kind: 'row-changed',
    book: 'УО',
    sheetRow: 5,
    column: 'N',
    before: '01.09.2026',
    after: '15.09.2026',
    at: new Date().toISOString(),
  });
});

afterEach(() => {
  cleanup();
  resetLiveEvents();
  vi.unstubAllGlobals();
});

describe('журнал угла — перечитывание при каждом раскрытии', () => {
  it('раскрытие читает журнал и подписывает момент чтения «журнал на чч:мм»', async () => {
    render(<LiveHistory />);
    fireEvent.click(screen.getByRole('button', { name: /Эфир/ }));
    await screen.findByText(/журнал на \d{2}:\d{2}/);
    expect(getChangesMock).toHaveBeenCalledTimes(2);
    // Содержимое журнала действительно показано, а не только подпись
    // (автор печатается только в раскрытой панели, в барабане его нет).
    expect(screen.getByText(/И. Иванов/)).toBeTruthy();
  });

  it('повторное раскрытие перечитывает журнал заново, а не показывает утренний список', async () => {
    render(<LiveHistory />);
    const drum = screen.getByRole('button', { name: /Эфир/ });

    fireEvent.click(drum);
    await waitFor(() => expect(getChangesMock).toHaveBeenCalledTimes(2));

    // Закрыли (Escape), эфир прожил ещё сколько-то — раскрыли снова.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(drum);
    await waitFor(() => expect(getChangesMock).toHaveBeenCalledTimes(3));
  });

  it('сбой чтения назван словами, а не выдан за «правок не было»', async () => {
    getChangesMock.mockRejectedValue(new Error('нет связи'));
    render(<LiveHistory />);
    fireEvent.click(screen.getByRole('button', { name: /Эфир/ }));
    await screen.findByText(/Журнал правок не прочитан/);
    expect(screen.getByText(/не «правок не было»/)).toBeTruthy();
  });
});


describe('итог с контрольного среза', () => {
  it('показывает серверный накопленный итог до первого события SSE', async () => {
    resetLiveEvents();
    render(<LiveHistory />);
    await screen.findByText('125');
    expect(screen.getByText(/записей журнала с контрольного среза/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Эфир/ })).toBeTruthy();
    expect(screen.getByText(/2026-10-08/)).toBeTruthy();
    expect(document.querySelector('.lh-row')).toBeTruthy();
    acknowledgeLiveEvents();
    expect(screen.getByText('125')).toBeTruthy();
    expect(getChangesMock).toHaveBeenCalledWith({ limit: 30 });
  });
  it('перечитывает после принятого чтения, но не по каждой правке SSE', async () => {
    render(<LiveHistory />);
    await screen.findByText('125');
    useStore.setState({ lastRefreshed: '2026-10-12T01:00:00Z' });
    await waitFor(() => expect(getChangesMock).toHaveBeenCalledTimes(2));
    ingestLiveEvent({kind:'row-changed',book:'УО',sheetRow:6,column:'N',before:'1',after:'2',at:new Date().toISOString()});
    expect(getChangesMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('125')).toBeTruthy();
  });
  it('пробелы источников не выдаются за достоверный ноль', async () => {
    resetLiveEvents();
    getChangesMock.mockResolvedValue({ since:'2026-10-08',total:0,entries:[],gaps:[{book:'УО',reason:'journal-unread',detail:'журнал недоступен'}] } as unknown as ChangeStoryResponse);
    render(<LiveHistory />);
    await screen.findByText(/Сведения неполны/);
    expect(screen.queryByText('0')).toBeNull();
  });
});


it.each([403, 503])('HTTP %s не становится нулём журнала', async (status) => {
  resetLiveEvents();
  getChangesMock.mockRejectedValue(new Error(String(status)));
  render(<LiveHistory />);
  await screen.findByText('Журнал не прочитан');
  expect(screen.queryByText('0')).toBeNull();
});
it('поздний ответ старого чтения не перезаписывает принятый новый ответ', async () => {
  let resolveOld!: (value: ChangeStoryResponse) => void;
  getChangesMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  render(<LiveHistory />);
  fireEvent.click(screen.getByRole('button', { name: /Эфир/ }));
  await screen.findByText('125');
  await act(async () => {
    resolveOld({ since:'2020-01-01',total:999,entries:[],gaps:[] } as unknown as ChangeStoryResponse);
  });
  expect(screen.queryByText('999')).toBeNull();
  expect(screen.getByText('125')).toBeTruthy();
});
