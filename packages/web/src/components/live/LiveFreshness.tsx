/**
 * Отметка свежести в шапке — «обновлено только что» с бегущим временем.
 *
 * Раньше единственным ответом на вопрос «свежее ли то, что я вижу» был обратный
 * отсчёт до следующего опроса. Это ответ про будущее, а читателю нужен ответ про
 * прошлое: когда числа на экране в последний раз совпадали с книгами.
 *
 * Отметка намеренно тихая: серый мелкий текст, никакого цвета. Цвет в этом
 * продукте принадлежит данным, а не хрому.
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useStore } from '../../store';
import { useLiveEvents } from '../../hooks/useLiveEvents';
import { relativeMoment } from './live-text';

/** Как часто перерисовывать подпись. Раз в 15 секунд — «только что» не врёт. */
const TICK_MS = 15_000;

export function LiveFreshness({ className }: { className?: string }) {
  const lastRefreshed = useStore((s) => s.lastRefreshed);
  const live = useLiveEvents();
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const label = relativeMoment(lastRefreshed);
  // Эфир — отдельное обещание от свежести чисел: поток может быть открыт, а
  // данные на экране прежними (никто ничего не правил). И наоборот: поток
  // оборвался — числа не устарели мгновенно, но новостей мы больше не слышим.
  const streamNote = live.connected
    ? 'Прямой эфир: изменения в книгах приходят сами'
    : 'Прямой эфир недоступен — числа обновляются по таймеру и по кнопке';

  return (
    <span
      className={clsx('text-[10px] text-zinc-400 dark:text-zinc-500 whitespace-nowrap', className)}
      title={streamNote}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle',
          live.connected ? 'bg-emerald-500/70' : 'bg-zinc-300 dark:bg-zinc-600',
        )}
      />
      обновлено {label}
    </span>
  );
}
