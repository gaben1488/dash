/** Read-only native comments and notes; values and edits are separate evidence. */
export interface CommentWitness {
  kind: 'native_thread' | 'cell_note' | 'drive_thread';
  fileId: string;
  sourceId: string;
  sheetId: number | null;
  sheet: string | null;
  cell: string | null;
  author: string | null;
  content: string | null;
  posts: Array<{ id: string; author: string | null; content: string | null; raw: unknown }>;
  readAt: string;
  sourceRevision: string | null;
  sourceRevisionUnavailableReason: string;
  raw: unknown;
  /** Parsed claims inside a script-written note; never Google author metadata. */
  noteClaims?: Array<{ before: string; at: string; actor: string; evidenceKind: 'NOTE_TEXT_CLAIM' }>;
}

export interface WitnessReading {
  status: 'read' | 'unavailable';
  reason: string | null;
  records: CommentWitness[];
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function integer(value: unknown): number | null { return typeof value === 'number' && Number.isInteger(value) ? value : null; }
function columnName(index: number): string {
  let n = index + 1, name = '';
  while (n > 0) { n--; name = String.fromCharCode(65 + n % 26) + name; n = Math.floor(n / 26); }
  return name;
}
function base(fileId: string, sourceId: string, readAt: string) {
  return { fileId, sourceId, readAt, sourceRevision: null,
    sourceRevisionUnavailableReason: 'Ответ чтения не содержит доказанную ревизию файла.' };
}
function author(value: unknown): string | null {
  const person = object(value);
  return person.anonymous === true ? null : text(person.displayName);
}

export function parseDriveCommentWitness(raw: unknown, fileId: string, readAt: string): CommentWitness | null {
  const thread = object(raw), sourceId = text(thread.id);
  if (!sourceId) return null;
  const posts = [raw, ...array(thread.replies)].map(value => {
    const post = object(value);
    return { id: text(post.id) ?? '', author: author(post.author), content: text(post.content), raw: value };
  });
  return { ...base(fileId, sourceId, readAt), kind: 'drive_thread', sheetId: null, sheet: null,
    cell: null, author: author(thread.author), content: text(thread.content), posts, raw };
}

export function parseNativeComments(value: unknown, fileId: string, readAt: string): WitnessReading {
  const data = object(value);
  if (data.commentsViewMode !== 'COMMENTS_VIEW_MODE_INCLUDED') {
    return { status: 'unavailable', reason: 'Обсуждения не включены в ответ Google.', records: [] };
  }
  const anchors = new Map<string, { sheetId: number | null; sheet: string | null; cell: string | null }>();
  for (const s of array(data.sheets)) {
    const sheet = object(s), props = object(sheet.properties);
    for (const a of array(sheet.commentAnchors)) {
      const anchor = object(a), range = object(anchor.range);
      const row = integer(range.startRowIndex) ?? 0, col = integer(range.startColumnIndex) ?? 0;
      const sheetId = integer(range.sheetId) ?? integer(props.sheetId);
      const endRow = integer(range.endRowIndex), endCol = integer(range.endColumnIndex);
      const cell = endRow !== null && endCol !== null && row >= 0 && col >= 0 && endRow > row && endCol > col
        ? `${columnName(col)}${row + 1}${endRow === row + 1 && endCol === col + 1 ? '' : ':' + columnName(endCol - 1) + endRow}` : null;
      if (text(anchor.anchorId)) anchors.set(String(anchor.anchorId), { sheetId, sheet: text(props.title), cell });
    }
  }
  const records: CommentWitness[] = [];
  for (const raw of array(data.comments)) {
    const thread = object(raw), id = text(thread.commentId);
    if (!id) return { status: 'unavailable', reason: 'Обсуждение без исходного ID; полнота чтения не подтверждена.', records: [] };
    const head = object(thread.headPost);
    const posts = [thread.headPost, ...array(thread.replies)].filter(Boolean).map(p => {
      const post = object(p);
      return { id: text(post.postId) ?? '', author: author(post.author), content: text(post.content), raw: p };
    });
    records.push({ ...base(fileId, id, readAt), kind: 'native_thread',
      ...(anchors.get(String(thread.anchorId)) ?? { sheetId: null, sheet: null, cell: null }),
      author: author(head.author), content: text(head.content), posts, raw });
  }
  return { status: 'read', reason: null, records };
}

export function parseCellNotes(value: unknown, fileId: string, readAt: string): WitnessReading {
  if (!Array.isArray(object(value).sheets) || array(object(value).sheets).length === 0) {
    return { status: 'unavailable', reason: 'Геометрия заметок отсутствует в ответе.', records: [] };
  }
  const records: CommentWitness[] = [];
  for (const s of array(object(value).sheets)) {
    const sheet = object(s), props = object(sheet.properties);
    if (integer(props.sheetId) === null || !text(props.title)) {
      return { status: 'unavailable', reason: 'Заметки без доказанного листа и sheetId.', records };
    }
    for (const g of array(sheet.data)) {
      const grid = object(g), startRow = integer(grid.startRow) ?? 0, startCol = integer(grid.startColumn) ?? 0;
      array(grid.rowData).forEach((r, i) => array(object(r).values).forEach((c, j) => {
        const cell = object(c);
        if (typeof cell.note !== 'string') return;
        const address = `${columnName(startCol + j)}${startRow + i + 1}`;
        const sheetId = integer(props.sheetId);
        const noteClaims = cell.note.split(/\r?\n/u).flatMap(line => {
          const match = /^Было:\s*(.*?)\s*\((\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}),\s*(.*?)\)\s*$/u.exec(line);
          return match ? [{ before: match[1]!, at: match[2]!, actor: match[3]!, evidenceKind: 'NOTE_TEXT_CLAIM' as const }] : [];
        });
        records.push({ ...base(fileId, `${sheetId}:${address}`, readAt), kind: 'cell_note',
          sheetId, sheet: text(props.title), cell: address, author: null, content: cell.note, posts: [], raw: cell, noteClaims });
      }));
    }
  }
  return { status: 'read', reason: null, records };
}
