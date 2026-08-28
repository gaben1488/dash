/**
 * formula-error.ts — канон распознавания ошибки формулы в ячейке книги.
 *
 * Класс дефекта (страж 29.08.2026): значения #REF!/#N/A/#ЗНАЧ!/#ДЕЛ/0! в
 * ячейках книг молча читались как текст — детектор ядра знал только
 * английские коды, а книги района живут в русской локали Google Sheets,
 * где те же ошибки печатаются кириллицей («#ЗНАЧ!», «#ДЕЛ/0!», «#Н/Д»,
 * «#ССЫЛКА!», «#ИМЯ?», «#ЧИСЛО!», «#ПУСТО!»). Такая ячейка не число и не
 * пустота: формула сломана, и строка молча выпадает из сумм.
 *
 * Дом распознавания один — этот файл. Копии списка кодов по модулям
 * (signals.ts ядра держал свой FORMULA_ERROR_PATTERNS) обязаны звать
 * isFormulaError, не переизобретать список.
 *
 * Сличение якорное: значение ЯВЛЯЕТСЯ ошибкой формулы, когда начинается с
 * кода («#REF! (The source sheet for this IMPORTRANGE...)» — ошибка), а не
 * когда код упомянут в середине текста примечания.
 */

/** Коды ошибок формул: английская и русская локали Google Sheets / Excel. */
export const FORMULA_ERROR_TOKENS = [
  // Английская локаль
  '#REF', '#VALUE', '#N/A', '#NAME', '#DIV/0', '#NULL', '#NUM', '#ERROR', '#GETTING_DATA',
  // Русская локаль
  '#ССЫЛКА', '#ЗНАЧ', '#Н/Д', '#ИМЯ', '#ДЕЛ/0', '#ПУСТО', '#ЧИСЛО',
] as const;

/**
 * Якорь: значение начинается с кода ошибки, дальше — не буква/цифра
 * (символы «!», «?», пробел, скобка пояснения — допустимы).
 */
const FORMULA_ERROR_RE = new RegExp(
  '^(?:' +
    FORMULA_ERROR_TOKENS
      .map(t => t.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|') +
    ')(?![A-ZА-ЯЁ0-9])',
);

/** Значение ячейки — ошибка формулы источника. */
export function isFormulaError(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val !== 'string' && typeof val !== 'number') {
    return isFormulaError(String(val));
  }
  const s = String(val).trim().toUpperCase();
  if (s === '' || s[0] !== '#') return false;
  return FORMULA_ERROR_RE.test(s);
}

/** Ячейка с ошибкой формулы: графа и значение как есть. */
export interface FormulaErrorCell {
  column: string;
  value: string;
}

/**
 * Все ячейки строки с ошибкой формулы — для замечания с адресом
 * книга-лист-ячейка, а не только «в строке где-то ошибка».
 */
export function formulaErrorCells(
  cells: Record<string, unknown>,
): FormulaErrorCell[] {
  const out: FormulaErrorCell[] = [];
  for (const [column, value] of Object.entries(cells)) {
    if (isFormulaError(value)) out.push({ column, value: String(value) });
  }
  // Порядок граф листа: A..Z, AA..AZ — по длине, затем по алфавиту.
  out.sort((a, b) =>
    a.column.length !== b.column.length
      ? a.column.length - b.column.length
      : a.column.localeCompare(b.column),
  );
  return out;
}
