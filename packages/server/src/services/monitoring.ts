/**
 * monitoring.ts — чтение книги «Ежедневный мониторинг» (канон п.69в:
 * отдельная вкладка; п.101а: ВСЕ страницы книги переносятся в продукт).
 *
 * Паттерн — тот же, что у source-refresh/google-sheets: кэш на процесс с TTL
 * из config.cache.ttlSeconds, дедупликация параллельных чтений одним
 * промисом, отказ отдельного листа не валит цикл, а честно записывается в
 * failed (читатель увидит плашку неполноты, а не тишину).
 *
 * Четыре текущих источника: мастер, рабочая очередь, аналитический свод,
 * справочник заказчиков. Архивы и совместные закупки Dash выводит из мастера;
 * справочник поставщиков читается отдельно с собственным статусом отказа.
 * Один values.batchGet получает всю основную книгу. Если пакет не проходит,
 * читаем листы отдельно и сохраняем имена непрочитанных источников.
 *
 * Чего этот слой НЕ делает: не разбирает строки (это @aemr/core), не решает,
 * что считать ошибкой, и не сглаживает неполноту. Лист не ответил — его имя
 * едет наружу.
 */

import { MONITORING_DATA_SHEETS } from '@aemr/core';
import { config } from '../config.js';
import { batchGetSheetValues, getSheetDataFromSpreadsheet } from './google-sheets.js';
import { bookFingerprints, changedSheets } from './sheet-fingerprint.js';
import { checkFileChanged } from './file-revision.js';
import { assignMissingCustomerIds } from './customer-identities.js';

/**
 * Книга оперативного мониторинга/процедур. Значение централизовано в config:
 * default указывает на текущую книгу, production может переопределить его env.
 * Тот же экспорт оставлен для drive-watch и существующих тестов.
 */
export const MONITORING_SPREADSHEET_ID = config.google.monitoringSpreadsheetId
  ?? '1wET-yUf9OQGTgPWSs96xAE3X7WSrVejtVGWRH1pv-1E';

export interface MonitoringBookSnapshot {
  /** Грид каждого прочитанного листа: имя листа книги → строки значений. */
  sheets: Record<string, unknown[][]>;
  /** Момент чтения книги (ISO) — плашка периода данных на экране (п.58). */
  readAt: string;
  /** Непрочитанные листы: имя → русская причина. Пусто — цикл полный. */
  failed: Record<string, string>;
  /**
   * Номер содержимого книги. Растёт ТОЛЬКО когда содержимое действительно
   * изменилось — перечитка, вернувшая те же строки, номер не двигает. По нему
   * потребители (разбор, снимок, живые события) отличают «книгу перечитали» от
   * «книга стала другой», не сравнивая грид заново.
   */
  version: number;
  /** Листы, чьё содержимое отличается от прошлого чтения. */
  changed: string[];
}

let cached: MonitoringBookSnapshot | null = null;
let cachedAtMs = 0;
let inFlight: Promise<MonitoringBookSnapshot> | null = null;
let prints: Record<string, string> | null = null;
let version = 0;
let retryRequired = false;

/** Прочитать все листы одним пакетом. Отказ — общий на всю книгу. */
async function readBookInOneRequest(): Promise<Record<string, unknown[][]>> {
  return batchGetSheetValues(MONITORING_DATA_SHEETS, MONITORING_SPREADSHEET_ID);
}

/**
 * Запасной путь: лист за листом. Дороже пакетного на порядок по числу
 * обращений, зато отказ одного листа не уносит остальные десять.
 */
async function readBookSheetBySheet(): Promise<{
  sheets: Record<string, unknown[][]>;
  failed: Record<string, string>;
}> {
  const sheets: Record<string, unknown[][]> = {};
  const failed: Record<string, string> = {};
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
      failed[MONITORING_DATA_SHEETS[i]] = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    }
  }
  return { sheets, failed };
}

