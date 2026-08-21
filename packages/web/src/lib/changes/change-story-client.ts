/**
 * change-story-client.ts — журнал изменений на стороне экрана.
 *
 * Здесь три вещи, и ни одна из них не «ещё один разбор правок»:
 *   • форма ответа GET /api/change-story (контракт с routes/change-story.ts);
 *   • перевод событий ЖИВОГО ЭФИРА в те же записи рассказа, что приходят с
 *     сервера, — чтобы правка, случившаяся минуту назад при открытой вкладке,
 *     стояла в одном списке с правками недельной давности;
 *   • слияние двух списков без дублей.
 *
 * ПОЧЕМУ ЭФИР СВОДИТСЯ ЗДЕСЬ, А НЕ НА СЕРВЕРЕ. Сервер отвечает телом запроса,
 * эфир идёт отдельным незаканчивающимся соединением. Подмешай сервер эфир в
 * тело — одна и та же правка приехала бы дважды: раз потоком, раз ответом.
 * Экран — единственное место, где видно оба потока сразу, значит и склейка
 * его.
 *
 * ПРАВИЛА СКЛЕЙКИ. Ключ записи один и тот же на обеих сторонах (книга + лист +
 * адрес ячейки + момент + автор), поэтому правка, успевшая попасть и в поток, и
 * в журнал книги, схлопывается в одну. Записи эфира, которых в ответе сервера
 * ещё нет (журнал книги читается окном в пять минут), остаются — иначе экран
 * забывал бы то, что сам только что показал.
 */
import {
  changeKindOfColumn,
  columnLabelOf,
  compareEntries,
  filterChangeEntries,
  foldRowEvents,
  orderingMsOf,
  type ChangeDigest,
  type ChangeEntry,
  type ChangeFilter,
  type ChangeGap,
  type ChangeKind,
} from '@aemr/core';
import type { RowChange } from '../../hooks/useLiveEvents';
import { fetchJSON } from '../../api';

/** Ответ GET /api/change-story — внешний контракт, менять вместе с роутом. */
export interface ChangeStoryResponse {
  readonly since: string;
  readonly digest: ChangeDigest;
  readonly gaps: readonly ChangeGap[];
  readonly deletionsUnobservable: boolean;
  readonly note: string;
  /** Пара снимков, по которой найдены пропажи; null — сравнивать не с чем. */
  readonly comparison: { readonly beforeAt: string; readonly afterAt: string } | null;
  readonly facets: {
    readonly books: ReadonlyArray<{ book: string; count: number }>;
    readonly authors: ReadonlyArray<{ author: string; count: number }>;
  };
  readonly total: number;
  readonly shown: number;
  readonly entries: readonly ChangeEntry[];
}

/** Параметры запроса подробной глубины. */
export interface ChangeStoryQuery {
  readonly since?: string;
  readonly books?: readonly string[];
  readonly kinds?: readonly ChangeKind[];
  readonly authors?: readonly string[];
  readonly search?: string;
  readonly limit?: number;
}

/** Собрать адрес запроса. Пустые оси не отправляются вовсе. */
export function changeStoryUrl(query: ChangeStoryQuery): string {
  const params = new URLSearchParams();
  if (query.since) params.set('since', query.since);
  for (const b of query.books ?? []) params.append('book', b);
  for (const k of query.kinds ?? []) params.append('kind', k);
  for (const a of query.authors ?? []) params.append('author', a);
  if (query.search && query.search.trim() !== '') params.set('q', query.search.trim());
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const qs = params.toString();
  return qs === '' ? '/api/change-story' : `/api/change-story?${qs}`;
}

/** Запросить рассказ у сервера. Отказ пробрасывается — молчать о нём нельзя. */
export async function fetchChangeStory(query: ChangeStoryQuery = {}): Promise<ChangeStoryResponse> {
  return fetchJSON<ChangeStoryResponse>(changeStoryUrl(query));
}

