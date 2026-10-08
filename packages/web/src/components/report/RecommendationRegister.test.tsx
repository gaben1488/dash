// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecommendationRegister } from './RecommendationRegister';

const calls = vi.hoisted(() => ({
  get: vi.fn(), create: vi.fn(), update: vi.fn(),
}));
vi.mock('../../api', () => ({
  api: {
    getReportRecommendations: calls.get,
    createReportRecommendation: calls.create,
    updateReportRecommendation: calls.update,
  },
  humanizeRequestError: (e: unknown) => String(e),
}));
const ledger = {
  revision: 'a'.repeat(64),
  counts: { active: 1, historical: 1, uerAuthored: 0 },
  records: [
    { id: 'REC-ONE', grbs: 'УО', text: 'Вынести закупку на электронный аукцион',
      sourceIds: ['42'], stage: 'ACTIVE', editable: false, type: 'CHANGE_METHOD_EA',
      firstSeen: '25.09.2026', lastSeen: '25.09.2026',
      statusLabel: 'Требует проверки', statusAsOf: '25.09.2026',
      grbsResponse: 'Принято', uerDecision: 'Нужно уточнить', note: '',
      updatedAt: '', history: [] },
    { id: 'REC-TWO', grbs: 'УД', text: 'Ранее действовавшая рекомендация',
      sourceIds: ['84'], stage: 'HISTORY', editable: false, type: 'MERGE_PROCUREMENTS',
      firstSeen: '01.08.2026', lastSeen: '25.08.2026',
      statusLabel: 'Замещено', statusAsOf: '25.09.2026',
      grbsResponse: '', uerDecision: '', note: 'История сохранена',
      updatedAt: '', history: [] },
  ],
};
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('loads the existing ledger, shows true counts and lets a person filter/search', async () => {
  calls.get.mockResolvedValue(ledger);
  render(<RecommendationRegister />);
  expect(await screen.findByText('Вынести закупку на электронный аукцион')).toBeTruthy();
  expect(screen.queryByText('Ранее действовавшая рекомендация')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Все записи/ }));
  expect(screen.getByText('Ранее действовавшая рекомендация')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: /Поиск по рекомендациям/ }),
    { target: { value: 'ранее' } });
  expect(screen.queryByText('Вынести закупку на электронный аукцион')).toBeNull();
  expect(screen.getByText('Ранее действовавшая рекомендация')).toBeTruthy();
});

it('keeps historical wording immutable but allows a working note', async () => {
  calls.get.mockResolvedValue(ledger);
  calls.update.mockResolvedValue({ revision: 'b'.repeat(64), record: {} });
  render(<RecommendationRegister />);
  fireEvent.click(await screen.findByRole('button', { name: /Вынести закупку на электронный аукцион/ }));
  expect(screen.getByText(/Исходный текст и ответы не переписываются/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Добавить рабочее пояснение/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /Рабочее пояснение/ }),
    { target: { value: 'Сверить связь с текущим планом' } });
  fireEvent.click(screen.getByRole('button', { name: /^Сохранить пояснение$/ }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('REC-ONE',
    { expectedRevision: ledger.revision, note: 'Сверить связь с текущим планом' }));
});

it('registers official UЭР recommendation immediately without a separate draft', async () => {
  calls.get.mockResolvedValue(ledger);
  calls.create.mockResolvedValue({ revision: 'b'.repeat(64), record: {} });
  render(<RecommendationRegister />);
  fireEvent.click(await screen.findByRole('button', { name: /Новая рекомендация/ }));
  expect(screen.getByText(/Сохранение регистрирует официальную рекомендацию УЭР/)).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: /Управление/ }), { target: { value: 'УЭР' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Текст рекомендации/ }),
    { target: { value: 'Проверить целесообразность объединения закупочных позиций' } });
  fireEvent.change(screen.getByRole('textbox', { name: /Номера закупочных позиций/ }),
    { target: { value: '42, 43' } });
  fireEvent.click(screen.getByRole('button', { name: /Сохранить рекомендацию/ }));
  await waitFor(() => expect(calls.create).toHaveBeenCalledWith({
    expectedRevision: ledger.revision, grbs: 'УЭР',
    text: 'Проверить целесообразность объединения закупочных позиций',
    sourceIds: ['42', '43'], note: '',
  }));
});

it('retains official recommendation text when concurrent update is rejected', async () => {
  calls.get.mockResolvedValue(ledger);
  calls.create.mockRejectedValue(new Error('409 — данные изменились'));
  render(<RecommendationRegister />);
  fireEvent.click(await screen.findByRole('button', { name: /Новая рекомендация/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /^Текст рекомендации/ }),
    { target: { value: 'Это предложение с сохранённым введённым текстом' } });
  fireEvent.click(screen.getByRole('button', { name: /Сохранить черновик/ }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('409'));
  expect(screen.getByRole('textbox', { name: /^Текст рекомендации/ })).toHaveProperty(
    'value', 'Это предложение с сохранённым введённым текстом');
});

it('does not turn an unavailable ledger into a false empty result', async () => {
  calls.get.mockRejectedValue(new Error('Хранилище недоступно'));
  render(<RecommendationRegister />);
  expect(await screen.findByText(/Хранилище недоступно/)).toBeTruthy();
  expect(screen.queryByText('Рекомендаций пока нет')).toBeNull();
});


it('edits an official UЭР recommendation and keeps historical originals read-only', async () => {
  calls.get.mockResolvedValue({
    ...ledger,
    counts: { ...ledger.counts, active: 2, uerAuthored: 1 },
    records: [...ledger.records, {
      ...ledger.records[0], id: 'REC-UER-123', editable: true, grbs: 'УЭР',
      text: 'Официальное предложение по закупке 42',
      sourceIds: ['42'], history: [],
    }],
  });
  calls.update.mockResolvedValue({ revision: 'b'.repeat(64), record: {} });
  render(<RecommendationRegister />);
  fireEvent.click(await screen.findByRole('button', { name: /Официальное предложение по закупке 42/ }));
  fireEvent.click(screen.getByRole('button', { name: /Редактировать рекомендацию/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /^Текст рекомендации/ }), {
    target: { value: 'Обновлённая официальная рекомендация по закупке 42' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Сохранить новую редакцию/ }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('REC-UER-123', {
    expectedRevision: ledger.revision, grbs: 'УЭР',
    text: 'Обновлённая официальная рекомендация по закупке 42',
    sourceIds: ['42'], note: '',
  }));
});
