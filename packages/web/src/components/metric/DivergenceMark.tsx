/**
 * DivergenceMark — значок у числа, которое источник считает иначе
 * (канон п.104, десять расхождений карты происхождения).
 *
 * ПОЧЕМУ ЗНАЧОК, А НЕ ТОЛЬКО ПОПАП. Родословная в попапе честна, но её видит
 * только тот, кто навёл. Десять чисел продукта считаются не так, как их
 * считает документ, и читатель, который никогда не откроет подсказку, всё
 * равно обязан знать, что это число нельзя молча приложить к отчёту. Значок
 * работает как сноска в тексте: сам по себе он мал, но говорит «здесь есть
 * оговорка», и дальше решает читатель.
 *
 * ТОН п.53. Подпись объясняет механизм и называет адрес («на источнике
 * считается иначе: …»), а не выносит приговор. Расхождение чаще всего —
 * разница определений, а не наша ошибка счёта.
 *
 * Янтарный, а не красный: красное на экране означает «сорвано», а здесь не
 * сорвано ничего — здесь нужна осторожность при переносе числа в документ.
 * В тёмной теме янтарный поднимается до 400, иначе он тонет в фоне.
 */
import { AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { divergenceWarning } from './metric-provenance-view';

export interface DivergenceMarkProps {
  /** Ключ показателя в карте происхождения. */
  metricKey: string;
  /** Размер иконки; по умолчанию — подстрочный, чтобы не спорить с числом. */
  size?: number;
  className?: string;
}

/**
 * Значок расхождения либо ничего, если наш счёт сходится с источником.
 * Отсутствие показателя в карте — тоже «ничего»: неизвестное происхождение
 * не повод пугать читателя.
 */
export function DivergenceMark({ metricKey, size = 10, className }: DivergenceMarkProps) {
  const warning = divergenceWarning(metricKey);
  if (!warning) return null;

  return (
    <span
      role="img"
      aria-label={warning}
      title={warning}
      data-testid="divergence-mark"
      data-metric={metricKey}
      className={clsx(
        'inline-flex shrink-0 cursor-help align-middle',
        'text-amber-600 dark:text-amber-400',
        className,
      )}
    >
      <AlertTriangle size={size} aria-hidden="true" />
    </span>
  );
}
