/**
 * row-cells.ts — доступ к ячейке сырой строки листа.
 *
 * Вынесено из dataset-signals.ts (чанк G-3): те же два аксессора нужны детектору
 * сезонных аномалий. Общий модуль вместо дубля — иначе точка дрейфа.
 *
 * Семантика намеренно снисходительная: пустая ячейка = '' / 0, нечисловая = 0.
 * Гейты (пусто? плейсхолдер?) живут в CalcEngine и здесь не дублируются.
 */

/** Строковое значение ячейки; null/undefined → ''. */
export function strFromRow(row: unknown[], colIndex: number): string {
  const v = row[colIndex];
  return v == null ? '' : String(v);
}

/** Числовое значение ячейки; null/undefined/нечисло → 0. */
export function numFromRow(row: unknown[], colIndex: number): number {
  const v = row[colIndex];
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? 0 : n;
}
