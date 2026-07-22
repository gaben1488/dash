// Юниты lib/recon/monthly — рендер-классы ячеек помесячной сверки,
// честная подпись no_calc («расчёт не построен»), сбор бюджетных расхождений.
import { describe, expect, it } from 'vitest';
import {
  collectBudgetDiscrepancies,
  confidenceLabel,
  MONTH_NAMES_SHORT,
  monthlyCellClass,
  monthlyCellTitle,
  monthlyDeltaClass,
  NO_CALC_NOTE,
} from './monthly';
import type { ReconBudget, ReconCell } from './types';

function makeCell(status: ReconCell['status'], delta = 0): ReconCell {
  return { shdyu: 100, calc: 100 + delta, delta, deltaPct: delta, status };
}

function makeBudget(overrides: Partial<ReconBudget> = {}): ReconBudget {
  const ok = () => makeCell('ok');
  return {
    planFB: ok(), planKB: ok(), planMB: ok(),
    factFB: ok(), factKB: ok(), factMB: ok(),
    economyFB: ok(), economyKB: ok(), economyMB: ok(),
    ...overrides,
  };
}

describe('MONTH_NAMES_SHORT', () => {
  it('индекс = номер месяца (1-12), [0] — заглушка', () => {
    expect(MONTH_NAMES_SHORT).toHaveLength(13);
    expect(MONTH_NAMES_SHORT[0]).toBe('');
    expect(MONTH_NAMES_SHORT[1]).toBe('Янв');
    expect(MONTH_NAMES_SHORT[12]).toBe('Дек');
  });
});

describe('monthlyCellClass', () => {
  it('ok → зелёный, warning → янтарный с фоном, high → красный с фоном', () => {
    expect(monthlyCellClass(makeCell('ok'))).toContain('text-emerald-600');
    expect(monthlyCellClass(makeCell('warning'))).toContain('text-amber-600');
    expect(monthlyCellClass(makeCell('warning'))).toContain('bg-amber-50/50');
    expect(monthlyCellClass(makeCell('high'))).toContain('text-red-600');
    expect(monthlyCellClass(makeCell('high'))).toContain('bg-red-50/50');
  });

  it('no_calc — нейтральный курсив (не ошибка), empty — приглушённый', () => {
    const noCalc = monthlyCellClass(makeCell('no_calc'));
    expect(noCalc).toContain('italic');
    expect(noCalc).toContain('text-zinc-400');
    expect(noCalc).not.toContain('red');
    expect(monthlyCellClass(makeCell('empty'))).toContain('text-zinc-300');
  });

  it('undefined-ячейка получает только базовый класс без статусных цветов', () => {
    expect(monthlyCellClass(undefined)).toBe('px-2 py-2 text-right tabular-nums');
  });
});

describe('monthlyCellTitle', () => {
  it('no_calc → подпись «расчёт не построен», остальные — без подсказки', () => {
    expect(monthlyCellTitle(makeCell('no_calc'))).toBe(NO_CALC_NOTE);
    expect(monthlyCellTitle(makeCell('ok'))).toBeUndefined();
    expect(monthlyCellTitle(makeCell('high'))).toBeUndefined();
    expect(monthlyCellTitle(undefined)).toBeUndefined();
  });
});

describe('monthlyDeltaClass', () => {
  it('ok/warning/high окрашены по статусу', () => {
    expect(monthlyDeltaClass(makeCell('ok'))).toContain('text-emerald-600');
    expect(monthlyDeltaClass(makeCell('warning'))).toContain('text-amber-600');
    expect(monthlyDeltaClass(makeCell('high'))).toContain('text-red-600');
  });

  it('empty, no_calc и отсутствующая ячейка — единый нейтральный цвет', () => {
    for (const cls of [monthlyDeltaClass(makeCell('empty')), monthlyDeltaClass(makeCell('no_calc')), monthlyDeltaClass(undefined)]) {
      expect(cls).toContain('text-zinc-400');
    }
  });
});

describe('confidenceLabel', () => {
  it('переводит уровни достоверности root-cause', () => {
    expect(confidenceLabel('high')).toBe('высокая');
    expect(confidenceLabel('medium')).toBe('средняя');
    expect(confidenceLabel('low')).toBe('низкая');
  });
});

describe('collectBudgetDiscrepancies', () => {
  it('обе разбивки отсутствуют → пусто (разбивка сходится)', () => {
    expect(collectBudgetDiscrepancies(undefined, undefined)).toEqual([]);
  });

  it('ok/empty/no_calc не считаются расхождением', () => {
    const budget = makeBudget({ planFB: makeCell('empty'), factKB: makeCell('no_calc') });
    expect(collectBudgetDiscrepancies(budget, budget)).toEqual([]);
  });

  it('собирает только warning|high с меткой «КП|ЕП + бюджет»', () => {
    const comp = makeBudget({ planFB: makeCell('warning', 3), economyMB: makeCell('high', 42) });
    const ep = makeBudget({ factKB: makeCell('high', -7) });
    const rows = collectBudgetDiscrepancies(comp, ep);
    expect(rows.map(([label]) => label)).toEqual(['КП план ФБ', 'КП эконом. МБ', 'ЕП факт КБ']);
    expect(rows[1][1].delta).toBe(42);
  });
});
