// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IssuesPage } from './Issues';
import { api } from '../api';
const fixture = vi.hoisted(() => ({
  issue: { id: 'case-1', severity: 'significant', title: 'Проверка антидемпинга', description: 'Исходная строка', departmentId: 'УКСиМП', signal: 'highEconomy', checkId: 'high_economy', status: 'open', detectedAt: '2026-10-12T00:00:00Z' },
  reload: vi.fn(async () => true), error: null as string | null,
}));
vi.mock('../store', () => {
  const state = () => ({ dashboardData: { lastRefreshed: "2026-10-12" }, navigateTo: vi.fn(), searchQuery: '', issuesSectionSeed: null, trustComponentSeed: null, fetchDashboard: fixture.reload, error: fixture.error });
  return { useStore: Object.assign(state, { getState: state }) };
});
vi.mock('../hooks/useFilteredData', () => ({ useFilteredData: () => ({ issues: [fixture.issue] }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { fixture.reload.mockClear(); fixture.error = null; fixture.issue.status = 'open'; });
async function openCase() {
  const rendered = render(<IssuesPage />);
  fireEvent.click(rendered.container.querySelector('button[aria-expanded]')!);
  fireEvent.click(screen.getByRole('button', { name: /Проверка антидемпинга/ }));
  return rendered;
}
async function save() {
  const rendered = render(<IssuesPage />);
  const { container } = rendered;
  fireEvent.click(container.querySelector('button[aria-expanded]')!);
  fireEvent.click(screen.getByRole('button', { name: /Проверка антидемпинга/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Ложное срабатывание' }));
  fireEvent.change(screen.getByLabelText(/Причина перевода/), { target: { value: 'Меры проверены' } });
  fireEvent.keyDown(screen.getByLabelText(/Причина перевода/), { key: 'Enter' });
  return rendered;
}
describe('Issues shared decision refresh', () => {
  it('shows the saved decision, explanation and separate comments without treating the responsible person as author', async () => {
    vi.spyOn(api, 'getIssueDetail').mockResolvedValue({ issue: { id: 'case-1', status: 'false_positive' }, history: [
      { eventId: 'issue-history:1', issueId: 'case-1', type: 'status_change', source: 'dash_decision',
        at: '2026-10-16T01:00:00Z', from: 'open', to: 'false_positive', author: null,
        reason: 'Меры проверены', justification: 'Обеспечение включено в контракт',
        responsible: 'Координатор', deadline: '2026-10-22', text: 'Проверку согласовали' },
      { eventId: 'audit-log:1', issueId: 'case-1', type: 'comment', source: 'dash_comment',
        at: '2026-10-16T02:00:00Z', author: 'Исполнитель', text: 'Добавлен документ' },
    ] });
    await openCase();
    expect(await screen.findByText(/Обеспечение включено в контракт/)).toBeTruthy();
    expect(screen.getByText(/Меры проверены/)).toBeTruthy();
    expect(screen.getByText('Проверку согласовали')).toBeTruthy();
    expect(screen.getByText('Добавлен документ')).toBeTruthy();
    expect(screen.getByText('Ответственный: Координатор')).toBeTruthy();
    expect(screen.getByText('Автор не указан')).toBeTruthy();
    expect(screen.getByText('Исполнитель')).toBeTruthy();
  });

  it('refreshes shared data after confirmed save, not source sheets', async () => {
    vi.spyOn(api, 'updateIssueStatus').mockResolvedValue({ success: true, issueId: 'case-1', toStatus: 'false_positive' });
    fixture.reload.mockImplementationOnce(async () => { fixture.issue.status = 'false_positive'; return true; });
    await save();
    await waitFor(() => expect(fixture.reload).toHaveBeenCalledOnce());
    expect(await screen.findByText('Замечание закрыто — можно вернуть в статус')).toBeTruthy();
    cleanup(); fixture.issue.status = 'false_positive';
    const { container } = render(<IssuesPage />);
    fireEvent.click(container.querySelector('button[aria-expanded]')!);
    fireEvent.click(screen.getByRole('button', { name: /Проверка антидемпинга/ }));
    expect(screen.getByText('Замечание закрыто — можно вернуть в статус')).toBeTruthy();
  });
  it('keeps the reason and shows unconfirmed state when readback fails', async () => {
    vi.spyOn(api, 'updateIssueStatus').mockRejectedValue(new Error('Повторное чтение недоступно'));
    await save();
    await waitFor(() => expect(screen.getByText(/Повторное чтение недоступно/)).toBeTruthy());
    expect(fixture.reload).not.toHaveBeenCalled();
    expect(screen.queryByText('Замечание закрыто — можно вернуть в статус')).toBeNull();
    expect((screen.getByLabelText(/Причина перевода/) as HTMLInputElement).value).toBe('Меры проверены');
  });
  it('does not show local success when shared data refresh fails', async () => {
    vi.spyOn(api, 'updateIssueStatus').mockResolvedValue({ success: true, issueId: 'case-1', toStatus: 'false_positive' });
    fixture.reload.mockImplementationOnce(async () => { fixture.error = 'Нет связи'; return false; });
    await save();
    await waitFor(() => expect(screen.getByText(/общие данные не обновлены/)).toBeTruthy());
    expect(screen.queryByText('Замечание закрыто — можно вернуть в статус')).toBeNull();
  });
  it('does not confirm a superseded refresh even when shared error is still null', async () => {
    vi.spyOn(api, 'updateIssueStatus').mockResolvedValue({ success: true, issueId: 'case-1', toStatus: 'false_positive' });
    fixture.reload.mockResolvedValueOnce(false);
    await save();
    await waitFor(() => expect(screen.getByText(/общие данные не обновлены/)).toBeTruthy());
    expect(screen.queryByText('Замечание закрыто — можно вернуть в статус')).toBeNull();
    expect((screen.getByLabelText(/Причина перевода/) as HTMLInputElement).value).toBe('Меры проверены');
  });

  it('renders a concurrent reopen from the confirmed shared refresh instead of a local override', async () => {
    vi.spyOn(api, 'updateIssueStatus').mockResolvedValue({ success: true, issueId: 'case-1', toStatus: 'false_positive' });
    await save();
    await waitFor(() => expect(screen.queryByText('Сохраняем статус…')).toBeNull());
    expect(screen.queryByText('Замечание закрыто — можно вернуть в статус')).toBeNull();
    expect(screen.getByText('Перевести в статус')).toBeTruthy();
  });
  it('does not mask later shared status updates after a confirmed decision', async () => {
    vi.spyOn(api, 'updateIssueStatus').mockResolvedValue({ success: true, issueId: 'case-1', toStatus: 'false_positive' });
    fixture.reload.mockImplementationOnce(async () => { fixture.issue.status = 'false_positive'; return true; });
    const rendered = await save();
    await waitFor(() => expect(screen.getByText('Замечание закрыто — можно вернуть в статус')).toBeTruthy());
    fixture.issue.status = 'open';
    rendered.rerender(<IssuesPage />);
    expect(screen.queryByText('Замечание закрыто — можно вернуть в статус')).toBeNull();
  });

});
