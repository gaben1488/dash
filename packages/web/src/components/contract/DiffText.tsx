/**
 * DiffText — каноническое «число с направлением расхождения» (Page Contract).
 *
 * Показывает значение (обычно официальное, СВОД) и дельту против опорного
 * (обычно расчётного): совпадение — тихий «=», расхождение — янтарная
 * подпись «+N»/«−N». Расхождение НЕ подменяется и не прячется — принцип
 * двухисточниковости D1: читатель видит обе правды.
 */
import type { PageElementProps } from './types';

export interface DiffView {
  matches: boolean;
  /** «+2» / «−3»; '' при совпадении */
  deltaText: string;
}

/** Чистое направление расхождения value против reference (юнит-тестируемо). */
export function diffView(value: number, reference: number): DiffView {
  const delta = value - reference;
  if (delta === 0) return { matches: true, deltaText: '' };
  return {
    matches: false,
    deltaText: `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('ru-RU')}`,
  };
}

export interface DiffTextProps extends PageElementProps {
  /** Показываемое число (обычно СВОД) */
  value: number;
  /** Опорное число (обычно расчёт) — против него считается направление */
  reference: number;
  /** Форматтер значения; дефолт — целое ru-RU */
  format?: (n: number) => string;
}

export function DiffText({ value, reference, format = (n) => Math.round(n).toLocaleString('ru-RU') }: DiffTextProps) {
  const view = diffView(value, reference);
  return (
    <span className="tabular-nums">
      {format(value)}
      {view.matches ? (
        <span className="ml-1 text-[9px] text-zinc-400 dark:text-zinc-500">=</span>
      ) : (
        <span className="ml-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          {view.deltaText}
        </span>
      )}
    </span>
  );
}
