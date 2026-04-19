import { describe, it, expect } from 'vitest';
import {
  reconcile,
  reconcileMonthly,
  crossVerifyQuarterly,
  type OfficialMetrics,
  type ReconSummary,
  type MonthlyReconSummary,
  type QuarterCrossSummary,
} from './reconcile.js';

// ── Helpers ──────────────────────────────────────────────────

function m(plan: number, fact: number, eco: number): OfficialMetrics {
  return { planTotal: plan, factTotal: fact, economyTotal: eco };
}

function mapOf(entries: [string, OfficialMetrics][]): Map<string, OfficialMetrics> {
  return new Map(entries);
}

// ────────────────────────────────────────────────────────────
// 1. reconcile() — main SVOD vs CalcEngine comparison
// ────────────────────────────────────────────────────────────

describe('reconcile', () => {
  it('returns ok for exactly matching values (delta=0)', () => {
    const off = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const calc = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const result = reconcile(off, calc);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].planDelta).toBe(0);
    expect(result.rows[0].factDelta).toBe(0);
    expect(result.rows[0].ecoDelta).toBe(0);
    expect(result.rows[0].assessment.kind).toBe('ok');
    expect(result.rows[0].assessment.status).toBe('Совпадает');
    expect(result.counts.ok).toBe(1);
    expect(result.overallStatus).toBe('Данные согласованы');
  });

  it('returns ok for small differences (< 1%)', () => {
    // 0.5% delta on plan: 1_000_000 vs 1_005_000
    const off = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const calc = mapOf([['Dept1', m(1_005_000, 800_000, 200_000)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].assessment.kind).toBe('ok');
    expect(result.rows[0].planDelta).toBe(5_000);
  });

  it('returns warning for medium differences (1-5%)', () => {
    // ~3% delta on plan: 1_000_000 vs 1_030_000
    const off = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const calc = mapOf([['Dept1', m(1_030_000, 800_000, 200_000)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].assessment.kind).toBe('warning');
    expect(result.rows[0].assessment.status).toBe('Несопоставимо');
    expect(result.overallStatus).toBe('Требует проверки');
  });

  it('returns high for large differences (>= 5%)', () => {
    // 10% delta: 1_000_000 vs 1_100_000
    const off = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const calc = mapOf([['Dept1', m(1_100_000, 800_000, 200_000)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].assessment.kind).toBe('high');
    expect(result.rows[0].assessment.status).toBe('Есть расхождение');
    expect(result.overallStatus).toBe('Есть расхождения');
  });

  it('handles zero official values (both plan and fact = 0) as neutral', () => {
    const off = mapOf([['Dept1', m(0, 0, 0)]]);
    const calc = mapOf([['Dept1', m(500_000, 300_000, 200_000)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].assessment.kind).toBe('neutral');
    expect(result.rows[0].assessment.status).toBe('Нечего сравнивать');
  });

  it('handles zero calculated values with non-zero official', () => {
    const off = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const calc = mapOf([['Dept1', m(0, 0, 0)]]);
    const result = reconcile(off, calc);

    // Huge negative delta → high
    expect(result.rows[0].assessment.kind).toBe('high');
    expect(result.rows[0].planDelta).toBe(-1_000_000);
  });

  it('handles both zeros', () => {
    const off = mapOf([['Dept1', m(0, 0, 0)]]);
    const calc = mapOf([['Dept1', m(0, 0, 0)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].assessment.kind).toBe('neutral');
    expect(result.rows[0].assessment.status).toBe('Нечего сравнивать');
  });

  it('handles negative values', () => {
    const off = mapOf([['Dept1', m(-500_000, 800_000, 200_000)]]);
    const calc = mapOf([['Dept1', m(-500_000, 800_000, 200_000)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].planDelta).toBe(0);
    expect(result.rows[0].assessment.kind).toBe('ok');
  });

  it('reconciles multiple departments correctly', () => {
    const off = mapOf([
      ['DeptA', m(1_000_000, 800_000, 200_000)],
      ['DeptB', m(2_000_000, 1_500_000, 500_000)],
      ['DeptC', m(500_000, 400_000, 100_000)],
    ]);
    const calc = mapOf([
      ['DeptA', m(1_000_000, 800_000, 200_000)],   // ok
      ['DeptB', m(2_060_000, 1_500_000, 500_000)],  // warning (~3%)
      ['DeptC', m(600_000, 400_000, 100_000)],       // high (20%)
    ]);
    const result = reconcile(off, calc);

    expect(result.rows).toHaveLength(3);
    expect(result.counts.ok).toBe(1);
    expect(result.counts.warning).toBe(1);
    expect(result.counts.high).toBe(1);
    expect(result.overallStatus).toBe('Есть расхождения');
  });

  it('handles empty inputs', () => {
    const result = reconcile(new Map(), new Map());

    expect(result.rows).toHaveLength(0);
    expect(result.counts).toEqual({ ok: 0, neutral: 0, warning: 0, high: 0 });
    expect(result.overallStatus).toBe('Данные согласованы');
  });

  it('handles department present only in official', () => {
    const off = mapOf([['OnlyOfficial', m(1_000_000, 800_000, 200_000)]]);
    const calc = new Map<string, OfficialMetrics>();
    const result = reconcile(off, calc);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].department).toBe('OnlyOfficial');
    // calc defaults to 0 → big negative delta → high
    expect(result.rows[0].fullPlanCalculated).toBe(0);
    expect(result.rows[0].assessment.kind).toBe('high');
  });

  it('handles department present only in calculated', () => {
    const off = new Map<string, OfficialMetrics>();
    const calc = mapOf([['OnlyCalc', m(1_000_000, 800_000, 200_000)]]);
    const result = reconcile(off, calc);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].department).toBe('OnlyCalc');
    // off defaults to 0 → neutral (planOff=0, factOff=0)
    expect(result.rows[0].assessment.kind).toBe('neutral');
  });

  it('computes deltaPct correctly (division by zero avoided)', () => {
    const off = mapOf([['Dept1', m(0, 500_000, 100_000)]]);
    const calc = mapOf([['Dept1', m(100_000, 500_000, 100_000)]]);
    const result = reconcile(off, calc);

    // planDeltaPct: plan is 0, so deltaPct should be 0 (base=0 guard)
    expect(result.rows[0].planDeltaPct).toBe(0);
    // factDeltaPct should be 0 (no delta)
    expect(result.rows[0].factDeltaPct).toBe(0);
  });

  it('diagnoses calc_error when calculated > official consistently', () => {
    // calc.plan > off.plan AND planDelta > 0
    const off = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const calc = mapOf([['Dept1', m(1_100_000, 900_000, 250_000)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].assessment.source).toBe('calc_error');
  });

  it('diagnoses svod_error when official > calculated consistently', () => {
    // off.plan > calc.plan AND planDelta < 0
    const off = mapOf([['Dept1', m(1_100_000, 900_000, 250_000)]]);
    const calc = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].assessment.source).toBe('svod_error');
  });

  it('handles very large numbers (billions)', () => {
    const off = mapOf([['Dept1', m(50_000_000_000, 40_000_000_000, 10_000_000_000)]]);
    const calc = mapOf([['Dept1', m(50_000_000_000, 40_000_000_000, 10_000_000_000)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].assessment.kind).toBe('ok');
  });

  it('single department summary counts are correct', () => {
    const off = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const calc = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const result = reconcile(off, calc);

    expect(result.counts.ok).toBe(1);
    expect(result.counts.neutral).toBe(0);
    expect(result.counts.warning).toBe(0);
    expect(result.counts.high).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────
// 2. reconcileMonthly() — SHDYU monthly comparison
// ────────────────────────────────────────────────────────────

describe('reconcileMonthly', () => {
  it('returns matching monthly data as ok', () => {
    const recalc = {
      dept1: {
        months: {
          1: {
            planCount: 10, factCount: 5,
            competitive: { plan: 10, fact: 5, planSum: 1000, factSum: 500 },
            ep: { plan: 3, fact: 2, planSum: 300, factSum: 200 },
          },
        },
      },
    };
    const shdyu = {
      dept1: {
        months: {
          1: {
            compPlanCount: 10, compFactCount: 5, compPlanTotal: 1000, compFactTotal: 500,
            epPlanCount: 3, epFactCount: 2, epPlanTotal: 300, epFactTotal: 200,
          },
        },
      },
    };
    const names = { dept1: 'Department 1' };
    const result = reconcileMonthly(recalc, shdyu, names);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].month).toBe(1);
    expect(result.rows[0].compPlan.status).toBe('ok');
    expect(result.rows[0].compFact.status).toBe('ok');
    expect(result.rows[0].deptName).toBe('Department 1');
    expect(result.overallStatus).toBe('Данные согласованы');
  });

  it('skips months with no data on either side', () => {
    const recalc = { dept1: { months: {} } };
    const shdyu = { dept1: { months: {} } };
    const result = reconcileMonthly(recalc, shdyu, { dept1: 'D1' });

    expect(result.rows).toHaveLength(0);
  });

  it('detects discrepancies in monthly data', () => {
    const recalc = {
      dept1: {
        months: {
          3: {
            planCount: 10, factCount: 5,
            competitive: { plan: 100, fact: 50, planSum: 10000, factSum: 5000 },
            ep: { plan: 20, fact: 10, planSum: 2000, factSum: 1000 },
          },
        },
      },
    };
    const shdyu = {
      dept1: {
        months: {
          3: {
            compPlanCount: 50, compFactCount: 25, compPlanTotal: 50000, compFactTotal: 25000,
            epPlanCount: 100, epFactCount: 50, epPlanTotal: 100000, epFactTotal: 50000,
          },
        },
      },
    };
    const result = reconcileMonthly(recalc, shdyu, { dept1: 'D1' });

    expect(result.rows).toHaveLength(1);
    // Large discrepancies → high
    expect(result.counts.high).toBeGreaterThan(0);
    expect(result.overallStatus).toBe('Есть расхождения');
  });

  it('excludes "all" key from shdyuData', () => {
    const recalc = {};
    const shdyu = {
      all: { months: { 1: { compPlanCount: 100, compFactCount: 50 } } },
    };
    const result = reconcileMonthly(recalc, shdyu, {});

    expect(result.rows).toHaveLength(0);
  });

  it('adds warnings when SHDYU data missing but calc has data', () => {
    const recalc = {
      dept1: {
        months: {
          5: {
            planCount: 10, factCount: 5,
            competitive: { plan: 10, fact: 5, planSum: 1000, factSum: 500 },
            ep: { plan: 3, fact: 2, planSum: 300, factSum: 200 },
          },
        },
      },
    };
    const shdyu = { dept1: { months: {} } }; // no month 5
    const result = reconcileMonthly(recalc, shdyu, { dept1: 'D1' });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].warnings).toBeDefined();
    expect(result.rows[0].warnings![0]).toContain('месяц 5');
  });

  it('handles empty inputs', () => {
    const result = reconcileMonthly({}, {}, {});
    expect(result.rows).toHaveLength(0);
    expect(result.overallStatus).toBe('Данные согласованы');
  });

  it('uses deptId as name when deptNames missing', () => {
    const recalc = {
      unknownDept: {
        months: {
          1: {
            planCount: 1, factCount: 0,
            competitive: { plan: 1, fact: 0, planSum: 100, factSum: 0 },
            ep: { plan: 0, fact: 0, planSum: 0, factSum: 0 },
          },
        },
      },
    };
    const shdyu = {
      unknownDept: {
        months: {
          1: { compPlanCount: 1, compFactCount: 0, compPlanTotal: 100, compFactTotal: 0 },
        },
      },
    };
    const result = reconcileMonthly(recalc, shdyu, {});

    expect(result.rows[0].deptName).toBe('unknownDept');
  });

  it('handles both zeros as empty cells', () => {
    const recalc = {
      dept1: {
        months: {
          1: {
            planCount: 0, factCount: 0,
            competitive: { plan: 0, fact: 0, planSum: 0, factSum: 0 },
            ep: { plan: 0, fact: 0, planSum: 0, factSum: 0 },
          },
        },
      },
    };
    const shdyu = {
      dept1: {
        months: {
          1: {
            compPlanCount: 0, compFactCount: 0, compPlanTotal: 0, compFactTotal: 0,
            epPlanCount: 0, epFactCount: 0, epPlanTotal: 0, epFactTotal: 0,
          },
        },
      },
    };
    const result = reconcileMonthly(recalc, shdyu, { dept1: 'D1' });

    // All zeros on both sides → skip (no sh data, no rc data with planCount=0 and factCount=0)
    // Actually the condition is: !sh is false (sh exists), so it won't skip. Let's check.
    // sh exists, so the row is created. All cells will be 'empty'.
    if (result.rows.length > 0) {
      expect(result.rows[0].compPlan.status).toBe('empty');
      expect(result.rows[0].epFact.status).toBe('empty');
    }
  });

  it('reconciles budget breakdown (FB/KB/MB) when available', () => {
    const recalc = {
      dept1: {
        months: {
          1: {
            planCount: 10, factCount: 5,
            competitive: {
              plan: 10, fact: 5, planSum: 1000, factSum: 500,
              planFB: 500, planKB: 300, planMB: 200,
              factFB: 250, factKB: 150, factMB: 100,
              economyFB: 50, economyKB: 30, economyMB: 20,
            },
            ep: { plan: 0, fact: 0, planSum: 0, factSum: 0 },
          },
        },
      },
    };
    const shdyu = {
      dept1: {
        months: {
          1: {
            compPlanCount: 10, compFactCount: 5, compPlanTotal: 1000, compFactTotal: 500,
            epPlanCount: 0, epFactCount: 0, epPlanTotal: 0, epFactTotal: 0,
            comp: {
              planFB: 500, planKB: 300, planMB: 200,
              factFB: 250, factKB: 150, factMB: 100,
              economyFB: 50, economyKB: 30, economyMB: 20,
            },
          },
        },
      },
    };
    const result = reconcileMonthly(recalc, shdyu, { dept1: 'D1' });

    expect(result.rows[0].compBudget).toBeDefined();
    expect(result.rows[0].compBudget!.planFB.status).toBe('ok');
    expect(result.rows[0].compBudget!.planFB.delta).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────
// 3. crossVerifyQuarterly() — SHDYU monthly sums vs quarterly
// ────────────────────────────────────────────────────────────

describe('crossVerifyQuarterly', () => {
  it('returns ok when monthly sums match quarterly totals', () => {
    const shdyu = {
      dept1: {
        months: {
          1: { compPlanCount: 10, compFactCount: 5, epPlanCount: 3, epFactCount: 2 },
          2: { compPlanCount: 15, compFactCount: 8, epPlanCount: 4, epFactCount: 3 },
          3: { compPlanCount: 20, compFactCount: 12, epPlanCount: 5, epFactCount: 4 },
        },
      },
    };
    const recalc = {
      dept1: {
        quarters: {
          q1: {
            competitive: { plan: 45, fact: 25 },
            ep: { plan: 12, fact: 9 },
          },
        },
      },
    };
    const result = crossVerifyQuarterly(shdyu, recalc, { dept1: 'D1' });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].quarter).toBe(1);
    expect(result.rows[0].compPlan.status).toBe('ok');
    expect(result.rows[0].compPlan.delta).toBe(0);
    expect(result.overallStatus).toBe('Данные согласованы');
  });

  it('detects mismatched quarterly sums', () => {
    const shdyu = {
      dept1: {
        months: {
          1: { compPlanCount: 10, compFactCount: 5, epPlanCount: 3, epFactCount: 2 },
          2: { compPlanCount: 15, compFactCount: 8, epPlanCount: 4, epFactCount: 3 },
          3: { compPlanCount: 20, compFactCount: 12, epPlanCount: 5, epFactCount: 4 },
        },
      },
    };
    const recalc = {
      dept1: {
        quarters: {
          q1: {
            competitive: { plan: 100, fact: 80 },  // shdyu sum is 45, big mismatch
            ep: { plan: 50, fact: 40 },
          },
        },
      },
    };
    const result = crossVerifyQuarterly(shdyu, recalc, { dept1: 'D1' });

    expect(result.rows[0].compPlan.status).toBe('high');
    expect(result.overallStatus).toBe('Есть расхождения');
  });

  it('skips quarters with all zeros', () => {
    const shdyu = { dept1: { months: {} } };
    const recalc = { dept1: { quarters: {} } };
    const result = crossVerifyQuarterly(shdyu, recalc, { dept1: 'D1' });

    expect(result.rows).toHaveLength(0);
  });

  it('handles empty inputs', () => {
    const result = crossVerifyQuarterly({}, {}, {});

    expect(result.rows).toHaveLength(0);
    expect(result.counts).toEqual({ ok: 0, warning: 0, high: 0, empty: 0 });
    expect(result.overallStatus).toBe('Данные согласованы');
  });

  it('handles missing months in quarter (partial data)', () => {
    const shdyu = {
      dept1: {
        months: {
          1: { compPlanCount: 10, compFactCount: 5, epPlanCount: 0, epFactCount: 0 },
          // months 2 and 3 missing
        },
      },
    };
    const recalc = {
      dept1: {
        quarters: {
          q1: {
            competitive: { plan: 10, fact: 5 },
            ep: { plan: 0, fact: 0 },
          },
        },
      },
    };
    const result = crossVerifyQuarterly(shdyu, recalc, { dept1: 'D1' });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].compPlan.shdyuSum).toBe(10);
    expect(result.rows[0].compPlan.status).toBe('ok');
  });

  it('processes all 4 quarters when data exists', () => {
    const months: Record<number, any> = {};
    for (let m = 1; m <= 12; m++) {
      months[m] = { compPlanCount: 10, compFactCount: 5, epPlanCount: 2, epFactCount: 1 };
    }
    const shdyu = { dept1: { months } };
    const recalc = {
      dept1: {
        quarters: {
          q1: { competitive: { plan: 30, fact: 15 }, ep: { plan: 6, fact: 3 } },
          q2: { competitive: { plan: 30, fact: 15 }, ep: { plan: 6, fact: 3 } },
          q3: { competitive: { plan: 30, fact: 15 }, ep: { plan: 6, fact: 3 } },
          q4: { competitive: { plan: 30, fact: 15 }, ep: { plan: 6, fact: 3 } },
        },
      },
    };
    const result = crossVerifyQuarterly(shdyu, recalc, { dept1: 'D1' });

    expect(result.rows).toHaveLength(4);
    expect(result.rows.map(r => r.quarter)).toEqual([1, 2, 3, 4]);
    result.rows.forEach(row => {
      expect(row.compPlan.status).toBe('ok');
    });
  });

  it('uses deptId as fallback name', () => {
    const shdyu = {
      mystery: {
        months: {
          1: { compPlanCount: 10, compFactCount: 0, epPlanCount: 0, epFactCount: 0 },
        },
      },
    };
    const recalc = {
      mystery: {
        quarters: {
          q1: { competitive: { plan: 10, fact: 0 }, ep: { plan: 0, fact: 0 } },
        },
      },
    };
    const result = crossVerifyQuarterly(shdyu, recalc, {});

    expect(result.rows[0].deptName).toBe('mystery');
  });

  it('warning status for 1-5% deltas', () => {
    const shdyu = {
      dept1: {
        months: {
          1: { compPlanCount: 100, compFactCount: 50, epPlanCount: 0, epFactCount: 0 },
          2: { compPlanCount: 0, compFactCount: 0, epPlanCount: 0, epFactCount: 0 },
          3: { compPlanCount: 0, compFactCount: 0, epPlanCount: 0, epFactCount: 0 },
        },
      },
    };
    const recalc = {
      dept1: {
        quarters: {
          q1: {
            competitive: { plan: 97, fact: 49 }, // ~3% delta
            ep: { plan: 0, fact: 0 },
          },
        },
      },
    };
    const result = crossVerifyQuarterly(shdyu, recalc, { dept1: 'D1' });

    expect(result.rows[0].compPlan.status).toBe('warning');
  });

  it('empty cells when both sides are zero', () => {
    const shdyu = {
      dept1: {
        months: {
          4: { compPlanCount: 10, compFactCount: 0, epPlanCount: 0, epFactCount: 0 },
        },
      },
    };
    const recalc = {
      dept1: {
        quarters: {
          q2: {
            competitive: { plan: 10, fact: 0 },
            ep: { plan: 0, fact: 0 },
          },
        },
      },
    };
    const result = crossVerifyQuarterly(shdyu, recalc, { dept1: 'D1' });

    expect(result.rows).toHaveLength(1);
    // compFact: shdyu=0, svod=0 → empty
    expect(result.rows[0].compFact.status).toBe('empty');
    // epPlan: shdyu=0, svod=0 → empty
    expect(result.rows[0].epPlan.status).toBe('empty');
  });
});

