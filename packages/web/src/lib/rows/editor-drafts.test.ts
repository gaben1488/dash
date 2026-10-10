import { describe, expect, it } from 'vitest';
import { restoreEditorPage, type EditorDraft } from './editor-drafts';
import type { RowData } from '../../components/TableEditor';

const original: RowData = {
  _id: 'uo-4', id: '173/1', _sourceManagementName: 'УО',
  _sourceSubordinate: 'МБОУ «СШ № 3»', subject: 'Поставка книг', planFB: 20,
};

describe('registry editor draft rebase', () => {
  const edited: RowData = { ...original, planFB: 30 };
  const drafts = new Map<string, EditorDraft>([['uo-4', { baseline: original, edited }]]);
  it('keeps draft and original baseline when source refreshes or page returns', () => {
    const result = restoreEditorPage([{ ...original, planFB: 20 }], drafts);
    expect(result.rows[0].planFB).toBe(30);
    expect(result.originals['uo-4'].planFB).toBe(20);
    expect(result.conflicts).toBe(0);
  });
  it('keeps off-page drafts without applying them to an unrelated row', () => {
    expect(restoreEditorPage([{ ...original, _id: 'uo-5' }], drafts).rows[0].planFB).toBe(20);
    expect(drafts.size).toBe(1);
  });
  it('does NOT copy edits into a different procurement at the same row address', () => {
    const changed = { ...original, subject: 'Строительство школы', id: '174' };
    const result = restoreEditorPage([changed], drafts);
    expect(result.rows[0]).toEqual(changed);
    expect(result.conflicts).toBe(1);
    expect(drafts.get('uo-4')?.edited.planFB).toBe(30);
  });
});
