/**
 * Бейдж происхождения данных («Расчёт» / «СВОД» / «Комби»).
 * Канонический элемент Page Contract; словарь подписей/стилей — SOURCE_META.
 */
import { SOURCE_META, type ElementSource } from './types';

export interface SourceBadgeProps {
  source: ElementSource;
}

export function SourceBadge({ source }: SourceBadgeProps) {
  const meta = SOURCE_META[source];
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}