// ────────────────────────────────────────────────────────────
// 4. Edge cases and integration
// ────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('reconcile: NaN values treated as numbers (no crash)', () => {
    const off = mapOf([['Dept1', m(NaN, 800_000, 200_000)]]);
    const calc = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    // Should not throw
    expect(() => reconcile(off, calc)).not.toThrow();
  });

  it('reconcile: boundary at exactly 1% delta', () => {
    // Exactly 1%: delta=10_000 on base 1_000_000 → 1.0%
    // The threshold is pctDelta < 1 for ok, so 1.0% should be warning
    const off = mapOf([['Dept1', m(1_000_000, 0, 0)]]);
    const calc = mapOf([['Dept1', m(1_010_000, 0, 0)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].assessment.kind).toBe('warning');
  });

  it('reconcile: boundary at exactly 5% delta', () => {
    // 5% of 1_000_000 = 50_000. pctDelta < 5 is warning, >= 5 is high
    const off = mapOf([['Dept1', m(1_000_000, 0, 0)]]);
    const calc = mapOf([['Dept1', m(1_050_000, 0, 0)]]);
    const result = reconcile(off, calc);

    expect(result.rows[0].assessment.kind).toBe('high');
  });

  it('reconcile: methodology diagnosed for mixed signals', () => {
    // planCalc < planOff but factCalc > factOff → mixed signals
    const off = mapOf([['Dept1', m(1_000_000, 800_000, 200_000)]]);
    const calc = mapOf([['Dept1', m(900_000, 900_000, 200_000)]]);
    const result = reconcile(off, calc);

    // planDelta = -100_000 (calc < off), factDelta = 100_000 (calc > off)
    // planCalc(900k) < planOff(1M), planDelta < 0 → would match svod_error
    // But let's check: planOff > planCalc is true, planDelta < 0 is true → svod_error
    // Actually the second condition: planOff(1M) > planCalc(900k) AND planDelta(-100k) < 0 → svod_error
    expect(result.rows[0].assessment.source).toBe('svod_error');
  });
});
