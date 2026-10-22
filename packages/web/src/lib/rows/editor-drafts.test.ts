import { describe, expect, it } from 'vitest';
import { applicableDraft, changeEditorDraft, clearEditorDraft } from './editor-drafts';

describe('editor drafts', () => {
  const original = { _rowRevision: 'version-1', subject: 'Бумага', planFB: 10 };
  it('keeps the first source baseline through repeated edits', () => {
    let drafts = changeEditorDraft({}, 'uo:4', 'subject', 'Поставка бумаги', original);
    drafts = changeEditorDraft(drafts, 'uo:4', 'planFB', 20, { ...original, subject: 'Другое' });
    expect(drafts['uo:4'].original.subject).toBe('Бумага');
    expect(drafts['uo:4'].changes).toEqual({ subject: 'Поставка бумаги', planFB: 20 });
  });
  it('removes a cell changed back to its original value', () => {
    let drafts = changeEditorDraft({}, 'uo:4', 'subject', 'Поставка бумаги', original);
    drafts = changeEditorDraft(drafts, 'uo:4', 'subject', 'Бумага', original);
    expect(drafts).toEqual({});
  });
  it('does not overlay an old draft onto a different source row at that index', () => {
    const drafts = changeEditorDraft({}, 'uo:4', 'subject', 'Поправка', original);
    expect(applicableDraft(drafts['uo:4'], 'version-2')).toBeUndefined();
    expect(applicableDraft(drafts['uo:4'], 'version-1')).toBeDefined();
    expect(clearEditorDraft(drafts, 'uo:4')).toEqual({});
  });
});
