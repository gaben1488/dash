import { describe, expect, it } from 'vitest';
import { budgetSelection, selectTotal, sumSelected } from './budget';

describe('budgetSelection', () => {
  it('пустой выбор = фильтра нет = все бюджеты включены', () => {
    const sel = budgetSelection(new Set());
    expect(sel).toEqual({ filtered: false, fb: true, kb: true, mb: true });
  });

  it('частичный выбор включает только выбранные', () => {
    const sel = budgetSelection(new Set(['fb', 'mb']));
    expect(sel).toEqual({ filtered: true, fb: true, kb: false, mb: true });
  });
});

describe('sumSelected', () => {
  it('суммирует только выбранные компоненты', () => {
    const sel = budgetSelection(new Set(['kb']));
    expect(sumSelected(sel, 100, 20, 3)).toBe(20);
  });

  it('без фильтра суммирует все три', () => {
    expect(sumSelected(budgetSelection(new Set()), 100, 20, 3)).toBe(123);
  });
});

describe('selectTotal', () => {
  it('при активном фильтре — сумма выбранных компонент', () => {
    const sel = budgetSelection(new Set(['fb', 'kb']));
    expect(selectTotal(sel, 100, 20, 3, 999)).toBe(120);
  });

  it('без фильтра — официальный total, даже если компоненты не сходятся', () => {
    const sel = budgetSelection(new Set());
    expect(selectTotal(sel, 100, 20, 3, 999)).toBe(999);
  });
});
