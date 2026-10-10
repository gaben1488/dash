/**
 * A position number is not a record ID. Use the four source columns which
 * locate the item seen by the editor before writing to a mutable Google grid.
 * This is a best-effort optimistic precondition, NOT atomic Google Sheets CAS.
 */
export const ROW_IDENTITY_COLUMNS = ['A', 'B', 'C', 'G'] as const;
export type RowWriteIdentity = Record<(typeof ROW_IDENTITY_COLUMNS)[number], unknown>;

export function hasRowWriteIdentity(input: unknown): input is RowWriteIdentity {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  return ROW_IDENTITY_COLUMNS.every(col => Object.hasOwn(record, col));
}

function comparableCell(value: unknown): string {
  return String(value ?? '').trim();
}

/** Fail closed if even one identifying source cell changed or row is blank. */
export function rowIdentityMatches(
  expected: RowWriteIdentity,
  actual: Record<string, unknown>,
): boolean {
  if (!comparableCell(expected.A) && !comparableCell(expected.G)) return false;
  return ROW_IDENTITY_COLUMNS.every(col => comparableCell(expected[col]) === comparableCell(actual[col]));
}
