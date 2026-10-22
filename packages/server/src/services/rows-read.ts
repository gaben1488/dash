/**
 * R05.03 — единственный выбор первичных строк для сырых API-потребителей.
 * Сначала принятый кэш той же master-книги, затем прямая проверенная книга.
 * Никакой СВОД/IMPORTRANGE не является запасным источником исходных строк.
 * Receipt относится к чтению, а не к времени текущего HTTP-запроса.
 */
import { readDeptSheet } from './google-sheets.js';
import type { DeptSheetResult } from './google-sheets.js';
import { getDeptSheetCache } from './snapshot.js';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { DEPT_HEADER_ROWS } from '@aemr/shared';

export interface DeptRowsSource {
  kind: 'accepted-cache' | 'live-primary';
  providerId: string;
  sheetName: string;
  readAt: string | null;
  sourceVersion: string | null;
  sourceRevision: string | null;
}

export type DeptRowsResult =
  | { ok: true; values: unknown[][]; source: DeptRowsSource }
  | { ok: false; reason: 'read-error'; error: unknown }
  | { ok: false; reason: 'no-source' };

function receipt(reading: DeptSheetResult, kind: DeptRowsSource['kind'], providerId: string): DeptRowsSource {
  const instant = reading.readAt;
  return {
    kind,
    providerId,
    sheetName: reading.sheetName,
    readAt: typeof instant === 'string' && Number.isFinite(Date.parse(instant)) ? instant : null,
    sourceVersion: reading.sourceVersion ?? null,
    sourceRevision: reading.sourceRevision ?? null,
  };
}

/** A known-empty primary has three reviewed header rows; a missing grid does not. */
export async function readDeptRows(dept: { nameShort: string; sheetName: string }): Promise<DeptRowsResult> {
  const providerId = DEPARTMENT_SPREADSHEETS[dept.nameShort];
  if (!providerId) return { ok: false, reason: 'no-source' };

  // An old cached response from another file must not survive a binding change.
  // A legacy cache with no provider identity is not evidence of a primary read.
  const cached = getDeptSheetCache()[dept.nameShort];
  if (cached?.providerId === providerId && Array.isArray(cached.values)
      && cached.values.length >= DEPT_HEADER_ROWS) {
    return { ok: true, values: cached.values, source: receipt(cached, 'accepted-cache', providerId) };
  }

  try {
    const reading = await readDeptSheet(dept.nameShort, providerId);
    if (reading.providerId !== providerId) throw new Error('MASTER_SOURCE_BINDING_MISMATCH');
    if (!Array.isArray(reading.values) || reading.values.length < DEPT_HEADER_ROWS) {
      throw new Error('MASTER_READ_INCOMPLETE');
    }
    return { ok: true, values: reading.values, source: receipt(reading, 'live-primary', providerId) };
  } catch (error) {
    return { ok: false, reason: 'read-error', error };
  }
}
