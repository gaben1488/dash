import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { detectSheetSignals } from './orchestrator.js';
import type { RowSignals } from './signals.js';

const at = new Date('2026-10-22T03:25:00.000Z');

function row(id: string): unknown[] {
  const cells: unknown[] = new Array(34).fill('');
  cells[DEPT_COLUMNS.ID] = id;
  cells[DEPT_COLUMNS.TYPE] = 'Текущая деятельность';
  cells[DEPT_COLUMNS.SUBJECT] = 'Закупка: оборудование';
  cells[DEPT_COLUMNS.METHOD] = 'ЭА';
  cells[DEPT_COLUMNS.TOTAL_PLAN] = 100;
  return cells;
}

describe('read-only signal detection coverage on the new Dash pipeline', () => {
  it('names a failed physical row but keeps other signal entries and the run clock', () => {
    const observedClock: Date[] = [];
    const failed: number[] = [];
    const input = [[], [], [], row('ok'), row('broken'), row('later')];
    const detector = ((cells: Record<string, unknown>, asOf: Date): RowSignals => {
      observedClock.push(asOf);
      if (cells.A === 'broken') throw new Error('Synthetic decoder failure');
      return { signed: false } as RowSignals;
    }) as typeof import('./signals.js').detectSignals;
    const output = detectSheetSignals(input, at, n => failed.push(n), detector);
    expect(failed).toEqual([5]); // physical spreadsheet row, not array index
    expect([...output.keys()]).toEqual([3, 5]); // existing map uses 0-based indices
    expect(observedClock).toEqual([at, at, at]);
  });

  it('does not call broken detection for short service notes or header rows', () => {
    const failures: number[] = [];
    const output = detectSheetSignals([['header'], [], [], ['Служебная строка']], at,
      n => failures.push(n), (() => { throw new Error('not data'); }) as typeof import('./signals.js').detectSignals);
    expect(output.size).toBe(0);
    expect(failures).toEqual([]);
  });
});
