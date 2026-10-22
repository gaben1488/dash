/**
 * Single current-book → canonical comparison-row adapter.
 * Both the persisted Thursday proof and live/webhook readers use one row
 * classifier, one numbering representation and one monetary parser.
 * No provider I/O, persistence, or event delivery lives in this module.
 */
import { DEPT_COLUMNS, DEPT_HEADER_ROWS, subordinateKey, ORG_ITSELF_SENTINEL } from '@aemr/shared';
import { journalNumber, type SnapshotRow } from '@aemr/core';
import { isDataRow } from './rows-dto.js';

export function orgLabel(raw: unknown): string {
  const key = subordinateKey(raw);
  return key === ORG_ITSELF_SENTINEL ? 'Аппарат управления' : key;
}

function cellText(row: readonly unknown[], column: number): string {
  return String(row[column] ?? '').trim();
}

/**
 * A physical row number is an address, never a business identity. An empty
 * identifier is retained as an unkeyed observation, not coerced to 0.
 */
export function currentSheetToSnapshotRows(values: readonly unknown[][]): SnapshotRow[] {
  const result: SnapshotRow[] = [];
  values.forEach((raw, index) => {
    if (index < DEPT_HEADER_ROWS || !Array.isArray(raw)) return;
    const rowSeq = cellText(raw, DEPT_COLUMNS.ID);
    const subject = cellText(raw, DEPT_COLUMNS.SUBJECT);
    const method = cellText(raw, DEPT_COLUMNS.METHOD);
    const planSum = journalNumber(raw[DEPT_COLUMNS.TOTAL_PLAN]);
    if (!isDataRow({ id: rowSeq, subject, method, planSum: planSum ?? 0 })) return;
    const factSum = journalNumber(raw[DEPT_COLUMNS.TOTAL_FACT]);
    result.push({
      rowSeq,
      sheetRow: index + 1,
      subject,
      subordinate: orgLabel(raw[DEPT_COLUMNS.SUBORDINATE]),
      ...(planSum === null ? {} : { planSum }),
      ...(factSum === null ? {} : { factSum }),
      method,
    });
  });
  return result;
}
