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
import { createHash } from 'node:crypto';
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
  /** 0-based occurrence among identical source events, independent of sheet row position. */
  sourceOccurrence?: number;
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
export interface ChangeLogCoverage {
  rawRows: number;
  parsed: number;
  dayOnly: number;
  /** Non-empty source records not safely parsed as single-cell events. */
  unparsed: number;
  /** Non-cell actions (ranges, sheet deletion, bulk writes), not expanded. */
  nonCell: number;
  /** A recognisable cell event without a valid timestamp. */
  invalidTime: number;
}

export interface ParsedChangeLog {
  records: ChangeRecord[];
  coverage: ChangeLogCoverage;
}

/** Canonical source-value signature, not a mutable sheet coordinate. */
function dayEventSignature(record: ChangeRecord): string {
  return JSON.stringify([
    record.dept, record.sheet, record.cell, record.atMs, record.author,
    record.oldValue, record.newValue,
  ]);
}

/**
 * Do not use journal row number as identity: reordering or inserting rows
 * shifts that number while leaving the original event unchanged.
 * Indistinguishable *identical* entries receive occurrence ordinals; without
 * source event IDs their individual identities cannot be proven.
 */
export function parseChangeLogDetailed(rows: unknown[][], dept: string): ParsedChangeLog {
  const records: ChangeRecord[] = [];
  const coverage: ChangeLogCoverage = {
    rawRows: rows.length, parsed: 0, dayOnly: 0, unparsed: 0, nonCell: 0, invalidTime: 0,
  };
  const occurrences = new Map<string, number>();
  const add = (record: ChangeRecord, precision: 'exact' | 'day'): void => {
    if (precision === 'day') {
      const signature = dayEventSignature(record);
      const ordinal = occurrences.get(signature) ?? 0;
      occurrences.set(signature, ordinal + 1);
      record.timePrecision = 'day';
      record.sourceOccurrence = ordinal;
      coverage.dayOnly += 1;
    }
    records.push(record);
    coverage.parsed += 1;
  };

  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0 || row.every(v => String(v ?? '').trim() === '')) continue;
    const s = (i: number): string => String(row[i] ?? '').trim();
    if ((s(0) === 'Лист' && s(1) === 'Ячейка') ||
        (s(0) === 'Ячейка' && s(3) === 'Время')) continue;

    // Eight-column source schema.
    const cell8 = s(1).toUpperCase();
    if (/^[A-Z]{1,2}\d+$/i.test(cell8)) {
      const time8 = parseRuDateTime(row[6]);
      if (!time8) { coverage.invalidTime += 1; coverage.unparsed += 1; continue; }
      add({
        dept, sheet: s(0) || 'ВСЕ', cell: cell8,
        attribute: attributeOf(cell8), oldValue: s(4), newValue: s(5),
        atMs: time8.atMs, author: s(7),
      }, time8.precision);
      continue;
    }

    // Six-column source schema, including 'УАГЗО!B48' addresses.
    const sixCell = s(0).match(/^(?:(.+)!)?([A-Z]{1,2}\d+)$/i);
    if (sixCell) {
      const time6 = parseRuDateTime(row[3]);
      if (!time6) { coverage.invalidTime += 1; coverage.unparsed += 1; continue; }
      const cell = sixCell[2].toUpperCase();
      add({
        dept, sheet: sixCell[1] || 'ВСЕ', cell,
        attribute: attributeOf(cell), oldValue: s(1), newValue: s(2),
        atMs: time6.atMs, author: s(4),
      }, time6.precision);
      continue;
    }

    // Bulk/range operations remain visible as a coverage gap. Inventing
    // per-cell edits from A1:C12 or 'deleteSheet x1' would falsify history.
    coverage.nonCell += 1;
    coverage.unparsed += 1;
  }
  return { records, coverage };
}

/** Compatibility entrypoint: the shared source still has one fetch path. */
export function parseChangeLog(rows: unknown[][], dept: string): ChangeRecord[] {
  return parseChangeLogDetailed(rows, dept).records;
}

/** Immutable content identity for date-only entries (no spreadsheet position). */
export function changeEntryIdentity(r: ChangeRecord): string {
  const legacy = [r.dept, r.sheet, r.cell, r.atMs, r.author].join('|');
  if (r.timePrecision !== 'day') return legacy;
  if (!Number.isSafeInteger(r.sourceOccurrence) || (r.sourceOccurrence ?? -1) < 0) {
    throw new Error('Date-only event requires a stable content occurrence');
  }
  const digest = createHash('sha256').update(dayEventSignature(r)).digest('hex');
  return 'journal-day-v2:' + digest + ':' + r.sourceOccurrence;
}

/** Правки после момента среза, свежие сверху. */
export function changesSince(records: ChangeRecord[], sinceMs: number): ChangeRecord[] {
  return records
    .filter((r) => r.atMs >= sinceMs)
    .sort((a, b) => b.atMs - a.atMs);
}
