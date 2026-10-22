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
import { knownFileRevisionKey } from './file-revision.js';
import { normalizeSourceJournal, type SourceJournal } from './source-journal.js';

/** Имя скрытого листа журнала правок — одно во всех восьми книгах. */
export const CHANGELOG_SHEET_NAME = '_ChangeLog';

/**
 * Только запасное окно для источника без известной версии. Подтверждённая
 * версия координатора сохраняет чтение до изменения или ручного сброса.
 * Этот читатель не опрашивает Drive сам: все потребители используют одну
 * уже известную отметку. Момент чтения при повторном использовании не меняется.
 */
export const CHANGELOG_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedRows {
  spreadsheetId: string;
  rows: unknown[][];
  normalized: SourceJournal;
  at: number;
  revision: string | null;
}

const cache = new Map<string, CachedRows>();
const inFlight = new Map<string, { spreadsheetId: string; revision: string | null; request: Promise<CachedRows> }>();
let resetGeneration = 0;

/** Complete known source identity, including explicit rereads; null means unproven. */
export function changelogInputKey(books: Readonly<Record<string, string>>): string | null {
  const entries = Object.entries(books).sort(([a], [b]) => a.localeCompare(b))
    .map(([dept, id]) => [dept, id, knownFileRevisionKey(id)]);
  return entries.length > 0 && entries.every(entry => entry[2] !== null)
    ? JSON.stringify([resetGeneration, entries]) : null;
}

/** Сбрасывает окно — нужен стражам и ручной перечитке. */
export function resetChangelogSource(): void {
  resetGeneration++;
  cache.clear();
  inFlight.clear();
}

/** Момент последнего успешного чтения журнала книги (мс эпохи); null — не читался. */
export function changelogReadAt(dept: string, spreadsheetId?: string): number | null {
  const cached = cache.get(dept);
  return cached && (spreadsheetId === undefined || cached.spreadsheetId === spreadsheetId) ? cached.at : null;
}

/**
 * Сырые строки листа «_ChangeLog» одной книги.
 *
 * Окно и pending принадлежат паре ГРБС + неизменяемый ID книги. На ГРБС
 * хранится только последнее выбранное чтение: смена адреса и reset не дают
 * старому ответу заполнить новое окно. ID в журнал сервера не выводится.
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
  return (await readChangelogReading(dept, spreadsheetId, now)).rows;
}

/** Metadata belongs to this reply, including a reply superseded by a reset. */
export async function readChangelogReading(
  dept: string,
  spreadsheetId: string,
  now: number = Date.now(),
): Promise<CachedRows> {
  const cached = cache.get(dept);
  const revision = knownFileRevisionKey(spreadsheetId);
  if (cached?.spreadsheetId === spreadsheetId && cached.revision === revision
      && (revision !== null || now - cached.at < CHANGELOG_CACHE_TTL_MS)) return cached;
  if (cached && cached.spreadsheetId !== spreadsheetId) cache.delete(dept);

  const pending = inFlight.get(dept);
  if (pending?.spreadsheetId === spreadsheetId && pending.revision === revision) return pending.request;

  const request = getSheetDataFromSpreadsheet(spreadsheetId, CHANGELOG_SHEET_NAME, true)
    .then((rows) => {
      const reading: CachedRows = { spreadsheetId, rows, normalized: normalizeSourceJournal(rows), at: now, revision };
      if (inFlight.get(dept)?.request === request && knownFileRevisionKey(spreadsheetId) === revision) cache.set(dept, reading);
      return reading;
    })
    .finally(() => {
      if (inFlight.get(dept)?.request === request) inFlight.delete(dept);
    });

  inFlight.set(dept, { spreadsheetId, revision, request });
  return request;
}