/**
 * Прочитать листы книги мониторинга (с кэшем).
 *
 * Кэшируется только полный снимок: полный отказ
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
    let sheets: Record<string, unknown[][]>;
    let failed: Record<string, string>;
    try {
      sheets = await readBookInOneRequest();
      failed = {};
    } catch {
      // Пакет не прошёл (переименованный лист роняет весь запрос, сеть, квота).
      // Причину отдельного листа назовёт запасной путь — он и назовёт.
      ({ sheets, failed } = await readBookSheetBySheet());
    }

    const next = bookFingerprints(sheets);
    const changed = changedSheets(prints, next);
    // Первое чтение за жизнь процесса изменением не считается (changedSheets),
    // но номер содержимого обязано получить — иначе «версия 0» означала бы
    // одновременно «книгу не читали» и «книга не менялась».
    if (prints === null || changed.length > 0) version++;
    retryRequired = Object.keys(failed).length > 0;
    if (!retryRequired) prints = next;

    const snapshot: MonitoringBookSnapshot = {
      sheets,
      readAt: new Date().toISOString(),
      failed,
      version,
      changed,
    };
    if (Object.keys(sheets).length > 0 && Object.keys(failed).length === 0) {
      cached = snapshot;
      cachedAtMs = Date.now();
    }
    return snapshot;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Сброс кэша — для вебхука изменений книги и тестов.
 *
 * Отпечатки при этом НЕ стираются: сброс говорит «перечитай», а не «забудь,
 * что видел». Иначе каждое уведомление Drive объявляло бы всю книгу новой, и
 * ответ на вопрос «что изменилось» опять свёлся бы к «всё».
 */
export function invalidateMonitoringCache(): void {
  cached = null;
  cachedAtMs = 0;
}

/** Полный сброс, включая память об отпечатках. Только для тестов. */
export function resetMonitoringState(): void {
  invalidateMonitoringCache();
  prints = null;
  version = 0;
retryRequired = false;
}

/** Итог адресной перечитки книги по уведомлению. */
export interface MonitoringRefreshResult {
  /** Читали ли книгу вообще. false — Drive сказал, что файл не менялся. */
  read: boolean;
  /** Листы, чьё содержимое отличается от прошлого чтения. */
  changed: string[];
  /** Номер содержимого после этого захода. */
  version: number;
  /** Почему не читали — для журнала. Пусто, если читали. */
  skippedBecause?: string;
  /** Partial reading must remain retryable. */
  failed?: Record<string, string>;
}

/**
 * Перечитать книгу мониторинга по уведомлению Drive — с двумя ступенями
 * отсева, чтобы событие не равнялось работе.
 *
 * СТУПЕНЬ ПЕРВАЯ, У GOOGLE. Отметка версии файла (services/file-revision.ts) —
 * запрос около двухсот байт. Совпала с прошлой — файл не менялся ничем, и
 * читать книгу не надо вовсе: ни сети, ни квоты, ни разбора. Drive шлёт
 * уведомления и на правки, которых в данных нет (открыли и закрыли, сменили
 * ширину колонки), и раньше каждая такая стоила полного чтения книги.
 *
 * СТУПЕНЬ ВТОРАЯ, У СЕБЯ. Книгу прочитали — отпечатки листов говорят, какие
 * листы поехали. Пустой список законен: книгу правили так, что содержимое не
 * изменилось. Тогда в эфир не уходит ничего — тишина честнее, чем «обновлено».
 *
 * Событие в эфир публикуется вызывающим (webhook/цикл): этот модуль читает
 * книгу и не знает про шину, иначе его тесты потянули бы за собой полпродукта.
 */
export async function refreshMonitoringBook(options: {
  /** Спрашивать ли Drive об отметке версии. false — читать безусловно. */
  askDrive?: boolean;
} = {}): Promise<MonitoringRefreshResult> {
  if (options.askDrive ?? true) {
    const verdict = await checkFileChanged(MONITORING_SPREADSHEET_ID);
    if (verdict === 'same'&& !retryRequired) {
      return {
        read: false,
        changed: [],
        version,
        skippedBecause: 'Drive: файл не менялся с прошлого чтения',
      };
    }
    // 'unknown' — Drive недоступен или доступа нет. Это НЕ повод пропустить
    // правку: читаем, как читали раньше.
  }

  invalidateMonitoringCache();
  let book = await getMonitoringBook(true);
  const directory = book.sheets['Справочник заказчиков'];
  if (directory?.[0]?.[18] === 'ID учреждения' && directory.slice(1).some(row => (row[3] || row[4]) && !row[18])) {
    try {
      if (await assignMissingCustomerIds(MONITORING_SPREADSHEET_ID)) book = await getMonitoringBook(true);
    } catch (error) {
      book = { ...book, failed: { ...book.failed, 'ID учреждения': error instanceof Error ? error.message : 'Идентификаторы не сохранены; повторите обновление.' } };
    }
  }
  return { read: true, changed: book.changed, version: book.version , failed: book.failed };
}

/** Номер содержимого последней прочитанной книги; 0 — книгу ещё не читали. */
export function monitoringBookVersion(): number {
  return version;
}
