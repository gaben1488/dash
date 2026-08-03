/**
 * Маршрутизация «дельта снимков → KPI-плитка» страницы «Отчёт» (R1-хвост).
 *
 * Человеческим языком: бейдж «↑↓ к прошлому снимку» на плитке честен только
 * тогда, когда у числа плитки есть та же самая метрика в официальном СВОДе —
 * история снимков (metric_history) хранит именно официальные ячейки. Плитки
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
 * Официальный аналог плитки в слое снимков — dotted-ключ REPORT_MAP
 * (та самая ячейка листа СВОД ТД-ПМ, которую хранит metric_history).
 *
 * Аналог есть только у исполнения КП/ЕП: «год» → строка года (G14/G26),
 * 1 кв → строка первого квартала (G9/G21). Районных строк 2 кв–4 кв в СВОДе нет,
 * как нет и единой ячейки «КП+ЕП вместе» — для них честный ответ undefined.
 */
export function officialAnalogKey(
  metricKey: string,
  scope: KpiScope,
  /**
   * Год отчёта. История снимков хранит ячейки ЖИВОГО листа СВОД — а он
   * ведёт один план-год. Для другого года аналога нет: бейдж «к прошлому
   * снимку» показывал бы сдвиг чужого числа (code-review 03.08). Не задан —
   * поведение прежнее (аналог по скоупу).
   */
  reportYear?: number,
): string | undefined {
  if (reportYear !== undefined && reportYear !== new Date().getFullYear()) return undefined;
  const family = OFFICIAL_FAMILY[metricKey];
  if (family === undefined) return undefined;
  if (scope === 'year') return `${family}.year.percent`;
  if (scope === 1) return `${family}.q1.percent`;
  return undefined;
}

/**
 * Дельта для плитки из diff снимков: по officialKey плитки находит сдвиг
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
