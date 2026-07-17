import { parseSheetDate } from '@aemr/shared';

/**
 * Дата-канон на стороне web (fidelity-аудит 2026-07-16 §2.2).
 *
 * DTO /api/rows отдаёт planDate/factDate строго в ISO «YYYY-MM-DD» | null
 * (конверсия из serial/«дд.мм.гггг» — на сервере, sheetDateToIso в rows.ts).
 * Здесь — локализация рендера и извлечение месяца для фильтров. Оба хелпера
 * дополнительно понимают «дд.мм.гггг» (ввод пользователя в редакторе до
 * сохранения) и legacy-серийники (46034) — чтобы старые/чужие источники
 * не рендерились как «01.01.46034» и не падали в январь-1970.
 */

const RU_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Рендер значения даты в «дд.мм.гггг»; пусто → '', нераспознанное → как есть. */
export function formatDateCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const s = String(value).trim();

  const ru = s.match(RU_RE);
  if (ru) return `${ru[1].padStart(2, '0')}.${ru[2].padStart(2, '0')}.${ru[3]}`;

  const iso = s.match(ISO_RE);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;

  // Серийник или иная парсабельная форма — через канон shared.
  // parseSheetDate для serial/ISO создаёт UTC-полночь → берём UTC-геттеры,
  // локальные сдвинули бы день в поясах западнее Гринвича.
  const d = parseSheetDate(s);
  if (d) {
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
  }
  return s;
}

/** Месяц (1..12) значения даты для квартальных/месячных фильтров; не дата → null. */
export function monthOfDateValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();

  const iso = s.match(ISO_RE);
  if (iso) return Number(iso[2]);

  const ru = s.match(RU_RE);
  if (ru) return Number(ru[2]);

  // Серийник — только через канон; «не дата» → null (строка не должна
  // ложно классифицироваться в январь, как это делал new Date(46034)).
  const serial = Number(s);
  if (!isNaN(serial)) {
    const d = parseSheetDate(s);
    return d ? d.getUTCMonth() + 1 : null;
  }
  return null;
}
