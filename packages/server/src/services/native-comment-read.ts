import { google } from 'googleapis';
import { config } from '../config.js';
import { findDept } from '@aemr/shared';
import { departmentSheetNameCandidates } from './sheet-name-candidates.js';
import { withSheetsRetry } from './sheets-retry.js';
import { parseNativeComments, parseCellNotes, type WitnessReading } from './google-comment-witnesses.js';

export interface NativeCommentReading extends WitnessReading { scope: string[]; }
export interface NativeCommentApi { get(fileId: string, params: Record<string, unknown>): Promise<unknown>; }

function realApi(): NativeCommentApi | null {
  const { serviceAccountEmail, privateKey } = config.google;
  if (!serviceAccountEmail || !privateKey) return null;
  const auth = new google.auth.GoogleAuth({ credentials: { client_email: serviceAccountEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  return { async get(fileId, params) {
    // Authenticated transport supports current discovery fields even when the
    // pinned googleapis generated declarations predate native comments.
    const response = await withSheetsRetry('чтение обсуждений и заметок Google', () => auth.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}`,
      method: 'GET', params, timeout: 25_000 }));
    return response.data;
  } };
}

function unavailable(reason: string, scope: string[] = [], records: NativeCommentReading['records'] = []): NativeCommentReading {
  return { status: 'unavailable', reason, records, scope };
}

/** Independent channels: refusal to read discussions does not hide readable notes. */
export async function readNativeCommentWitnesses(book: string, fileId: string,
  api: NativeCommentApi | null = realApi(), now = new Date()) {
  const readAt = now.toISOString();
  if (!api) return { threads: unavailable('Нет служебной учётной записи для чтения.'),
    notes: unavailable('Нет служебной учётной записи для чтения.') };
  const threadsTask = (async (): Promise<NativeCommentReading> => {
    try {
      const data = await api.get(fileId, { commentsViewMode: 'COMMENTS_VIEW_MODE_INCLUDED',
        fields: 'spreadsheetId,commentsViewMode,comments,sheets(properties(sheetId,title),commentAnchors)' });
      return { ...parseNativeComments(data, fileId, readAt), scope: ['Обсуждения всей книги'] };
    } catch { return unavailable('Google не разрешил либо не завершил чтение обсуждений.'); }
  })();
  const notesTask = (async (): Promise<NativeCommentReading> => {
    const scope: string[] = [];
    const records: NativeCommentReading['records'] = [];
    try {
      const metadata = await api.get(fileId, { fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))' }) as {
        sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }> };
      const sheets = metadata.sheets ?? [];
      const dept = findDept(book);
      const candidates = departmentSheetNameCandidates(dept?.sheetName ?? book, dept?.id ?? book);
      const selected = candidates.map(name => sheets.find(s => s.properties?.title === name)).find(Boolean)
        ?? sheets.find(s => s.properties?.title === book);
      const props = selected?.properties;
      if (!props?.title || !Number.isInteger(props.sheetId) || !props.gridProperties?.rowCount || !props.gridProperties.columnCount) {
        return unavailable('Рабочий лист и его геометрия для заметок не установлены.');
      }
      for (let start = 1; start <= props.gridProperties.rowCount; start += 500) {
        // Row-bounded read of notes only; neither values nor formulas requested.
        const range = `'${props.title.replace(/'/g, "''")}'!${start}:${Math.min(start + 499, props.gridProperties.rowCount)}`;
        scope.push(range);
        const data = await api.get(fileId, { ranges: [range],
          fields: 'spreadsheetId,sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(note))))' });
        const parsed = parseCellNotes(data, fileId, readAt);
        if (parsed.status !== 'read') return unavailable(parsed.reason ?? 'Заметки не прочитаны.', scope, [...records, ...parsed.records]);
        records.push(...parsed.records);
      }
      return { status: 'read', reason: null, records, scope };
    } catch { return unavailable('Google не разрешил либо не завершил чтение заметок.', scope, records); }
  })();
  const [threads, notes] = await Promise.all([threadsTask, notesTask]);
  return { threads, notes };
}
