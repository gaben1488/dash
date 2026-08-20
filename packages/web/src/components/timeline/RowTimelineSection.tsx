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
          <div className="h-6 w-6 shrink-0 rounded-full bg-[var(--surface-raised)]" />
          <div className="flex-1 space-y-1.5 pt-0.5">
            <div className="h-2 w-24 rounded bg-[var(--surface-raised)]" />
            <div className="h-2.5 w-3/4 rounded bg-[var(--surface-raised)]" />
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
      <p className="text-xs text-[var(--ink-muted)]">
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
        className="flex items-center gap-1.5 rounded text-xs font-medium text-[var(--ink-muted)] transition hover:text-[var(--ink-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
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
            <div className="rounded-lg bg-[var(--surface-raised)] px-3 py-2.5 text-xs">
              <p className="text-[var(--data-bad)]">История строки не загрузилась. {error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-1.5 inline-flex items-center gap-1 font-medium text-[var(--data-bad)] hover:underline"
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
