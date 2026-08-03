/**
 * BudgetTriple — каноническая тройка бюджетов ФБ/КБ/МБ (контракт).
 *
 * Единственная закреплённая цветовая тройка продукта (DESIGN.md): ФБ синий,
 * КБ изумруд, МБ янтарь — CSS-переменные --budget-*. Цвет ВСЕГДА дублируется
 * текстовой подписью (закон «текстовый дубль визуального»): печать
 * чёрно-белая и дальтонизм не теряют смысла. Каждая часть — с БЗ по
 * наведению (ключи <prefix>_fb/kb/mb; kbFor гасит неполные записи).
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
}

const PARTS = [
  { key: 'fb', label: 'ФБ', cssVar: 'var(--budget-fb)' },
  { key: 'kb', label: 'КБ', cssVar: 'var(--budget-kb)' },
  { key: 'mb', label: 'МБ', cssVar: 'var(--budget-mb)' },
] as const;

export function BudgetTriple({ fb, kb, mb, metricPrefix }: BudgetTripleProps) {
  const values = { fb, kb, mb };
  return (
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
}
