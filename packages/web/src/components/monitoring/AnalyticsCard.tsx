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
 *
 * ПАСПОРТ ПЕРИМЕТРА — У КАЖДОГО БЛОКА, А НЕ ОДНОЙ ФРАЗОЙ НАД СЕКЦИЕЙ. Плашка
 * периода отвечает на «когда прочитано», паспорт — на остальные четыре
 * вопроса: за какой год, за какой период, по каким органам, каким срезом.
 * Аналитика книги считается по ВСЕМУ району, поэтому область у всех блоков
 * одна — `district`: выбранное в шапке управление их числа не сужает, и
 * паспорт говорит это словами у каждого блока сам, а не полагается на одну
 * янтарную строку сверху (болезнь A1 карты «Аналитики»: одна фраза обещает
 * поведение сразу всей странице, а половина карточек ведёт себя иначе).
 */
import type { ReactNode } from 'react';
import { BookPeriodBadge } from './BookPeriodBadge';
import { MonitoringPerimeterCaption } from './PerimeterProvider';
import { CARD, CONTROL_EDGE, TILE } from './surfaces';

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
  /**
   * ОТКУДА число: книга и её листы. Требование владельца «у каждого числа
   * виден источник и момент чтения» состоит из двух половин, и момент без
   * источника отвечает только на половину вопроса — «когда прочитали», молча
   * оставляя «что именно прочитали». Умолчание верно для всей аналитики:
   * она считается по строкам восьми листов управлений, а не по своду и не по
   * книгам ГРБС. Блок, у которого источник другой (сверка читает ещё и восемь
   * книг управлений), называет его сам.
   */
  source?: string;
  /** Переключатели блока — режим величины, основание даты. */
  controls?: ReactNode;
  children: ReactNode;
}

/** Источник по умолчанию: аналитика книги считается по листам управлений. */
export const DEFAULT_ANALYTICS_SOURCE = 'книга «Ежедневный мониторинг» · восемь листов управлений';

export function AnalyticsCard({
  kicker, title, method, periodLabel, periodNote, source = DEFAULT_ANALYTICS_SOURCE,
  controls, children,
}: AnalyticsCardProps) {
  return (
    <section className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{kicker}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h3>
        </div>
        <div className="shrink-0 text-right">
          <BookPeriodBadge label={periodLabel} {...(periodNote !== undefined ? { note: periodNote } : {})} />
          <p className="mt-1 text-[10px] leading-tight text-zinc-400 dark:text-zinc-500 max-w-[16rem] break-words">
            Источник: {source}
          </p>
          <MonitoringPerimeterCaption scope="district" className="max-w-[16rem]" />
        </div>
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
          ? 'border-zinc-400 dark:border-transparent bg-zinc-100 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-medium'
          : `${CONTROL_EDGE} text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700/40`
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
 *
 * В ТЁМНОЙ ТЕМЕ МЕСТО ОЧЕРЧИВАЕТ СВЕТЛОТА, А НЕ ПУНКТИР (п.129). Пунктирная
 * рамка — не управление, не линейка таблицы и не всплывающее окно, то есть
 * ровно тот случай, где обводка становится частоколом; форму пустого места
 * держит подложка плитки, и она же читается лучше пунктира.
 */
export function CardEmpty({ children }: { children: ReactNode }) {
  return (
    <p className={`${TILE} border-dashed px-3 py-6 text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400`}>
      {children}
    </p>
  );
}
