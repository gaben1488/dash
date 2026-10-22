import { buildSignalAnswer, COL_LETTER_INDEX, DEPT_HEADER_ROWS, signalPassportForIssue } from '@aemr/shared';
import type { DataSnapshot, Issue } from '@aemr/shared';

/**
 * Evidence is read only from the exact already-captured row. Never live-read
 * Google on GET, reuse positional row after a reshuffle, coerce "173/18" to a
 * number, or claim that an address alone proves the observed values.
 */
export function signalEvidenceFromSnapshot(
  snapshot: Pick<DataSnapshot, 'id' | 'createdAt' | 'rowsByDept'>,
  issue: Issue,
) {
  const passport = signalPassportForIssue(issue);
  const rows = issue.sheet ? snapshot.rowsByDept?.[issue.sheet] : undefined;
  const sourceIndex = typeof issue.row === 'number' ? issue.row - DEPT_HEADER_ROWS - 1 : -1;
  const sourceRow = Number.isInteger(sourceIndex) && sourceIndex >= 0 ? rows?.[sourceIndex] : undefined;
  const rowSeq = typeof issue.rowSeq === 'string' ? issue.rowSeq.trim() : '';
  // Identical position with a missing/reused № п/п is not evidence of identity.
  const count = rowSeq && rows
    ? rows.reduce((n, row) => n + (String(row?.[0] ?? '').trim() === rowSeq ? 1 : 0), 0) : 0;
  const proved = Array.isArray(sourceRow) && rowSeq !== ''
    && String(sourceRow[0] ?? '').trim() === rowSeq && count === 1;
  const answer = buildSignalAnswer(passport.checkId, {
    issues: [{ ...issue, checkId: passport.checkId }],
    ...(proved ? {
      readCell: (sheet: string, row: number, column: string) => {
        if (sheet !== issue.sheet || row !== issue.row) return null;
        const position = COL_LETTER_INDEX[column];
        if (typeof position !== 'number') return null;
        const cell = sourceRow?.[position];
        // Absent indexed column is NOT the same evidence as an actual empty cell.
        return cell === undefined ? null : cell === null ? '' : String(cell);
      },
    } : {}),
  }, 1);
  return {
    source: 'sealed_snapshot' as const,
    snapshotId: snapshot.id,
    capturedAt: snapshot.createdAt,
    status: proved ? 'row_identity_verified' as const : 'identity_not_verified' as const,
    explanation: proved
      ? 'Значения из сохранённой строки снимка с уникальным совпадением № п/п. Это не новое чтение Google.'
      : 'Совпадение исходной строки и № п/п не доказано; значения не подставлены из соседних строк.',
    answer,
  };
}
