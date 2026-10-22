// @vitest-environment jsdom
/** C06.03: do not silently export defaults as the saved revision. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { procurementEditableGuidance } from '@aemr/shared';
import { RuleReference, checkedGuidanceResponse } from './RuleReference';

const getEditorialGuidance = vi.fn();
const updateEditorialGuidance = vi.fn();
vi.mock('../api', () => ({
  api: {
    getEditorialGuidance: (...args: unknown[]) => getEditorialGuidance(...(args as [])),
    updateEditorialGuidance: (...args: unknown[]) => updateEditorialGuidance(...(args as [])),
  },
  humanizeRequestError: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

const entries = () => procurementEditableGuidance().map(item => ({
  ...item,
  text: item.defaultText,
  overridden: false,
  revision: 0,
  updatedAt: null,
}));
const response = (list: ReturnType<typeof entries>) => ({
  version: 'C06.03-editorial-v1' as const,
  calculationRulesChanged: false as const,
  entries: list,
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('C06.03 guide and export', () => {
  it('rejects partial/duplicated/unversioned catalogs before exporting', () => {
    const list = entries();
    expect(() => checkedGuidanceResponse(response(list.slice(0, -1)))).toThrow();
    const duplicates = [...list];
    duplicates[1] = { ...duplicates[0] };
    expect(() => checkedGuidanceResponse(response(duplicates))).toThrow();
    expect(() => checkedGuidanceResponse({ ...response(list), version: 'future' as 'C06.03-editorial-v1' })).toThrow();
    expect(checkedGuidanceResponse(response(list))).toHaveLength(list.length);
  });

  it('unavailable saved catalog disables both exports; canonical text is not claimed current', async () => {
    getEditorialGuidance.mockRejectedValueOnce(new Error('503 DB unavailable'));
    render(<RuleReference />);
    fireEvent.click(screen.getByText('Правила и подсказки заполнения'));
    await screen.findByText(/Сохранённая редакция не прочитана/);
    expect(screen.getByRole('button', { name: 'Скачать Markdown' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Скачать Word' }).hasAttribute('disabled')).toBe(true);
  });

  it('writes a revisioned explanation, reads the same revision back, and retains calculated defaults', async () => {
    const current = entries();
    getEditorialGuidance.mockResolvedValueOnce(response(current));
    const changed = current.map(entry => entry.key === 'field:method' ? {
      ...entry, text: 'Сверьте способ по документу', overridden: true, revision: 1,
      updatedAt: '2026-10-22T08:00:00.000Z',
    } : entry);
    updateEditorialGuidance.mockResolvedValueOnce({
      key: 'field:method', revision: 1, text: 'Сверьте способ по документу',
      overridden: true, updatedAt: '2026-10-22T08:00:00.000Z',
    });
    getEditorialGuidance.mockResolvedValueOnce(response(changed));

    render(<RuleReference />);
    fireEvent.click(screen.getByText('Правила и подсказки заполнения'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скачать Markdown' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByText(/Редактировать пояснения/));
    fireEvent.click(screen.getAllByRole('button', { name: 'Изменить' })[0]);
    fireEvent.change(screen.getByLabelText('Редакция пояснения'), { target: { value: 'Сверьте способ по документу' } });
    fireEvent.change(screen.getByLabelText('Причина изменения (не менее 8 знаков)'), { target: { value: 'Уточнение инструкции оператора' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и проверить' }));
    await screen.findByText(/Редакция сохранена и повторно прочитана/);
    expect(updateEditorialGuidance).toHaveBeenCalledWith(
      'field:method', 'Сверьте способ по документу', 'Уточнение инструкции оператора', 0,
    );
    expect(document.body.textContent).toContain('Сверьте способ по документу');
    expect(document.body.textContent).toContain('изменено');
  });

  it('does not confirm a write when the subsequent readback disagrees', async () => {
    const current = entries();
    getEditorialGuidance.mockResolvedValue(response(current));
    updateEditorialGuidance.mockResolvedValueOnce({
      key: 'field:method', revision: 1, text: 'Сверьте способ по документу',
      overridden: true, updatedAt: '2026-10-22T08:00:00.000Z',
    });
    render(<RuleReference />);
    fireEvent.click(screen.getByText('Правила и подсказки заполнения'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скачать Markdown' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByText(/Редактировать пояснения/));
    fireEvent.click(screen.getAllByRole('button', { name: 'Изменить' })[0]);
    fireEvent.change(screen.getByLabelText('Редакция пояснения'), { target: { value: 'Сверьте способ по документу' } });
    fireEvent.change(screen.getByLabelText('Причина изменения (не менее 8 знаков)'), { target: { value: 'Уточнение инструкции оператора' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и проверить' }));
    await screen.findByText(/Сервер не подтвердил сохранённую редакцию/);
    expect(screen.queryByText(/Редакция сохранена и повторно прочитана/)).toBeNull();
  });
});
