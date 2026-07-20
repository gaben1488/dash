/**
 * Фильтры оси ГРБС и текстового поиска по департаментам.
 *
 * Извлечено move-only из useFilteredData.ts §1 (:40–48), §2b (:180–190),
 * §3 (:192–201), разрез E11-1.
 *
 * ВНИМАНИЕ (спека filter-system-target-2026-07-16 §3.4): двухформенный матчинг
 * ключа ГРБС (id-латиница / nameShort-кириллица) умирает при канонизации
 * DepartmentId в FilterContext (§3.3, канон — кириллица). markDeptOnlyMode —
 * маркер без математики вычитания; заменится осью orgScope (§3.2).
 */

/**
 * §1: selectedDepartments хранит канон-кириллицу (после dept-key канонизации),
 * данные API несут обе формы (.id='uer', .nameShort='УЭР') — матчим обе.
 * Пустой выбор = все проходят.
 */
export function filterDeptsByDepartments(allDepts: any[], selectedDepartments: Set<string>): any[] {
  if (selectedDepartments.size === 0) return allDepts;
  return allDepts.filter((d: any) =>
    selectedDepartments.has(d.department?.id) ||
    selectedDepartments.has(d.department?.nameShort));
}

/**
 * §2b: пометка режима «только управление» (_deptOnly). Только маркер для UI —
 * математики вычитания подвед-агрегатов нет (см. спека §3.2, замена на orgScope).
 * Пустой набор = депты не тронуты.
 */
export function markDeptOnlyMode(depts: any[], deptOnlyMode: Set<string>): any[] {
  if (deptOnlyMode.size === 0) return depts;
  return depts.map((d: any) => {
    const deptKey = d.department?.nameShort ?? d.department?.id ?? '';
    if (!deptOnlyMode.has(deptKey)) return d;
    // Mark as dept-only so UI can indicate
    return { ...d, _deptOnly: true };
  });
}

/**
 * §3: текстовый поиск по name / nameShort / id (уже нормализованный запрос —
 * trim + toLowerCase делает вызывающий). Пустой запрос = все проходят.
 */
export function filterDeptsBySearch(depts: any[], normalizedSearch: string): any[] {
  if (!normalizedSearch) return depts;
  return depts.filter((d: any) => {
    const name = (d.department?.name ?? '').toLowerCase();
    const nameShort = (d.department?.nameShort ?? '').toLowerCase();
    const id = (d.department?.id ?? '').toLowerCase();
    return name.includes(normalizedSearch) || nameShort.includes(normalizedSearch) || id.includes(normalizedSearch);
  });
}
