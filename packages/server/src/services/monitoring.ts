/**
 * monitoring.ts — чтение книги «Ежедневный мониторинг» (канон п.69в:
 * отдельная вкладка; п.101а: ВСЕ страницы книги переносятся в продукт).
 *
 * Паттерн — тот же, что у source-refresh/google-sheets: кэш на процесс с TTL
 * из config.cache.ttlSeconds, дедупликация параллельных чтений одним
 * промисом, отказ отдельного листа не валит цикл, а честно записывается в
 * failed (читатель увидит плашку неполноты, а не тишину).
 *
 * ЧИТАЕМ ОДИННАДЦАТЬ ВИДИМЫХ ЛИСТОВ, а не восемь: восемь реестров управлений,
 * «СВОДНЫЙ» (итог книги и его разрыв с нашим счётом), «25-26» (переходящий
 * реестр с победителями, ИНН и родословной переобъявлений) и «Перечень ГРБС»
 * (справочник учреждений). Три скрытых листа-предка данными не читаются — там
 * ноль строк, и продукт показывает их как форму, а не как данные.
 *
 * Чего этот слой НЕ делает: не разбирает строки (это @aemr/core), не решает,
 * что считать ошибкой, и не сглаживает неполноту. Лист не ответил — его имя
 * едет наружу.
 */

import { MONITORING_DATA_SHEETS } from '@aemr/core';
import { config } from '../config.js';
import { getSheetDataFromSpreadsheet } from './google-sheets.js';

/**
 * Книга «Ежедневный мониторинг» — директива владельца п.59 (drive-ссылка
 * 14.08). Тот же идентификатор наблюдает drive-watch (вебхук-канал изменений).
 */
export const MONITORING_SPREADSHEET_ID = '15VKFyOPbyP2vJVvmAFVXD0lV14ZwgJ0nxwbhBdjJMps';

export interface MonitoringBookSnapshot {
  /** Грид каждого прочитанного листа: имя листа книги → строки значений. */
  sheets: Record<string, unknown[][]>;
  /** Момент чтения книги (ISO) — плашка периода данных на экране (п.58). */
  readAt: string;
  /** Непрочитанные листы: имя → русская причина. Пусто — цикл полный. */
  failed: Record<string, string>;
}

let cached: MonitoringBookSnapshot | null = null;
let cachedAtMs = 0;
let inFlight: Promise<MonitoringBookSnapshot> | null = null;

/**
 * Прочитать листы книги мониторинга (с кэшем).
 *
 * Кэшируется только снимок, где прочитан хоть один лист: полный отказ
 * источника не должен занимать TTL и держать «пустоту» пять минут —
 * следующий запрос честно попробует снова.
 */
export function getMonitoringBook(force = false): Promise<MonitoringBookSnapshot> {
  const ttlMs = config.cache.ttlSeconds * 1000;
  if (!force && cached && Date.now() - cachedAtMs < ttlMs) {
    return Promise.resolve(cached);
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const sheets: Record<string, unknown[][]> = {};
    const failed: Record<string, string> = {};

    // Листы читаются параллельно: книга одна, листов одиннадцать, а срок
    // ответа источника на каждый вызов свой (withSheetsDeadline внутри).
    const results = await Promise.allSettled(
      MONITORING_DATA_SHEETS.map(async (sheet) => ({
        sheet,
        values: await getSheetDataFromSpreadsheet(MONITORING_SPREADSHEET_ID, sheet),
      })),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        sheets[result.value.sheet] = result.value.values;
      } else {
        const sheetName = MONITORING_DATA_SHEETS[i];
        failed[sheetName] = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      }
    }

    const snapshot: MonitoringBookSnapshot = {
      sheets,
      readAt: new Date().toISOString(),
      failed,
    };
    if (Object.keys(sheets).length > 0) {
      cached = snapshot;
      cachedAtMs = Date.now();
    }
    return snapshot;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Сброс кэша — для вебхука изменений книги и тестов. */
export function invalidateMonitoringCache(): void {
  cached = null;
  cachedAtMs = 0;
}
