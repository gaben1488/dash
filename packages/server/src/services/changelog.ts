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
  /** 'day' means the source gave no clock time; atMs is only a date anchor. */
  timePrecision?: 'day';
  /** Source _ChangeLog row, used to distinguish multiple date-only edits. */
  sourceRow?: number;
  /** Почта автора правки, как её записал источник. */
  author: string;
}

/**
 * Accepted live _ChangeLog forms:
 *   06.04.2026 17:39:02 / 08.04.2026 9:09:54 /
 *   10.09.2026, 17:21:15 / 22.10.2026 (date only).
 *
 * Keep the existing Date.UTC convention for exact instants: changing its
 * time-zone interpretation here would re-key already persisted history.
 * For date-only entries midnight is a FILTER ANCHOR, not an event time;
 * precision is carried through to the API/UI, never displayed as 00:00.
 */
function parseRuDateTime(raw: unknown): { atMs: number; precision: 'exact' | 'day' } | null {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const day = Number(dd), month = Number(mm), year = Number(yyyy);
  const hour = hh === undefined ? 0 : Number(hh);
  const minute = mi === undefined ? 0 : Number(mi);
  const second = ss === undefined ? 0 : Number(ss);
  if (year < 1900 || year > 2100 || hour > 23 || minute > 59 || second > 59) return null;
  const atMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(atMs);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day) return null;
  return { atMs, precision: hh === undefined ? 'day' : 'exact' };
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
  rows.forEach((row, index) => {
    if (!row || row.length < 5) return;
    const s = (i: number): string => String(row[i] ?? '').trim();
    const provenance = (time: { atMs: number; precision: 'exact' | 'day' }) =>
      time.precision === 'day'
        ? { timePrecision: 'day' as const, sourceRow: index + 1 }
        : {};

    // Eight-column source schema: 'Лист | Ячейка | ... | Время | Автор'.
    const cell8 = s(1).toUpperCase();
    const time8 = parseRuDateTime(row[6]);
    if (time8 && /^[A-Z]{1,2}\d+$/i.test(cell8)) {
      out.push({
        dept, sheet: s(0) || 'ВСЕ', cell: cell8,
        attribute: attributeOf(cell8), oldValue: s(4), newValue: s(5),
        atMs: time8.atMs, author: s(7), ...provenance(time8),
      });
      return;
    }

    // Six-column source schema, including 'УАГЗО!B48' cell references.
    const sixCell = s(0).match(/^(?:(.+)!)?([A-Z]{1,2}\d+)$/i);
    const time6 = parseRuDateTime(row[3]);
    if (time6 && sixCell) {
      const cell = sixCell[2].toUpperCase();
      out.push({
        dept, sheet: sixCell[1] || 'ВСЕ', cell,
        attribute: attributeOf(cell), oldValue: s(1), newValue: s(2),
        atMs: time6.atMs, author: s(4), ...provenance(time6),
      });
    }
    // A bulk/range event without a single cell is not silently expanded into
    // fabricated per-cell history. Its coverage must be checked separately.
  });
  return out;
}

/** Правки после момента среза, свежие сверху. */
export function changesSince(records: ChangeRecord[], sinceMs: number): ChangeRecord[] {
  return records
    .filter((r) => r.atMs >= sinceMs)
    .sort((a, b) => b.atMs - a.atMs);
}
