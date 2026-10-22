import { describe, expect, it } from 'vitest';
import { readNativeCommentWitnesses } from './native-comment-read.js';

describe('bounded native reading', () => {
  it('reads notes in row-bounded batches even when native discussions are forbidden', async () => {
    const scopes: unknown[] = [];
    const result = await readNativeCommentWitnesses('УКСиМП', 'file', { async get(_file, params) {
      if (params.commentsViewMode) throw new Error('403');
      if (!params.ranges) return { sheets: [{ properties: { sheetId: 17, title: 'ВСЕ',
        gridProperties: { rowCount: 1100, columnCount: 34 } } }] };
      scopes.push(params.ranges);
      return { sheets: [{ properties: { sheetId: 17, title: 'ВСЕ' }, data: [] }] };
    } });
    expect(result.threads.status).toBe('unavailable');
    expect(result.notes.status).toBe('read');
    expect(scopes).toEqual([["'ВСЕ'!1:500"], ["'ВСЕ'!501:1000"], ["'ВСЕ'!1001:1100"]]);
    expect(result.notes.records).toHaveLength(0);
  });
  it('marks a partial note traversal unavailable without a proven zero', async () => {
    let calls = 0;
    const result = await readNativeCommentWitnesses('УИО', 'file', { async get(_file, params) {
      if (params.commentsViewMode) return { commentsViewMode: 'COMMENTS_VIEW_MODE_INCLUDED' };
      if (!params.ranges) return { sheets: [{ properties: { sheetId: 17, title: 'УИО',
        gridProperties: { rowCount: 600, columnCount: 34 } } }] };
      if (++calls === 2) throw new Error('Timeout');
      return { sheets: [{ properties: { sheetId: 17, title: 'УИО' }, data: [
        { rowData: [{ values: [{ note: 'Сохранённое свидетельство первой страницы' }] }] },
      ] }] };
    } });
    expect(result.threads.status).toBe('read');
    expect(result.notes.status).toBe('unavailable');
    expect(result.notes.scope).toHaveLength(2);
    expect(result.notes.records).toHaveLength(1);
  });

  it('keeps proved notes from an incomplete batch without claiming completeness', async () => {
    const result = await readNativeCommentWitnesses('УИО', 'file', { async get(_file, params) {
      if (params.commentsViewMode) return { commentsViewMode: 'COMMENTS_VIEW_MODE_INCLUDED' };
      if (!params.ranges) return { sheets: [{ properties: { sheetId: 17, title: 'УИО',
        gridProperties: { rowCount: 100, columnCount: 34 } } }] };
      return { sheets: [{ properties: { sheetId: 17, title: 'УИО' }, data: [
        { rowData: [{ values: [{ note: 'Проверенная заметка' }] }] },
        { startRow: '50', rowData: [{ values: [{ note: 'Адрес не доказан' }] }] },
      ] }] };
    } });
    expect(result.notes.status).toBe('unavailable');
    expect(result.notes.records).toMatchObject([{ cell: 'A1', content: 'Проверенная заметка' }]);
    expect(result.notes.records).toHaveLength(1);
  });
});
