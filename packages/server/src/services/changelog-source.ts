/**
 * changelog-source.ts — ОДНО чтение листа «_ChangeLog» книги на всех читателей.
 *
 * ЗАЧЕМ. Журнал правок книги читают три разных потребителя, и до сих пор
 * каждый ходил к Google своей дорогой со своим окном кэша:
 *   • `/api/changes` — «кто что поменял с даты среза» (routes/changes.ts);
 *   • `/api/provenance/*` — откуда взялась плановая сумма (provenance-journal.ts);
 *   • `/api/workload` — нагрузка управлений и три рода событий (routes/workload.ts,
 *     через тот же provenance-journal.ts).
 * Разбор у них РАЗНЫЙ и обязан оставаться разным (changelog.ts выбрасывает
 * колонку «Строка», провенансу она нужна как ключ). А вот СЫРЬЁ у них одно и то
 * же: те же 33 724 строки книги УО. Два независимых окна означали два обращения
 * к одной книге за одно и то же окно — и ровно в тот момент, когда открыта
 * страница провенанса и рядом обновляется журнал правок, Google отвечает
 * «слишком часто» (реестр багов 09.07.2026).
 *
 * ЧТО ДЕЛАЕТ ЭТОТ МОДУЛЬ. Держит сырые строки листа покнижно с одним общим
 * окном и склеивает ОДНОВРЕМЕННЫЕ запросы в одно обращение. Второе важнее
 * первого: окно кэша не спасает от шквала, потому что при пустом окне пять
 * параллельных запросов честно уходят к источнику все пять раз. Тот же приём,
 * которым уже живут снимок (inFlightLoads) и цикл источников (inFlight).
 *
 * ЧЕГО НЕ ДЕЛАЕТ. Не разбирает строки — разбор остаётся у потребителей, их два
 * и они не сводимы. Не кэширует отказ: книга, ожившая через минуту, обязана
 * читаться сразу, а не числиться молчащей до конца окна.
 */
import { getSheetDataFromSpreadsheet } from './google-sheets.js';

/** Имя скрытого листа журнала правок — одно во всех восьми книгах. */
export const CHANGELOG_SHEET_NAME = '_ChangeLog';

/**
 * Окно кэша. Пять минут — то же значение, что было у обоих прежних читателей;
 * менять его здесь значило бы менять свежесть страниц, а не устранять дубль.
 */
export const CHANGELOG_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedRows {
  rows: unknown[][];
  at: number;
}

const cache = new Map<string, CachedRows>();
const inFlight = new Map<string, Promise<unknown[][]>>();

/** Сбрасывает окно — нужен стражам и ручной перечитке. */
export function resetChangelogSource(): void {
  cache.clear();
  inFlight.clear();
}

/** Момент последнего успешного чтения журнала книги (мс эпохи); null — не читался. */
export function changelogReadAt(dept: string): number | null {
  return cache.get(dept)?.at ?? null;
}

/**
 * Сырые строки листа «_ChangeLog» одной книги.
 *
 * Ключ окна — короткое имя ГРБС: адрес книги за ним закреплён реестром
 * источников, а имя читаемо в журнале сервера, в отличие от идентификатора
 * книги, которому в журнале не место.
 *
 * Отказ пробрасывается как есть — решать, что значит молчание книги (пустой
 * ответ страницы или честная пометка «книга не ответила»), должен потребитель,
 * а не общий читатель.
 */
export async function readChangelogRows(
  dept: string,
  spreadsheetId: string,
  now: number = Date.now(),
): Promise<unknown[][]> {
  const cached = cache.get(dept);
  if (cached && now - cached.at < CHANGELOG_CACHE_TTL_MS) return cached.rows;

  const pending = inFlight.get(dept);
  if (pending) return pending;

  const request = getSheetDataFromSpreadsheet(spreadsheetId, CHANGELOG_SHEET_NAME)
    .then((rows) => {
      cache.set(dept, { rows, at: now });
      return rows;
    })
    .finally(() => {
      inFlight.delete(dept);
    });

  inFlight.set(dept, request);
  return request;
}
