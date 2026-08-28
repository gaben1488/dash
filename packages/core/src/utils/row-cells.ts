/**
 * row-cells.ts — доступ к ячейке сырой строки листа.
 *
 * Вынесено из dataset-signals.ts (чанк G-3): те же два аксессора нужны детектору
 * сезонных аномалий. Общий модуль вместо дубля — иначе точка дрейфа.
 *
 * Семантика намеренно снисходительная: пустая ячейка = '' / 0, нечисловая = 0.
 * Гейты (пусто? плейсхолдер?) живут в CalcEngine и здесь не дублируются.
 */
import { sheetNumber } from '../timeline/row-timeline.js';

/** Строковое значение ячейки; null/undefined → ''. */
export function strFromRow(row: unknown[], colIndex: number): string {
  const v = row[colIndex];
  return v == null ? '' : String(v);
}

/** Числовое значение ячейки; null/undefined/нечисло → 0.
 * Разбор — единая коэрция ядра sheetNumber: прежний голый parseFloat не знал
 * пробелов-разрядов и запятой-десятичной («1 234,5» → 1 — сумма худела в
 * тысячу раз, «12,5» → 12), страж 29.08.2026. Снисходительная семантика
 * «нечисло → 0» сохранена — гейты живут в CalcEngine. */
export function numFromRow(row: unknown[], colIndex: number): number {
  return sheetNumber(row[colIndex]) ?? 0;
}
