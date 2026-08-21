import { AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { rowStatusLook, type RowStatusIcon } from '../../lib/rows/row-status';

/**
 * Состояние строки реестра одним элементом: подпись, тон, значок и объяснение
 * механизма при наведении.
 *
 * Компонент один на две поверхности — таблицу просмотра и карточку строки.
 * До 21.08.2026 каждая рисовала состояние своим списком условий, и списки
 * разошлись: карточка не знала пяти подписей из тринадцати и показывала их
 * серыми без значка. Смысл («какое состояние что значит») живёт в
 * lib/rows/row-status, здесь — только его вид.
 *
 * Пустое состояние компонент не выдумывает: возвращает null и оставляет
 * поверхности сказать свою честную пустоту — в таблице и в карточке она
 * звучит по-разному.
 */
function IconOf({ icon, size }: { icon: RowStatusIcon; size: number }) {
  if (icon === 'ok') return <CheckCircle2 size={size} aria-hidden="true" />;
  if (icon === 'clock') return <Clock size={size} aria-hidden="true" />;
  if (icon === 'alert') return <AlertCircle size={size} aria-hidden="true" />;
  if (icon === 'canceled') return <XCircle size={size} aria-hidden="true" />;
  return null;
}

export function RowStatusChip({
  status,
  size = 13,
  className,
}: {
  status: unknown;
  size?: number;
  className?: string;
}) {
  const look = rowStatusLook(status);
  if (look === null) return null;
  return (
    <span
      title={look.hint}
      className={clsx('inline-flex items-center gap-1 text-xs font-medium', look.tone, className)}
    >
      <IconOf icon={look.icon} size={size} />
      {look.label}
    </span>
  );
}
