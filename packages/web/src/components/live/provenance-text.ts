/**
 * Тексты узла провенанса (канон п.133): «понятно написанный, одновременно
 * показывающий всё и вместе с тем лаконичный провенанс и изменения».
 *
 * Логика отделена от вида по той же причине, что и в live-text: подписи здесь
 * — обещания продукта («откуда числа», «когда прочитаны», «что изменилось»),
 * а обещания положено держать под стражем. Компонент рисует, этот файл
 * решает, ЧТО написано.
 *
 * Правило честности (п.58/п.104): молчание источника отличается от нуля.
 * Не знаем момента чтения — так и пишем «момент чтения неизвестен», а не
 * «только что». Не знаем режима — «режим обновления неизвестен».
 */
import type { BookChange, LiveState } from '../../hooks/useLiveEvents';
import { countWord, plural, relativeMoment } from './live-text';

/** Свод одной строкой для кнопки в шапке (лаконичная часть требования). */
export interface ProvenancePill {
  /** Момент чтения: «обновлено 3 мин назад» либо честное незнание. */
  readonly moment: string;
  /** Есть ли живой поток изменений — от этого горит точка. */
  readonly live: boolean;
  /** Число изменений с последнего мягкого обновления; 0 — значка нет. */
  readonly changes: number;
  /** Подпись для screen reader и подсказки. */
  readonly title: string;
}

/** Строка панели «откуда числа»: источник, момент, что с ним. */
export interface ProvenanceLine {
  readonly label: string;
  readonly detail: string;
}

/**
 * Режим обновления словами. Три состояния, а не два: вебхук (книга сама
 * сообщает о правке), таймер (спрашиваем сами каждые N минут) и незнание
 * (сервер не рассказал — не выдумываем).
 */
export function refreshModeLine(
  webhookConfigured: boolean | null,
  autoRefreshMinutes: number | null,
  workWindowLabel: string | null,
): ProvenanceLine {
  if (webhookConfigured === null && autoRefreshMinutes === null) {
    return { label: 'Режим обновления', detail: 'неизвестен — сервер не сообщил' };
  }
  const parts: string[] = [];
  if (webhookConfigured) {
    parts.push('книги сообщают о правках сами');
  } else {
    parts.push('уведомления от книг не настроены');
  }
  if (autoRefreshMinutes !== null && autoRefreshMinutes > 0) {
    parts.push(
      `перечитка каждые ${autoRefreshMinutes} ${plural(autoRefreshMinutes, 'минуту', 'минуты', 'минут')}`,
    );
  }
  if (workWindowLabel) parts.push(`рабочее окно ${workWindowLabel}`);
  return { label: 'Режим обновления', detail: parts.join(' · ') };
}

/** Сколько правок пришло с последнего мягкого обновления — одним числом. */
export function totalChanges(books: readonly BookChange[]): number {
  return books.reduce((sum, b) => sum + b.changedRows + b.addedRows + b.removedRows, 0);
}

/** Свод для кнопки в шапке. */
export function provenancePill(live: LiveState, lastRefreshed: string | null): ProvenancePill {
  const changes = totalChanges(live.books);
  const moment = lastRefreshed === null
    ? 'момент чтения неизвестен'
    : `обновлено ${relativeMoment(lastRefreshed)}`;
  const streamNote = live.connected
    ? 'изменения в книгах приходят сами'
    : 'прямой эфир недоступен — числа обновляются по таймеру и по кнопке';
  const changeNote = changes > 0
    ? `; с последнего обновления ${countWord(changes, 'правка', 'правки', 'правок')}`
    : '';
  return {
    moment,
    live: live.connected,
    changes,
    title: `Откуда числа и что изменилось. ${moment}, ${streamNote}${changeNote}`,
  };
}

/**
 * Строки «что изменилось» по книгам. Пусто — значит правок не было, и это
 * отдельное сообщение, а не пустая панель (честная пустота п.53).
 */
export function changeLines(books: readonly BookChange[]): ProvenanceLine[] {
  return books.map((b) => {
    const bits: string[] = [];
    if (b.changedRows > 0) bits.push(`${b.changedRows} ${plural(b.changedRows, 'правка', 'правки', 'правок')}`);
    if (b.addedRows > 0) bits.push(`${b.addedRows} ${plural(b.addedRows, 'строка добавлена', 'строки добавлены', 'строк добавлено')}`);
    if (b.removedRows > 0) bits.push(`${b.removedRows} ${plural(b.removedRows, 'строка исчезла', 'строки исчезли', 'строк исчезло')}`);
    const origin = b.origin === 'webhook'
      ? 'книга сообщила сама'
      : b.origin === 'request'
        ? 'по кнопке «Обновить»'
        : b.origin === 'startup'
          ? 'при запуске'
          : 'по таймеру';
    return {
      label: b.book,
      detail: `${bits.length > 0 ? bits.join(' · ') : 'без изменений строк'} — ${origin}, ${relativeMoment(b.at)}`,
    };
  });
}

/** Итоговая строка о замечаниях: показывается, только если их прибавилось. */
export function newIssuesLine(newIssues: number): string | null {
  if (newIssues <= 0) return null;
  return `Прибавилось ${countWord(newIssues, 'замечание', 'замечания', 'замечаний')} — проверки перечитали изменившиеся строки`;
}
