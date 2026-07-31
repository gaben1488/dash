/**
 * Журнал правок книг ГРБС — вкладка «_ChangeLog», которую ведёт Apps Script
 * источника: полная история «кто, когда, что поменял» с ячейкой, старым и
 * новым значением (аудит 30.07 №15: 37 294 записи лежали нечитанными).
 *
 * Это тот самый провенанс, который просила коллега: «кто что поменял с даты
 * последнего среза». Адрес отдаётся ЧЕЛОВЕЧЕСКИМ: не только «L178», но и
 * название атрибута из живой шапки («Способ определения поставщика») —
 * читатель не обязан помнить буквы колонок.
 *
 * Две схемы вкладки (проверено по восьми книгам):
 *   • 8 колонок: Лист ┃ Ячейка ┃ Столбец ┃ Строка ┃ Было ┃ Стало ┃ Время ┃ Автор;
 *   • УАГЗО, 6 колонок: Ячейка ┃ Было ┃ Стало ┃ Время ┃ Автор ┃ Статус —
 *     причём строки обеих схем встречаются вперемешку, поэтому схема
 *     определяется ПО СТРОКЕ (что лежит в её ячейках), а не по шапке.
 */
import {
  COL_LETTER_INDEX,
  DEPT_COLUMNS,
  DEPT_HEADER_LABELS,
} from '@aemr/shared';

export interface ChangeRecord {
  /** Короткое имя ГРБС («УО»). */
  dept: string;
  /** Лист книги, где случилась правка («ВСЕ»). */
  sheet: string;
  /** Адрес ячейки как в книге («L178»). */
  cell: string;
  /**
   * Название атрибута по живой шапке («Способ определения поставщика…»).
   * Пусто, если буква колонки не входит в канон — честнее пустоты нет:
   * выдуманное имя хуже отсутствия.
   */
  attribute: string;
  oldValue: string;
  newValue: string;
  /** Момент правки (мс эпохи) — из «06.04.2026 17:39:02» книги. */
  atMs: number;
  /** Почта автора правки, как её записал источник. */
  author: string;
}

/** «06.04.2026 17:39:02» → мс эпохи; null для мусора. */
function parseRuDateTime(raw: unknown): number | null {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const ms = Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +(ss ?? 0));
  return Number.isFinite(ms) ? ms : null;
}

/** Название атрибута по букве колонки из адреса ячейки («L178» → способ). */
function attributeOf(cell: string): string {
  const letter = cell.match(/^([A-Z]{1,2})\d+$/i)?.[1]?.toUpperCase();
  if (!letter) return '';
  const idx = COL_LETTER_INDEX[letter];
  if (idx === undefined) return '';
  const key = (Object.keys(DEPT_COLUMNS) as Array<keyof typeof DEPT_COLUMNS>)
    .find((k) => DEPT_COLUMNS[k] === idx);
  return key ? DEPT_HEADER_LABELS[key] : '';
}

/**
 * Разобрать строки вкладки «_ChangeLog» одной книги.
 * Строки без распознаваемого времени пропускаются: без момента правки
 * запись бесполезна для вопроса «что поменялось с даты среза».
 */
export function parseChangeLog(rows: unknown[][], dept: string): ChangeRecord[] {
  const out: ChangeRecord[] = [];
  for (const row of rows) {
    if (!row || row.length < 5) continue;
    const s = (i: number): string => String(row[i] ?? '').trim();

    // Схема 8 колонок: время в 7-й (индекс 6), ячейка во 2-й.
    let atMs = parseRuDateTime(row[6]);
    if (atMs !== null && /^[A-Z]{1,2}\d+$/i.test(s(1))) {
      out.push({
        dept,
        sheet: s(0) || 'ВСЕ',
        cell: s(1).toUpperCase(),
        attribute: attributeOf(s(1)),
        oldValue: s(4),
        newValue: s(5),
        atMs,
        author: s(7),
      });
      continue;
    }

    // Схема УАГЗО, 6 колонок: ячейка в 1-й (индекс 0), время в 4-й.
    atMs = parseRuDateTime(row[3]);
    if (atMs !== null && /^[A-Z]{1,2}\d+$/i.test(s(0))) {
      out.push({
        dept,
        sheet: 'ВСЕ',
        cell: s(0).toUpperCase(),
        attribute: attributeOf(s(0)),
        oldValue: s(1),
        newValue: s(2),
        atMs,
        author: s(4),
      });
    }
  }
  return out;
}

/** Правки после момента среза, свежие сверху. */
export function changesSince(records: ChangeRecord[], sinceMs: number): ChangeRecord[] {
  return records
    .filter((r) => r.atMs >= sinceMs)
    .sort((a, b) => b.atMs - a.atMs);
}
