/**
 * useTextHygiene — загрузка перечня гигиены текста (GET /api/text-hygiene).
 *
 * Запрос уходит один раз на открытие раздела (enabled), повтор — только по
 * кнопке читателя: сервер держит пятиминутный кэш, дёргать его на каждое
 * переключение фильтров незачем — фильтры работают по уже полученному ответу.
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
import { useCallback, useEffect, useState } from 'react';
import { fetchJSON, humanizeRequestError } from '../../api';
import type { TextHygieneResponse } from './contract';

export interface UseTextHygieneResult {
  data: TextHygieneResponse | null;
  loading: boolean;
  /** Русская фраза отказа; null — отказа не было. */
  error: string | null;
  reload: () => void;
}

export function useTextHygiene(enabled = true): UseTextHygieneResult {
  const [data, setData] = useState<TextHygieneResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Первый запрос живёт серверным кэшем (дёшево), повтор по кнопке требует
    // свежести: перечитать книги и пересчитать, а не отдать то же окно кэша.
    fetchJSON<TextHygieneResponse>(attempt === 0 ? '/text-hygiene' : '/text-hygiene?refresh=true')
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

    return () => { cancelled = true; };
  }, [enabled, attempt]);

  return { data, loading, error, reload };
}
