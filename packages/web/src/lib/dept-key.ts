/**
 * Канонизация ключа ГРБС на входе в store (фильтр-спека 16.07, «второе ружьё» Б5).
 *
 * Ключ ГРБС живёт в двух формах: кириллический канон ('УЭР', DepartmentId) и
 * латинский slug ('uer', latinId). Разные писатели клали в selectedDepartments
 * РАЗНЫЕ формы (OrgStrip — кириллицу из subordinatesMap, navigateTo со страниц —
 * латиницу из DTO) → фильтры issues/deltas матчились или нет в зависимости от
 * того, КТО последний писал. Канон store: кириллица; сравнение — обе формы.
 */
import { LATIN_TO_CYRILLIC, CYRILLIC_TO_LATIN } from '@aemr/shared';

/** Любая форма → кириллический канон ('uer' → 'УЭР'; 'УЭР' → 'УЭР'; чужое — как есть). */
export function toCanonicalDeptId(key: string): string {
  return (LATIN_TO_CYRILLIC as Record<string, string>)[key] ?? key;
}

/** Обе формы ключа для сравнения с данными любого происхождения. */
export function bothDeptKeyForms(keys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const k of keys) {
    out.add(k);
    const cyr = (LATIN_TO_CYRILLIC as Record<string, string>)[k];
    if (cyr) out.add(cyr);
    const lat = (CYRILLIC_TO_LATIN as Record<string, string>)[k];
    if (lat) out.add(lat);
  }
  return out;
}
