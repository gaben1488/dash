import { randomUUID } from 'node:crypto';
import { MONITORING_DIRECTORY_SHEET } from '@aemr/core';
import { getSheetDataFromSpreadsheet, writeCellValue } from './google-sheets.js';

let pending: Promise<number> | null = null;
/** Single production writer. Only missing technical IDs are assigned; legal facts stay human-owned. */
export function assignMissingCustomerIds(spreadsheetId: string): Promise<number> {
  if (pending) return pending;
  pending = (async () => {
    const grid = await getSheetDataFromSpreadsheet(spreadsheetId, MONITORING_DIRECTORY_SHEET);
    if (grid[0]?.[18] !== 'ID учреждения') throw new Error('Поле ID учреждения не подготовлено');
    if (grid.length > 500) throw new Error('Справочник превышает проверенную границу 500 строк');
    let assigned = 0;
    for (let i = 1; i < grid.length; i++) {
      if ((!grid[i]?.[3] && !grid[i]?.[4]) || grid[i]?.[18]) continue;
      // Re-read before each write: preserve a concurrently assigned ID or moved row.
      const fresh = await getSheetDataFromSpreadsheet(spreadsheetId, MONITORING_DIRECTORY_SHEET);
      if (JSON.stringify(fresh[i]?.slice(0, 18)) !== JSON.stringify(grid[i]?.slice(0, 18))) throw new Error('Запись справочника изменилась; повторите обновление');
      if (fresh[i]?.[18]) continue;
      const id = randomUUID();
      const result = await writeCellValue(spreadsheetId, MONITORING_DIRECTORY_SHEET, `S${i + 1}`, id);
      if (result.updatedCells !== 1) throw new Error('ID учреждения не сохранён');
      const verified = await getSheetDataFromSpreadsheet(spreadsheetId, MONITORING_DIRECTORY_SHEET);
      if (verified[i]?.[18] !== id) throw new Error('Запись ID учреждения не подтверждена');
      assigned++;
    }
    return assigned;
  })().finally(() => { pending = null; });
  return pending;
}
