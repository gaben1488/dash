/**
 * RowTimeline — вертикальная линия жизни строки книги ГРБС (канон п.75в:
 * «показывать ВСЕ изменения по строке, ОСОБЕННО просрочки — по всей истории
 * проекта, максимально красиво и корректно»).
 *
 * Компонент презентационный: данные готовит buildTimelineDisplay
 * (timeline-view.ts), загрузку ведёт RowTimelineSection. Каждый вид события —
 * со своим значком и тоном; источник (журнал / снимок / срез недели) — мелкой
 * подписью; плановая дата — якорная насечка на линии; внизу — честная подпись
 * глубины истории (historyNote сервера), а не выдуманная ретроспектива.
 */
import { useMemo } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CircleCheck,
  Coins,
  FileSignature,
  MessageSquare,
  Shuffle,
} from 'lucide-react';
import clsx from 'clsx';
import type { RowTimelineResponse } from '../../api';
import {
  buildTimelineDisplay,
  type DisplayAccent,
  type DisplayKind,
  type TimelineDisplayItem,
} from './timeline-view';

/** Палитра тонов: точка на линии + значок; обе темы. */
const ACCENT: Readonly<Record<DisplayAccent, { dot: string; icon: string }>> = {
  blue:    { dot: 'bg-blue-100 dark:bg-blue-950/60 ring-blue-300 dark:ring-blue-700',          icon: 'text-blue-600 dark:text-blue-400' },
  emerald: { dot: 'bg-emerald-100 dark:bg-emerald-950/60 ring-emerald-300 dark:ring-emerald-700', icon: 'text-emerald-600 dark:text-emerald-400' },
  amber:   { dot: 'bg-amber-100 dark:bg-amber-950/60 ring-amber-300 dark:ring-amber-700',      icon: 'text-amber-700 dark:text-amber-400' },
  violet:  { dot: 'bg-violet-100 dark:bg-violet-950/60 ring-violet-300 dark:ring-violet-700',  icon: 'text-violet-600 dark:text-violet-400' },
  zinc:    { dot: 'bg-zinc-100 dark:bg-zinc-800 ring-zinc-300 dark:ring-zinc-600',             icon: 'text-zinc-500 dark:text-zinc-400' },
  red:     { dot: 'bg-red-100 dark:bg-red-950/60 ring-red-400 dark:ring-red-700',              icon: 'text-red-600 dark:text-red-400' },
  sky:     { dot: 'bg-sky-100 dark:bg-sky-950/60 ring-sky-300 dark:ring-sky-700',              icon: 'text-sky-600 dark:text-sky-400' },
};

/** Значок по виду события; у якоря плановой даты — ромб-насечка без значка. */
function KindIcon({ kind, className }: { kind: DisplayKind; className: string }) {
  const size = 11;
  switch (kind) {
    case 'plan_date_changed': return <CalendarClock size={size} className={className} aria-hidden="true" />;
    case 'fact_date_set': return <FileSignature size={size} className={className} aria-hidden="true" />;
    case 'sum_changed': return <Coins size={size} className={className} aria-hidden="true" />;
    case 'method_changed': return <Shuffle size={size} className={className} aria-hidden="true" />;
    case 'comment_changed': return <MessageSquare size={size} className={className} aria-hidden="true" />;
    case 'overdue_started': return <AlertTriangle size={size} className={className} aria-hidden="true" />;
    case 'overdue_cleared': return <CircleCheck size={size} className={className} aria-hidden="true" />;
    default: return null;
  }
}

function EventNode({ item }: { item: TimelineDisplayItem }) {
  const tone = ACCENT[item.accent];
  const anchor = item.kind === 'plan_anchor';
  return (
    <li className="relative pl-9 pb-4 last:pb-0">
      {/* Узел на линии: ромб-насечка для плановой даты, круг для событий. */}
      <span
        className={clsx(
          'absolute left-0 top-0 flex items-center justify-center ring-1',
          anchor
            ? 'w-3.5 h-3.5 mt-0.5 ml-[5px] rotate-45 rounded-[3px]'
            : item.emphasis ? 'w-7 h-7 -ml-0.5 rounded-full' : 'w-6 h-6 rounded-full',
          tone.dot,
        )}
        aria-hidden="true"
      >
        {!anchor && <KindIcon kind={item.kind} className={tone.icon} />}
      </span>

      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {item.dateLabel}
          {item.timeLabel && <span> · {item.timeLabel}</span>}
        </span>
        {item.source && (
          <span className="text-[9px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {item.source}
          </span>
        )}
        {item.cell && (
          <span className="text-[9px] text-zinc-500 dark:text-zinc-400">ячейка {item.cell}</span>
        )}
      </div>
      <p className={clsx(
        'leading-snug',
        anchor
          ? 'text-xs font-medium text-sky-700 dark:text-sky-300'
          : item.emphasis
            ? 'text-xs font-semibold text-red-700 dark:text-red-400'
            : 'text-xs font-medium text-zinc-700 dark:text-zinc-200',
      )}>
        {item.title}
      </p>
      {item.detail && (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug break-words">
          {item.detail}
        </p>
      )}
    </li>
  );
}

export function RowTimeline({ timeline }: { timeline: RowTimelineResponse }) {
  const items = useMemo(() => buildTimelineDisplay(timeline), [timeline]);

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Изменений по строке не зафиксировано: во всех наблюдениях она одинакова,
          а журнал правок её ячеек не упоминает. История накапливается со снимками
          сервера — новые правки появятся здесь сами.
        </p>
      ) : (
        <ol className="relative" aria-label="События строки по времени">
          {/* Сама линия времени: сверху — начало истории, снизу — самое свежее. */}
          <span
            className="absolute left-[11px] top-1 bottom-1 w-px bg-zinc-200 dark:bg-zinc-700"
            aria-hidden="true"
          />
          {items.map((item) => <EventNode key={item.key} item={item} />)}
        </ol>
      )}

      {/* Честная глубина истории — фраза сервера, не выдумка витрины. */}
      <p className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-700/50 text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
        {timeline.historyNote}
        {!timeline.coverage.journalAvailable &&
          ' Журнал правок сейчас недоступен — это не значит, что правок не было.'}
      </p>
    </div>
  );
}
