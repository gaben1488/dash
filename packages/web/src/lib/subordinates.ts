/**
 * Слияние списков подведов для фильтра организаций.
 *
 * Класс бага «источник прочитан частично и молчит»: /api/rows/subordinates
 * строится из живой колонки C книг; недоступная книга пропускается, а во
 * время массовой правки листа колонка читается неполной. Старый merge
 * `{ ...fallback, ...api }` ЗАМЕНЯЛ канон таким неполным списком — из
 * фильтра «пропадала часть организаций» до перезагрузки страницы.
 *
 * Правило: фильтр — навигация, пропадание пунктов недопустимо.
 * Канон-реестр сохраняется при недоступном источнике; успешное чтение книги
 * выбирает живое написание. Только типографские формы имени совпадают,
 * разные организации не соединяются по расплывчатому семантическому сходству.
 */
import { ORG_ITSELF_SENTINEL, subordinateNameMatchKey } from '@aemr/shared';

export function mergeSubordinates(
  fallback: Record<string, string[]>,
  api: Record<string, string[]>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const dept of new Set([...Object.keys(fallback), ...Object.keys(api)])) {
    const names = new Map<string, string>();
    const canonical = new Map<string, string>();
    // Keep known organizations when a source read is partial or unavailable.
    for (const name of fallback[dept] ?? []) {
      const key = subordinateNameMatchKey(name);
      if (key === ORG_ITSELF_SENTINEL) continue;
      names.set(key, name);
      canonical.set(key, name);
    }
    const live = api[dept] ?? [];
    const liveNames = new Set(live);
    // Prefer the active spelling when a read contains both generations.
    // A historical-only snapshot retains its original visible label.
    for (const name of live) {
      const key = subordinateNameMatchKey(name);
      if (key === ORG_ITSELF_SENTINEL) continue;
      const current = canonical.get(key);
      names.set(key, current && liveNames.has(current) ? current : name);
    }
    merged[dept] = [...names.values()].sort((a, b) => a.localeCompare(b, 'ru'));
  }
  return merged;
}
