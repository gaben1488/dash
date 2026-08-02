/**
 * Слияние списков подведов для фильтра организаций.
 *
 * Класс бага «источник прочитан частично и молчит»: /api/rows/subordinates
 * строится из живой колонки C книг; недоступная книга пропускается, а во
 * время массовой правки листа колонка читается неполной. Старый merge
 * `{ ...fallback, ...api }` ЗАМЕНЯЛ канон таким неполным списком — из
 * фильтра «пропадала часть организаций» до перезагрузки страницы.
 *
 * Правило: фильтр — навигация, пропадание пунктов недопустимо, лишний
 * пункт безвреден (отфильтрует в ноль строк). Поэтому объединение:
 * канон-реестр ∪ живые имена, по каждому управлению.
 */
export function mergeSubordinates(
  fallback: Record<string, string[]>,
  api: Record<string, string[]>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = Object.fromEntries(
    Object.entries(fallback).map(([dept, subs]) => [dept, [...subs]]),
  );
  for (const [dept, subs] of Object.entries(api)) {
    const union = new Set([...(merged[dept] ?? []), ...subs]);
    merged[dept] = Array.from(union).sort((a, b) => a.localeCompare(b, 'ru'));
  }
  return merged;
}
