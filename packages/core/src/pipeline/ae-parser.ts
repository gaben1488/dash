/**
 * AE-parser — извлекает структурные данные из «Комментария ГРБС» (столбец AE),
 * которые операторы пишут свободным текстом вместо отдельных колонок:
 *  - дату факта/контракта (когда столбец Q = «Х»);
 *  - правовое основание ЕП (когда столбец M пуст).
 *
 * Корень FP (SIGNAL_VALIDATION §1, корень №3 «ответ в столбце AE»):
 * сигналы `factWithoutDate` и `epJustificationMissing` читают только Q/M и не видят AE,
 * где лежит реальная дата (≈73% «Факт суммы без даты» — дата в AE) и основание ЕП
 * (100% «ЕП без обоснования» — ст.93 в AE). Канон специфицировал этот парсер, но он не был построен.
 */

export interface ParsedAE {
  /** Найденные даты в формате dd.mm.yyyy или dd.mm.yy. */
  dates: string[];
  /** Есть ли в комментарии дата (договора/выплаты). */
  hasContractDate: boolean;
  /** Найденные правовые ссылки (ст.93, п.X ч.1, распоряжение №112, монополия и т.п.). */
  legalRefs: string[];
  /** Есть ли законное основание ЕП в комментарии. */
  hasLegalBasis: boolean;
}

// dd.mm.yyyy или dd.mm.yy — операторы пишут и «26.01.26».
// Кванторы ограничены (нет вложенного backtracking) — ReDoS-safe.
const RX_DATE = /\b(\d{1,2})\.(\d{1,2})\.(20\d{2}|\d{2})\b/g;

// Правовые основания ЕП (44-ФЗ ст.93 / Распоряжение АЕМР №112 / монополия / поручение Губернатора).
const RX_LEGAL: readonly RegExp[] = [
  /ст\.?\s?9[03]/i, // ст.93 / ст.90
  /п\.?\s?\d+\s?ч\.?\s?1/i, // п.4 ч.1 (ст.93)
  /ч\.?\s?1\s?ст\.?\s?9[03]/i,
  /распоряжени\w*\s?№?\s?112/i, // Распоряжение АЕМР №112
  /монопол/i, // естественная монополия
  /губернатор|поручени/i, // поручение Губернатора
  /единственн\w*\s+производител/i,
];

/**
 * Парсит текст комментария ГРБС (AE/AF). Принимает любое значение ячейки.
 * Длина обрезается до 4000 символов (defense-in-depth против ReDoS — см. SECURITY_REVIEW S-M5).
 */
export function parseAE(raw: unknown): ParsedAE {
  const text = raw == null ? '' : String(raw).slice(0, 4000);

  const dates: string[] = [];
  RX_DATE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RX_DATE.exec(text)) !== null) {
    dates.push(m[0]);
    if (dates.length >= 20) break; // защита от вырожденного ввода
  }

  const legalRefs: string[] = [];
  for (const rx of RX_LEGAL) {
    const hit = text.match(rx);
    if (hit) legalRefs.push(hit[0]);
  }

  return {
    dates,
    hasContractDate: dates.length > 0,
    legalRefs,
    hasLegalBasis: legalRefs.length > 0,
  };
}
