/**
 * RowTimelineSection — секция «История строки» для карточки строки.
 *
 * Ленивая: запрос /api/timeline/:deptId/:sheetRow уходит только при первом
 * раскрытии (карточку открывают чаще, чем читают историю, — не грузим зря).
 * Пока ответа нет — скелет; отказ — русская фраза с действием «повторить».
 */
import { useCallback, useState } from 'react';
import { ChevronDown, History, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { api, humanizeRequestError, type RowTimelineResponse } from '../../api';
import { RowTimeline } from './RowTimeline';

interface RowTimelineSectionProps {
  /** Канонический id книги ГРБС («УО»). */
  deptId: string;
  /** 1-based номер строки листа; данные книг начинаются со строки 4. */
  sheetRow: number;
}

function TimelineSkeleton() {
  return (
    <div className="space-y-3 animate-pulse" role="status" aria-live="polite">
      <span className="sr-only">Собираем историю строки из журнала правок и снимков</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-700/60 shrink-0" />
          <div className="flex-1 space-y-1.5 pt-0.5">
            <div className="h-2 w-24 rounded bg-zinc-100 dark:bg-zinc-700/60" />
            <div className="h-2.5 w-3/4 rounded bg-zinc-100 dark:bg-zinc-700/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RowTimelineSection({ deptId, sheetRow }: RowTimelineSectionProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<RowTimelineResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTimeline(await api.getRowTimeline(deptId, sheetRow));
    } catch (err) {
      setError(humanizeRequestError(err));
    } finally {
      setLoading(false);
    }
  }, [deptId, sheetRow]);

  const toggle = useCallback(() => {
    setOpen((was) => {
      const now = !was;
      if (now && timeline === null && !loading) void load();
      return now;
    });
  }, [timeline, loading, load]);

  // Адрес строки в книге неизвестен — историю запросить не по чему; честно
  // говорим причину вместо кнопки, которая обещала бы невозможное.
  if (!deptId || sheetRow <= 3) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        История недоступна: адрес строки в книге неизвестен, запросить журнал и снимки не по чему.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-zinc-100 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 rounded"
      >
        <History size={13} aria-hidden="true" />
        {open ? 'Свернуть историю' : 'Показать историю строки'}
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={clsx('transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="mt-3">
          {loading ? (
            <TimelineSkeleton />
          ) : error ? (
            <div className="text-xs bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2.5">
              <p className="text-red-700 dark:text-red-300">История строки не загрузилась. {error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-1.5 inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-300 hover:underline"
              >
                <RotateCcw size={11} aria-hidden="true" /> Запросить ещё раз
              </button>
            </div>
          ) : timeline ? (
            <RowTimeline timeline={timeline} />
          ) : null}
        </div>
      )}
    </div>
  );
}
