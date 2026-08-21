/**
 * monitoring-parsed.ts — разобранная книга мониторинга, разобранная ОДИН раз.
 *
 * ЧТО БЫЛО. Четыре маршрута вкладки (`/api/monitoring`, `…/analytics`,
 * `…/match`, `…/triple`) читали книгу из общего кэша — и каждый разбирал её
 * заново. Замер 21.08.2026 на живой книге (14 листов, 952 строки): разбор
 * реестра 57,6 мс, переходящего реестра 34,6 мс, свода 0,2 мс, справочника
 * 2,9 мс — 95,3 мс на один маршрут и 381 мс на открытие вкладки, где строки
 * ни разу не изменились. Кэш листов от этого не спасал: он хранит СЫРЫЕ
 * строки, а дорога дорога именно дорога до смысла.
 *
 * ЧТО СТАЛО. Разбор привязан к номеру содержимого книги (`version` из
 * services/monitoring.ts). Номер растёт только тогда, когда содержимое
 * действительно другое: перечитка, вернувшая те же строки, его не двигает.
 * Значит, разобранная книга живёт ровно столько, сколько живёт её содержимое,
 * а не столько, сколько отмерил TTL.
 *
 * ПОЧЕМУ НЕ ПО ВРЕМЕНИ. Кэш по времени отвечает на вопрос «давно ли», а нужен
 * ответ на вопрос «то же ли самое». Первый ошибается в обе стороны: держит
 * устаревший разбор, пока не вышел срок, и выбрасывает годный, когда срок
 * вышел, хотя в книге ничего не менялось.
 *
 * ГРАНИЦА. Здесь только разбор и производные счётчики — ни одного решения о
 * том, что показать. Тексты, оговорки и коды ответа остаются в маршруте.
 */
import {
  MONITORING_DIRECTORY_SHEET,
  MONITORING_JOURNAL_SHEET,
  MONITORING_SVOD_SHEET,
  aggregateMonitoring,
  compareSvodWithProduct,
  parseMonitoringDirectory,
  parseMonitoringJournal,
  parseMonitoringProcedures,
  parseMonitoringSvod,
  productTotalsByDept,
  type MonitoringAggregates,
  type MonitoringDirectory,
  type MonitoringJournal,
  type MonitoringSvod,
  type SvodComparison,
} from '@aemr/core';
import type { MonitoringBookSnapshot } from './monitoring.js';

export interface ParsedMonitoringBook {
  registry: ReturnType<typeof parseMonitoringProcedures>;
  journal: MonitoringJournal;
  svod: MonitoringSvod;
  directory: MonitoringDirectory;
  /** Агрегаты реестра — считаются вместе с разбором, живут столько же. */
  aggregates: MonitoringAggregates;
  /** Пара «свод книги ↔ наш счёт по листам». */
  comparison: SvodComparison;
  /** Номер содержимого, для которого всё это верно. */
  version: number;
}

let cache: ParsedMonitoringBook | null = null;

/** Сколько раз разбор был переиспользован и сколько раз выполнен заново. */
let reused = 0;
let computed = 0;

function parseFresh(book: MonitoringBookSnapshot): ParsedMonitoringBook {
  const registry = parseMonitoringProcedures(book.sheets);
  const journal = parseMonitoringJournal(book.sheets[MONITORING_JOURNAL_SHEET]);
  const svod = parseMonitoringSvod(book.sheets[MONITORING_SVOD_SHEET]);
  const directory = parseMonitoringDirectory(
    book.sheets[MONITORING_DIRECTORY_SHEET],
    registry.procedures.map((p) => ({
      customer: p.customer,
      customerNormalized: p.customerNormalized,
      dept: p.dept,
    })),
  );
  return {
    registry,
    journal,
    svod,
    directory,
    aggregates: aggregateMonitoring(registry),
    comparison: compareSvodWithProduct(svod, productTotalsByDept(registry.procedures)),
    version: book.version,
  };
}

/**
 * Разобранная книга. Тот же номер содержимого — тот же разбор, без счёта.
 *
 * Номер 0 означает «книгу не читали»: такой снимок не кэшируется вовсе, иначе
 * пустота заняла бы место годного разбора до первого настоящего чтения.
 */
export function parsedMonitoringBook(book: MonitoringBookSnapshot): ParsedMonitoringBook {
  if (cache && book.version > 0 && cache.version === book.version) {
    reused++;
    return cache;
  }
  const parsed = parseFresh(book);
  computed++;
  if (book.version > 0) cache = parsed;
  return parsed;
}

/** Счётчики переиспользования — для маршрута состояния и замеров. */
export function parsedBookStats(): { reused: number; computed: number; version: number } {
  return { reused, computed, version: cache?.version ?? 0 };
}

/** Только для тестов: забыть разбор и счётчики. */
export function resetParsedMonitoringBook(): void {
  cache = null;
  reused = 0;
  computed = 0;
}
