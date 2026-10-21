/**
 * Канонизация ключа ГРБС на входе в store (фильтр-спека 16.07, «второе ружьё» Б5).
 *
 * Ключ ГРБС живёт в двух формах: кириллический канон ('УЭР', DepartmentId) и
 * латинский slug ('uer', latinId). Разные писатели клали в selectedDepartments
 * РАЗНЫЕ формы (OrgStrip — кириллицу из subordinatesMap, navigateTo со страниц —
 * латиницу из DTO) → фильтры issues/deltas матчились или нет в зависимости от
 * того, КТО последний писал. Канон store: кириллица; сравнение — обе формы.
 */
import { DEPARTMENT_ALIASES, findDept } from '@aemr/shared';

/** Любая форма → кириллический канон ('uer' → 'УЭР'; 'УЭР' → 'УЭР'; чужое — как есть). */
export function toCanonicalDeptId(key: string): string {
  return findDept(key)?.id ?? key;
}

/** Идентификаторы и принятое название для сравнения с данными любого происхождения. */
export function bothDeptKeyForms(keys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const k of keys) {
    out.add(k);
    const dept = findDept(k);
    if (dept) {
      out.add(dept.id);
      out.add(dept.latinId);
      out.add(dept.shortName);
      for (const [alias, id] of Object.entries(DEPARTMENT_ALIASES)) {
        if (id === dept.id) out.add(alias);
      }
    }
  }
  return out;
}
