import { describe, expect, it } from 'vitest';
import { parseNativeComments, parseCellNotes, parseDriveCommentWitness } from './google-comment-witnesses.js';

describe('native Google comment witnesses preserve evidence rather than guessing edits', () => {
  it('keeps coordinator reply IDs, content and authors from the legacy Drive API', () => {
    const raw = { id: 'thread', content: 'Вопрос', author: { displayName: 'Исполнитель' },
      anchor: 'opaque', replies: [{ id: 'reply', content: 'Принято', author: { displayName: 'Координатор' },
        createdTime: '2026-10-12T01:00:00Z' }] };
    const result = parseDriveCommentWitness(raw, 'file', 'read');
    expect(result?.posts[1]).toMatchObject({ id: 'reply', content: 'Принято', author: 'Координатор' });
    expect(result?.raw).toEqual(raw);
    expect(result?.cell).toBeNull();
  });
  it('links a thread and reply by native IDs and range; anonymous authors remain unknown', () => {
    const raw = { spreadsheetId: 'file', commentsViewMode: 'COMMENTS_VIEW_MODE_INCLUDED',
      sheets: [{ properties: { sheetId: 17, title: 'ВСЕ' }, commentAnchors: [
        { anchorId: 'a', range: { sheetId: 17, startRowIndex: 6, endRowIndex: 7,
          startColumnIndex: 31, endColumnIndex: 32 } },
      ] }], comments: [{ commentId: 'thread', anchorId: 'a', status: 'OPEN',
        headPost: { postId: 'p1', content: 'История закупки', author: { displayName: 'Исполнитель', user: 'users/1' }, createTime: '2026-10-12T00:00:00Z' },
        replies: [{ postId: 'p2', content: 'Согласовано', author: { anonymous: true }, createTime: '2026-10-12T01:00:00Z' }],
      }] };
    const result = parseNativeComments(raw, 'file', '2026-10-12T02:00:00Z');
    expect(result.status).toBe('read');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ sourceId: 'thread', fileId: 'file',
      sheetId: 17, cell: 'AF7', author: 'Исполнитель', sourceRevision: null });
    expect(result.records[0]?.raw).toEqual(raw.comments[0]);
    expect(result.records[0]?.posts[1]).toMatchObject({ id: 'p2', author: null, content: 'Согласовано' });
  });
  it('does not invent addresses for unanchored threads or authors for notes', () => {
    const threads = parseNativeComments({ commentsViewMode: 'COMMENTS_VIEW_MODE_INCLUDED', comments: [
      { commentId: 'thread', headPost: { postId: 'p', content: 'Без привязки' } },
    ] }, 'file', 'read');
    expect(threads.records[0]).toMatchObject({ cell: null, sheetId: null, author: null });
    const notes = parseCellNotes({ sheets: [{ properties: { sheetId: 17, title: 'ВСЕ' },
      data: [{ startRow: 6, startColumn: 31, rowData: [{ values: [{ note: 'Было: 5 (author@example.test)' }] }] }],
    }] }, 'file', 'read');
    expect(notes.records[0]).toMatchObject({ cell: 'AF7', author: null, sourceRevision: null });
    expect(notes.records[0]?.content).toBe('Было: 5 (author@example.test)');
  });
  it('keeps multiline script-note claims separate from Google author and revision metadata', () => {
    const note = 'Было: 327 (21.05.2026 10:17, actor@example.test)\nБыло: 511.986 (06.06.2026 12:03, actor@example.test)';
    const result = parseCellNotes({ sheets: [{ properties: { sheetId: 17, title: 'ВСЕ' },
      data: [{ rowData: [{ values: [{ note }] }] }],
    }] }, 'file', 'read');
    expect(result.records[0]?.author).toBeNull();
    expect(result.records[0]?.noteClaims).toEqual([
      { before: '327', at: '21.05.2026 10:17', actor: 'actor@example.test', evidenceKind: 'NOTE_TEXT_CLAIM' },
      { before: '511.986', at: '06.06.2026 12:03', actor: 'actor@example.test', evidenceKind: 'NOTE_TEXT_CLAIM' },
    ]);
    expect(result.records[0]?.raw).toEqual({ note });
  });
  it('distinguishes zero comments from omitted/unsupported reading', () => {
    expect(parseNativeComments({ commentsViewMode: 'COMMENTS_VIEW_MODE_INCLUDED' }, 'file', 'read').status).toBe('read');
    expect(parseNativeComments({}, 'file', 'read').status).toBe('unavailable');
    expect(parseCellNotes({}, 'file', 'read').status).toBe('unavailable');
    expect(parseCellNotes({ sheets: [] }, 'file', 'read').status).toBe('unavailable');
    expect(parseCellNotes({ sheets: [{ data: [{ rowData: [{ values: [{ note: 'Без адреса' }] }] }] }] }, 'file', 'read').status).toBe('unavailable');
  });
});
