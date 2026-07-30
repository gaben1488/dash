/**
 * Мост «METRIC_KB → попап БЗ по наведению» (Отчёт++, решение 2).
 *
 * Единственная точка, где 10-блочная запись базы знаний (@aemr/core)
 * сплющивается в четыре абзаца попапа KbHover. Возвращаем null для
 * неизвестных ключей и для legacy-записей без полного КБ — попап
 * с пустыми абзацами вреднее, чем его отсутствие.
 */
import { METRIC_KB } from '@aemr/core';

export interface MetricKbCard {
  /** «Что это» — одно-два предложения простыми словами. */
  what: string;
  /** «Как считается» — путь движка; пример приклеен через перенос строки. */
  how: string;
  /** «Откуда» — таблица, лист, столбцы. */
  source: string;
  /** «Подводные камни» — только если запись их несёт. */
  pitfalls?: string;
}

export function kbFor(metricKey: string): MetricKbCard | null {
  const entry = METRIC_KB[metricKey];
  // Комплект what/how/source обязателен целиком: у legacy-записей
  // (formula/source без whatIs) человекочитаемых блоков просто нет.
  if (!entry?.whatIs || !entry.engine || !entry.dataSource) return null;
  return {
    what: entry.whatIs,
    how: entry.example ? `${entry.engine}\n${entry.example}` : entry.engine,
    source: entry.dataSource,
    ...(entry.pitfalls ? { pitfalls: entry.pitfalls } : {}),
  };
}
