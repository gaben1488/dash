export function departmentSheetNameCandidates(sheetName: string, deptName: string): string[] {
  const candidates = [sheetName];
  const normalized = sheetName.trim().toLocaleUpperCase('ru-RU');
  if (normalized === 'ВСЕ') {
    candidates.push('ВСЕ', 'Все');
  }
  candidates.push(deptName);
  return [...new Set(candidates.filter(Boolean))];
}
