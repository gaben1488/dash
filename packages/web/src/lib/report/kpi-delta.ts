/**
 * Маршрутизация «дельта слепков → KPI-плитка» страницы «Отчёт» (R1-хвост).
 *
 * Человеческим языком: бейдж «↑↓ к прошлому слепку» на плитке честен только
 * тогда, когда у числа плитки есть та же самая метрика в официальном СВОДе —
 * история слепков (metric_history) хранит именно официальные ячейки. Плитки
 * отчёта считаются заново из строк книг (origin=calc), поэтому сравнивать
 * можно лишь пары одинаковой семантики: исполнение КП и исполнение ЕП —
 * колонка G районных строк СВОДа. Итоговые плитки (КП+ЕП вместе) и деньги
 * «итого» одной официальной ячейки не имеют — они остаются без бейджа,
 * и это правильно: лучше нет дельты, чем дельта чужого числа.
 */
import type { MetricDelta } from '@aemr/core';

/** Скоуп плитки интегральной сводки: год либо конкретный квартал. */
export type KpiScope = 'year' | 1 | 2 | 3 | 4;

/** Плитка словаря продукта → семейство районных строк СВОДа (REPORT_MAP). */
const OFFICIAL_FAMILY: Readonly<Record<string, string>> = {
  comp_exec_count_pct: 'competitive',
  ep_exec_count_pct: 'sole',
};

/**
 * Официальный аналог плитки в слое слепков — dotted-ключ REPORT_MAP
 * (та самая ячейка листа СВОД ТД-ПМ, которую хранит metric_history).
 *
 * Аналог есть только у исполнения КП/ЕП: «год» → строка года (G14/G26),
 * Q1 → строка первого квартала (G9/G21). Районных строк Q2–Q4 в СВОДе нет,
 * как нет и единой ячейки «КП+ЕП вместе» — для них честный ответ undefined.
 */
export function officialAnalogKey(metricKey: string, scope: KpiScope): string | undefined {
  const family = OFFICIAL_FAMILY[metricKey];
  if (family === undefined) return undefined;
  if (scope === 'year') return `${family}.year.percent`;
  if (scope === 1) return `${family}.q1.percent`;
  return undefined;
}

/**
 * Дельта для плитки из diff слепков: по officialKey плитки находит сдвиг
 * той же официальной метрики. Нет аналога, пустой diff или ключ в diff
 * не встретился → undefined — плитка живёт без бейджа.
 */
export function kpiDeltaFor(
  tile: { officialKey?: string },
  deltas: readonly MetricDelta[],
): MetricDelta | undefined {
  if (tile.officialKey === undefined) return undefined;
  return deltas.find((d) => d.metricKey === tile.officialKey);
}
