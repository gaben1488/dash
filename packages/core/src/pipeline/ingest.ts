import type { RawCellValue, ReportMapEntry } from '@aemr/shared';

// ============================================================
// Ingest — превращает сырые ответы Google Sheets API в формы,
// которые понимают оркестратор (карта метрик) и классификатор
// (строки с ячейками по буквам колонок).
//
// Чистка 20.08.2026 (зона В): отсюда удалён легаси-путь
// ingestWorkbook/WorkbookSnapshot (grid-режим `spreadsheets.get`
// с includeGridData + утилиты getCellValue/getCellNumber/hasFormula).
// Живой конвейер читает книги ТОЛЬКО через values.batchGet →
// ingestBatchGetResponse / ingestSheetRows; grid-путь не вызывался
// нигде (ни кодом, ни тестами) со времён переноса чтения в
// orchestrator.ts.
// ============================================================

// ────────────────────────────────────────────────────────────
// Column helpers
// ────────────────────────────────────────────────────────────

/** Converts 0-based column index to letter(s): 0→A, 25→Z, 26→AA */
function colIndexToLetter(idx: number): string {
  if (idx < 26) return String.fromCharCode(65 + idx);
  return String.fromCharCode(65 + Math.floor(idx / 26) - 1) + String.fromCharCode(65 + (idx % 26));
}

/** Parses a range like "'СВОД ТД-ПМ'!A1:AG300" into sheet name and bounds */
function parseRange(range: string): { sheet: string; startRow: number; startCol: number } | null {
  const match = range.match(/^'?([^'!]+)'?!([A-Z]{1,2})(\d+)/);
  if (!match) return null;
  const sheet = match[1];
  const colStr = match[2];
  const row = parseInt(match[3], 10);
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  col -= 1; // 0-based
  return { sheet, startRow: row, startCol: col };
}

// ────────────────────────────────────────────────────────────
// Pipeline-facing functions (used by orchestrator.ts)
// ────────────────────────────────────────────────────────────

export interface IngestError {
  cell: string;
  error: string;
}

/**
 * Парсит batchGet ответ через reportMap, возвращает Map<key, RawCellValue>
 * для каждой метрики из карты.
 */
export function ingestBatchGetResponse(
  batchGetData: Array<{ range: string; values: unknown[][]; formulas?: unknown[][] }>,
  reportMap: ReportMapEntry[],
): { cells: Map<string, RawCellValue>; sheets: string[]; errors: IngestError[]; readAt: string; durationMs: number } {
  const start = Date.now();
  const now = new Date().toISOString();
  const cells = new Map<string, RawCellValue>();
  const errors: IngestError[] = [];
  const sheetsSet = new Set<string>();

  // Build a lookup: "SheetName!CellAddr" → reportMap entry
  const cellLookup = new Map<string, ReportMapEntry>();
  for (const entry of reportMap) {
    const key = `${entry.sourceSheet}!${entry.sourceCell}`;
    cellLookup.set(key, entry);
  }

  for (const rangeData of batchGetData) {
    const parsed = parseRange(rangeData.range);
    if (!parsed) continue;

    sheetsSet.add(parsed.sheet);

    for (let ri = 0; ri < (rangeData.values?.length ?? 0); ri++) {
      const row = rangeData.values[ri];
      const rowNum = parsed.startRow + ri;

      for (let ci = 0; ci < row.length; ci++) {
        const colIdx = parsed.startCol + ci;
        const colLetter = colIndexToLetter(colIdx);
        const address = `${colLetter}${rowNum}`;
        const fullKey = `${parsed.sheet}!${address}`;
        const rawValue = row[ci];

        // Extract formula if available
        let formula: string | null = null;
        if (rangeData.formulas && rangeData.formulas[ri] && rangeData.formulas[ri][ci]) {
          const f = rangeData.formulas[ri][ci];
          if (typeof f === 'string' && f.startsWith('=')) formula = f;
        }

        try {
          const rawCell: RawCellValue = {
            sheet: parsed.sheet,
            cell: address,
            rawValue,
            formattedValue: rawValue != null ? String(rawValue) : null,
            formula,
            valueType: rawValue == null ? 'null' : typeof rawValue,
            readAt: now,
          };
          cells.set(fullKey, rawCell);
        } catch (err) {
          errors.push({ cell: fullKey, error: String(err) });
        }
      }
    }
  }

  return {
    cells,
    sheets: Array.from(sheetsSet),
    errors,
    readAt: now,
    durationMs: Date.now() - start,
  };
}

/**
 * Конвертирует сырые строки листа в формат для классификатора.
 * [[val0, val1, ...], ...] → [{ rowIndex, cells: { A: val0, B: val1, ... } }]
 */
export function ingestSheetRows(
  rows: unknown[][],
): Array<{ rowIndex: number; cells: Record<string, unknown> }> {
  return rows.map((row, ri) => {
    const cells: Record<string, unknown> = {};
    for (let ci = 0; ci < row.length; ci++) {
      const col = colIndexToLetter(ci);
      cells[col] = row[ci];
    }
    return { rowIndex: ri + 1, cells };
  });
}
