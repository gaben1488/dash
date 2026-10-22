// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { epReasonEditorGuidance } from '@aemr/shared';
import { TableEditor, type ColumnConfig } from './TableEditor';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('C06.03 full source-M editing via the existing TableEditor', () => {
  it('shows classification context without turning it into legal approval; multiline text remains editable', () => {
    const onCellChange = vi.fn();
    const columns: ColumnConfig[] = [{
      key: 'epReason', label: 'Обоснование ЕП', type: 'multiline',
      guidanceForRow: row => epReasonEditorGuidance(row.method, row.epReason),
    }];
    render(<TableEditor columns={columns}
      rows={[{ _id: 'book:53', method: 'ЕП', epReason: 'Х' }]}
      onCellChange={onCellChange} />);

    fireEvent.click(screen.getByText('Х'));
    const editor = screen.getByRole('textbox', { name: 'Обоснование ЕП: значение' }) as HTMLTextAreaElement;
    expect(editor.tagName).toBe('TEXTAREA');
    expect(screen.getByRole('note').textContent).toContain('Основание отсутствует');
    const explanation = 'Проверить основание по документу\nНе считать автоматическим юридическим заключением';
    fireEvent.change(editor, { target: { value: explanation } });
    // A plain Enter must not close the multiline editor.
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter' });
    expect(screen.getByRole('textbox', { name: 'Обоснование ЕП: значение' })).toBe(editor);
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(onCellChange).toHaveBeenCalledWith('book:53', 'epReason', explanation);
  });
});
