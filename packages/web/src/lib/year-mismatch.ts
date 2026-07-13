/** Показывать баннер «данные за другой год» ТОЛЬКО при реальном несовпадении
 *  числового выбранного года и года данных, и не во время загрузки. */
export function shouldShowYearMismatch(
  storeYear: number | 'all',
  dataYear: number | undefined,
  isLoading: boolean,
): boolean {
  if (isLoading) return false;
  if (storeYear === 'all') return false;
  if (dataYear == null) return false;
  return storeYear !== dataYear;
}
