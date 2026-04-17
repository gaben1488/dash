/**
 * Types for the AEMR metrics KB (Knowledge Base) registry.
 */

/** Categories for grouping metrics in UI. */
export type MetricCategory =
  | 'execution'   // plan/fact/deviation/exec%
  | 'budget'      // plan/fact by budget level (FB/KB/MB)
  | 'economy'     // savings, economy_total, AD flags
  | 'method'      // competitive vs EP breakdown
  | 'trust'       // trust score components
  | 'quality'     // issue counts, data quality
  | 'signal';     // signal pipeline outputs

/** Unit type for display formatting. */
export type MetricUnit = 'count' | 'currency' | 'percent' | 'rub' | 'score' | 'binary';

/**
 * KB entry data — everything needed for a KBTooltip on any metric.
 *
 * 10-block literary Russian format (feedback_kb_tooltip_russian_literary.md):
 *   ① Что это (whatIs)           — visible immediately
 *   ② Как считается (howCalc)    — expandable
 *   ③ Откуда данные (dataSource) — expandable
 *   ④ Движок (engine)            — expandable
 *   ⑤ Пороги (thresholds)        — visible immediately
 *   ⑥ Закон (law)                — expandable, clickable
 *   ⑦ Пример (example)           — visible immediately
 *   ⑧ Подводные камни (pitfalls) — expandable
 *   ⑨ Что делать (actions)       — expandable
 *   ⑩ Связанные метрики (related)— expandable, clickable links
 *
 * Legacy fields (formula/source/cell) kept for backward compat.
 */
export interface KBEntryData {
  /** Human-readable metric label. */
  label: string;
  /** Formula explanation (legacy shorthand). */
  formula: string;
  /** CalcEngine source path (legacy shorthand). */
  source: string;
  /** Spreadsheet cell reference template. */
  cell?: string;
  /** Threshold description for color coding (legacy shorthand). */
  thresholds?: string;
  /** Legal reference (legacy shorthand). */
  law?: string;
  /** Additional note. */
  note?: string;
  /** Display unit. */
  unit: MetricUnit;
  /** Logical category for grouping. */
  category: MetricCategory;

  // ── 10-block literary Russian KB (full format) ──

  /** ① Что это — одно предложение, простым языком. */
  whatIs?: string;
  /** ② Как считается — полное описание формулы на русском литературном языке. */
  howCalc?: string;
  /** ③ Откуда данные — таблица, лист, столбцы. */
  dataSource?: string;
  /** ④ Как обрабатывает движок — CalcEngine pipeline описание. */
  engine?: string;
  /** ⑤ Пороги — цветовые зоны с пояснением (зелёный/жёлтый/красный). */
  thresholdsFull?: string;
  /** ⑥ Закон — статья 44-ФЗ с раскрытием сути при клике. */
  lawFull?: string;
  /** ⑦ Пример — конкретный, с реальными числами. */
  example?: string;
  /** ⑧ Подводные камни — типичные ошибки, что часто путают. */
  pitfalls?: string;
  /** ⑨ Что делать — рекомендации при отклонении. */
  actions?: string;
  /** ⑩ Связанные метрики — ключи других метрик для навигации. */
  related?: string[];
}
