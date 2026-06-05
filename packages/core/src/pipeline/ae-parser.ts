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

import { parseLegalRef, type LegalRefId } from '@aemr/shared';

export interface ParsedAE {
  /** Найденные даты в формате dd.mm.yyyy или dd.mm.yy. */
  dates: string[];
  /** Есть ли в комментарии дата (договора/выплаты). */
  hasContractDate: boolean;
  /** Структурные правовые ссылки (из канонического словаря legal-refs). */
  legalRefs: LegalRefId[];
  /** Есть ли законное основание ЕП в комментарии. */
  hasLegalBasis: boolean;
}

// dd.mm.yyyy или dd.mm.yy — операторы пишут и «26.01.26».
// Кванторы ограничены (нет вложенного backtracking) — ReDoS-safe.
const RX_DATE = /\b(\d{1,2})\.(\d{1,2})\.(20\d{2}|\d{2})\b/g;

// Структурные правовые ссылки извлекает канонический словарь legal-refs (parseLegalRef) —
// дедуп: ранее здесь дублировался инлайновый RX_LEGAL (DEADCODE_DISPOSITION §wire legal-refs).

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

  // Структурные ссылки — из словаря (parseLegalRef сканирует свободный текст → LegalRefId[]).
  const legalRefs = parseLegalRef(text);
  // hasLegalBasis шире: parseLegalRef строг (требует «п.N ч.1 ст.93»), а для подавления
  // epJustificationMissing достаточно любого упоминания основания — голое «ст.93», «монопол», «поручение».
  const hasLegalBasis =
    legalRefs.length > 0 ||
    /ст\.?\s*9[03]/i.test(text) ||
    /монопол/i.test(text) ||
    /губернатор|поручени/i.test(text);

  return {
    dates,
    hasContractDate: dates.length > 0,
    legalRefs,
    hasLegalBasis,
  };
}
