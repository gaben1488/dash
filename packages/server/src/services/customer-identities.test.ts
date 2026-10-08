import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ grid: [['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'ID учреждения'], ['', '', '', 'Учреждение', 'Краткое']], writes: 0, moved: false }));
vi.mock('./google-sheets.js', () => ({
  getSheetDataFromSpreadsheet: vi.fn(async () => { const grid = structuredClone(mock.grid); if (mock.moved) grid[1][3] = 'Другая запись'; return grid; }),
  writeCellValue: vi.fn(async (_id, _sheet, cell, id) => { mock.writes++; mock.grid[Number(cell.slice(1)) - 1][18] = id; return { updatedCells: 1 }; }),
}));
import { assignMissingCustomerIds } from './customer-identities.js';
beforeEach(() => { mock.grid[1] = ['', '', '', 'Учреждение', 'Краткое']; mock.writes = 0; mock.moved = false; });
it('assigns once, verifies persistence and preserves the ID after a rename', async () => {
  const result = await Promise.all([assignMissingCustomerIds('book'), assignMissingCustomerIds('book')]);
  expect(result).toEqual([1, 1]); expect(mock.writes).toBe(1);
  const id = mock.grid[1][18]; expect(id).toMatch(/^[0-9a-f-]{36}$/);
  mock.grid[1][3] = 'Новое название';
  expect(await assignMissingCustomerIds('book')).toBe(0); expect(mock.grid[1][18]).toBe(id);
});
