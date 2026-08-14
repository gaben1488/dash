/**
 * Загрузка строк для «Дисциплины»: все строки выбранных управлений за год.
 *
 * Тот же путь, что у Реестра (api.getRows + collectAllPages): дела считаются
 * из тех же строк с теми же признаками, что видит Реестр, — числа на двух
 * вкладках не могут разойтись по построению. Отказы не глотаются: управления,
 * чьи книги не прочитались, возвращаются списком для честной плашки.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, humanizeRequestError } from '../../api';
import { collectAllPages } from '../../lib/rows/collect-pages';

export interface DisciplineRowsState {
  rows: Record<string, unknown>[];
  loading: boolean;
  /** Управления (ключи запроса), чьи книги не прочитались вовсе. */
  failedDepts: string[];
  /** Человеческая причина последнего отказа — для технической приписки. */
  reason: string | null;
  /** Повторить загрузку тем же набором фильтров. */
  reload: () => void;
}

export function useDisciplineRows(depts: readonly string[], year: number | 'all'): DisciplineRowsState {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [failedDepts, setFailedDepts] = useState<string[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (depts.length === 0) return;
    let cancelled = false;
    setLoading(true);

    const params: Record<string, string> = { limit: '1000' };
    if (typeof year === 'number') params.year = String(year);

    Promise.all(
      depts.map(async (dept) => {
        let failed = false;
        let error: string | null = null;
        const deptRows = await collectAllPages<Record<string, unknown>>(async (page) => {
          try {
            return await api.getRows(dept, { ...params, ...(page > 1 ? { page: String(page) } : {}) });
          } catch (err) {
            if (page === 1) failed = true;
            error = humanizeRequestError(err);
            throw err;
          }
        });
        return { dept, rows: deptRows.map((r) => ({ ...r, dept: r.dept || dept })), failed, error };
      }),
    ).then((results) => {
      if (cancelled) return;
      setRows(results.flatMap((r) => r.rows));
      setFailedDepts(results.filter((r) => r.failed).map((r) => r.dept));
      setReason(results.find((r) => r.error)?.error ?? null);
    }).catch((err: unknown) => {
      // collectAllPages отказы гасит сам; сюда попадает только неожиданное.
      if (cancelled) return;
      setRows([]);
      setFailedDepts([...depts]);
      setReason(humanizeRequestError(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
    // depts — новый массив на каждый рендер зовущего недопустим: страница
    // передаёт useMemo-список; attempt перезапускает тот же набор.
  }, [depts, year, attempt]);

  return { rows, loading, failedDepts, reason, reload };
}
