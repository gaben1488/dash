/**
 * Полоса живого оповещения — теперь ПРЕДУПРЕЖДЕНИЕ, а не выключатель.
 *
 * ЧТО ИЗМЕНИЛОСЬ 21.08.2026. Раньше полоса была единственной дорогой свежих
 * чисел на экран: пока читатель её не нажмёт, продукт показывал вчерашние
 * данные, а нажатие уводило экран в заглушки — прокрутка наверх, раскрытые
 * карточки схлопнуты. Требование владельца: «оповещения без необходимости
 * обновлять в прямом эфире подтягивались сюда». Теперь числа встают на место
 * сами (hooks/useSeamlessRefresh.ts), и полосе остаётся ровно то, ради чего
 * она нужна человеку: сказать, когда тихая подмена НЕВОЗМОЖНА или НЕ УДАЛАСЬ.
 *
 * ПОЧЕМУ ТИШИНА В ОБЫЧНОМ СЛУЧАЕ. Успешная подмена не нуждается в объявлении:
 * изменившиеся строки подсвечиваются сами (эфир, FLASH_MS), момент чтения
 * стоит в шапке, подробности — в узле провенанса. Полоса, всплывающая на
 * каждое удачное обновление, была бы шумом, а не заботой.
 *
 * КОГДА ПОЛОСА ВСЁ-ТАКИ ПОЯВЛЯЕТСЯ. Две причины, и обе — про человека:
 *   • подменить числа сейчас нельзя (вводит, выделил текст, открыл окно,
 *     ушёл на другую вкладку) — продукт не дёргает экран под руками и говорит,
 *     что новые числа готовы и ждут;
 *   • обновить не вышло (сеть, сервер) — на экране прежние числа, и молчать
 *     об этом нельзя.
 *
 * ТОН прежний: спокойный кремовый фон, ни красного, ни мигания, ни звука.
 * Закрыть полосу можно, ничего не обновляя, — это законный выбор.
 *
 * РАЗДЕЛЕНИЕ РОЛЕЙ (срез 29.08, правый угол шапки). ПОКАЗ изменений эфира —
 * какие правки, было → стало, журнал — живёт в углу шапки (LiveHistory) и в
 * узле провенанса; полоса их НЕ дублирует. За ней остаётся ровно одна роль —
 * предупреждение: тихая подмена чисел невозможна (waitingBecause) или не
 * удалась (failed), с кнопкой «Показать сейчас»/«Повторить» и крестиком.
 * Ничего из умений полосы при этом не отнято: заголовок и подробность
 * изменений, причина помехи словами, признак потерянной связи — всё на месте
 * на те случаи, когда полоса показывается.
 */
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';
import { useLiveEvents } from '../../hooks/useLiveEvents';
import { BLOCKER_WORDS, useSeamlessRefresh } from '../../hooks/useSeamlessRefresh';
import { liveDetail, liveHeadline, originLabel, relativeMoment } from './live-text';

export function LiveUpdateBar() {
  const live = useLiveEvents();
  const seamless = useSeamlessRefresh();
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  // Момент показывается бегущим: полоса может провисеть минуту, и «только что»
  // к тому времени перестанет быть правдой.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live.hasNews) return;
    const timer = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, [live.hasNews]);

  // Тихая подмена справилась сама — говорить не о чем.
  const needsWord = seamless.waitingBecause !== null || seamless.failed;
  const hidden = !live.hasNews || !needsWord
    || (dismissedAt !== null && dismissedAt === live.lastEventAt);
  if (hidden) return null;

  const headline = seamless.failed
    ? 'Новые числа есть, показать не вышло'
    : liveHeadline(live.books);
  const detail = seamless.failed
    ? 'на экране прежние числа'
    : liveDetail(live.books, live.newIssues);
  const origin = live.books[0]?.origin;
  const because = seamless.waitingBecause;

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'fixed left-1/2 -translate-x-1/2 bottom-6 z-50 max-w-[min(92vw,640px)]',
        'flex items-center gap-3 px-4 py-2.5 rounded-xl',
        'bg-[#faf6ec] dark:bg-zinc-800',
        'border border-[#e6dcc4] dark:border-transparent',
        'shadow-lg shadow-black/5 dark:shadow-black/40',
        'text-[13px] text-zinc-700 dark:text-zinc-200',
        'live-bar-enter',
      )}
    >
      <span className="min-w-0">
        <span className="font-medium">{headline}</span>
        {detail && <span className="text-zinc-500 dark:text-zinc-400">: {detail}</span>}
        <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">
          {because
            ? `Новые числа готовы и ждут — ${BLOCKER_WORDS[because]}`
            : relativeMoment(live.lastEventAt)}
          {!because && origin ? ` · ${originLabel(origin)}` : ''}
          {!live.connected && ' · связь с эфиром потеряна, пробуем заново'}
        </span>
      </span>

      <button
        type="button"
        onClick={seamless.applyNow}
        disabled={seamless.updating}
        className={clsx(
          'ml-auto shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
          'bg-zinc-800 text-[#faf6ec] dark:bg-zinc-100 dark:text-zinc-900',
          'text-[12px] font-medium transition',
          'hover:bg-zinc-700 dark:hover:bg-white disabled:opacity-50 disabled:cursor-default',
        )}
      >
        <RefreshCw size={12} aria-hidden="true" className={seamless.updating ? 'animate-spin' : undefined} />
        {seamless.updating ? 'Обновляем' : seamless.failed ? 'Повторить' : 'Показать сейчас'}
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
