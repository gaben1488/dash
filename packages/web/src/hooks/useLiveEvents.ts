/**
 * useLiveEvents — приём живого потока изменений (GET /api/events).
 *
 * ЗАЧЕМ. Push-уведомления Google Drive приходили на сервер и обновляли данные,
 * но на экране это было видно единственным способом: перезагрузить страницу и
 * заметить, что числа другие. Читатель не знал ни что что-то изменилось, ни что
 * именно. Здесь эфир доводится до экрана.
 *
 * ПОЧЕМУ НЕ EventSource. Встроенный в браузер приёмник не умеет отправлять
 * заголовок — а ключ доступа продукт передаёт именно заголовком (в проде его
 * подставляет обратный прокси, при местной разработке он лежит в хранилище
 * браузера). Класть ключ в адрес строки запроса нельзя: адреса попадают в
 * журналы и историю. Поэтому поток читается обычным запросом с потоковым телом,
 * а переподключение после обрыва делает этот модуль сам.
 *
 * ОДНО СОЕДИНЕНИЕ НА ВКЛАДКУ. Состояние живёт в модуле, а не в компоненте:
 * шапка, полоса оповещения, Реестр и Контроль читают одно и то же, и каждый
 * из них не должен открывать свой поток. Соединение считает пользователей и
 * закрывается, когда уходит последний.
 *
 * ТОН. Хук НЕ решает, что показывать: он копит факты («книга УО: 3 строки»,
 * «замечаний стало на 1 больше») и отдаёт их спокойными числами. Тревогу,
 * мигание и восклицательные знаки сюда вносить нечем — и не нужно.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useStore } from '../store';

/** Откуда пришла перечитка (сервер называет это в событии книги). */
export type RefreshOrigin = 'webhook' | 'cycle' | 'request' | 'startup';

/** Изменения одной книги, накопленные с последнего мягкого обновления. */
export interface BookChange {
  book: string;
  changedRows: number;
  addedRows: number;
  removedRows: number;
  rowsTotal: number;
  origin: RefreshOrigin;
  /** Момент последнего события по этой книге (ISO). */
  at: string;
}

/** Изменившаяся строка книги — материал подсветки в Реестре. */
export interface RowChange {
  book: string;
  sheetRow: number;
  rowSeq?: string;
  column: string;
  columnLabel?: string;
  before: string;
  after: string;
  author?: string;
  at: string;
}

export interface LiveState {
  /** Поток открыт. false — связи нет; экран об этом не кричит, но знает. */
  connected: boolean;
  /** Момент последнего события (ISO); null — с открытия ничего не случилось. */
  lastEventAt: string | null;
  /** Книги, изменившиеся с последнего мягкого обновления. */
  books: BookChange[];
  /** На сколько замечаний стало больше с последнего мягкого обновления. */
  newIssues: number;
  /** Пересобирался ли снимок — числа на экране устарели. */
  snapshotRebuilt: boolean;
  /** Недавно изменившиеся строки: живут FLASH_MS, потом подсветка гаснет. */
  recentRows: RowChange[];
  /**
   * Журнал эфира для угла шапки (мини-барабан истории): те же правки строк,
   * что recentRows, но НЕ гаснущие с подсветкой и переживающие acknowledge —
   * это журнал, а не новость. Ограничен HISTORY_MAX, чтобы вкладка, открытая
   * сутки, не копила тысячи записей. Поле необязательное: старые срезы
   * состояния (в т.ч. в тестах) остаются валидными.
   */
  history?: RowChange[];
  /**
   * По какой момент числа пересчитаны (ISO последнего snapshot-rebuilt).
   * Правка новее этого момента показывается в истории приглушённо-серой:
   * она увидена, но в числах экрана её ещё нет. Acknowledge поле не трогает.
   */
  recalculatedThrough?: string | null;
}

/** Потолок журнала эфира: столько правок держит история угла шапки. */
export const HISTORY_MAX = 80;

const EMPTY: LiveState = {
  connected: false,
  lastEventAt: null,
  books: [],
  newIssues: 0,
  snapshotRebuilt: false,
  recentRows: [],
  history: [],
  recalculatedThrough: null,
};

/**
 * Сколько держится подсветка изменившейся строки. Шесть секунд: хватает,
 * чтобы заметить глазом, и мало, чтобы через минуту экран не был раскрашен
 * следами позавчерашних правок.
 */
export const FLASH_MS = 6_000;

