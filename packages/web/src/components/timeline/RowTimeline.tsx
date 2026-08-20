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

/**
 * Тон узла на линии: поверхность у всех узлов одна и тихая, различает их
 * ЗНАЧОК и его цвет (канон п.129: в тёмной теме поверхности — нейтральный
 * графит, цветных подложек и частокола обводок нет; цвет остаётся у данных).
 */
const DOT_SURFACE = 'bg-[var(--surface-raised)] ring-[var(--line-strong)]';
const ACCENT: Readonly<Record<DisplayAccent, { dot: string; icon: string }>> = {
  blue:    { dot: DOT_SURFACE, icon: 'text-[var(--data-info)]' },
  emerald: { dot: DOT_SURFACE, icon: 'text-[var(--data-good)]' },
  amber:   { dot: DOT_SURFACE, icon: 'text-[var(--data-warn)]' },
  violet:  { dot: DOT_SURFACE, icon: 'text-[var(--cat-4)]' },
  zinc:    { dot: DOT_SURFACE, icon: 'text-[var(--ink-muted)]' },
  red:     { dot: DOT_SURFACE, icon: 'text-[var(--data-bad)]' },
  sky:     { dot: DOT_SURFACE, icon: 'text-[var(--accent)]' },
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
        <span className="text-[10px] tabular-nums text-[var(--ink-muted)]">
          {item.dateLabel}
          {item.timeLabel && <span> · {item.timeLabel}</span>}
        </span>
        {item.source && (
          <span className="text-[9px] uppercase tracking-wide text-[var(--ink-faint)]">
            {item.source}
          </span>
        )}
        {item.cell && (
          <span className="text-[9px] text-[var(--ink-faint)]">ячейка {item.cell}</span>
        )}
      </div>
      <p className={clsx(
        'leading-snug',
        anchor
          ? 'text-xs font-medium text-[var(--accent)]'
          : item.emphasis
            ? 'text-xs font-semibold text-[var(--data-bad)]'
            : 'text-xs font-medium text-[var(--ink)]',
      )}>
        {item.title}
      </p>
      {item.detail && (
        <p className="break-words text-[11px] leading-snug text-[var(--ink-muted)]">
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
        <p className="text-xs leading-relaxed text-[var(--ink-muted)]">
          Изменений по строке не зафиксировано: во всех наблюдениях она одинакова,
          а журнал правок её ячеек не упоминает. История накапливается со снимками
          сервера — новые правки появятся здесь сами.
        </p>
      ) : (
        <ol className="relative" aria-label="События строки по времени">
          {/* Сама линия времени: сверху — начало истории, снизу — самое свежее. */}
          <span
            className="absolute left-[11px] top-1 bottom-1 w-px bg-[var(--line-strong)]"
            aria-hidden="true"
          />
          {items.map((item) => <EventNode key={item.key} item={item} />)}
        </ol>
      )}

      {/* Честная глубина истории — фраза сервера, не выдумка витрины. */}
      <p className="mt-3 border-t border-[var(--line-soft)] pt-2 text-[10px] leading-relaxed text-[var(--ink-muted)]">
        {timeline.historyNote}
        {!timeline.coverage.journalAvailable &&
          ' Журнал правок сейчас недоступен — это не значит, что правок не было.'}
      </p>
    </div>
  );
}
