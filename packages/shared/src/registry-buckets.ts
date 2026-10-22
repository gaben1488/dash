/**
 * Канонические корзины Реестра — единый дом R01.01 (пп.23, 71, 73в).
 * Подписи, объяснение, KB и предикаты читаются API, Реестром и навигацией.
 * Нельзя заводить отдельную логику фильтрации в React или серверном маршруте.
 * unfunded: уже вычисленный признак planYearMissing (@aemr/core).
 * yearlong: structural isYearlongStageRow (yearlong-stage.ts).
 *
 * Корзины НЕ взаимоисключающие: одна строка может быть в обеих.
 * Периметр (год, ГРБС, фильтры, покрытие, момент) задаёт каждый запрос,
 * поэтому суммы разных чтений не должны представляться как сопоставимые.
 */
import { isYearlongStageRow } from './yearlong-stage.js';
import type { SourceCoverage } from './source-coverage.js';

export type RegistryBucketId = 'unfunded' | 'yearlong';

export interface RegistryBucketRow {
  readonly signals?: readonly string[] | null;
  readonly method?: unknown;
  /** Сырая колонка Q, не сконвертированная ISO-дата. */
  readonly factDateRaw?: unknown;
  readonly factSum?: number | null;
}

export interface RegistryBucketDefinition {
  readonly title: string;
  readonly navigationLabel: string;
  readonly navigationTitle: string;
  readonly mechanism: string;
  readonly emptyReason: string;
  readonly kbKey: string;
  readonly predicate: (row: RegistryBucketRow) => boolean;
}

export interface RegistryBucketTotals {
  rows: number;
  /** Сумма планов K в тысячах рублей. */
  planSum: number;
  /** Подмножество unfunded, не добавляется к rows ещё раз. */
  initiativeRows?: number;
}

export interface RegistryBucketsResponse {
  asOf: string;
  source: 'live' | 'snapshot';
  coverage?: SourceCoverage;
  unfunded: RegistryBucketTotals;
  yearlong: RegistryBucketTotals;
}

/** Одни значения и одна логика для API, навигации и Реестра. */
export const REGISTRY_BUCKETS: Readonly<Record<RegistryBucketId, RegistryBucketDefinition>> = {
  unfunded: {
    navigationLabel: 'Не обеспеченные',
    navigationTitle: 'Закупки, не обеспеченные финансированием: плановая дата не указана',
    title: 'Закупки, не обеспеченные финансированием',
    kbKey: 'bucket_unfunded_rows',
    // Текст ведёт с рукописной плановой даты N, а не с производного года P
    // (канон п.123 «N и Q первичны»): год пуст вслед за датой, и просить
    // читателя заполнить производную графу означало бы послать его не туда.
    mechanism:
      'Способ и плановые деньги у строки есть, а рукописная плановая дата (графа N) не проставлена — '
      + 'и год плана пуст вслед за ней: финансирование не подтверждено. '
      + 'Формулы официального листа СВОД такие строки не видят, и наш годовой срез тоже: они лежат '
      + 'вне обоих чисел и ждут решения — подтвердить срок или снять план.',
    emptyReason:
      'Ни у одной загруженной строки плановая дата не пуста при заполненном способе и плановых деньгах. '
      + 'Если ожидали увидеть строки — проверьте отбор шапки (управление, период, способ) и снимите лишнее.',
    predicate: (r) => Array.isArray(r.signals) && r.signals.includes('planYearMissing'),
  },
  yearlong: {
    navigationLabel: 'В течение года',
    navigationTitle: 'Закупки, проводимые в течение года (серии договоров, выплаты, платежи)',
    title: 'Закупки, проводимые в течение года',
    kbKey: 'bucket_yearlong_rows',
    mechanism:
      'Единственный поставщик, дата заключения — заглушка («Х» или пусто), а факт больше нуля: статья исполняется '
      + 'серией договоров или платежей в течение года. Ровно эти строки формулы свода не считают в факте и экономии; план — входит (канон п.71).',
    emptyReason:
      'Среди загруженных строк нет ни одной с способом ЕП, заглушкой в дате заключения и ненулевым фактом. '
      + 'Если ожидали увидеть строки — проверьте отбор шапки (управление, период, бюджет) и снимите лишнее.',
    predicate: (r) => isYearlongStageRow({
      method: String(r.method ?? ''),
      factDateCell: r.factDateRaw,
      factSum: typeof r.factSum === 'number' ? r.factSum : 0,
    }),
  },
};
