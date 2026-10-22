import type { RowData } from '../../components/TableEditor';

/** Edits survive sorting/page changes, but never get applied to another item. */
export interface EditorDraft {
  baseline: RowData;
  edited: RowData;
}

const EDITOR_ROW_ANCHORS = ['id', '_sourceManagementName', '_sourceSubordinate', 'subject'] as const;

export function sameEditorSource(baseline: RowData, current: RowData): boolean {
  return EDITOR_ROW_ANCHORS.every(key => String(baseline[key] ?? '') === String(current[key] ?? ''));
}

export function restoreEditorPage(
  fetched: readonly RowData[],
  drafts: ReadonlyMap<string, EditorDraft>,
): { rows: RowData[]; originals: Record<string, RowData>; conflicts: number } {
  const originals: Record<string, RowData> = {};
  let conflicts = 0;
  const rows = fetched.map(row => {
    const draft = drafts.get(row._id);
    if (!draft) {
      originals[row._id] = { ...row };
      return row;
    }
    if (!sameEditorSource(draft.baseline, row)) {
      // Preserve the draft in memory but do NOT attach it to a different row
      // that reused the same sheet address after a sort/insert.
      originals[row._id] = { ...row };
      conflicts += 1;
      return row;
    }
    originals[row._id] = draft.baseline;
    return draft.edited;
  });
  return { rows, originals, conflicts };
}
