/**
 * useTextHygiene — загрузка перечня гигиены текста (GET /api/text-hygiene).
 *
 * Запрос уходит при открытии раздела и принятии нового снимка источников.
 * Кнопка читателя принудительно перечитывает книги; переключение
 * фильтров не вызывает запрос — фильтры работают по уже полученному ответу.
 *
 * Кнопка «перечитать» шлёт ?refresh=true: сервер сначала перечитывает САМИ
 * книги и только потом пересчитывает. Без этого кнопка возвращала тот же
 * пятиминутный кэш, и исправленная в книге находка не гасла (прецедент
 * 20.08.2026: правка G174 УКСиМП не убирала карточку с экрана).
 *
 * Три различимых исхода вместо одного флага: loading (ответа ещё нет), error
 * (сервер отказал — русской фразой и с возможностью повторить), data (ответ
 * пришёл). Пустоту хук не выдумывает: «дефектов нет» и «книги не прочитаны»
 * различает сам ответ (cellsChecked, booksSilent), подменять их общим null нельзя.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJSON, humanizeRequestError } from '../../api';
import { useStore } from '../../store';
import type { TextHygieneResponse } from './contract';

export interface UseTextHygieneResult {
  data: TextHygieneResponse | null;
  loading: boolean;
  /** Русская фраза отказа; null — отказа не было. */
  error: string | null;
  reload: () => void;
}

export function useTextHygiene(enabled = true): UseTextHygieneResult {
  const snapshotId = useStore((state) => state.dashboardData?.snapshot.id ?? null);
  const [data, setData] = useState<TextHygieneResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestedAttempt = useRef(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Только новое нажатие требует Google-чтения. После принятия общего
    // снимка источники уже прочитаны: получаем актуальный серверный ответ.
    const manualRead = attempt > requestedAttempt.current;
    requestedAttempt.current = attempt;
    fetchJSON<TextHygieneResponse>(manualRead ? '/text-hygiene?refresh=true' : '/text-hygiene')
      .then((response) => {
        if (cancelled) return;
        setData(response);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Прежний ответ не стираем: устаревший перечень с названным моментом
        // чтения честнее пустого места, а плашка отказа висит рядом.
        setError(humanizeRequestError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, attempt, snapshotId]);

  return { data, loading, error, reload };
}
