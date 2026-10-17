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

  const native = (extra: Record<string, unknown>) => parseNativeComments({
    commentsViewMode: 'COMMENTS_VIEW_MODE_INCLUDED', ...extra,
  }, 'file', 'read');
  const notes = (data: unknown) => parseCellNotes({ sheets: [{
    properties: { sheetId: 17, title: 'ВСЕ' }, data,
  }] }, 'file', 'read');

  it.each([
    ['comment list', () => native({ comments: { commentId: 'thread' } })],
    ['sheet list', () => native({ sheets: {} })],
    ['anchor list', () => native({ sheets: [{ commentAnchors: {} }] })],
    ['reply list', () => native({ comments: [{ commentId: 'thread', replies: {} }] })],
    ['note grids', () => notes({ rowData: [] })],
    ['note rows', () => notes([{ rowData: {} }])],
    ['note cells', () => notes([{ rowData: [{ values: {} }] }])],
  ] as const)('rejects malformed %s instead of claiming a complete empty reading', (_name, read) => {
    expect(read().status).toBe('unavailable');
  });

  it.each(['500', -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'does not assign a note to a cell using invalid grid offset %s', offset => {
      for (const field of ['startRow', 'startColumn']) {
        const result = notes([{ [field]: offset, rowData: [{ values: [{ note: 'Пояснение' }] }] }]);
        expect(result.status).toBe('unavailable');
        expect(result.records).toEqual([]);
      }
    },
  );

  it('does not turn an invalid native anchor offset into the first row', () => {
    const result = native({ sheets: [{ properties: { sheetId: 17, title: 'ВСЕ' },
      commentAnchors: [{ anchorId: 'a', range: { startRowIndex: '500', endRowIndex: 501,
        startColumnIndex: 0, endColumnIndex: 1 } }],
    }], comments: [{ commentId: 'thread', anchorId: 'a', headPost: { postId: 'p', content: 'Пояснение' } }] });
    expect(result.status).toBe('unavailable');
    expect(result.records).toEqual([]);
  });

  it('accepts omitted empty collections and preserves unrelated provider extensions', () => {
    expect(notes(undefined)).toMatchObject({ status: 'read', records: [] });
    const thread = { commentId: 'thread', headPost: { postId: 'p', content: 'Пояснение' },
      newProviderAttribute: { revision: 7 } };
    expect(native({ comments: [thread] })).toMatchObject({ status: 'read', records: [{ raw: thread }] });
  });

  it('retains proved earlier threads when a later thread is malformed', () => {
    const result = native({ comments: [{ commentId: 'valid', headPost: { postId: 'p', content: 'Вопрос' } },
      { commentId: 'invalid', replies: {} }] });
    expect(result.status).toBe('unavailable');
    expect(result.records.map(record => record.sourceId)).toEqual(['valid']);
  });

  it.each([null, 4, 'cell'])('rejects a malformed note cell %s', cell => {
    expect(notes([{ rowData: [{ values: [cell] }] }]).status).toBe('unavailable');
  });

  it('rejects a malformed legacy reply list rather than saving an incomplete witness', () => {
    expect(() => parseDriveCommentWitness({ id: 'thread', replies: {} }, 'file', 'read')).toThrow();
  });
});
