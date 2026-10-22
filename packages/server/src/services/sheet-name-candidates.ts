import { findDept } from '@aemr/shared';

export function departmentSheetNameCandidates(sheetName: string, deptName: string): string[] {
  const candidates = [sheetName];
  const normalized = sheetName.trim().toLocaleUpperCase('ru-RU');
  if (normalized === 'ВСЕ') {
    candidates.push('ВСЕ', 'Все');
  }
  candidates.push(deptName);
  // Stable source names stay first; the active directory name is a fallback.
  const department = findDept(deptName);
  if (department && sheetName === department.id) candidates.push(department.shortName);
  return [...new Set(candidates.filter(Boolean))];
}
