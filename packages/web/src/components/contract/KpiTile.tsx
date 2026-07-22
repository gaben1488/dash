/**
 * Каноническая KPI-плитка Page Contract.
 *
 * Подпись — СТРОГО через productLabel(metricKey): элемент принимает ключ
 * метрики, а не свободный текст, чтобы подписи не расползались мимо
 * канон-словаря (product-dictionary). periodBadge — честный скоуп числа
 * («Q1 · официал», «год», «июль»), обязателен: карточка без скоупа врёт.
 * Стиль — классы analytics-kpi (index.css), как у плиток Аналитики.
 */
import { productLabel } from '@aemr/shared';
import { SourceBadge } from './SourceBadge';
import type { PageElementProps } from './types';

/** Размерный ярус плитки (сетка analytics-kpi-grid Аналитики). */
export type KpiTier = 'hero' | 'med' | 'compact';

export interface KpiTileProps extends PageElementProps {
  /** Ключ метрики из канон-словаря — подпись выводится productLabel(metricKey) */
  metricKey: string;
  /** Отформатированное значение (форматирует вызывающий — formatMoney и т.п.) */
  value: string;
  /** Единица измерения ('' — безразмерная величина: счётчик, %) */
  unit: string;
  /** Честный скоуп числа: «Q1 · официал», «год», «июль» */
  periodBadge: string;
  tier?: KpiTier;
  onClick?: () => void;
}

/** Подпись плитки — единственная дверь: канон-словарь, без свободного текста. */
export function kpiTileLabel(metricKey: string): string {
  return productLabel(metricKey);
}

export function KpiTile({ metricKey, value, unit, periodBadge, source, tier = 'compact', onClick }: KpiTileProps) {
  return (
    <div
      className={`analytics-kpi analytics-kpi-${tier}${onClick ? ' cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`analytics-kpi-label ${tier === 'hero' ? 'text-[11px]' : 'text-[10px]'}`}>
          {kpiTileLabel(metricKey)}
        </span>
        <SourceBadge source={source} />
      </div>
      <div className={`analytics-kpi-value ${tier === 'hero' ? 'text-2xl' : tier === 'med' ? 'text-lg' : 'text-base'}`}>
        {value}
        {unit && <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500 ml-1">{unit}</span>}
      </div>
      <div className="text-[9px] mt-1 text-zinc-400 dark:text-zinc-500">{periodBadge}</div>
    </div>
  );
}
