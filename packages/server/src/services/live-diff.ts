/**
 * Сравнение двух чтений одной книги ГРБС — материал для живых событий.
 *
 * Вопрос читателя звучит не «книга обновилась», а «что именно поменялось».
 * Ответ на него собирается здесь: строка листа, № п/п, колонка по живой шапке,
 * было → стало. Автор берётся из журнала правок книги, если журнал доступен;
 * недоступен — поле пустое, и экран честно молчит про автора, а не подставляет
 * «система» (канон п.27: свободный текст не источник, а выдумка тем более).
 *
 * Сравнение позиционное: строка N прежнего чтения против строки N нового.
 * Это осознанное ограничение. Вставка строки в середину листа сдвигает всё
 * ниже, и позиционный разбор назовёт сдвиг «изменением» каждой строки — поэтому
 * такой случай ловится отдельно (addedRows/removedRows) и построчные события в
 * нём НЕ выпускаются: лучше сказать «в книге стало на 3 строки больше», чем
 * завалить экран сотней ложных «строка изменилась».
 */
import { COL_LETTER_INDEX, DEPT_COLUMNS, DEPT_HEADER_LABELS, DEPT_HEADER_ROWS } from '@aemr/shared';
import type { RowChangedEvent } from './event-bus.js';

/** Чтение листа книги: только то, что нужно сравнению. */
export interface SheetReading {
  values: unknown[][];
}

export interface BookDiff {
  book: string;
  changedRows: number;
  addedRows: number;
  removedRows: number;
  rowsTotal: number;
  /** Построчные изменения — не больше MAX_ROW_EVENTS на книгу. */
  rows: RowChangedEvent[];
}

/**
 * Потолок построчных событий на одну книгу за цикл. Массовая вставка (загрузили
 * лист целиком) — это не «сто правок, каждую показать», а «книга обновилась»:
 * подробности в этом случае бесполезны и только шумят.
 */
export const MAX_ROW_EVENTS = 12;

/** Индекс колонки (0=A) → буква. Обратное к COL_LETTER_INDEX. */
const LETTER_BY_INDEX: readonly string[] = (() => {
  const out: string[] = [];
  for (const [letter, idx] of Object.entries(COL_LETTER_INDEX)) out[idx] = letter;
  return out;
})();

/** Название атрибута по индексу колонки; пусто — колонка вне канона. */
const LABEL_BY_INDEX: Readonly<Record<number, string>> = (() => {
  const out: Record<number, string> = {};
  for (const key of Object.keys(DEPT_COLUMNS) as Array<keyof typeof DEPT_COLUMNS>) {
    out[DEPT_COLUMNS[key]] = DEPT_HEADER_LABELS[key];
  }
  return out;
})();

/** Значение ячейки к сравнимому виду: пусто, число и текст различаются честно. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** Короткая выдержка значения для показа: длинный текст в полосу не влезет. */
function brief(value: string, limit = 60): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/**
 * Кто правил эту ячейку. Подставляет журнал правок книги; по умолчанию — никто,
 * и поле остаётся пустым. Резолвер задаётся приложением (app.ts), чтобы модуль
 * сравнения не тянул за собой базу и не ломал свои же тесты.
 */
export type ChangeAuthorResolver = (book: string, cell: string) => string | undefined;

let authorResolver: ChangeAuthorResolver | null = null;

export function setChangeAuthorResolver(fn: ChangeAuthorResolver | null): void {
  authorResolver = fn;
}

function resolveAuthor(book: string, cell: string): string | undefined {
  if (!authorResolver) return undefined;
  try {
    const author = authorResolver(book, cell)?.trim();
    return author ? author : undefined;
  } catch {
    // Журнал недоступен — это не повод потерять само событие о правке.
    return undefined;
  }
}

/**
 * Сравнить два чтения книги. `before === null` (первое чтение за жизнь
 * процесса) даёт нулевой разбор: объявлять весь лист «изменившимся» на старте
 * значит поднимать тревогу там, где ничего не произошло.
 */
export function diffBook(book: string, before: SheetReading | null | undefined, after: SheetReading): BookDiff {
  const beforeRows = before?.values ?? null;
  const afterRows = after.values;
  const rowsTotal = afterRows.length;

  if (beforeRows === null || beforeRows.length === 0) {
    return { book, changedRows: 0, addedRows: 0, removedRows: 0, rowsTotal, rows: [] };
  }

  const addedRows = Math.max(0, afterRows.length - beforeRows.length);
  const removedRows = Math.max(0, beforeRows.length - afterRows.length);
  const shared = Math.min(beforeRows.length, afterRows.length);

  let changedRows = 0;
  const rows: RowChangedEvent[] = [];

  for (let i = DEPT_HEADER_ROWS; i < shared; i++) {
    const prev = beforeRows[i] ?? [];
    const next = afterRows[i] ?? [];
    const width = Math.max(prev.length, next.length);
    let rowChanged = false;

    for (let c = 0; c < width; c++) {
      const wasText = cellText(prev[c]);
      const nowText = cellText(next[c]);
      if (wasText === nowText) continue;
      rowChanged = true;
      // Построчные подробности собираем, только пока их немного: см. MAX_ROW_EVENTS.
      if (rows.length >= MAX_ROW_EVENTS || addedRows > 0 || removedRows > 0) continue;
      const letter = LETTER_BY_INDEX[c];
      if (!letter) continue; // колонка за пределами канона — адрес назвать нечем
      const sheetRow = i + 1; // человеческая нумерация строк листа
      rows.push({
        kind: 'row-changed',
        book,
        sheetRow,
        rowSeq: cellText(next[DEPT_COLUMNS.ID]) || undefined,
        column: letter,
        columnLabel: LABEL_BY_INDEX[c] || undefined,
        before: brief(wasText),
        after: brief(nowText),
        author: resolveAuthor(book, `${letter}${sheetRow}`),
      });
    }

    if (rowChanged) changedRows++;
  }

  // Сдвиг строк делает позиционный разбор недостоверным — подробности снимаем,
  // счётчики оставляем.
  if (addedRows > 0 || removedRows > 0) rows.length = 0;

  return { book, changedRows, addedRows, removedRows, rowsTotal, rows };
}

/** Изменилось ли в книге хоть что-нибудь. Тишина — законный ответ. */
export function isSilent(diff: BookDiff): boolean {
  return diff.changedRows === 0 && diff.addedRows === 0 && diff.removedRows === 0;
}
