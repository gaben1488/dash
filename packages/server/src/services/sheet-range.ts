const DEFAULT_WHOLE_SHEET_RANGE = 'A:ZZ';

function escapeSheetName(sheetName: string): string {
  return sheetName.replace(/'/g, "''");
}

export function sheetValuesRange(sheetName: string, a1Range = DEFAULT_WHOLE_SHEET_RANGE): string {
  return `'${escapeSheetName(sheetName)}'!${a1Range}`;
}
