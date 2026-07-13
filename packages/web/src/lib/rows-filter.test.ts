import { describe, expect, it } from 'vitest';
import { filterRowsByBudgets, type BudgetRow } from './rows-filter';

const mk = (o: Partial<BudgetRow>): BudgetRow => ({
  planFB: 0, planKB: 0, planMB: 0, factFB: 0, factKB: 0, factMB: 0, ...o,
});

describe('filterRowsByBudgets (T4)', () => {
  it('пустой набор бюджетов → все строки проходят', () => {
    const rows = [mk({ planFB: 100 }), mk({ planMB: 50 })];
    expect(filterRowsByBudgets(rows, new Set())).toHaveLength(2);
  });
  it('fb → только строки с федеральной компонентой (план ИЛИ факт)', () => {
    const rows = [mk({ planFB: 100 }), mk({ planMB: 50 }), mk({ factFB: 5 })];
    const out = filterRowsByBudgets(rows, new Set(['fb']));
    expect(out).toHaveLength(2);
  });
  it('несколько бюджетов → объединение (OR)', () => {
    const rows = [mk({ planFB: 100 }), mk({ planKB: 50 }), mk({ planMB: 10 })];
    expect(filterRowsByBudgets(rows, new Set(['fb', 'mb']))).toHaveLength(2);
  });
});
