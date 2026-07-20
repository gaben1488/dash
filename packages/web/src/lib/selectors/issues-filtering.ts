/**
 * Фильтрация замечаний (issues) по осям ГРБС / подвед / поиск / вид деятельности.
 *
 * Извлечено move-only из useFilteredData.ts §4 (:203–229), §4b (:231–238)
 * и severity-разбиение (:843–844), разрез E11-1.
 *
 * ВНИМАНИЕ (спека filter-system-target-2026-07-16 §3.4): двухформенный матчинг
 * депт-ключей (selectedDeptBothForms) умирает при канонизации DepartmentId
 * в FilterContext; до резки — обе формы (Б5).
 */
export function filterIssues(allIssues: any[], opts: {
  hasDeptFilter: boolean;
  /** Обе формы выбранных ключей ГРБС (кириллица+латиница), см. bothDeptKeyForms */
  selectedDeptBothForms: Set<string>;
  selectedSubordinates: Set<string>;
  normalizedSearch: string;
  selectedActivities: Set<string>;
}): any[] {
  const { hasDeptFilter, selectedDeptBothForms, selectedSubordinates, normalizedSearch, selectedActivities } = opts;
  const hasSubFilter = selectedSubordinates.size > 0;

  // Обе формы ключа ГРБС (кириллица+латиница): данные разного происхождения
  // несут разные формы, сравнение по одной форме молча пропускало фильтр (Б5).
  let issues = hasDeptFilter
    ? allIssues.filter((i: any) => {
        if (!i.departmentId) return true;
        return selectedDeptBothForms.has(i.departmentId) || selectedDeptBothForms.has(i.department);
      })
    : allIssues;

  if (hasSubFilter) {
    issues = issues.filter((i: any) => {
      // Issues without subordinateId pass through (org-level issues)
      if (!i.subordinateId) return true;
      return selectedSubordinates.has(i.subordinateId);
    });
  }

  if (normalizedSearch) {
    issues = issues.filter((i: any) => {
      const title = (i.title ?? '').toLowerCase();
      const desc = (i.description ?? '').toLowerCase();
      const dept = (i.departmentId ?? '').toLowerCase();
      return title.includes(normalizedSearch) || desc.includes(normalizedSearch) || dept.includes(normalizedSearch);
    });
  }

  // §4b. Activity filter for issues (multi-select)
  if (selectedActivities.size > 0) {
    issues = issues.filter((i: any) => {
      // Issues without activityType (СВОД-level, mapping) pass through
      if (!i.activityType) return true;
      return selectedActivities.has(i.activityType);
    });
  }

  return issues;
}

/** Severity-разбиение отфильтрованных issues (бывшие :843–844). */
export function splitIssuesBySeverity(issues: any[]): { criticalIssues: any[]; warningIssues: any[] } {
  return {
    criticalIssues: issues.filter((i: any) => i.severity === 'critical' || i.severity === 'error'),
    warningIssues: issues.filter((i: any) => i.severity === 'warning' || i.severity === 'significant'),
  };
}
