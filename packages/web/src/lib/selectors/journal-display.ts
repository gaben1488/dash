import { ISSUE_STATUS_LABELS } from '@aemr/shared';

/**
 * Подготовка записи журнала к показу: время, автор, детали.
 *
 * Журнал собирается сервером из трёх таблиц (снимки, аудит-лог, история
 * замечаний), и каждая приносит свои сырые артефакты: ISO-момент вместо даты,
 * латинское имя писателя «Pipeline», строку перехода «open → wont_fix» с
 * внутренними ключами статусов. Страница показывала всё это как есть.
 * Здесь — единственное место, где сырое становится читаемым.
 */

/** Момент события — общим форматом всех страниц (см. event-time.ts). */
export { formatEventTime } from './event-time';

/**
 * Имя автора события.
 *
 * Сервер подписывает автоматические записи латиницей («Pipeline» в
 * routes/journal.ts) — в колонке «Кто» это единственное английское слово на
 * экране. Словарь продукта таких ключей не держит: это не ключ данных, а
 * подпись писателя журнала, поэтому перевод живёт здесь, рядом с местом показа.
 */
const ACTOR_LABELS: Readonly<Record<string, string>> = {
  Pipeline: 'Обновление данных',
  pipeline: 'Обновление данных',
  System: 'Система',
  system: 'Система',
};

export function journalActorLabel(actor: string | null | undefined): string {
  if (!actor) return 'Система';
  return ACTOR_LABELS[actor] ?? actor;
}

/**
 * Детали события с расшифрованными статусами.
 *
 * История замечаний кладёт в детали строку вида `open → wont_fix` — сырые
 * ключи. Заменяем их словарными фразами продукта, чтобы одно и то же решение
 * называлось одинаково в бейдже, в кнопке и в журнале. Заменяем только
 * отдельно стоящие ключи: подстрока внутри слова — не статус.
 */
const STATUS_KEY_PATTERN = new RegExp(
  `(^|[^A-Za-z_])(${Object.keys(ISSUE_STATUS_LABELS).join('|')})(?![A-Za-z_])`,
  'g',
);

export function humanizeJournalDetails(details: string | null | undefined): string {
  if (!details) return '';
  return details.replace(
    STATUS_KEY_PATTERN,
    (_match, prefix: string, key: string) => `${prefix}${ISSUE_STATUS_LABELS[key] ?? key}`,
  );
}

/**
 * Типы событий, по которым сервер действительно умеет фильтровать.
 *
 * `/api/journal` принимает ОДИН параметр `action` и сравнивает его с типом
 * записи; типы задаются в трёх местах сборки журнала. Значения `issue`,
 * `error`, `system` не производит ни одно из них — чипы с такими типами
 * молча давали пустой список, то есть притворялись фильтром. Список ниже —
 * ровно то, что фильтруется на самом деле; интерфейс рисует чипы по нему.
 */
export const JOURNAL_FILTERABLE_TYPES = [
  'import',
  'edit',
  'issue_create',
  'issue_status',
  'normalize',
  'input_error',
  'mapping_change',
] as const;

export type JournalFilterableType = (typeof JOURNAL_FILTERABLE_TYPES)[number];
