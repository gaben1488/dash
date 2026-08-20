/**
 * Шина живых событий — канон п.66 «прямой эфир» и п.108 «интеграция не
 * лоскутами».
 *
 * До неё правка в книге доезжала до экрана молча: вебхук Google Drive сбрасывал
 * кэш, числа менялись, но читатель узнавал об этом, только если сам обновлял
 * страницу. Шина ничего не хранит про смысл данных — она лишь передаёт факт
 * события тем, кто сейчас смотрит на экран.
 *
 * Три свойства, ради которых она устроена именно так:
 *   • публикация НИКОГДА не валит вызывающего — упавший подписчик (оборванное
 *     соединение) не должен ломать перечитку источников;
 *   • кольцо последних событий даёт переподключившемуся клиенту догнать
 *     пропущенное по номеру (заголовок Last-Event-ID), а не начать с чистого
 *     листа;
 *   • тишина — законное состояние: нет изменений — нет событий, спама «всё
 *     по-прежнему» шина не создаёт.
 *
 * Тексты для человека здесь НЕ собираются: шина отдаёт структуру (какая книга,
 * сколько строк, что было и что стало), фразы строит экран. Иначе формулировка
 * оказалась бы вшита в сервер и её нельзя было бы поправить, не трогая продукт.
 */

/** Откуда пришла перечитка — читателю важно отличать эфир от планового цикла. */
export type RefreshOrigin = 'webhook' | 'cycle' | 'request' | 'startup';

/** Книга ГРБС перечитана и отличается от прежней. */
export interface BookUpdatedEvent {
  kind: 'book-updated';
  /** Короткое имя ГРБС, чью книгу прочитали («УО»). */
  book: string;
  /** Сколько строк изменилось по содержимому (без добавленных и удалённых). */
  changedRows: number;
  addedRows: number;
  removedRows: number;
  /** Сколько строк в книге сейчас — знаменатель честности. */
  rowsTotal: number;
  origin: RefreshOrigin;
}

/** Конкретная строка книги изменилась: адрес, было → стало, автор. */
export interface RowChangedEvent {
  kind: 'row-changed';
  book: string;
  /** Номер строки в листе книги (позиционный адрес). */
  sheetRow: number;
  /** «№ п/п» из колонки A — второй, устойчивый адрес строки (п.98б). */
  rowSeq?: string;
  /** Буква колонки («L»). */
  column: string;
  /** Название атрибута по живой шапке; пусто, если колонка вне канона. */
  columnLabel?: string;
  before: string;
  after: string;
  /** Почта автора из журнала правок книги; пусто — автор неизвестен. */
  author?: string;
}

/** После пересборки снимка замечаний стало больше, чем было. */
export interface IssuesAppearedEvent {
  kind: 'issues-appeared';
  /** На сколько замечаний стало больше по сравнению с прошлым снимком. */
  added: number;
  /** Сколько замечаний всего в новом снимке. */
  total: number;
  /**
   * Разбивка ВСЕХ замечаний нового снимка по строгости. Именно всех, а не
   * прироста: список замечаний пересобирается целиком при каждой сборке, и
   * сказать «эти три — новые» без подмены смысла нельзя. Экран обязан
   * подписывать разбивку так же честно.
   */
  bySeverity: Record<string, number>;
}

/** Снимок пересобран — числа на экране устарели. */
export interface SnapshotRebuiltEvent {
  kind: 'snapshot-rebuilt';
  rows: number;
  issues: number;
  /** Год снимка; null — «все годы». */
  year: number | null;
}

export type LiveEvent =
  | BookUpdatedEvent
  | RowChangedEvent
  | IssuesAppearedEvent
  | SnapshotRebuiltEvent;

/** Событие с номером и моментом (п.58: у каждого числа момент чтения). */
export interface LiveEventEnvelope {
  id: number;
  /** Момент публикации (ISO). */
  at: string;
  event: LiveEvent;
}

/**
 * Глубина кольца пропущенных событий. Больше не нужно: переподключение
 * браузера занимает секунды, а тот, кто отсутствовал дольше, всё равно
 * обновляет данные целиком, а не по одному событию.
 */
export const LIVE_EVENT_BUFFER = 100;

type Listener = (envelope: LiveEventEnvelope) => void;

const listeners = new Set<Listener>();
let ring: LiveEventEnvelope[] = [];
let seq = 0;

/**
 * Опубликовать событие. Возвращает конверт с присвоенным номером — вызывающий
 * может записать его в лог, не собирая номер сам.
 */
export function publishLiveEvent(event: LiveEvent, at: string = new Date().toISOString()): LiveEventEnvelope {
  const envelope: LiveEventEnvelope = { id: ++seq, at, event };
  ring.push(envelope);
  if (ring.length > LIVE_EVENT_BUFFER) ring = ring.slice(ring.length - LIVE_EVENT_BUFFER);

  // Копия множества: подписчик вправе отписаться прямо в обработчике
  // (закрывшееся соединение так и делает), а изменение Set во время обхода
  // молча пропустило бы соседа.
  for (const listener of [...listeners]) {
    try {
      listener(envelope);
    } catch {
      // Упавший слушатель — это оборванное соединение, а не поломка данных.
      // Перечитка источников не имеет права падать из-за чужого сокета.
    }
  }
  return envelope;
}

/** Подписаться. Возвращает функцию отписки — вызвать её обязан подписчик. */
export function subscribeLiveEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Сколько сейчас подписчиков (для потолка соединений и здоровья сервера). */
export function liveSubscriberCount(): number {
  return listeners.size;
}

/**
 * События, случившиеся ПОСЛЕ названного номера, — догон после обрыва связи.
 * Номер неизвестен (первое подключение) — не отдаём ничего: клиент только что
 * загрузил свежие данные, и пересказ прошлого был бы ложной тревогой.
 */
export function liveEventsAfter(lastId: number | null): LiveEventEnvelope[] {
  if (lastId === null || !Number.isFinite(lastId)) return [];
  return ring.filter((e) => e.id > lastId);
}

/** Только для тестов: чистая шина без подписчиков и без истории. */
export function resetLiveEventBus(): void {
  listeners.clear();
  ring = [];
  seq = 0;
}