/** Пауза перед первой попыткой переподключения; дальше удваивается до потолка. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

let state: LiveState = EMPTY;
const listeners = new Set<() => void>();

function setState(patch: Partial<LiveState>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
}

/**
 * Текущее состояние эфира вне React — тем же чтением, что отдаёт хук.
 * Нужно там, где подписка избыточна: обработчику события, тесту, отладке.
 */
export function getLiveState(): LiveState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ── Разбор потока ─────────────────────────────────────── */

interface ServerEvent {
  id?: number;
  at?: string;
  kind?: string;
  [key: string]: unknown;
}

/**
 * Разобрать одну запись потока. Записи-комментарии (служебный «пульс» и
 * приветствие) возвращают null: они держат соединение и до экрана не доходят —
 * именно поэтому ничего не мигает в тишине.
 */
export function parseStreamRecord(raw: string): ServerEvent | null {
  const dataLines = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join('\n')) as ServerEvent;
  } catch {
    // Обрывок записи — не повод рушить поток: следующая запись придёт целой.
    return null;
  }
}

/** Свести пришедшее событие в накопленное состояние экрана. */
export function reduceLive(prev: LiveState, event: ServerEvent, now = Date.now()): LiveState {
  const at = typeof event.at === 'string' ? event.at : new Date(now).toISOString();

  if (event.kind === 'book-updated') {
    const book = String(event.book ?? '');
    const rest = prev.books.filter((b) => b.book !== book);
    const previous = prev.books.find((b) => b.book === book);
    return {
      ...prev,
      lastEventAt: at,
      books: [
        ...rest,
        {
          book,
          // Накопление, а не замена: две правки подряд до обновления данных —
          // это «изменилось 5 строк», а не «изменилось 2».
          changedRows: (previous?.changedRows ?? 0) + Number(event.changedRows ?? 0),
          addedRows: (previous?.addedRows ?? 0) + Number(event.addedRows ?? 0),
          removedRows: (previous?.removedRows ?? 0) + Number(event.removedRows ?? 0),
          rowsTotal: Number(event.rowsTotal ?? 0),
          origin: (event.origin as RefreshOrigin) ?? 'cycle',
          at,
        },
      ],
    };
  }

  if (event.kind === 'row-changed') {
    const row: RowChange = {
      book: String(event.book ?? ''),
      sheetRow: Number(event.sheetRow ?? 0),
      rowSeq: typeof event.rowSeq === 'string' ? event.rowSeq : undefined,
      column: String(event.column ?? ''),
      columnLabel: typeof event.columnLabel === 'string' ? event.columnLabel : undefined,
      before: String(event.before ?? ''),
      after: String(event.after ?? ''),
      author: typeof event.author === 'string' ? event.author : undefined,
      at,
    };
    return {
      ...prev,
      lastEventAt: at,
      recentRows: [...prev.recentRows, row],
      // Журнал угла: копится параллельно подсветке и не гаснет с ней.
      history: [...(prev.history ?? []), row].slice(-HISTORY_MAX),
    };
  }

  if (event.kind === 'issues-appeared') {
    return { ...prev, lastEventAt: at, newIssues: prev.newIssues + Number(event.added ?? 0) };
  }

  if (event.kind === 'snapshot-rebuilt') {
    // Снимок пересобран — всё, что пришло по этот момент, уже в числах экрана:
    // серые строки истории угла наливаются цветом.
    return { ...prev, lastEventAt: at, snapshotRebuilt: true, recalculatedThrough: at };
  }

  return prev;
}

/** Убрать строки, чья подсветка отгорела. */
export function pruneRecentRows(rows: RowChange[], now = Date.now()): RowChange[] {
  return rows.filter((r) => now - Date.parse(r.at) < FLASH_MS);
}

/* ── Соединение ────────────────────────────────────────── */

let wanted = false;
let refCount = 0;
let controller: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let flashTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let lastEventId: number | null = null;

function scheduleFlashPrune(): void {
  if (flashTimer) return;
  flashTimer = setTimeout(() => {
    flashTimer = null;
    const pruned = pruneRecentRows(state.recentRows);
    if (pruned.length !== state.recentRows.length) setState({ recentRows: pruned });
    if (pruned.length > 0) scheduleFlashPrune();
  }, FLASH_MS / 2);
}

