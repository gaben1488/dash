/**
 * useScorecard — оценка управлений и нарушения норм закона за один заход
 * (GET /api/analytics/scorecard + GET /api/analytics/compliance).
 *
 * ДВА ОТВЕТА, ДВА ИСХОДА. Маршруты независимы, и падают они порознь: оценка
 * читает пересчёт плана-факта, нарушения — сырые строки книг. Общий флаг
 * ошибки похоронил бы половину экрана из-за отказа другой половины, поэтому
 * отказ по нарушениям живёт отдельным полем и таблицу грейдов не гасит.
 *
 * Запрос уходит один раз на открытие вкладки: оба маршрута перебирают строки
 * всех восьми книг, гонять их на каждый рендер незачем. Повтор — по кнопке
 * читателя.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchJSON, humanizeRequestError } from '../../api';
import type { ComplianceResponse, ScorecardData, ScorecardResponse } from './contract';

export interface UseScorecardResult {
  data: ScorecardData | null;
  loading: boolean;
  /** Русская фраза отказа по оценке; null — отказа не было. */
  error: string | null;
  reload: () => void;
}

export function useScorecard(enabled = true): UseScorecardResult {
  const [data, setData] = useState<ScorecardData | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const scorecard = fetchJSON<ScorecardResponse>('/analytics/scorecard');
    // Нарушения закона просим отдельно и отказ по ним ловим здесь же: пусть
    // таблица грейдов доедет до экрана даже без второго ответа.
    const compliance = fetchJSON<ComplianceResponse>('/analytics/compliance').then(
      (value) => ({ value, error: null as string | null }),
      (err: unknown) => ({ value: null, error: humanizeRequestError(err) }),
    );

    Promise.all([scorecard, compliance])
      .then(([scorecardValue, complianceResult]) => {
        if (cancelled) return;
        setData({
          scorecard: scorecardValue,
          compliance: complianceResult.value,
          complianceError: complianceResult.error,
          // Ни один из маршрутов не сообщает, на какой момент прочитаны книги.
          // Поэтому плашка называет то, что известно точно: когда ответ получен.
          readAt: new Date().toISOString(),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Прежний ответ не стираем: устаревшие числа с названным моментом
        // честнее пустого места, а плашка отказа висит рядом.
        setError(humanizeRequestError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [enabled, attempt]);

  return { data, loading, error, reload };
}
