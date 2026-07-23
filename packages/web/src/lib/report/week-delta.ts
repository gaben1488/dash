/**
 * Выбор пары слепков для блока «Что изменилось за неделю» (волна R1).
 *
 * Дата слепка — номер календарных суток из UTC-компонентов createdAt
 * (dayNumberOf читает компоненты ISO-строки напрямую, без Date-объекта):
 * слепок позднего вечера четверга по UTC остаётся слепком четверга на любом
 * поясе клиента — локальная полночь сдвинула бы границу суток.
 */
import { dayNumberOf } from '@aemr/shared';

/** Минимум таймлайна /api/history/snapshots, нужный для выбора пары. */
export interface SnapshotRef {
  id: string;
  createdAt: string;
}

/** Пара — сами слепки, не id: потребителю нужны и id (diff), и createdAt
 *  (подпись дат) — повторный поиск по массиву был бы мёртвой веткой с
 *  фолбэком «чужой датой» (ponytail-ревью R1 #9). */
export interface WeekSnapshotPair {
  from: SnapshotRef;
  to: SnapshotRef;
}

const DAYS_PER_WEEK = 7;

/** Последний слепок с датой ≤ maxDay; внутри одних суток — поздний по createdAt. */
function lastAtOrBefore(snapshots: readonly SnapshotRef[], maxDay: number): SnapshotRef | null {
  let best: SnapshotRef | null = null;
  let bestDay = -Infinity;
  for (const s of snapshots) {
    const day = dayNumberOf(s.createdAt);
    if (day === null || day > maxDay) continue;
    // createdAt — toISOString одного формата, лексикографика = хронология
    if (best === null || day > bestDay || (day === bestDay && s.createdAt > best.createdAt)) {
      best = s;
      bestDay = day;
    }
  }
  return best;
}

/**
 * to — последний слепок ≤ конца четверга среза (asOfDay), from — последний
 * ≤ прошлого четверга (asOfDay − 7); любой из двух отсутствует → null.
 * Совпадение from и to (за неделю слепков не прибавилось) — тоже null:
 * дифф слепка с самим собой показал бы «без изменений» там, где данные
 * попросту не собирались.
 */
export function pickWeekSnapshots(
  snapshots: readonly SnapshotRef[],
  asOfDay: number,
): WeekSnapshotPair | null {
  const to = lastAtOrBefore(snapshots, asOfDay);
  const from = lastAtOrBefore(snapshots, asOfDay - DAYS_PER_WEEK);
  if (to === null || from === null || to.id === from.id) return null;
  return { from, to };
}
