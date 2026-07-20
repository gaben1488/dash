/**
 * Фильтрация KPI-карточек по ГРБС/поиску и выбор топ-KPI по периоду и способу.
 *
 * Извлечено move-only из useFilteredData.ts §7 (:285–303), §7b (:305–312)
 * и выбора topKpis (:314–327), разрез E11-1.
 *
 * Фолбэк «нет точных ключей → первые 6 карточек» (:328–330) НЕ извлечён —
 * он помечен на смерть (спека filter-system-target-2026-07-16 §3.4) и остаётся
 * в хуке с DEPRECATED-комментарием до перехода на честный KPI-фолбэк с бейджем.
 */

/**
 * §7+§7b: карточки по выбранным ГРБС (metricKey `grbs.{deptId}.*`; сводные
 * `competitive.*`/`sole.*` проходят всегда) и по поисковому запросу.
 * Без фильтров = все карточки.
 */
export function filterKpiCards(kpiCards: any[], opts: {
  hasDeptFilter: boolean;
  /** УЖЕ отфильтрованные по осям депты — из них берутся латинские id для metricKey */
  depts: any[];
  normalizedSearch: string;
}): any[] {
  const { hasDeptFilter, depts, normalizedSearch } = opts;
  let filteredKpiCards = kpiCards;
  if (hasDeptFilter) {
    // Build set of dept IDs that are selected (need English IDs for metricKey matching)
    const selectedDeptIds = new Set<string>();
    for (const d of depts) {
      if (d.department?.id) selectedDeptIds.add(d.department.id);
    }
    filteredKpiCards = kpiCards.filter((k: any) => {
      const key = k.metricKey ?? '';
      // Summary keys (competitive.*, sole.*) — always show
      if (!key.startsWith('grbs.')) return true;
      // grbs.{deptId}.* — show only if deptId is selected
      const deptId = key.split('.')[1];
      return selectedDeptIds.has(deptId);
    });
  }

  if (normalizedSearch) {
    filteredKpiCards = filteredKpiCards.filter((k: any) => {
      const label = (k.label ?? '').toLowerCase();
      const metricKey = (k.metricKey ?? '').toLowerCase();
      return label.includes(normalizedSearch) || metricKey.includes(normalizedSearch);
    });
  }
  return filteredKpiCards;
}

/**
 * Топ-KPI: ключи `competitive.{periodKey}.*` / `sole.{periodKey}.*` с учётом
 * выбранных способов (пустой Set = оба). Возвращает НОВЫЙ массив (≤6 карточек);
 * элементы — те же объекты карточек (референсы сохранены).
 */
export function selectTopKpis(filteredKpiCards: any[], periodKey: string, selectedMethods: Set<string>): any[] {
  const kpKeys = [`competitive.${periodKey}.percent`, `competitive.${periodKey}.count`];
  const epKeys = [`sole.${periodKey}.percent`, `sole.${periodKey}.count`];
  // Single source of truth: selectedMethods Set. empty = show both.
  const wantKP = selectedMethods.size === 0 || selectedMethods.has('competitive');
  const wantEP = selectedMethods.size === 0 || selectedMethods.has('single');
  const keyMetrics = wantKP && wantEP ? [...kpKeys, ...epKeys]
    : wantKP ? kpKeys
    : wantEP ? epKeys
    : [];

  return keyMetrics
    .map(key => filteredKpiCards.find((k: any) => k.metricKey === key))
    .filter(Boolean)
    .slice(0, 6);
}
