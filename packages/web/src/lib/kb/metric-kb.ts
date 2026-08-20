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

  // ── Поля карточки 2.0 (спека 2026-08-20-kb-uplift) ──
  //
  // Все три необязательны и отдаются ровно тогда, когда запись их несёт:
  // правило пустоты не меняется — незаполненный раздел не рисуется.

  /** «Скоуп и момент» — за какой периметр и на какое время это число. */
  scope?: string;
  /** «Почему может разойтись с книгой или Сводом». */
  divergence?: string;
  /** «Порог» — цветовые зоны словами; текущую зону считает экран. */
  thresholds?: string;
  /** «Что делать» — действие при отклонении. */
  actions?: string;
}

export function kbFor(metricKey: string): MetricKbCard | null {
  const entry = METRIC_KB[metricKey];
  // Комплект what/how/source обязателен целиком: у legacy-записей
  // (formula/source без whatIs) человекочитаемых блоков просто нет.
  if (!entry?.whatIs || !entry.dataSource) return null;
  // «Как считается» — человеческий howCalc; engine-путь — это провенанс,
  // ему место в «Откуда», а не в объяснении для читателя без подготовки.
  const how = entry.howCalc ?? entry.engine;
  if (!how) return null;
  const source = entry.engine
    ? `${entry.dataSource}\nПуть в движке: ${entry.engine}`
    : entry.dataSource;
  return {
    what: entry.whatIs,
    how: entry.example ? `${how}\n${entry.example}` : how,
    source,
    ...(entry.pitfalls ? { pitfalls: entry.pitfalls } : {}),
    ...(entry.scopeMoment ? { scope: entry.scopeMoment } : {}),
    ...(entry.divergence ? { divergence: entry.divergence } : {}),
    ...(entry.thresholdsFull ? { thresholds: entry.thresholdsFull } : {}),
    ...(entry.actions ? { actions: entry.actions } : {}),
  };
}
