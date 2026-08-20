/**
 * Полоса живого оповещения — «на сервере данные изменились, показать новые?».
 *
 * ПОЧЕМУ ПОЛОСА, А НЕ АВТОПОДМЕНА ЧИСЕЛ. Читатель может стоять посреди работы:
 * сверять строку, диктовать сумму по телефону, показывать экран начальнику.
 * Подменить числа под ним значит сломать то, что он делает. Поэтому продукт
 * СООБЩАЕТ об изменении и ждёт согласия, а обновляет — по нажатию.
 *
 * ТОН. Полоса ничего не требует и никого не торопит: спокойный кремовый фон,
 * ни красного, ни мигания, ни звука. Появление — единственное движение, и то
 * короткое; при системной настройке «уменьшить движение» его тоже нет.
 * Закрыть полосу можно, ничего не обновляя, — это законный выбор.
 */
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../store';
import { useLiveEvents } from '../../hooks/useLiveEvents';
import { liveDetail, liveHeadline, originLabel, relativeMoment } from './live-text';

export function LiveUpdateBar() {
  const live = useLiveEvents();
  const loading = useStore((s) => s.loading);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  // Момент показывается бегущим: полоса может провисеть минуту, и «только что»
  // к тому времени перестанет быть правдой.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live.hasNews) return;
    const timer = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, [live.hasNews]);

  const hidden = !live.hasNews || (dismissedAt !== null && dismissedAt === live.lastEventAt);
  if (hidden) return null;

  const headline = liveHeadline(live.books);
  const detail = liveDetail(live.books, live.newIssues);
  const origin = live.books[0]?.origin;

  /** Мягкое обновление: перечитывается снимок, страница не перезагружается. */
  const softRefresh = async () => {
    await useStore.getState().quickRefresh();
    live.acknowledge();
    setDismissedAt(null);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'fixed left-1/2 -translate-x-1/2 bottom-6 z-50 max-w-[min(92vw,640px)]',
        'flex items-center gap-3 px-4 py-2.5 rounded-xl',
        'bg-[#faf6ec] dark:bg-zinc-800',
        'border border-[#e6dcc4] dark:border-zinc-700',
        'shadow-lg shadow-black/5 dark:shadow-black/40',
        'text-[13px] text-zinc-700 dark:text-zinc-200',
        'live-bar-enter',
      )}
    >
      <span className="min-w-0">
        <span className="font-medium">{headline}</span>
        {detail && <span className="text-zinc-500 dark:text-zinc-400">: {detail}</span>}
        <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">
          {relativeMoment(live.lastEventAt)}
          {origin ? ` · ${originLabel(origin)}` : ''}
          {!live.connected && ' · связь с эфиром потеряна, пробуем заново'}
        </span>
      </span>

      <button
        type="button"
        onClick={() => void softRefresh()}
        disabled={loading}
        className={clsx(
          'ml-auto shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
          'bg-zinc-800 text-[#faf6ec] dark:bg-zinc-100 dark:text-zinc-900',
          'text-[12px] font-medium transition',
          'hover:bg-zinc-700 dark:hover:bg-white disabled:opacity-50 disabled:cursor-default',
        )}
      >
        <RefreshCw size={12} aria-hidden="true" className={loading ? 'animate-spin' : undefined} />
        {loading ? 'Обновляем' : 'Обновить'}
      </button>

      <button
        type="button"
        onClick={() => setDismissedAt(live.lastEventAt)}
        aria-label="Скрыть оповещение, данные не обновлять"
        title="Скрыть — числа на экране останутся прежними"
        className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
