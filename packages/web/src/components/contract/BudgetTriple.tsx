/**
 * BudgetTriple — каноническая тройка бюджетов ФБ/КБ/МБ (контракт).
 *
 * Единственная закреплённая цветовая тройка продукта (DESIGN.md): ФБ синий,
 * КБ изумруд, МБ янтарь — CSS-переменные --budget-*. Цвет ВСЕГДА дублируется
 * текстовой подписью (закон «текстовый дубль визуального»): печать
 * чёрно-белая и дальтонизм не теряют смысла. Каждая часть — с БЗ по
 * наведению (ключи <prefix>_fb/kb/mb; kbFor гасит неполные записи).
 *
 * `bar` добавляет полосу состава над числами: доли трёх бюджетов в сумме —
 * то, чего ряд чисел не показывает с одного взгляда. Полоса декоративна
 * (aria-hidden): весь её смысл продублирован числами под ней.
 */
import { fmtThousands } from '../../lib/report/mappers';
import { KbHover } from './KbHover';

export interface BudgetTripleProps {
  /** Значения тыс. руб. */
  fb: number;
  kb: number;
  mb: number;
  /** Префикс ключей БЗ: 'plan' | 'fact' | 'economy' | 'pending'. */
  metricPrefix: 'plan' | 'fact' | 'economy' | 'pending';
  /** Полоса долей над числами (для денежных плиток). */
  bar?: boolean;
}

const PARTS = [
  { key: 'fb', label: 'ФБ', cssVar: 'var(--budget-fb)' },
  { key: 'kb', label: 'КБ', cssVar: 'var(--budget-kb)' },
  { key: 'mb', label: 'МБ', cssVar: 'var(--budget-mb)' },
] as const;

export function BudgetTriple({ fb, kb, mb, metricPrefix, bar = false }: BudgetTripleProps) {
  const values = { fb, kb, mb };
  const sum = fb + kb + mb;
  const labels = (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 tabular-nums">
      {PARTS.map((p) => (
        <KbHover key={p.key} metricKey={`${metricPrefix}_${p.key}`}>
          <span className="whitespace-nowrap">
            <span className="font-medium" style={{ color: p.cssVar }}>{p.label}</span>
            {' '}{fmtThousands(values[p.key])}
          </span>
        </KbHover>
      ))}
    </span>
  );

  // Полоса без базы (все три нуля) не рисуется: пустой прямоугольник
  // читался бы как «состав есть, но нулевой» — а его просто нет.
  if (!bar || sum <= 0) return labels;

  return (
    <span className="block">
      <span
        className="mb-1 flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
        aria-hidden="true"
      >
        {PARTS.map((p) => (
          <span
            key={p.key}
            className="block h-full"
            style={{ width: `${(values[p.key] / sum) * 100}%`, background: p.cssVar }}
          />
        ))}
      </span>
      {labels}
    </span>
  );
}
