/**
 * Фразы прямого эфира — чистая часть, отделённая от разметки.
 *
 * Зачем отдельно: тон здесь важнее вёрстки. Полоса оповещения обязана звучать
 * как объяснение механизма, а не как тревога: «Книга УО обновилась: 3 строки»,
 * а не «ВНИМАНИЕ! ДАННЫЕ УСТАРЕЛИ». Правила согласования по-русски (строка /
 * строки / строк) — та же честность: продукт, который пишет «1 строк»,
 * читатель перестаёт считать своим.
 */
import type { BookChange, RowChange } from '../../hooks/useLiveEvents';

/** Согласование существительного с числом: 1 строка, 2 строки, 5 строк. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** «3 строки», «1 строка», «11 строк». */
export function countWord(n: number, one: string, few: string, many: string): string {
  return `${n} ${plural(n, one, few, many)}`;
}

/**
 * Насколько давно это было — словами. Шкала грубая намеренно: читателю нужна
 * не секундная точность, а ответ «свежее ли то, на что я смотрю».
 */
export function relativeMoment(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'пока не обновлялось';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'момент неизвестен';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'только что';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${countWord(minutes, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${countWord(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.round(hours / 24);
  return `${countWord(days, 'день', 'дня', 'дней')} назад`;
}

/**
 * Заголовок полосы оповещения. Одна книга названа по имени; несколько — счётом,
 * потому что перечисление восьми управлений в одну строку не читается.
 */
export function liveHeadline(books: BookChange[]): string {
  if (books.length === 0) return 'Данные на сервере обновились';
  if (books.length === 1) {
    const b = books[0];
    return `Книга ${b.book} обновилась`;
  }
  return `Обновились ${countWord(books.length, 'книга', 'книги', 'книг')}`;
}

/**
 * Подробность полосы: что именно поменялось. Пустые части не проговариваются —
 * «изменилось 0 строк» сообщение не улучшает.
 */
export function liveDetail(books: BookChange[], newIssues: number): string {
  const parts: string[] = [];
  const changed = books.reduce((sum, b) => sum + b.changedRows, 0);
  const added = books.reduce((sum, b) => sum + b.addedRows, 0);
  const removed = books.reduce((sum, b) => sum + b.removedRows, 0);

  if (changed > 0) parts.push(countWord(changed, 'строка', 'строки', 'строк'));
  if (added > 0) parts.push(`добавлено ${countWord(added, 'строка', 'строки', 'строк')}`);
  if (removed > 0) parts.push(`убрано ${countWord(removed, 'строка', 'строки', 'строк')}`);
  if (newIssues > 0) parts.push(`новых замечаний ${newIssues}`);

  return parts.join(', ');
}

/**
 * Откуда пришло обновление — подпись мелким. Отличать эфир от планового цикла
 * читателю полезно: в первом случае правку заметили сразу, во втором она могла
 * пролежать до очередного опроса.
 */
export function originLabel(origin: BookChange['origin']): string {
  switch (origin) {
    case 'webhook': return 'изменение замечено сразу';
    case 'cycle': return 'плановая перечитка';
    case 'request': return 'перечитка по запросу';
    case 'startup': return 'первое чтение после запуска';
    default: return '';
  }
}

/** Ключ строки для подсветки: книга и номер строки листа. */
export function changedRowKey(book: string, sheetRow: number): string {
  return `${book}#${sheetRow}`;
}

/** Множество ключей недавно изменившихся строк — для подсветки в Реестре. */
export function changedRowKeys(rows: readonly RowChange[]): Set<string> {
  return new Set(rows.map((r) => changedRowKey(r.book, r.sheetRow)));
}

/**
 * Подпись к подсвеченной строке: что именно в ней поменялось и кто это сделал.
 * Автор называется, только если журнал его знает, — назначать автора нельзя.
 */
export function rowChangeHint(row: RowChange): string {
  const what = row.columnLabel ? `«${row.columnLabel}»` : `колонка ${row.column}`;
  const was = row.before === '' ? 'пусто' : row.before;
  const now = row.after === '' ? 'пусто' : row.after;
  const who = row.author ? `, правил ${row.author}` : '';
  return `${what}: было ${was} → стало ${now}${who}`;
}
