import type { ClassifiedRow, RowClassification } from '@aemr/shared';

/**
 * Классифицирует строки листа по типу
 */
export function classifyRows(
  sheetName: string,
  rows: Array<{ rowIndex: number; cells: Record<string, unknown> }>,
): ClassifiedRow[] {
  return rows.map(row => classifyRow(sheetName, row));
}

function classifyRow(
  sheetName: string,
  row: { rowIndex: number; cells: Record<string, unknown> },
): ClassifiedRow {
  const reasons: string[] = [];
  let classification: RowClassification = 'unknown';
  let confidence = 0;

  const { cells } = row;

  // Early exit for header rows (first 3 rows are always spreadsheet headers, rowIndex is 1-based)
  if (row.rowIndex <= 3) {
    return {
      rowIndex: row.rowIndex,
      sheet: sheetName,
      classification: 'header' as RowClassification,
      classificationConfidence: 0.99,
      cells,
      classificationReasons: ['Строка заголовка таблицы (rowIndex <= 3)'],
    };
  }

  // Проверяем наличие числового идентификатора (столбец A или B)
  const hasId = isNumeric(cells['A']) || isNumeric(cells['B']);

  // Проверяем наличие суммовых столбцов
  const hasAmounts = isNumeric(cells['H']) || isNumeric(cells['I']) ||
                     isNumeric(cells['J']) || isNumeric(cells['K']);

  // Heuristic: if all "amount" columns have small integers (<100), likely column numbers not real amounts
  const amountValues = ['H', 'I', 'J', 'K'].map(c => toNumber(cells[c])).filter(v => v !== null) as number[];
  const allSmallIntegers = amountValues.length > 0 && amountValues.every(v => Number.isInteger(v) && v >= 0 && v < 100);

  // Проверяем текст столбца C (наименование)
  const nameText = String(cells['C'] ?? '').trim().toLowerCase();

  // Проверяем маркеры служебных строк
  const isTotalMarker = nameText.includes('итого') || nameText.includes('всего');
  const isHeaderMarker = nameText.includes('раздел') || nameText.includes('блок') ||
                         nameText === '' && !hasAmounts;
  const isSeparator = Object.values(cells).every(v => v === null || v === undefined || v === '');

  // Классификация
  if (isSeparator) {
    classification = 'separator';
    confidence = 0.95;
    reasons.push('Все ячейки пусты');
  } else if (isTotalMarker && hasAmounts) {
    classification = 'summary';
    confidence = 0.9;
    reasons.push('Маркер "итого"/"всего" с суммами');
  } else if (isTotalMarker && !hasAmounts) {
    classification = 'header';
    confidence = 0.7;
    reasons.push('Маркер заголовка без сумм');
  } else if (isHeaderMarker) {
    classification = 'header';
    confidence = 0.6;
    reasons.push('Маркер заголовка блока');
  } else if (hasId && hasAmounts && allSmallIntegers) {
    classification = 'header';
    confidence = 0.8;
    reasons.push('Числовые столбцы содержат малые целые (<100) — вероятно номера столбцов');
  } else if (hasId && hasAmounts) {
    classification = 'procurement';
    confidence = 0.9;
    reasons.push('Есть числовой ID и суммы');
  } else if (hasId && !hasAmounts) {
    classification = 'procurement_derived';
    confidence = 0.6;
    reasons.push('Есть ID, но нет сумм');
  } else if (!hasId && hasAmounts) {
    classification = 'service';
    confidence = 0.5;
    reasons.push('Нет ID, но есть суммы');
  } else if (nameText.length > 0) {
    classification = 'note';
    confidence = 0.4;
    reasons.push('Текстовая строка без ID и сумм');
  }

  return {
    rowIndex: row.rowIndex,
    sheet: sheetName,
    classification,
    classificationConfidence: confidence,
    cells: cells,
    classificationReasons: reasons,
  };
}

function isNumeric(val: unknown): boolean {
  if (typeof val === 'number') return true;
  if (typeof val === 'string') return /^\d+([.,]\d+)?$/.test(val.trim());
  return false;
}

function toNumber(val: unknown): number | null {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = Number(val.trim().replace(/,/g, '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
