import { describe, expect, it } from 'vitest';
import {
  reconcileMonthly,
  type MonthlyRecalcDepartment,
  type MonthlySHDYUDepartment,
} from './reconcile';

/**
 * 5.4-A: срез года, за который расчётный слой НЕ ПОСТРОЕН (в книгах управлений
 * нет строк этого план-года — доказано пробой 15.07: у всех листов P=2026),
 * не должен светить сотнями ложных «high» (сравнение официала с нулём).
 * Честный статус ячейки — no_calc, сводка — «расчёт не построен».
 */
describe('reconcileMonthly — расчётный слой за срез не построен (5.4-A)', () => {
  const shdyu: Record<string, MonthlySHDYUDepartment> = {
    uer: {
      months: {
        1: { compPlanCount: 2, compFactCount: 1, compPlanTotal: 100, compFactTotal: 50, epPlanCount: 3, epFactCount: 2, epPlanTotal: 30, epFactTotal: 20 },
      },
    },
  };
  const names = { uer: 'УЭР' };

  it('пустой расчётный слой → ячейки no_calc, high = 0, честная сводка', () => {
    const summary = reconcileMonthly({}, shdyu, names, { calcLayerAbsent: true });
    expect(summary.counts.high).toBe(0);
    expect(summary.counts.noCalc).toBeGreaterThan(0);
    const cell = summary.rows[0].compPlan;
    expect(cell.status).toBe('no_calc');
    expect(cell.shdyu).toBe(2);
    expect(summary.overallStatus).toContain('не построен');
  });

  it('живой расчётный слой → прежняя семантика (high при Δ≥5%)', () => {
    const recalc: Record<string, MonthlyRecalcDepartment> = {
      uer: {
        months: {
          1: {
            planCount: 2, factCount: 1,
            competitive: { plan: 4, fact: 1, planSum: 100, factSum: 50 },
            ep: { plan: 3, fact: 2, planSum: 30, factSum: 20 },
          },
        },
      },
    };
    const summary = reconcileMonthly(recalc, shdyu, names);
    // comp plan: официал 2 vs расчёт 4 → 100% расхождение → high (как раньше)
    expect(summary.rows[0].compPlan.status).toBe('high');
    expect(summary.counts.noCalc ?? 0).toBe(0);
  });
});
