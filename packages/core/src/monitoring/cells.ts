/**
 * cells.ts — разбор ячеек книги «Ежедневный мониторинг» (канон п.101а).
 *
 * Одно место, где книга превращается в числа и даты. Живёт отдельно от
 * разборщиков листов, потому что все пять листов книги (восемь управлений,
 * СВОДНЫЙ, «25-26», справочник) читают ячейки одинаково, а дефекты ячеек —
 * общий словарь сигналов (спека §5).
 *
 * Правила:
 *  - ноль — содержание, не пустота: 0 в цене аукциона означает «торги без
 *    результата», и подменять его на null нельзя (п.36);
 *  - сумма текстом («73 970 897,35» с неразрывными пробелами) разбирается в
 *    число, НО факт «в книге это текст» сохраняется — из-за него формула
 *    СУММ на своде занижена на 73,97 млн (спека §1.2);
 *  - дата, которую нельзя прочитать («23.062026», «03.06.25026»), даёт iso =
 *    null и остаётся в строке сырым текстом: молча чинить набор нельзя
 *    (п.74), а адрес уезжает в сигнал.
 */

/** Единица денег книги мониторинга. Книги ГРБС — тысячи, здесь рубли. */
export const MONITORING_MONEY_UNIT = 'руб' as const;

/** Буква колонки по индексу (0 → A, 14 → O) — адрес ячейки для карточки диагноста. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Адрес ячейки книги: «5. УДТХиРКИ!D34». */
export function cellAddress(sheet: string, row: number, columnIndex: number): string {
  return `${sheet}!${columnLetter(columnIndex)}${row}`;
}

/**
 * Число из ячейки. UNFORMATTED_VALUE обычно отдаёт number, но в книге
 * встречаются суммы текстом с неразрывными пробелами и запятой вместо точки.
 * Нечисло → null (ноль возвращается только там, где в книге ноль).
 */
export function monitoringNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  // \s в JS покрывает и неразрывный пробел U+00A0 — разряды сумм книги.
  const cleaned = v.replace(/\s/gu, '').replace(',', '.');
  if (cleaned === '' || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** true — в ячейке число, но записанное текстом (СУММ его не видит). */
export function isTextNumber(v: unknown): boolean {
  return typeof v === 'string' && monitoringNumber(v) !== null;
}

/**
 * true — ячейка выглядит пустой, но хранит пробелы. Такая ячейка в разбивке
 * МБ/КБ/ФБ ломает контроль книги (спека §5, десять адресов).
 */
export function isBlankTextCell(v: unknown): boolean {
  return typeof v === 'string' && v !== '' && v.trim() === '';
}

/** Непустой текст ячейки либо null (пробельная ячейка — тоже null). */
export function monitoringText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Дата книги: сырое написание из ячейки и разбор в ISO (null — не читается). */
export interface MonitoringDate {
  /** Как записано в книге — на экран уходит это, не наш разбор. */
  readonly raw: string;
  /** «ГГГГ-ММ-ДД» либо null: набор испорчен (спека §5, двенадцать ячеек). */
  readonly iso: string | null;
}

/** Начало отсчёта серийных дат Google Sheets — 30.12.1899. */
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

function isoFromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Дата из ячейки. Понимает три живые формы:
 *  - «дд.мм.гггг» — как отдаёт API с dateTimeRenderOption FORMATTED_STRING;
 *  - серийное число Google Sheets — как лежит в дампе книги;
 *  - «гггг-мм-дд» — на случай уже нормализованного входа.
 * Пустая ячейка → null (даты нет). Испорченный набор → iso = null при
 * сохранённом raw: строка остаётся в реестре, адрес уезжает в сигнал.
 */
export function monitoringDate(v: unknown): MonitoringDate | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    const iso = isoFromUtcMs(SHEETS_EPOCH_MS + Math.round(v) * MS_PER_DAY);
    return { raw: iso, iso };
  }
  const raw = String(v).trim();
  if (raw === '') return null;

  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u.exec(raw);
  if (dotted) {
    const iso = validIso(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]));
    return { raw, iso };
  }
  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(raw);
  if (dashed) {
    const iso = validIso(Number(dashed[1]), Number(dashed[2]), Number(dashed[3]));
    return { raw, iso };
  }
  // Серийное число текстом («45993») — тоже живая форма выгрузки.
  if (/^\d{4,6}$/u.test(raw)) {
    const iso = isoFromUtcMs(SHEETS_EPOCH_MS + Number(raw) * MS_PER_DAY);
    return { raw, iso };
  }
  return { raw, iso: null };
}

/**
 * Календарная проверка: 31.02 и год вне 2000–2100 датой не считаются.
 * Верхняя граница нужна против опечаток вида «03.06.25026» (год 25026).
 */
function validIso(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return isoFromUtcMs(ms);
}

/** true — в ячейке что-то есть, но датой это не читается (сигнал с адресом). */
export function isBrokenDate(d: MonitoringDate | null): boolean {
  return d !== null && d.iso === null;
}

/** Календарных дней между двумя ISO-датами; null — одной из дат нет. */
export function daysBetween(fromIso: string | null, toIso: string | null): number | null {
  if (fromIso === null || toIso === null) return null;
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / MS_PER_DAY);
}

/** Месяц ISO-даты в виде «ГГГГ-ММ» — ось сезонности. */
export function isoMonth(iso: string | null): string | null {
  return iso === null ? null : iso.slice(0, 7);
}

/** Квартал ISO-даты в виде «2026-I» — ось сезонности крупным планом. */
export function isoQuarter(iso: string | null): string | null {
  if (iso === null) return null;
  const month = Number(iso.slice(5, 7));
  const roman = ['I', 'I', 'I', 'II', 'II', 'II', 'III', 'III', 'III', 'IV', 'IV', 'IV'][month - 1];
  return `${iso.slice(0, 4)}-${roman}`;
}

/** Округление до трёх знаков — как ОКРУГЛ(...;3) в формуле экономии книги. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
