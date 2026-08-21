/**
 * change-story-text.ts — фразы журнала изменений обеих глубин.
 *
 * Логика отделена от вида по той же причине, что у provenance-text.ts: эти
 * подписи — обещания продукта («что именно поменялось», «кем», «когда»), и
 * держать их положено под стражем, а не в разметке.
 *
 * АДРЕСАТ ТЕКСТОВ — НАЧАЛЬНИЦА УПРАВЛЕНИЯ. Она не помнит букв колонок и не
 * обязана: в строке стоит «Комментарий ГРБСа», а не «AF». Она мыслит деньгами,
 * сроками и перепиской — отсюда роды правок вместо тридцати четырёх колонок.
 *
 * ЧЕСТНАЯ ПУСТОТА (канон п.53, п.58). «Правок не было» и «журнал не прочитан»
 * — разные фразы, и вторая называет книги по именам. Отдельно и всегда
 * произносится то, чего журнал книги не видит вовсе: удаление строки.
 */
import { CHANGE_KIND_LABELS, CHANGE_KIND_ORDER, type ChangeDigest, type ChangeEntry, type ChangeGap, type ChangeKind } from '@aemr/core';
import { countWord, plural, relativeMoment } from './live-text';

/** Роды, которые называются в краткой глубине. Порядок — канон ядра. */
const DIGEST_KINDS: readonly ChangeKind[] = CHANGE_KIND_ORDER;

/**
 * Короткие имена родов для строки свода: «деньги — 3, сроки — 2». Полные
 * подписи (CHANGE_KIND_LABELS) идут в чипы отбора, где есть место.
 */
const SHORT_KIND: Readonly<Record<ChangeKind, string>> = {
  money: 'деньги',
  dates: 'сроки',
  comment: 'комментарии',
  method: 'способ закупки',
  subject: 'предмет',
  flag: 'признак учёта',
  'row-added': 'новых закупок',
  'row-vanished': 'исчезнувших закупок',
  'row-cleared': 'очищенных строк',
  other: 'прочее',
};

/** Дата подписи книги «2026-08-18T12:00:00» → «18.08». Мусор → null. */
export function shortDate(at: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(at ?? ''));
  return m === null ? null : `${m[3]}.${m[2]}`;
}

/** Время подписи книги → «12:00». Мусор → null. */
export function shortTime(at: string | null): string | null {
  const m = /T(\d{2}):(\d{2})/.exec(String(at ?? ''));
  return m === null ? null : `${m[1]}:${m[2]}`;
}

/**
 * Первая фраза краткой глубины: сколько правок, в скольких книгах, скольких
 * закупок они коснулись. Одна книга названа по имени — счёт «1 книга» вместо
 * «УО» читателю ничего не даёт.
 */
export function digestHeadline(digest: ChangeDigest): string {
  if (digest.entries === 0) {
    return digest.emptiness === 'unknown'
      ? 'О правках ничего не известно'
      : 'Правок не было';
  }
  const where = digest.books === 1
    ? `в книге ${digest.booksNamed[0]}`
    : `в ${countWord(digest.books, 'книге', 'книгах', 'книгах')}`;
  return `${countWord(digest.entries, 'правка', 'правки', 'правок')} ${where}, ` +
    `затронуто ${countWord(digest.rows, 'закупка', 'закупки', 'закупок')}`;
}

/**
 * Вторая фраза: КАКИЕ это правки. Роды с нулём не проговариваются — «деньги —
 * 0» сообщение не улучшает; порядок родов канонический, от тревожного к
 * бытовому.
 */
export function digestKindLine(digest: ChangeDigest): string {
  const parts: string[] = [];
  for (const kind of DIGEST_KINDS) {
    const n = digest.byKind[kind] ?? 0;
    if (n > 0) parts.push(`${SHORT_KIND[kind]} — ${n}`);
  }
  return parts.join(', ');
}

/** Третья фраза: кто правил. Больше трёх имён — счётом, иначе строка не читается. */
export function digestAuthorsLine(digest: ChangeDigest): string | null {
  if (digest.authors.length === 0) return null;
  if (digest.authors.length <= 3) return `правили ${digest.authors.join(', ')}`;
  return `правили ${countWord(digest.authors.length, 'человек', 'человека', 'человек')}`;
}

/** Четвёртая фраза: когда. Один день — одной датой, разброс — от и до. */
export function digestWhenLine(digest: ChangeDigest): string | null {
  const first = shortDate(digest.firstAt);
  const last = shortDate(digest.lastAt);
  if (first === null || last === null) return null;
  if (first === last) return `всё ${first}`;
  return `с ${first} по ${last}`;
}

/**
 * Краткая глубина целиком — четыре фразы, которые человек читает одним
 * взглядом. Пустые фразы выброшены, а не показаны пустыми.
 */
export function digestLines(digest: ChangeDigest): string[] {
  const lines = [digestHeadline(digest)];
  const kinds = digestKindLine(digest);
  if (kinds !== '') lines.push(kinds);
  const who = digestAuthorsLine(digest);
  if (who !== null) lines.push(who);
  const when = digestWhenLine(digest);
  if (when !== null) lines.push(when);
  return lines;
}

