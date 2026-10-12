/**
 * Сравнение двух чтений одной книги ГРБС — материал для живых событий.
 *
 * Вопрос читателя звучит не «книга обновилась», а «что именно поменялось».
 * Ответ на него собирается здесь: строка листа, № п/п, колонка по живой шапке,
 * было → стало. Автор берётся из журнала правок книги, если журнал доступен;
 * недоступен — поле пустое, и экран честно молчит про автора, а не подставляет
 * «система» (канон п.27: свободный текст не источник, а выдумка тем более).
 *
 * Сопоставление использует существующий diffSnapshots по уникальным № п/п.
 * Очистка и уплотнение не меняют идентичность оставшихся позиций. Неоднозначные
 * номера и смена предмета/учреждения остаются в недельном контексте для проверки,
 * а не превращаются в доказанную правку чужой закупки.
 */
import { COL_LETTER_INDEX, DEPT_COLUMNS, DEPT_HEADER_LABELS, DEPT_HEADER_ROWS } from '@aemr/shared';
import { diffSnapshots, type SnapshotRow } from '@aemr/core';
import type { RowChangedEvent } from './event-bus.js';

/** Чтение листа книги: только то, что нужно сравнению. */
export interface SheetReading {
  values: unknown[][];
}

export interface BookDiff {
  book: string;
  /** Изменившиеся сопоставимые номера; смена предметного контекста требует проверки. */
  changedRows: number;
  /** Новые уникальные номера, не доказательство новой самостоятельной закупки. */
  addedRows: number;
  /** Прежние уникальные номера не найдены; причина отсутствия ещё не установлена. */
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

  const indexed = (values: unknown[][]): SnapshotRow[] => values
    .slice(DEPT_HEADER_ROWS)
    .map((row, i) => ({
      rowSeq: cellText(row[DEPT_COLUMNS.ID]),
      sheetRow: i + DEPT_HEADER_ROWS + 1,
      subject: cellText(row[DEPT_COLUMNS.SUBJECT]),
      subordinate: cellText(row[DEPT_COLUMNS.SUBORDINATE]),
      method: cellText(row[DEPT_COLUMNS.METHOD]),
      planSum: Number(row[DEPT_COLUMNS.TOTAL_PLAN]),
    }))
    .filter((row) => row.rowSeq !== '');
  const comparison = diffSnapshots(indexed(beforeRows), indexed(afterRows));
  const ambiguous = new Set([
    ...(comparison.ambiguousKeys?.before ?? []),
    ...(comparison.ambiguousKeys?.after ?? []),
  ]);
  const changedContext = new Set((comparison.contextChanged ?? []).map((row) => row.rowSeq));
  const addedRows = comparison.appeared.length;
  const removedRows = comparison.vanished.length;
  const previous = new Map(indexed(beforeRows)
    .filter((row) => !ambiguous.has(row.rowSeq))
    .map((row) => [row.rowSeq, row.sheetRow]));

  let changedRows = 0;
  const rows: RowChangedEvent[] = [];

  for (let i = DEPT_HEADER_ROWS; i < afterRows.length; i++) {
    const next = afterRows[i] ?? [];
    const seq = cellText(next[DEPT_COLUMNS.ID]);
    const priorRow = previous.get(seq);
    // Не угадываем связь при новом, пропавшем или повторном номере.
    if (priorRow === undefined || ambiguous.has(seq)) continue;
    if (changedContext.has(seq)) { changedRows++; continue; }
    const prev = beforeRows[priorRow - 1] ?? [];
    const width = Math.max(prev.length, next.length);
    let rowChanged = false;

    for (let c = 0; c < width; c++) {
      const wasText = cellText(prev[c]);
      const nowText = cellText(next[c]);
      if (wasText === nowText) continue;
      rowChanged = true;
      // Построчные подробности собираем, только пока их немного: см. MAX_ROW_EVENTS.
      if (rows.length >= MAX_ROW_EVENTS) continue;
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
        // Физическая ячейка после сдвига могла принадлежать другой закупке.
        author: priorRow === sheetRow ? resolveAuthor(book, `${letter}${sheetRow}`) : undefined,
      });
    }

    if (rowChanged) changedRows++;
  }

  return { book, changedRows, addedRows, removedRows, rowsTotal, rows };
}

/** Изменилось ли в книге хоть что-нибудь. Тишина — законный ответ. */
export function isSilent(diff: BookDiff): boolean {
  return diff.changedRows === 0 && diff.addedRows === 0 && diff.removedRows === 0;
}
