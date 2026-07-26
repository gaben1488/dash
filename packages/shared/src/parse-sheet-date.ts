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

/** Миллисекунд в сутках. */
const MS_PER_DAY = 86400000;

/** Смещение Google/Excel-serial относительно Unix-эпохи: serial 25569 = 1970-01-01. */
const SERIAL_EPOCH_OFFSET = 25569;

/**
 * dayNumberOf — целый номер календарных суток (дней от 1970-01-01), TZ-ИНВАРИАНТНЫЙ.
 *
 * Зачем отдельно от parseSheetDate (TZ-fix 2026-07-20, триаж 15.07): parseSheetDate
 * даёт serial как UTC-полночь, а «дд.мм.гггг» — как ЛОКАЛЬНУЮ полночь. Разница таких
 * Date-объектов на дальних поясах округляется в ±1 день → «дедлайн сегодня» светился
 * просрочкой. Здесь номер суток берётся из КОМПОНЕНТОВ записи, без промежуточного
 * Date-объекта — форма записи (serial / строка / ISO) и пояс машины не влияют:
 * один календарный день → один номер.
 *
 * Формы входа:
 *   «дд.мм.гггг»      → Date.UTC(y, m-1, d) / 86400000 напрямую из строки;
 *   serial 40000..60000 → Math.round(serial) - 25569 (дни от 1899-12-30 → от эпохи);
 *   ISO «YYYY-MM-DD…» → компоненты даты из строки (время/offset игнорируются);
 *   Date-объект       → ЛОКАЛЬНЫЕ компоненты (getFullYear/getMonth/getDate).
 *     По самому Date его происхождение неразличимо (UTC-полночь от serial или
 *     локальная от парса строки); в наших данных Date из листов приходит редко
 *     и создаётся локальным парсом (new Date(y, m, d)) — поэтому локальные
 *     компоненты воспроизводят календарный день, который имел в виду оператор.
 *   null / пусто / мусор → null.
 */
export function dayNumberOf(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()) / MS_PER_DAY;
  }

  const s = String(val).trim();

  // дд.мм.гггг — номер суток напрямую из компонентов строки
  const ruMatch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ruMatch) {
    const [, dd, mm, yyyy] = ruMatch;
    return Date.UTC(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10)) / MS_PER_DAY;
  }

  // Google/Excel serial — уже число суток, только сместить эпоху
  const serial = Number(s);
  if (!isNaN(serial) && serial > 40000 && serial < 60000) {
    return Math.round(serial) - SERIAL_EPOCH_OFFSET;
  }

  // ISO «YYYY-MM-DD» или «YYYY-MM-DDTHH:mm:ss…» — компоненты даты из строки
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return Date.UTC(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10)) / MS_PER_DAY;
  }

  return null;
}

// ── Недельная арифметика над номерами суток ──────────────────────────
// Канон еженедельной системы: срез отчёта — ЧЕТВЕРГ. Все три функции
// опираются на один факт: день 0 эпохи (1970-01-01) — четверг.
// Единственный дом этой арифметики (ponytail-ревью R1 #7): копии в
// web/server запрещены — импортировать отсюда.

/** Дней в неделе — единый дом константы недельной арифметики (копии запрещены). */
export const DAYS_PER_WEEK = 7;

/** Последний четверг ≤ d (день 0 эпохи — четверг ⇒ достаточно d − d % 7). */
export const floorToThursday = (day: number): number => day - (day % DAYS_PER_WEEK);

/** Понедельник недели дня d: d − ((d+3) % 7). */
export const mondayOfDay = (day: number): number => day - ((day + 3) % DAYS_PER_WEEK);

/** Номер суток → ISO «YYYY-MM-DD» через UTC-компоненты (номер суток TZ-инвариантен). */
export function isoOfDayNumber(day: number): string {
  const d = new Date(day * MS_PER_DAY);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}
