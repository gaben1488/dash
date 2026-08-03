/**
 * Каноническая KPI-плитка Page Contract.
 *
 * Подпись — СТРОГО через productLabel(metricKey): элемент принимает ключ
 * метрики, а не свободный текст, чтобы подписи не расползались мимо
 * канон-словаря (product-dictionary). periodBadge — честный скоуп числа
 * («1 кв · официал», «год», «июль»), обязателен: карточка без скоупа врёт.
 * Стиль — классы analytics-kpi (index.css), как у плиток Аналитики.
 *
 * Три необязательных слоя добавлены переплавкой 03.08 (иерархия вместо ряда
 * равнозначных плиток) — и добавлены СЮДА, а не в параллельный компонент:
 * у плитки один дом, иначе страницы разъедутся стилями.
 *   • formula — «заключено 2 440 из 2 819»: из чего сложилось число;
 *   • meter   — процент баром, всегда рядом с самим процентом (канон
 *               «текстовый дубль визуального»);
 *   • footer  — состав числа (тройка ФБ/КБ/МБ, полоса бюджетов).
 */
import type { ReactNode } from 'react';
import { productLabel } from '@aemr/shared';
import type { FormulaPart } from '../../lib/report/mappers';
import type { MetricDelta } from '@aemr/core';
import { DeltaBadge } from '../DeltaBadge';
import { KbHover } from './KbHover';
import { SourceBadge } from './SourceBadge';
import type { PageElementProps } from './types';

/** Размерный ярус плитки (сетка analytics-kpi-grid Аналитики). */
export type KpiTier = 'hero' | 'med' | 'compact';

/** Смысловой акцент числа: нейтраль, способ закупки, тревога, экономия. */
export type KpiAccent = 'neutral' | 'brand' | 'violet' | 'amber' | 'emerald';

const ACCENT_TEXT: Record<KpiAccent, string> = {
  neutral: '',
  brand: 'text-blue-600 dark:text-blue-400',
  violet: 'text-violet-700 dark:text-violet-400',
  amber: 'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
};

const ACCENT_BAR: Record<KpiAccent, string> = {
  neutral: 'bg-zinc-400 dark:bg-zinc-500',
  brand: 'bg-blue-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
};

export interface KpiTileProps extends PageElementProps {
  /** Ключ метрики из канон-словаря — подпись выводится productLabel(metricKey) */
  metricKey: string;
  /** Отформатированное значение (форматирует вызывающий — formatMoney и т.п.) */
  value: string;
  /** Единица измерения ('' — безразмерная величина: счётчик, %) */
  unit: string;
  /** Честный скоуп числа: «1 кв · официал», «год», «июль» */
  periodBadge: string;
  tier?: KpiTier;
  /**
   * Сдвиг числа к прошлому снимку недели (официальные метрики СВОДа) —
   * тихий DeltaBadge в углу плитки. Проп опционален и вешается только на
   * плитки с однозначным официальным аналогом (см. lib/report/kpi-delta):
   * нет аналога — нет дельты, плитка не врёт чужим сравнением.
   */
  delta?: MetricDelta;
  /**
   * Из чего сложилось число — по частям; часть со своим metricKey несёт
   * собственную БЗ по наведению (метрики, потерявшие отдельные плитки при
   * переплавке 03.08, сохранили доступ к своим объяснениям).
   */
  formula?: FormulaPart[];
  /**
   * Процент для бара (0..100+; null — «нет базы», бар не рисуется:
   * пустая полоса читалась бы как ноль, которого никто не считал).
   */
  meter?: number | null;
  /** Смысловой акцент значения и бара. */
  accent?: KpiAccent;
  /** Состав числа под ним: тройка бюджетов, полоса, что нужно вызывающему. */
  footer?: ReactNode;
  onClick?: () => void;
}

/** Подпись плитки — единственная дверь: канон-словарь, без свободного текста. */
export function kpiTileLabel(metricKey: string): string {
  return productLabel(metricKey);
}

export function KpiTile({
  metricKey, value, unit, periodBadge, source, tier = 'compact',
  delta, formula, meter, accent = 'neutral', footer, onClick,
}: KpiTileProps) {
  return (
    <div
      className={`analytics-kpi analytics-kpi-${tier}${onClick ? ' cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-1">
        {/* БЗ по наведению на подписи: одна дверь для всех плиток всех
            страниц; kbFor гасит неполные записи — пустых попапов не бывает */}
        <KbHover metricKey={metricKey}>
          <span className={`analytics-kpi-label ${tier === 'hero' ? 'text-[11px]' : 'text-[10px]'}`}>
            {kpiTileLabel(metricKey)}
          </span>
        </KbHover>
        <span className="flex items-center gap-1.5 shrink-0">
          {delta && <DeltaBadge delta={delta} context="К прошлому снимку (СВОД)" />}
          <SourceBadge source={source} />
        </span>
      </div>
      <div
        className={`analytics-kpi-value ${ACCENT_TEXT[accent]} ${
          tier === 'hero' ? 'text-[26px] leading-tight tracking-tight' : tier === 'med' ? 'text-lg' : 'text-base'
        }`}
      >
        {value}
        {unit && <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500 ml-1">{unit}</span>}
      </div>
      {formula && formula.length > 0 && (
        <div className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {formula.map((part, i) => (
            part.metricKey
              ? (
                <KbHover key={i} metricKey={part.metricKey}>
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">{part.text}</span>
                </KbHover>
              )
              : <span key={i}>{part.text}</span>
          ))}
        </div>
      )}
      {meter !== undefined && meter !== null && (
        <div
          className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
          aria-hidden="true"
        >
          <div
            className={`h-full rounded-full ${ACCENT_BAR[accent]}`}
            style={{ width: `${Math.min(100, Math.max(0, meter))}%` }}
          />
        </div>
      )}
      {footer && <div className="mt-1.5">{footer}</div>}
      <div className="text-[9px] mt-1 text-zinc-400 dark:text-zinc-500">{periodBadge}</div>
    </div>
  );
}
