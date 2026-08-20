/**
 * Загрузка двух разделов-новосёлов: адресные признаки (GET /api/anomalies) и
 * целостность книг (GET /api/integrity).
 *
 * Один хук на оба, потому что различаются они только адресом: правило чтения
 * общее — запрос уходит один раз на открытие раздела, повтор только по кнопке
 * читателя. Оба роута перебирают строки всех восьми книг, а первый ещё и их
 * журналы; дёргать такое на каждый ререндер нельзя.
 *
 * Три различимых исхода вместо одного флага: loading (ответа ещё нет), error
 * (сервер отказал — русской фразой, с возможностью повторить), data (ответ
 * пришёл). Прежний ответ при отказе НЕ стирается: устаревшие числа с названным
 * моментом чтения честнее пустого места, а плашка отказа висит рядом.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchJSON, humanizeRequestError } from '../../api';
import type { AnomaliesResponse, IntegrityResponse } from './contract';

export interface UseRemoteResult<T> {
  data: T | null;
  loading: boolean;
  /** Русская фраза отказа; null — отказа не было. */
  error: string | null;
  reload: () => void;
}

function useRemote<T>(path: string, enabled: boolean): UseRemoteResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchJSON<T>(path)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(humanizeRequestError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [path, enabled, attempt]);

  return { data, loading, error, reload };
}

/** Признаки странностей строк — раздел «Аналитика». */
export function useAnomalies(enabled = true): UseRemoteResult<AnomaliesResponse> {
  return useRemote<AnomaliesResponse>('/anomalies', enabled);
}

/** Целостность книг — раздел «Контроль». */
export function useIntegrity(enabled = true): UseRemoteResult<IntegrityResponse> {
  return useRemote<IntegrityResponse>('/integrity', enabled);
}