/**
 * Чем именно вызвана пустота. Возвращает null, когда записи есть: молчать о
 * полном журнале не нужно, а вот тишину объяснять обязательно.
 */
export function emptinessLine(digest: ChangeDigest, gaps: readonly ChangeGap[]): string | null {
  if (digest.entries > 0) return null;
  if (digest.emptiness === 'unknown') {
    const books = gaps.filter((g) => g.reason === 'journal-unread').map((g) => g.book);
    const named = books.length === 0
      ? 'ни одна книга'
      : books.length <= 3 ? books.join(', ') : `${books.slice(0, 3).join(', ')} и ещё ${books.length - 3}`;
    return `Журналы правок не прочитаны (${named}) — это не «правок не было», а отсутствие ответа источника.`;
  }
  return 'Журналы книг прочитаны, правок в выбранном окне нет.';
}

/**
 * То, чего журнал книги не видит В ПРИНЦИПЕ. Фраза показывается всегда, а не
 * только при нулях: читатель обязан знать границу источника до того, как
 * сделает вывод из чисел.
 */
export const DELETION_NOTE =
  'Удаление строки книга не записывает: через меню таблицы закупка уходит без единой ' +
  'правки ячейки. Пропажи находятся сравнением снимков по № п/п, и если пары снимков ' +
  'ещё нет — исчезнувших закупок в этом списке не будет.';

/** Пробелы рассказа фразами — по одной на пробел, без склейки в кашу. */
export function gapLines(gaps: readonly ChangeGap[]): string[] {
  return gaps.map((g) => g.detail);
}

// ── Подробная глубина ────────────────────────────────────────────────

/** Адрес записи одной строкой: книга, лист, № п/п, колонка человеческим именем. */
export function entryAddress(entry: ChangeEntry): string {
  const parts: string[] = [entry.book];
  if (entry.sheet !== '' && entry.sheet !== 'ВСЕ') parts.push(`лист ${entry.sheet}`);
  // № п/п ведёт адрес: позиционный номер строки листа устаревает при
  // вставках, и вести им нельзя (канон п.98б).
  parts.push(entry.rowSeq === null
    ? `строка листа ${entry.sheetRow ?? '?'} (№ п/п журнал не назвал)`
    : `№ п/п ${entry.rowSeq}`);
  if (entry.columnLabel !== null) parts.push(entry.columnLabel);
  else if (entry.column !== null) parts.push(`колонка ${entry.column}`);
  return parts.join(' · ');
}

/** Значение для показа: пустота названа словом, а не пустым местом. */
export function valueLabel(value: string): string {
  return value.trim() === '' ? 'пусто' : value;
}

/**
 * Что произошло, одной фразой. Событие целой строки говорится иначе, чем
 * правка ячейки: «появилась новая закупка» и «было 100 → стало 120» — разные
 * сообщения, и сводить их к одному шаблону значит врать об обоих.
 */
export function entryChangeLine(entry: ChangeEntry): string {
  switch (entry.kind) {
    case 'row-added':
      return entry.subject === null
        ? 'Появилась новая закупка'
        : `Появилась новая закупка: ${entry.subject}`;
    case 'row-vanished':
      return entry.subject === null
        ? 'Закупка исчезла — её нет в новом снимке книги'
        : `Закупка исчезла: ${entry.subject}`;
    case 'row-cleared':
      return 'Строку очистили — ячейки обнулены, сама строка в книге осталась';
    default:
      return `${valueLabel(entry.before)} → ${valueLabel(entry.after)}`;
  }
}

/** Кто и когда — хвост строки. Незнание называется, а не заполняется. */
export function entryWhoWhen(entry: ChangeEntry): string {
  const who = entry.author ?? 'автор источником не назван';
  if (entry.at === null) {
    return entry.origin === 'snapshot-diff'
      ? 'момент неизвестен — пропажа найдена сравнением снимков'
      : `${who} · момент неизвестен`;
  }
  const date = shortDate(entry.at);
  const time = shortTime(entry.at);
  return `${who} · ${date} ${time}`;
}

/** Подпись источника записи — разная полнота источников не прячется. */
export function originNote(entry: ChangeEntry): string {
  switch (entry.origin) {
    case 'book-journal': return 'из журнала правок книги';
    case 'live-stream': return 'из прямого эфира';
    case 'snapshot-diff': return 'из сравнения снимков';
    default: return '';
  }
}

/** Заголовок подробной глубины: сколько показано из скольких. */
export function shownLine(shown: number, total: number): string {
  if (total === 0) return 'Показывать нечего';
  if (shown >= total) return `${countWord(total, 'правка', 'правки', 'правок')}`;
  return `показаны ${shown} из ${total} ${plural(total, 'правки', 'правок', 'правок')}`;
}

/** Насколько давно последняя правка — для строки в шапке. */
export function lastChangeMoment(digest: ChangeDigest): string | null {
  if (digest.lastAt === null) return null;
  // Подпись книги без пояса читается как местное время машины: расхождение в
  // пределах часов на грубой шкале «сегодня / вчера» ничего не меняет.
  return relativeMoment(digest.lastAt);
}

/** Полная подпись рода — для чипов отбора. */
export function kindLabel(kind: ChangeKind): string {
  return CHANGE_KIND_LABELS[kind];
}
