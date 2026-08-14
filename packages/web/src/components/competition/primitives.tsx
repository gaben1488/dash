// ────────────────────────────────────────────────────────────────
// Общие части вкладки «Конкуренция»: каркас карточки и счёт ЕП/КП
// по периметру шапки.
//
// Правила вкладки (канон 14.08, пп. 53, 58, 69):
//   • каждая карточка сама объявляет период своих ДАННЫХ (PeriodBadge);
//   • оговорки счёта видны на карточке, а не спрятаны в тултип;
//   • хром кремово-серый, цвет — только у данных;
//   • на экране нет латинских внутренних ключей.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import { PeriodBadge } from '../PeriodBadge';

/** Единое фокус-кольцо вкладки — клавиатурный обход виден на каждой кнопке. */
export const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900';

/**
 * Каркас карточки вкладки. Плашка периода стоит на каждой карточке (канон
 * п. 58): числа обязаны называть период, которому фактически подчиняются.
 * `caveats` — оговорки счёта; они янтарные и живут прямо под заголовком,
 * потому что метрика без оговорок выглядела бы точнее, чем она есть.
 */
export function CompetitionCard({ title, subtitle, icon: Icon, caveats = [], children }: {
  title: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  caveats?: string[];
  children: ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50">
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          {Icon && (
            <Icon size={16} className="text-zinc-400 dark:text-zinc-500 mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{title}</h2>
            {subtitle && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed max-w-2xl">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <PeriodBadge />
      </header>
      {caveats.length > 0 && (
        <div className="px-5 pb-2 space-y-1">
          {caveats.map((c, i) => (
            <p
              key={i}
              className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle size={10} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{c}</span>
            </p>
          ))}
        </div>
      )}
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

/** Процент по-русски: запятая, один знак, неразрывный пробел перед %. */
export const fmtPct = (v: number): string =>
  `${v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`;

// ── Счёт ЕП/КП по периметру шапки ────────────────────────────────

/** Итоги способа закупки за периметр: счётчики процедур и плановые деньги (тыс. ₽). */
export interface EpKpTotals {
  epCount: number;
  kpCount: number;
  epPlan: number;
  kpPlan: number;
  /** Хоть одно ненулевое значение встретилось — иначе показывать нечего. */
  hasData: boolean;
}

/** Срез периода из useFilteredData, который нужен счёту (узкий контракт). */
export interface PeriodSel {
  periodKey: string;
  hasActiveMonths: boolean;
  coveredQuarters: string[];
  fullQuarters: string[];
  partialMonths: number[];
  useMonthLevel: boolean;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const present = (v: unknown): boolean => v !== null && v !== undefined;

/**
 * Суммирует ЕП/КП по ОТФИЛЬТРОВАННЫМ управлениям за выбранный период — тем же
 * правилом смешанной агрегации, что и общие тоталы (полные кварталы —
 * квартальным уровнем, частично выбранные — месячным): иначе доля ЕП этой
 * вкладки расходилась бы с числами «Пульта» при одном и том же выборе.
 */
export function sumEpKp(depts: Array<Record<string, any>>, sel: PeriodSel): EpKpTotals {
  const out: EpKpTotals = { epCount: 0, kpCount: 0, epPlan: 0, kpPlan: 0, hasData: false };

  let quarterKeys: string[];
  let monthKeys: number[] = [];
  if (!sel.hasActiveMonths) {
    quarterKeys = sel.periodKey === 'year' ? ['year'] : [sel.periodKey];
  } else if (sel.useMonthLevel) {
    quarterKeys = sel.fullQuarters;
    monthKeys = sel.partialMonths;
  } else {
    quarterKeys = sel.coveredQuarters;
  }

  const addRecord = (rec: Record<string, unknown> | undefined) => {
    if (!rec) return;
    if ([rec.epCount, rec.kpCount, rec.epPlanTotal, rec.kpPlanTotal].some(present)) {
      out.hasData = true;
    }
    out.epCount += num(rec.epCount);
    out.kpCount += num(rec.kpCount);
    out.epPlan += num(rec.epPlanTotal);
    out.kpPlan += num(rec.kpPlanTotal);
  };

  for (const d of depts) {
    const quarters = (d.quarters ?? {}) as Record<string, Record<string, unknown>>;
    const months = (d.months ?? {}) as Record<string | number, Record<string, unknown>>;
    // Годовой записи может не быть у книги без расчёта — тогда честный фолбэк
    // на сумму кварталов (та же величина, собранная из частей).
    if (quarterKeys.length === 1 && quarterKeys[0] === 'year' && !quarters.year) {
      for (const qk of ['q1', 'q2', 'q3', 'q4']) addRecord(quarters[qk]);
    } else {
      for (const qk of quarterKeys) addRecord(quarters[qk]);
    }
    for (const m of monthKeys) addRecord(months[m]);
  }
  return out;
}

/** Итоги одного квартала по quarter-level данным (для динамики по кварталам). */
export function sumEpKpQuarter(depts: Array<Record<string, any>>, qk: string): EpKpTotals {
  return sumEpKp(depts, {
    periodKey: qk,
    hasActiveMonths: false,
    coveredQuarters: [],
    fullQuarters: [],
    partialMonths: [],
    useMonthLevel: false,
  });
}
