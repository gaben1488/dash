/**
 * In-memory drafts survive React route/page remounts within the current tab.
 * They are intentionally NOT persisted to localStorage/sessionStorage because
 * procurement rows can contain personal or commercially sensitive text.
 */
export interface EditorDraft {
  original: Record<string, unknown>;
  changes: Record<string, unknown>;
}
export type EditorDrafts = Record<string, EditorDraft>;
let currentDrafts: EditorDrafts = {};

export function currentEditorDrafts(): EditorDrafts {
  return currentDrafts;
}

function preventUnsavedUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = '';
}

export function rememberEditorDrafts(next: EditorDrafts): EditorDrafts {
  const had = Object.keys(currentDrafts).length > 0;
  const has = Object.keys(next).length > 0;
  currentDrafts = next;
  if (typeof window !== 'undefined' && had !== has) {
    if (has) window.addEventListener('beforeunload', preventUnsavedUnload);
    else window.removeEventListener('beforeunload', preventUnsavedUnload);
  }
  return next;
}

export function changeEditorDraft(
  drafts: EditorDrafts,
  rowId: string,
  field: string,
  value: unknown,
  original: Record<string, unknown>,
): EditorDrafts {
  const current = drafts[rowId] ?? { original: { ...original }, changes: {} };
  const changes = { ...current.changes };
  if (Object.is(value, current.original[field])) delete changes[field];
  else changes[field] = value;
  const next = { ...drafts };
  if (Object.keys(changes).length === 0) delete next[rowId];
  else next[rowId] = { original: current.original, changes };
  return next;
}

export function clearEditorDraft(drafts: EditorDrafts, rowId: string): EditorDrafts {
  if (!drafts[rowId]) return drafts;
  const next = { ...drafts };
  delete next[rowId];
  return next;
}

export function applicableDraft(
  draft: EditorDraft | undefined,
  currentRevision: unknown,
): EditorDraft | undefined {
  return draft && draft.original._rowRevision === currentRevision ? draft : undefined;
}
