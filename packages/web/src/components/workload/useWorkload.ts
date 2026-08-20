/**
 * useWorkload — загрузка нагрузки управлений (GET /api/workload).
 *
 * Роут тяжёлый: он открывает журналы правок всех восьми книг (около 40 тыс.
 * записей) и пересчитывает строки каждой. Поэтому запрос уходит один раз на
 * открытие вкладки, повтор — только по кнопке читателя.
 *
 * Три различимых исхода вместо одного флага: loading (ответа ещё нет), error
 * (сервер отказал — русской фразой и с возможностью повторить), data (ответ
 * пришёл). Пустоту хук не выдумывает: «журнал не прочитан» и «правок не было»
 * различает сам ответ, и подменять их общим null нельзя.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchJSON, humanizeRequestError } from '../../api';
import type { WorkloadResponse } from './contract';

export interface UseWorkloadResult {
  data: WorkloadResponse | null;
  loading: boolean;
  /** Русская фраза отказа; null — отказа не было. */
  error: string | null;
  reload: () => void;
}

export function useWorkload(enabled = true): UseWorkloadResult {
  const [data, setData] = useState<WorkloadResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchJSON<WorkloadResponse>('/workload')
      .then((response) => {
        if (cancelled) return;
        setData(response);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Прежний ответ не стираем: устаревшие числа с названным моментом
        // чтения честнее пустого места, а плашка отказа висит рядом.
        setError(humanizeRequestError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled, attempt]);

  return { data, loading, error, reload };
}
