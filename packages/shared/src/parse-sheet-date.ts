/**
 * parse-sheet-date.ts — ЕДИНЫЙ парсер даты из ячейки Google-листа.
 *
 * Один канон вместо копий (свеп консолидации 2026-07-14). Раньше дату парсили
 * минимум в двух местах несогласованно: signals.ts (parseDate) и seasonal.ts
 * (parseDateFromCell) — и обе НЕ понимали Google-serial (46023 = 01.01.2026),
 * а `new Date('46023')` даёт год 46023 → датные/сезонные сигналы молча мертвы
 * на 6 из 8 ГРБС-листов (столбцы N/Q там хранятся как serial-число).
 *
 * Поддержка: Date-объект, «дд.мм.гггг», Google/Excel-serial (число дней от
 * 1899-12-30, диапазон 40000..60000 ≈ 2009..2064), ISO/прочие строки new Date().
 * Serial-конверсия совпадает с recalculate.ts / calc-engine.ts (n-25569)*86400000.
 */
export function parseSheetDate(val: unknown): Date | null {
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (val === null || val === undefined || val === '') return null;

  const s = String(val).trim();

  // дд.мм.гггг
  const ruMatch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ruMatch) {
    const [, dd, mm, yyyy] = ruMatch;
    const d = new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // Google/Excel serial (число дней от 1899-12-30).
  const serial = Number(s);
  if (!isNaN(serial) && serial > 40000 && serial < 60000) {
    const d = new Date((serial - 25569) * 86400000);
    return isNaN(d.getTime()) ? null : d;
  }

  // ISO yyyy-mm-dd или полная ISO-строка
  const iso = new Date(s);
  return isNaN(iso.getTime()) ? null : iso;
}
