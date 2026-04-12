/**
 * Centralized column mapping for department sheets.
 * Single source of truth for all column indices (0-based).
 *
 * Column layout (standard department sheet):
 *   A=0 (ID), B=1 (Реестровый номер), C=2 (Наименование подведа),
 *   D=3 (Описание), E=4, F=5 (Вид деятельности), G=6 (Предмет закупки),
 *   H=7 (ФБ план), I=8 (КБ план), J=9 (МБ план), K=10 (Итого план),
 *   L=11 (Способ), M=12, N=13 (Дата плана), O=14 (Квартал плана),
 *   P=15, Q=16 (Дата факта), R=17 (Квартал факта), S=18, T=19,
 *   U=20 (Статус), V=21 (ФБ факт), W=22 (КБ факт), X=23 (МБ факт),
 *   Y=24 (Итого факт), Z=25, AA=26, AB=27 (Экономия МБ), AC=28,
 *   AD=29 (Признак экономии), AE=30 (Комментарий ГРБС), AF=31 (Комментарий УЭР)
 */
export const DEPT_COLUMNS = {
  ID: 0,              // A — порядковый номер
  REG_NUMBER: 1,      // B — реестровый номер
  SUBORDINATE: 2,     // C — наименование подведомственного
  DESCRIPTION: 3,     // D — описание закупки / наименование ПМ
  PROGRAM_NAME: 4,    // E — наименование программы (если есть → ТД в рамках ПМ)
  TYPE: 5,            // F — вид деятельности (Текущая деятельность / Программное мероприятие)
  SUBJECT: 6,         // G — предмет закупки
  FB_PLAN: 7,         // H — федеральный бюджет (план)
  KB_PLAN: 8,         // I — краевой бюджет (план)
  MB_PLAN: 9,         // J — муниципальный бюджет (план)
  TOTAL_PLAN: 10,     // K — итого (план)
  METHOD: 11,         // L — способ закупки (ЭА/ЕП/ЭК/ЭЗК)
  PLAN_DATE: 13,      // N — дата размещения плана
  PLAN_QUARTER: 14,   // O — квартал плана
  PLAN_YEAR: 15,      // P — год плана
  FACT_DATE: 16,      // Q — дата заключения контракта
  FACT_QUARTER: 17,   // R — квартал факта
  FACT_YEAR: 18,      // S — год факта
  STATUS: 20,         // U — статус
  FB_FACT: 21,        // V — федеральный бюджет (факт)
  KB_FACT: 22,        // W — краевой бюджет (факт)
  MB_FACT: 23,        // X — муниципальный бюджет (факт)
  TOTAL_FACT: 24,     // Y — итого (факт)
  ECONOMY_FB: 25,     // Z — экономия ФБ
  ECONOMY_KB: 26,     // AA — экономия КБ
  ECONOMY_MB: 27,     // AB — экономия МБ
  ECONOMY_TOTAL: 28,  // AC — экономия итого
  FLAG: 29,           // AD — признак/флаг экономии
  COMMENT_GRBS: 30,   // AE — комментарий ГРБС
  COMMENT_UER: 31,    // AF — комментарий УЭР
} as const;

/** Number of header rows in department sheets (шапка: 3 строки) */
export const DEPT_HEADER_ROWS = 3;

/** Column letter → 0-based index mapping (A=0..AF=31). */
export const COL_LETTER_INDEX: Readonly<Record<string, number>> = {
  A:0, B:1, C:2, D:3, E:4, F:5, G:6, H:7, I:8, J:9, K:10,
  L:11, M:12, N:13, O:14, P:15, Q:16, R:17, S:18, T:19, U:20,
  V:21, W:22, X:23, Y:24, Z:25, AA:26, AB:27, AC:28, AD:29, AE:30, AF:31,
};

/** Cached entries array for buildCellDict hot path */
const COL_ENTRIES = Object.entries(COL_LETTER_INDEX);

/** Convert a raw row array to a column-letter keyed cell dictionary. */
export function buildCellDict(row: unknown[]): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const [col, i] of COL_ENTRIES) {
    cells[col] = row[i] ?? null;
  }
  return cells;
}

/**
 * Check if a text value represents a meta-row (итого, всего, раздел, блок, наименование).
 * Uses `includes` (not `startsWith`) — meta keywords can appear mid-string (e.g. "Закупки всего").
 */
const META_ROW_KEYWORDS = ['итого', 'всего', 'раздел', 'блок', 'наименование'];
export function isMetaRow(text: string): boolean {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return META_ROW_KEYWORDS.some(w => lower.includes(w));
}
