/**
 * Фильтрация дельт сверки (deltas) по оси ГРБС.
 *
 * Извлечено move-only из useFilteredData.ts §5 (:240–249), разрез E11-1.
 *
 * ВНИМАНИЕ (спека filter-system-target-2026-07-16 §3.4): двухформенный матчинг
 * депт-ключей умирает при канонизации DepartmentId в FilterContext.
 */
export function filterDeltas(
  allDeltas: any[],
  /** Обе формы выбранных ключей ГРБС (кириллица+латиница), см. bothDeptKeyForms */
  selectedDeptBothForms: Set<string>,
  hasDeptFilter: boolean,
): any[] {
  if (!hasDeptFilter) return allDeltas;
  return allDeltas.filter((d: any) => {
    if (!d.metricKey) return true;
    // metricKey has format grbs.uer.kp.q1.count — dept id (uer) is at position 1;
    // сверка по обеим формам ключа (Б5: кириллица в selected ломала матч латиницы)
    const keyDeptId = d.metricKey.split('.')[1] ?? '';
    return selectedDeptBothForms.has(keyDeptId);
  });
}