/**
 * Момент эфира приходит в ISO с поясом («2026-08-21T11:33:00.000Z»), а записи
 * журнала книги подписаны часами КНИГИ без пояса. Приводим эфир к той же
 * подписи, что у книги, — иначе одна и та же правка в списке стояла бы дважды
 * под двумя разными временами.
 */
export function bookClockOf(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * События живого эфира в записи рассказа.
 *
 * Свёртка построчных событий делается тем же ядром, что на сервере: если
 * оператор заполнил новую строку целиком, эфир покажет «новая закупка», а не
 * десять отдельных правок. Второй правды о том, что такое «добавили закупку»,
 * в продукте нет.
 */
export function entriesFromLiveRows(rows: readonly RowChange[]): ChangeEntry[] {
  const raw: ChangeEntry[] = rows.map((r) => {
    const letter = r.column === '' ? null : r.column.toUpperCase();
    const at = bookClockOf(r.at);
    const author = r.author && r.author.trim() !== '' ? r.author : null;
    return {
      id: `${r.book}|ВСЕ|${letter ?? '?'}${r.sheetRow}|${at ?? '?'}|${author ?? '?'}`,
      book: r.book,
      sheet: 'ВСЕ',
      rowSeq: r.rowSeq ?? null,
      sheetRow: Number.isFinite(r.sheetRow) ? r.sheetRow : null,
      column: letter,
      columnLabel: r.columnLabel ?? columnLabelOf(letter),
      kind: changeKindOfColumn(letter),
      before: r.before,
      after: r.after,
      author,
      at,
      atMs: orderingMsOf(at),
      subject: null,
      subordinate: null,
      origin: 'live-stream' as const,
    };
  });
  return foldRowEvents(raw);
}

/**
 * Начало окна отбора в той же шкале, что ключ `atMs` записей: подпись «Z»
 * приписывается намеренно — так же читает дату сервер (`sinceDay * 86400000`),
 * и граница окна не уезжает на часовой пояс машины читателя.
 */
export function sinceMsOf(since: string | undefined): number | undefined {
  if (since === undefined || since.trim() === '') return undefined;
  const ms = Date.parse(`${since.trim()}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Отбор запроса в форме, понятной ядру. Пустые оси не сужают ничего. */
export function filterOf(query: ChangeStoryQuery): ChangeFilter {
  return {
    books: query.books ?? [],
    kinds: query.kinds ?? [],
    authors: query.authors ?? [],
    sinceMs: sinceMsOf(query.since),
    search: query.search,
  };
}

/**
 * Эфир, ПРОШЕДШИЙ ТОТ ЖЕ ОТБОР, что и ответ сервера.
 *
 * Без этого шага живая правка обходила фильтры экрана с чёрного хода: сервер
 * отбирает то, что отдаёт, а эфир приходит на экран сырым, и читатель,
 * выбравший книгу УО и род «деньги», видел бы среди них чужую правку
 * комментария в другой книге. Отбор делается ТЕМ ЖЕ `filterChangeEntries`,
 * что на сервере, — второй правды о том, что значит «отобрано», в продукте
 * нет.
 */
export function liveEntriesMatching(
  entries: readonly ChangeEntry[],
  query: ChangeStoryQuery,
): ChangeEntry[] {
  return filterChangeEntries(entries, filterOf(query));
}

/**
 * Слить ответ сервера с эфиром. Победитель дубля — запись СЕРВЕРА: у неё есть
 * предмет закупки из ключа журнала, а у эфира его нет.
 */
export function mergeStoryWithLive(
  fromServer: readonly ChangeEntry[],
  fromLive: readonly ChangeEntry[],
): ChangeEntry[] {
  const seen = new Set(fromServer.map((e) => e.id));
  const merged = [...fromServer, ...fromLive.filter((e) => !seen.has(e.id))];
  merged.sort(compareEntries);
  return merged;
}