/**
 * Принять одно разобранное событие эфира: свести в состояние (reduceLive) и
 * исполнить побочные действия, которым в чистом редьюсере не место.
 * Экспортировано как шов для стражей: тест кормит событие сюда же, куда его
 * кладёт поток.
 *
 * Побочное действие одно: monitoring-updated — книга мониторинга перечитана
 * и изменилась, значит живой коэффициент ставки (liveStavka) снят с прежнего
 * содержимого и больше не факт. Сбрасываем замер в хранилище; повторный
 * запрос сделает следующий читатель (эффект барабана ставки). Без события
 * замер НЕ перезапрашивается — и полученный коэффициент, и знание «замера
 * не существует» окончательны до следующей правки книги.
 */
export function ingestLiveEvent(event: Record<string, unknown>): void {
  const next = reduceLive(state, event);
  if (next !== state) {
    state = next;
    for (const listener of [...listeners]) listener();
  }
  if (event.kind === 'monitoring-updated') {
    useStore.getState().invalidateLiveStavka();
  }
  if (state.recentRows.length > 0) scheduleFlashPrune();
}

function handleRecord(raw: string): void {
  const event = parseStreamRecord(raw);
  if (!event) return;
  if (typeof event.id === 'number') lastEventId = event.id;
  ingestLiveEvent(event);
}

/** Ключ доступа — тот же, что у остальных запросов продукта. */
function authHeaders(): Record<string, string> {
  const key = typeof localStorage !== 'undefined' ? localStorage.getItem('aemr_api_key') : null;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function runStream(): Promise<void> {
  controller = new AbortController();
  try {
    const headers: Record<string, string> = { ...authHeaders(), Accept: 'text/event-stream' };
    // Догон после обрыва: сервер дошлёт пропущенное, а не начнёт с чистого листа.
    if (lastEventId !== null) headers['Last-Event-ID'] = String(lastEventId);

    const response = await fetch('/api/events', { headers, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`поток не открылся (${response.status})`);

    setState({ connected: true });
    attempt = 0;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        handleRecord(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch {
    // Обрыв связи, перезапуск сервера, уход вкладки в сон — всё это обычная
    // жизнь потока, а не поломка продукта. Молча переподключаемся.
  } finally {
    controller = null;
    if (state.connected) setState({ connected: false });
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (!wanted || retryTimer) return;
  const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  attempt++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (wanted) void runStream();
  }, delay);
}

/** Открыть поток (идемпотентно). Возвращает функцию «я больше не смотрю». */
export function openLiveEvents(): () => void {
  refCount++;
  if (!wanted) {
    wanted = true;
    attempt = 0;
    void runStream();
  }
  return () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) closeLiveEvents();
  };
}

/** Закрыть поток и снять таймеры. */
export function closeLiveEvents(): void {
  wanted = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
  controller?.abort();
  controller = null;
  if (state.connected) setState({ connected: false });
}

/**
 * Сказать, что накопленное принято к сведению: данные обновлены, полоса
 * оповещения гаснет. Момент последнего события НЕ стирается — «обновлено
 * тогда-то» в шапке остаётся верным.
 */
export function acknowledgeLiveEvents(): void {
  setState({ books: [], newIssues: 0, snapshotRebuilt: false });
}

/** Только для тестов: чистое состояние и закрытое соединение. */
export function resetLiveEvents(): void {
  closeLiveEvents();
  refCount = 0;
  attempt = 0;
  lastEventId = null;
  state = EMPTY;
  for (const listener of [...listeners]) listener();
}

/** Есть ли что показывать в полосе оповещения. */
export function hasLiveNews(s: LiveState): boolean {
  return s.books.length > 0 || s.newIssues > 0 || s.snapshotRebuilt;
}

/* ── Хук ───────────────────────────────────────────────── */

export interface UseLiveEventsResult extends LiveState {
  /** Есть ли неотработанные новости (полоса оповещения показывается по нему). */
  hasNews: boolean;
  /** Принять новости к сведению после мягкого обновления данных. */
  acknowledge: () => void;
}

/**
 * Подписка на живой поток. `enabled: false` — соединение не открывается вовсе
 * (например, в тестах и на экранах, где эфир не нужен).
 */
export function useLiveEvents(enabled = true): UseLiveEventsResult {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => EMPTY);

  useEffect(() => {
    if (!enabled) return;
    return openLiveEvents();
  }, [enabled]);

  const acknowledge = useCallback(() => acknowledgeLiveEvents(), []);

  return { ...snapshot, hasNews: hasLiveNews(snapshot), acknowledge };
}
