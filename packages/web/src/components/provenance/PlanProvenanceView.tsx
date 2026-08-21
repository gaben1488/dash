/**
 * PlanProvenanceView — «Откуда взялась плановая сумма» на экране.
 *
 * Компонент презентационный: данные готовит provenance-view.ts, загрузку ведёт
 * PlanProvenanceSection. Порядок сверху вниз повторяет порядок вопросов
 * читателя: сколько план сейчас → что с ним делали → сколько с него сняли
 * задним числом → можно ли этой истории верить.
 *
 * Плашка наблюдаемости стоит ВЫШЕ ленты не случайно: если журнал книги почти
 * не ведётся, короткая лента без предупреждения читается как «правок почти не
 * было», то есть ровно наоборот (канон п.102 — дыра наблюдаемости не равна
 * отсутствию практики).
 */
import { AlertTriangle, ArrowDownRight, ArrowUpRight, EyeOff, PenLine, Wrench } from 'lucide-react';
import clsx from 'clsx';
import type { RowProvenanceResponse } from '../../lib/provenance/contract';
import {
  assessJournal,
  buildProvenanceEvents,
  buildRetroCutHeadline,
  emptyLedgerNote,
  type ProvenanceEventView,
  type ProvenanceTone,
} from './provenance-view';

/** Палитра тонов ленты: кружок узла и значок; обе темы. */
const TONE: Readonly<Record<ProvenanceTone, { dot: string; icon: string }>> = {
  red: { dot: 'bg-red-100 dark:bg-red-950/60 ring-red-400 dark:ring-red-700', icon: 'text-red-600 dark:text-red-400' },
  amber: { dot: 'bg-amber-100 dark:bg-amber-950/60 ring-amber-300 dark:ring-amber-700', icon: 'text-amber-700 dark:text-amber-400' },
  violet: { dot: 'bg-violet-100 dark:bg-violet-950/60 ring-violet-300 dark:ring-violet-700', icon: 'text-violet-600 dark:text-violet-400' },
  zinc: { dot: 'bg-zinc-100 dark:bg-zinc-800 ring-zinc-300 dark:ring-zinc-600', icon: 'text-zinc-500 dark:text-zinc-400' },
};

function EventIcon({ tone, className }: { tone: ProvenanceTone; className: string }) {
  const size = 11;
  if (tone === 'red') return <ArrowDownRight size={size} className={className} aria-hidden="true" />;
  if (tone === 'amber') return <AlertTriangle size={size} className={className} aria-hidden="true" />;
  if (tone === 'violet') return <PenLine size={size} className={className} aria-hidden="true" />;
  return <Wrench size={size} className={className} aria-hidden="true" />;
}

function EventNode({ item }: { item: ProvenanceEventView }) {
  const tone = TONE[item.tone];
  return (
    <li className="relative pl-9 pb-3.5 last:pb-0">
      <span
        className={clsx(
          'absolute left-0 top-0 flex items-center justify-center ring-1 rounded-full',
          item.emphasis ? 'w-7 h-7 -ml-0.5' : 'w-6 h-6',
          tone.dot,
        )}
        aria-hidden="true"
      >
        <EventIcon tone={item.tone} className={tone.icon} />
      </span>

      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {item.dateLabel}
          {item.timeLabel && <span> · {item.timeLabel}</span>}
        </span>
        {item.author && (
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 break-all">{item.author}</span>
        )}
      </div>

      <div
        className={clsx(
          'text-xs font-medium',
          item.emphasis
            ? 'text-red-700 dark:text-red-300'
            : 'text-zinc-700 dark:text-zinc-200',
        )}
        title={item.kindHint}
      >
        {item.kindLabel}
      </div>

      <div className="text-[11px] text-zinc-600 dark:text-zinc-300 tabular-nums">
        {item.transition} <span className="text-zinc-400 dark:text-zinc-500">тыс. ₽</span>
      </div>

      <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
        ячейка {item.cell} · {item.columnLabel}
        {item.afterFact && (
          <span className="ml-1.5 text-red-600 dark:text-red-400">правка уже после заключения</span>
        )}
      </div>
    </li>
  );
}

export function PlanProvenanceView({ provenance }: { provenance: RowProvenanceResponse }) {
  const notice = assessJournal(provenance);
  const events = buildProvenanceEvents(provenance.events);
  const headline = buildRetroCutHeadline(provenance);

  return (
    <div className="space-y-3">
      {/* Наблюдаемость: можно ли вообще судить по этой ленте. */}
      {notice && (
        <div
          className="flex items-start gap-2 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/25 border border-amber-200 dark:border-transparent"
          role="note"
        >
          <EyeOff size={13} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{notice.title}</p>
            <p className="text-[11px] text-amber-700/90 dark:text-amber-400/80 leading-relaxed mt-0.5">
              {notice.detail}
            </p>
          </div>
        </div>
      )}

      {/* Дубли «№ п/п»: история двух закупок под одним номером неразделима. */}
      {provenance.ambiguity && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
          {provenance.ambiguity.note}
        </p>
      )}

      {/* Лента правок плановых ячеек — от свежей к старой. */}
      {events.length > 0 ? (
        <ol className="relative" aria-label="Правки плановой суммы по времени">
          {/* Линия времени: сверху самое свежее, ниже — что было до него. */}
          <span
            className="absolute left-[11px] top-1 bottom-1 w-px bg-zinc-200 dark:bg-zinc-700"
            aria-hidden="true"
          />
          {events.map((item) => (
            <EventNode key={item.key} item={item} />
          ))}
        </ol>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {emptyLedgerNote(provenance)}
        </p>
      )}

      {/* Итог: сколько плана ушло задним числом и что это означает. */}
      <div
        className={clsx(
          'rounded-lg px-3 py-2.5 border',
          headline.present
            ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-transparent'
            : 'bg-zinc-50 dark:bg-zinc-900/40 border-zinc-200 dark:border-transparent',
        )}
      >
        <p
          className={clsx(
            'text-xs font-semibold tabular-nums',
            headline.present
              ? 'text-red-700 dark:text-red-300'
              : 'text-zinc-600 dark:text-zinc-300',
          )}
        >
          {headline.present && (
            <ArrowUpRight size={12} className="inline mr-1 -mt-0.5 rotate-90" aria-hidden="true" />
          )}
          {headline.title}
        </p>
        <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed mt-1">
          {headline.mechanism}
        </p>
        {headline.afterFact && (
          <p className="text-[11px] text-red-700 dark:text-red-300 leading-relaxed mt-1">
            {headline.afterFact}
          </p>
        )}
        {headline.excluded && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-500 leading-relaxed mt-1">
            {headline.excluded}
          </p>
        )}
      </div>

      {/* Фраза диагноста от сервера — единственный дом этих формулировок. */}
      <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
        {provenance.summary.note}
      </p>
    </div>
  );
}
