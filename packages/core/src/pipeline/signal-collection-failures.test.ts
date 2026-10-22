import { describe, expect, it } from 'vitest';
import { detectSheetSignals } from './orchestrator.js';

describe('Сигналы строк: ошибки не считаются чистыми строками', () => {
  it('отмечает физические строки, чей детектор упал, и сохраняет остальные', () => {
    const rows: unknown[][] = [
      [], [], [],
      ['1', '', '', '', '', '', 'Закупка 1'],
      ['2', '', '', '', '', '', 'Закупка 2'],
    ];
    const failures: number[] = [];
    const entries = detectSheetSignals(rows, row => failures.push(row), cells => {
      if (cells.A === '1') throw new Error('Detector failed');
      return { signalExample: true } as never;
    });
    expect(failures).toEqual([4]);
    expect(entries.has(3)).toBe(false);
    expect(entries.has(4)).toBe(true);
  });
});
