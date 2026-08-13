/**
 * Metrics registry for web — delegates to @aemr/core KB (single source of truth).
 * UI-specific helpers (threshold colors) remain here.
 *
 * Previously: 286-line duplicate of core/metrics/registry.ts
 * Now: thin wrapper importing from @aemr/core + UI color helpers
 */

import { METRIC_KB } from '@aemr/core';
import type { KBEntry } from '../components/ui/kb-tooltip';
import { getExecutionBand } from './chart-colors';

// ── Re-export KB as STANDARD_METRICS (backward compatibility) ──

/** Convert core KBEntryData → web KBEntry for KBTooltip component */
function toKBEntry(key: string): KBEntry {
  const entry = METRIC_KB[key];
  if (!entry) return {};
  return {
    description: entry.label,
    formula: entry.formula,
    source: entry.source,
    cell: entry.cell,
    thresholds: entry.thresholds,
    law: entry.law,
    // 10-block literary Russian
    whatIs: entry.whatIs,
    howCalc: entry.howCalc,
    dataSource: entry.dataSource,
    engine: entry.engine,
    thresholdsFull: entry.thresholdsFull,
    lawFull: entry.lawFull,
    example: entry.example,
    pitfalls: entry.pitfalls,
    actions: entry.actions,
    related: entry.related,
  };
}

/** Proxy that lazily converts core entries to web KBEntry format */
export const STANDARD_METRICS: Record<string, KBEntry> = new Proxy(
  {} as Record<string, KBEntry>,
  {
    get(_target, key: string) {
      return toKBEntry(key);
    },
    has(_target, key: string) {
      return key in METRIC_KB;
    },
    ownKeys() {
      return Object.keys(METRIC_KB);
    },
    getOwnPropertyDescriptor(_target, key: string) {
      if (key in METRIC_KB) {
        return { configurable: true, enumerable: true, value: toKBEntry(key) };
      }
      return undefined;
    },
  },
);

/** Helper: get metric entry or empty object */
export function getMetricKB(key: string): KBEntry {
  return toKBEntry(key);
}

// ── UI-specific helpers (Tailwind classes, not applicable to core) ──
//
// Правило раскраски: порог берётся из базы знаний того же показателя, а не
// придумывается на месте. Иначе подсказка утверждает одно («🟢 ≥ 80 %»), а
// цвет рядом — другое, и читатель верит цвету. Ниже у каждой ветки указан
// источник порога.

/** Условная оценка значения: во что окрашивать. */
type Verdict = 'good' | 'watch' | 'mid' | 'bad' | 'neutral';

const VERDICT_TEXT: Record<Verdict, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  mid: 'text-blue-600 dark:text-blue-400',
  watch: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
  neutral: 'text-zinc-700 dark:text-zinc-200',
};

const VERDICT_BG: Record<Verdict, string> = {
  good: 'bg-emerald-500/10',
  mid: 'bg-blue-500/10',
  watch: 'bg-amber-500/10',
  bad: 'bg-red-500/10',
  neutral: 'bg-zinc-500/10',
};

/**
 * Оценка показателя по порогам его карточки в базе знаний.
 * Один вывод на текст и на плашку — иначе число может получить зелёный
 * текст на жёлтой подложке.
 */
function verdictFor(metricKey: string, value: number): Verdict {
  switch (metricKey) {
    // Общее исполнение: METRIC_KB.exec_count_pct.thresholdsFull —
    // «🟢 ≥ 80 % · 🟡 50–79 % · 🔴 < 50 %», плюс «🟣 > 100 %» у денежного.
    // Прежде здесь стояли 90/70/50: плитка красила 85 % жёлтым, а столбец
    // того же исполнения на «Обзоре» — зелёным, и легенда под графиком
    // говорила «больше 80 %».
    case 'exec_count_pct':
    case 'execution_pct': {
      const band = getExecutionBand(value);
      if (band === 'over') return 'mid';
      if (band === 'good') return 'good';
      if (band === 'watch') return 'watch';
      return 'bad';
    }

    // Исполнение по управлению: METRIC_KB.dept_exec_count_pct.thresholds —
    // «≥90 % зелёный, 70–89 % синий, 50–69 % жёлтый, <50 % красный».
    // Порог строже общего сознательно: это карточка отдельного ГРБС.
    case 'dept_exec_count_pct':
    case 'dept_exec_amount_pct':
    case 'dept_fb_pct':
      if (value >= 90) return 'good';
      if (value >= 70) return 'mid';
      if (value >= 50) return 'watch';
      return 'bad';

    // Экономия: METRIC_KB.economy_rate.thresholds — «5-25 % норма; >25 % флаг»,
    // avg_reduction_pct.thresholdsFull — «🟢 5–15 % · 🟡 < 2 % · 🔴 > 25 %».
    // Красный оставлен только там, где база знаний прямо говорит «так быть
    // не должно», — на отрицательной экономии. Прежняя шкала звала зелёной
    // экономию в 1 %, хотя по той же карточке это «слишком низкая, подозрение
    // на формальные торги».
    case 'economy_rate':
    case 'avg_reduction_pct':
      if (value < 0) return 'bad';
      if (value >= 5 && value <= 25) return 'good';
      return 'watch';

    case 'critical_issues':
    case 'economy_conflicts':
      if (value === 0) return 'good';
      if (value <= 3) return 'watch';
      return 'bad';

    // Доверие: METRIC_KB.trust_binary — «🟢 ≥ 75 — норма, 🔴 < 75 — проверь».
    case 'dept_trust':
      if (value >= 90) return 'good';
      if (value >= 75) return 'mid';
      if (value >= 60) return 'watch';
      return 'bad';

    default:
      return 'neutral';
  }
}

/** Класс цвета текста по порогам показателя. */
export function getThresholdColor(metricKey: string, value: number): string {
  return VERDICT_TEXT[verdictFor(metricKey, value)];
}

/**
 * Класс подложки бейджа. Оценка та же, что у текста: раньше две функции
 * повторяли пороги каждая по-своему, и число могло получить зелёный текст
 * на жёлтой плашке. Показатель без порогов остаётся нейтрально-серым.
 */
export function getThresholdBg(metricKey: string, value: number): string {
  return VERDICT_BG[verdictFor(metricKey, value)];
}
