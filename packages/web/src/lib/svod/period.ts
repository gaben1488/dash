/**
 * period.ts — период «Свода» выводится из ОДНОГО глобального выбора времени.
 *
 * Зачем. У страницы были собственные тумблеры «месяц / квартал / год», ничем
 * не связанные с фильтром времени в шапке приложения. Пользователь выбирал
 * квартал в одном месте, приходил в «Свод» и видел год: один выбор — два
 * состояния, и числа на соседних экранах честно расходились. Здесь глобальный
 * выбор (год + активные месяцы + квартал + режим) канонизируется домом
 * `resolveTimeSelection` из @aemr/shared и переводится в ключи сводной сетки.
 *
 * Почему складывать месяцы можно. Сетка держит инвариант «год = Σ месяцев =
 * Σ кварталов» (docs/UNIFIED_SVOD_DESIGN.md §7.2), а `resolveTimeSelection`
 * возвращает ДИЗЪЮНКТНОЕ покрытие выбора (квартал поглощает свои месяцы,
 * полная тройка месяцев схлопывается в квартал). Значит сумма по ключам не
 * даёт двойного счёта.
 */
import {
  quarterLabel,
  type Month,
  type Quarter,
  type PeriodKey,
  type SvodPeriodKey,
  type TimeSelection,
  resolveTimeSelection,
} from '@aemr/shared';
import { MONTHS, type PeriodScope } from '../../store';

/** Полные названия месяцев берём из канона web-фильтра, а не пишем заново. */
const MONTH_NAME: Record<number, string> = Object.fromEntries(
  MONTHS.map((m) => [m.id, m.full.toLowerCase()]),
);

export interface SvodPeriodInput {
  /** Год данных сетки (сетка всегда про один год). */
  year: number;
  /** Legacy-ось квартала из store. */
  period: PeriodScope;
  /** Активные месяцы 1..12 из store. */
  months: Iterable<number>;
  /**
   * Выбирал ли период сам пользователь. В режиме недели store держит в
   * activeMonths месяцы текущей недели — это позиция колеса, а не фильтр,
   * и принимать её за выбор значит молча сузить «Свод» до августа.
   */
  explicit: boolean;
}

export interface SvodPeriodSelection {
  /** Дизъюнктные ключи сетки; сумма по ним = выбранный период. */
  keys: SvodPeriodKey[];
  /** Подпись с годом («2026 · 1 кв.») — дом подписи в @aemr/shared. */
  fullLabel: string;
  /** Короткая подпись без года («1 кв», «январь», «год») — для фраз. */
  shortLabel: string;
  granularity: 'year' | 'quarter' | 'month' | 'mixed';
  /** Единственный ключ, если период выражается одной ячейкой сетки; иначе null. */
  single: SvodPeriodKey | null;
}

function validMonths(raw: Iterable<number>): Month[] {
  const out = new Set<Month>();
  for (const m of raw) {
    if (Number.isInteger(m) && m >= 1 && m <= 12) out.add(m as Month);
  }
  return [...out].sort((a, b) => a - b);
}

function quarterOfScope(period: PeriodScope): Quarter | null {
  if (period === 'year') return null;
  const q = Number(period.slice(1));
  return q >= 1 && q <= 4 ? (q as Quarter) : null;
}

/** Глобальный выбор store → канонический `TimeSelection` одного года. */
export function buildSvodTimeSelection(input: SvodPeriodInput): TimeSelection {
  const years = new Set<number>([input.year]);
  const wholeYear: TimeSelection = { years, byYear: new Map(), weekStart: null };
  if (!input.explicit) return wholeYear;

  const months = validMonths(input.months);
  if (months.length > 0) {
    return {
      years,
      byYear: new Map([[input.year, { quarters: new Set<Quarter>(), months: new Set(months) }]]),
      weekStart: null,
    };
  }
  const quarter = quarterOfScope(input.period);
  if (quarter === null) return wholeYear;
  return {
    years,
    byYear: new Map([[input.year, { quarters: new Set<Quarter>([quarter]), months: new Set<Month>() }]]),
    weekStart: null,
  };
}

function toSvodKey(key: PeriodKey): SvodPeriodKey {
  if (key.kind === 'year') return 'year';
  if (key.kind === 'quarter') return `q${key.quarter}` as SvodPeriodKey;
  return `m${key.month}` as SvodPeriodKey;
}

/** Короткая подпись одного ключа сетки: «год», «1 кв», «январь». */
export function svodKeyLabel(key: SvodPeriodKey): string {
  if (key === 'year') return 'год';
  const n = Number(key.slice(1));
  if (key.startsWith('q')) return quarterLabel(n);
  return MONTH_NAME[n] ?? key;
}

/** Глобальный выбор времени → ключи сводной сетки и подписи к ним. */
export function resolveSvodPeriod(input: SvodPeriodInput): SvodPeriodSelection {
  const resolved = resolveTimeSelection(buildSvodTimeSelection(input), {
    availableYears: [input.year],
  });
  const keys = resolved.keys.map(toSvodKey);
  return {
    keys,
    fullLabel: resolved.label,
    shortLabel: keys.map(svodKeyLabel).join(' + '),
    granularity: resolved.granularity,
    single: keys.length === 1 ? keys[0] : null,
  };
}

/**
 * Какая кнопка периода подсвечена на странице. Возвращает `null`, когда
 * глобальный выбор не сводится к одной кнопке (например январь и март) —
 * тогда страница честно показывает набор словами, а не врёт подсветкой.
 */
export function activePeriodButton(
  selection: SvodPeriodSelection,
): { kind: 'year' } | { kind: 'quarter'; quarter: number } | { kind: 'month'; month: number } | null {
  const key = selection.single;
  if (key === null) return null;
  if (key === 'year') return { kind: 'year' };
  const n = Number(key.slice(1));
  if (key.startsWith('q')) return { kind: 'quarter', quarter: n };
  return { kind: 'month', month: n };
}
