import { describe, expect, it } from 'vitest';
import { aggregateSignalCounts } from './signal-counts';

describe('aggregateSignalCounts (T5)', () => {
  it('суммирует per-dept counts только по переданным (отфильтрованным) депам', () => {
    const depts: { signalCounts: Record<string, number> }[] = [
      { signalCounts: { overdue: 2, highEconomy: 1 } },
      { signalCounts: { overdue: 3 } },
    ];
    expect(aggregateSignalCounts(depts, {})).toEqual({ overdue: 5, highEconomy: 1 });
  });
  it('один выбранный депт → его counts, не сумма всех', () => {
    const depts = [{ signalCounts: { overdue: 2 } }];
    expect(aggregateSignalCounts(depts, { overdue: 99 })).toEqual({ overdue: 2 });
  });
  it('депты без signalCounts → фолбэк на серверный полный счёт', () => {
    expect(aggregateSignalCounts([], { overdue: 7 })).toEqual({ overdue: 7 });
  });
});
