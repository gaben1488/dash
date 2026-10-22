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

function useRemote<T>(
  path: string,
  enabled: boolean,
  rereadSourceOnReload = false,
  softRefreshEvent?: string,
  freshOnOpen = false,
): UseRemoteResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  // Manual refresh may read Google; SSE revalidation MUST only read local API.
  // The Control screen must compare the current source with Thursday even if
  // Drive never delivered a webhook. One explicit read on mount, no polling.
  const [request, setRequest] = useState({ version: 0, forceSource: freshOnOpen });
  const reload = useCallback(() => setRequest((r) => ({
    version: r.version + 1, forceSource: true,
  })), []);

  useEffect(() => {
    if (!enabled || !softRefreshEvent || typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setRequest((r) => ({ version: r.version + 1, forceSource: false }));
      }, 600);
    };
    window.addEventListener(softRefreshEvent, onChange);
    return () => {
      window.removeEventListener(softRefreshEvent, onChange);
      if (timer !== null) clearTimeout(timer);
    };
  }, [enabled, softRefreshEvent]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Только явная кнопка перечитывает Google; сигнал после webhook — дешёвый
    // GET локальной версии с TTL/source watermark, без дополнительного Google I/O.
    const requestPath = rereadSourceOnReload && request.forceSource ? `${path}?refresh=true` : path;
    fetchJSON<T>(requestPath)
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
  }, [path, enabled, request.version, request.forceSource, rereadSourceOnReload]);

  return { data, loading, error, reload };
}

/** Признаки странностей строк — раздел «Аналитика». */
export function useAnomalies(enabled = true): UseRemoteResult<AnomaliesResponse> {
  return useRemote<AnomaliesResponse>('/anomalies', enabled);
}

/** Целостность книг — при открытии независимая сверка с Google, далее дешёвый SSE. */
export function useIntegrity(enabled = true): UseRemoteResult<IntegrityResponse> {
  return useRemote<IntegrityResponse>('/integrity', enabled, true, 'department-books-updated', true);
}
