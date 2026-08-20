/**
 * Оболочка блока аналитики: заголовок-утверждение, плашка периода, методика
 * словами и место под график.
 *
 * ЗАГОЛОВОК — УТВЕРЖДЕНИЕ, А НЕ ЯРЛЫК. «Половина процедур доходит до цены
 * победителя» читается за секунду; «Воронка стадий» требует сначала
 * разглядеть картинку, а потом догадаться. Ярлык остаётся мелкой надписью
 * сверху — он нужен, чтобы блок можно было назвать в разговоре.
 *
 * МЕТОДИКА ОБЯЗАТЕЛЬНА. Число без правила счёта — это чужое мнение: читатель
 * не может ни проверить его, ни возразить. Поэтому у каждого блока стоит
 * фраза «как это посчитано», и она часть договора волны, а не украшение.
 *
 * ПЛАШКА ПЕРИОДА У КАЖДОГО БЛОКА СВОЯ (п.58): реестр — на момент чтения
 * книги, сезонность — по дате публикации, сверка — по датам обеих книг.
 */
import type { ReactNode } from 'react';
import { BookPeriodBadge } from './BookPeriodBadge';

export interface AnalyticsCardProps {
  /** Мелкая надпись — как блок называется. */
  kicker: string;
  /** Крупный заголовок — что видно в числах. */
  title: string;
  /** Как посчитано: правило, знаменатель, оговорка. */
  method: ReactNode;
  /** Подпись плашки периода: «данные книги на 18.08.2026, 14:05». */
  periodLabel: string;
  /** Честная оговорка янтарным — чего период не покрывает. */
  periodNote?: string;
  /** Переключатели блока — режим величины, основание даты. */
  controls?: ReactNode;
  children: ReactNode;
}

export function AnalyticsCard({
  kicker, title, method, periodLabel, periodNote, controls, children,
}: AnalyticsCardProps) {
  return (
    <section className="rounded-xl border border-zinc-100 dark:border-zinc-700/50 bg-white dark:bg-zinc-800/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{kicker}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h3>
        </div>
        <BookPeriodBadge label={periodLabel} {...(periodNote !== undefined ? { note: periodNote } : {})} />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        <span className="text-zinc-400 dark:text-zinc-500">Как посчитано: </span>{method}
      </p>

      {controls !== undefined && <div className="mt-3 flex flex-wrap gap-1.5">{controls}</div>}

      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Кнопка переключателя внутри блока. Выбранное состояние отличается не только
 * цветом: `aria-pressed` слышен диктору, а рамка видна в чёрно-белой печати.
 */
export function CardToggle({
  active, onClick, children, title,
}: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      {...(title !== undefined ? { title } : {})}
      className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${
        active
          ? 'border-zinc-400 dark:border-zinc-400 bg-zinc-100 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-medium'
          : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/40'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Пустота внутри блока аналитики. Отдельная от общей `EmptyState`: там речь о
 * целом экране, здесь — об одном графике, и место под него не должно
 * схлопываться, иначе страница прыгает при каждом переключении разреза.
 */
export function CardEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700 px-3 py-6 text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
      {children}
    </p>
  );
}
