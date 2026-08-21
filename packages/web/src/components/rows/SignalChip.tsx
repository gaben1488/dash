import clsx from 'clsx';
import { rowSignalTone, signalChipText, signalHint } from '../../lib/rows/registry-view';

/**
 * Признак строки одним элементом: подпись, тон по СТРОКЕ, объяснение механизма
 * и отбор по щелчку.
 *
 * Почему компонент, а не три строчки на месте. Тон чипа перестал быть
 * свойством ключа: ЕП-риск красится по степени обоснованности из графы M
 * (решение владельца п.137(2)), и ровно ту же функцию зовёт счётчик
 * критических строк в сводке выборки. Пока таблица красила чип по ключу
 * (signalTone), сводка могла сказать «критических нет», а рядом горел красный
 * чип на строке с подтверждённой безальтернативностью — два ответа на один
 * вопрос. Здесь дом один: и тон, и подсказка берутся теми же функциями, что и
 * счёт.
 *
 * Подсказка не собирается на месте по той же причине — её дом
 * lib/rows/registry-view (signalHint), который читает паспорт проверки из
 * реестра @aemr/shared: механизм плюс «что сделать», без своих формулировок.
 *
 * Обводки в тёмной теме не рисуются (канон п.129): выбранный признак отличается
 * светлотой и насыщенностью, а не рамкой.
 */
export function SignalChip({
  signal,
  row,
  picked = false,
  onToggle,
  className,
}: {
  signal: string;
  /** Строка целиком: от графы M зависит строгость ЕП-риска. */
  row: { epReason?: unknown };
  picked?: boolean;
  /** Не задан — чип показывает, но не отбирает (карточка строки, легенда). */
  onToggle?: (signal: string) => void;
  className?: string;
}) {
  const chip = signalChipText(signal);
  const tone = rowSignalTone(signal, row);
  const look = clsx(
    'px-1.5 py-0.5 rounded text-[10px] font-medium',
    tone.bg,
    tone.text,
    className,
  );
  const hint = chip.hint ?? signalHint(signal);

  if (onToggle === undefined) {
    return <span title={hint} className={look}>{chip.text}</span>;
  }

  return (
    <button
      type="button"
      aria-pressed={picked}
      title={`${hint}\n\n${picked
        ? 'Щелчок — убрать этот признак из отбора.'
        : 'Щелчок — оставить в списке только строки с этим признаком.'}`}
      // Щелчок по чипу не должен заодно открывать карточку строки: у строки
      // свой обработчик, поэтому всплытие останавливается явно.
      onClick={(e) => { e.stopPropagation(); onToggle(signal); }}
      className={clsx(
        look,
        'transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500',
        picked
          ? 'ring-1 ring-inset ring-current dark:ring-0 font-semibold dark:brightness-150'
          : 'hover:brightness-95 dark:hover:brightness-125',
      )}
    >
      {chip.text}
    </button>
  );
}
