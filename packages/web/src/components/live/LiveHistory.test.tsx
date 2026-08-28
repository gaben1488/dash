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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiveHistory } from './LiveHistory';
import { api } from '../../api';
import { ingestLiveEvent, resetLiveEvents } from '../../hooks/useLiveEvents';

vi.mock('../../api', () => ({
  api: { getChanges: vi.fn() },
}));

const getChangesMock = vi.mocked(api.getChanges);

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
  // Поток эфира в страже не нужен: соединение висит вечно и молчит.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  getChangesMock.mockReset();
  getChangesMock.mockResolvedValue({ records: [journalRecord] } as any);
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
    expect(getChangesMock).toHaveBeenCalledTimes(1);
    // Содержимое журнала действительно показано, а не только подпись
    // (автор печатается только в раскрытой панели, в барабане его нет).
    expect(screen.getByText('И. Иванов')).toBeTruthy();
  });

  it('повторное раскрытие перечитывает журнал заново, а не показывает утренний список', async () => {
    render(<LiveHistory />);
    const drum = screen.getByRole('button', { name: /Эфир/ });

    fireEvent.click(drum);
    await waitFor(() => expect(getChangesMock).toHaveBeenCalledTimes(1));

    // Закрыли (Escape), эфир прожил ещё сколько-то — раскрыли снова.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(drum);
    await waitFor(() => expect(getChangesMock).toHaveBeenCalledTimes(2));
  });

  it('сбой чтения назван словами, а не выдан за «правок не было»', async () => {
    getChangesMock.mockRejectedValue(new Error('нет связи'));
    render(<LiveHistory />);
    fireEvent.click(screen.getByRole('button', { name: /Эфир/ }));
    await screen.findByText(/Журнал правок не прочитан/);
    expect(screen.getByText(/не «правок не было»/)).toBeTruthy();
  });
});
