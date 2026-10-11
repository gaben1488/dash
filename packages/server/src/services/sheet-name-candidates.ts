export function departmentSheetNameCandidates(sheetName: string, deptName: string): string[] {
  const candidates = [sheetName];
  const normalized = sheetName.trim().toLocaleUpperCase('ru-RU');
  if (normalized === 'ВСЕ') {
    candidates.push('ВСЕ', 'Все');
  }
  candidates.push(deptName);
  // Two explicitly reviewed directory migrations. Keep the stable GRBS keys
  // and old tab names readable until every consumer has switched to AG.
  if (sheetName === 'УФБП' && deptName === 'УФБП') candidates.push('УФ');
  if (sheetName === 'УДТХ' && deptName === 'УДТХ') candidates.push('УДТХиБ');
  return [...new Set(candidates.filter(Boolean))];
}
