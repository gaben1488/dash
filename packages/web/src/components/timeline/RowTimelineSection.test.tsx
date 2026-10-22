// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { RowTimelineSection } from './RowTimelineSection';
import { api, type RowTimelineResponse } from '../../api';

vi.mock('../../api', () => ({ api: { getRowTimeline: vi.fn() }, humanizeRequestError: () => 'Повторите чтение' }));
afterEach(() => { cleanup(); vi.mocked(api.getRowTimeline).mockReset(); });
const history = (note: string): RowTimelineResponse => ({
  rowKey: 'УО:178', plannedDate: null, events: [], historySince: null, identityCutAt: null,
  historyNote: note, coverage: { journalAvailable: true, journalEntries: 0, snapshotObservations: 1, weekSliceDates: [] },
});

it('does not display the previous row history after changing the selected address', async () => {
  vi.mocked(api.getRowTimeline).mockResolvedValueOnce(history('История предыдущей строки'))
    .mockResolvedValueOnce(history('История выбранной строки'));
  const view = render(<RowTimelineSection deptId="УО" sheetRow={178} />);
  fireEvent.click(view.getByRole('button', { name: 'Показать историю строки' }));
  await view.findByText('История предыдущей строки');
  view.rerender(<RowTimelineSection deptId="УКСиМП" sheetRow={534} />);
  expect(view.queryByText('История предыдущей строки')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Показать историю строки' }));
  await view.findByText('История выбранной строки');
  expect(api.getRowTimeline).toHaveBeenLastCalledWith('УКСиМП', 534);
});

it('does not attach a late response from a previous address to the new row', async () => {
  let finish!: (value: RowTimelineResponse) => void;
  vi.mocked(api.getRowTimeline).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(history('Новая история'));
  const view = render(<RowTimelineSection deptId="УО" sheetRow={178} />);
  fireEvent.click(view.getByRole('button', { name: 'Показать историю строки' }));
  view.rerender(<RowTimelineSection deptId="УО" sheetRow={179} />);
  await act(async () => { finish(history('Чужой запоздавший ответ')); });
  expect(view.queryByText('Чужой запоздавший ответ')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Показать историю строки' }));
  await view.findByText('Новая история');
});
