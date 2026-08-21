/**
 * useChangeStory — журнал изменений на экране: ответ сервера плюс живой эфир.
 *
 * ПОЧЕМУ ЭФИР НАКАПЛИВАЕТСЯ ЗДЕСЬ, А НЕ БЕРЁТСЯ ИЗ `useLiveEvents`. Там
 * `recentRows` живут шесть секунд: это материал ПОДСВЕТКИ строки в Реестре, и
 * дольше он не нужен — иначе через минуту экран был бы раскрашен следами
 * позавчерашних правок. Журналу нужно ровно обратное: правка, случившаяся при
 * открытой вкладке, обязана остаться в списке, пока вкладка открыта. Поэтому
 * хук держит свой накопитель и ничего из него не выбрасывает.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО, если сервер и так отдаёт журнал книги. Журнал книги
 * читается окном в пять минут: правка, сделанная минуту назад, в ответе
 * сервера ЕЩЁ НЕ ПОЯВИТСЯ. Эфир закрывает эту дыру, а когда сервер догонит,
 * склейка по ключу схлопнет обе записи в одну (lib/changes: победитель —
 * сервер, у него есть предмет закупки из ключа журнала).
 *
 * ЧЕСТНОСТЬ ОТКАЗА. Не ответивший сервер — это НЕ «правок не было». Отказ
 * едет отдельным полем, и панель обязана сказать о нём вслух, а не показать
 * пустой список.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEntry } from '@aemr/core';
import {
  entriesFromLiveRows,
  fetchChangeStory,
  mergeStoryWithLive,
  type ChangeStoryQuery,
  type ChangeStoryResponse,
} from '../lib/changes/change-story-client';
import { useLiveEvents } from './useLiveEvents';

export interface UseChangeStoryResult {
  /** Ответ сервера целиком; null — ещё не читали либо чтение не удалось. */
  readonly response: ChangeStoryResponse | null;
  /** Список правок: ответ сервера, склеенный с накопленным эфиром. */
  readonly entries: readonly ChangeEntry[];
  /** Идёт чтение. */
  readonly loading: boolean;
  /** Отказ чтения человеческой фразой; null — отказа не было. */
  readonly error: string | null;
  /** Момент последнего удачного чтения (ISO); null — не читали. */
  readonly readAt: string | null;
  /** Перечитать по кнопке. */
  readonly reload: () => void;
}

/** Ключ запроса: смена отбора обязана вызывать перечитку, и только она. */
function queryKey(query: ChangeStoryQuery): string {
  return JSON.stringify([
    query.since ?? '',
    [...(query.books ?? [])].sort(),
    [...(query.kinds ?? [])].sort(),
    [...(query.authors ?? [])].sort(),
    (query.search ?? '').trim(),
    query.limit ?? 0,
  ]);
}

/**
 * Чтение журнала. `enabled: false` — не читать вовсе (панель свёрнута):
 * журнал книги велик, и дёргать его на каждой странице продукта незачем.
 */
export function useChangeStory(query: ChangeStoryQuery, enabled = true): UseChangeStoryResult {
  const live = useLiveEvents(enabled);
  const [response, setResponse] = useState<ChangeStoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [again, setAgain] = useState(0);

  // Накопитель эфира: сюда правки только добавляются. Ref, а не состояние,
  // чтобы приход события не пересобирал список на каждом кадре.
  const seenIds = useRef<Set<string>>(new Set());
  const [liveEntries, setLiveEntries] = useState<ChangeEntry[]>([]);

  const key = queryKey(query);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetchChangeStory(query)
      .then((data) => {
        if (!alive) return;
        setResponse(data);
        setReadAt(new Date().toISOString());
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // Пустой список после отказа читался бы как «правок не было» —
        // ровно та подмена, против которой написан весь этот журнал.
        setResponse(null);
        setError(
          'Журнал изменений не прочитан — сервер не ответил. Это не «правок не было»: ' +
          `список ниже неполон. ${(err as Error)?.message ?? ''}`.trim(),
        );
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // Запрос пересобирается по КЛЮЧУ отбора, а не по ссылке на объект: иначе
    // каждый рендер родителя заново дёргал бы журнал в тридцать тысяч строк.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, again]);

  useEffect(() => {
    if (!enabled || live.recentRows.length === 0) return;
    const fresh = entriesFromLiveRows(live.recentRows).filter((e) => !seenIds.current.has(e.id));
    if (fresh.length === 0) return;
    for (const e of fresh) seenIds.current.add(e.id);
    setLiveEntries((prev) => [...prev, ...fresh]);
  }, [live.recentRows, enabled]);

  const entries = useMemo(
    () => mergeStoryWithLive(response?.entries ?? [], liveEntries),
    [response, liveEntries],
  );

  const reload = useCallback(() => setAgain((n) => n + 1), []);

  return { response, entries, loading, error, readAt, reload };
}
