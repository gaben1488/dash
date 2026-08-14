/**
 * Comprehensive tests for all 6 analytics modules.
 * anomaly.ts, forecast.ts, compliance-44fz.ts, centralization.ts,
 * grbs-profile.ts, subject-classify.ts
 */
import { describe, it, expect } from 'vitest';

import {
  benfordAnalysis,
  ewmaDetection,
  zScoreAnalysis,
} from './anomaly.js';

import {
  linearForecast,
  seasonalForecast,
  buildScenarios,
} from './forecast.js';

import {
  checkEPContractLimits,
  checkAntiDumping,
  checkEPShareLimits,
  classifyEPReason,
  analyzeEPReasons,
} from './compliance-44fz.js';

import {
  findCentralizationOpportunities,
} from './centralization.js';

import {
  buildGRBSProfiles,
  GRBS_BASELINES,
} from './grbs-profile.js';

import {
  classifySubject,
  buildSubjectAnalysis,
} from './subject-classify.js';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Generate Benford-conforming amounts (first digits follow log10(1+1/d)) */
function generateBenfordData(n: number): number[] {
  const amounts: number[] = [];
  const counts = [
    Math.round(n * 0.301), // digit 1
    Math.round(n * 0.176), // digit 2
    Math.round(n * 0.125), // digit 3
    Math.round(n * 0.097), // digit 4
    Math.round(n * 0.079), // digit 5
    Math.round(n * 0.067), // digit 6
    Math.round(n * 0.058), // digit 7
    Math.round(n * 0.051), // digit 8
    Math.round(n * 0.046), // digit 9
  ];
  for (let d = 1; d <= 9; d++) {
    for (let i = 0; i < counts[d - 1]; i++) {
      amounts.push(d * 1000 + Math.random() * 900);
    }
  }
  return amounts;
}

function makeQuarter(overrides: Partial<{
  planCount: number; factCount: number;
  planFB: number; planKB: number; planMB: number; planTotal: number;
  factFB: number; factKB: number; factMB: number; factTotal: number;
  economyTotal: number; economyFB: number; economyKB: number; economyMB: number;
  executionPct: number; execCountPct: number;
  compExecCountPct: number; epExecCountPct: number;
}> = {}) {
  const methodBlock = {
    plan: 0, fact: 0, planSum: 0, factSum: 0,
    planFB: 0, planKB: 0, planMB: 0,
    factFB: 0, factKB: 0, factMB: 0,
    economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0,
  };
  return {
    planCount: 0, factCount: 0,
    planFB: 0, planKB: 0, planMB: 0, planTotal: 0,
    factFB: 0, factKB: 0, factMB: 0, factTotal: 0,
    economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0,
    executionPct: 0, execCountPct: 0,
    compExecCountPct: 0, epExecCountPct: 0,
    competitive: { ...methodBlock },
    ep: { ...methodBlock },
    ...overrides,
  };
}

function makeRecalc(overrides: {
  department?: string;
  totalCompetitive?: number;
  totalEP?: number;
  planTotal?: number;
  factTotal?: number;
  epSharePct?: number;
  q1ExecutionPct?: number;
}) {
  const q = makeQuarter({ executionPct: overrides.q1ExecutionPct ?? 0 });
  return {
    department: overrides.department ?? 'test',
    totalCompetitive: overrides.totalCompetitive ?? 10,
    totalEP: overrides.totalEP ?? 5,
    quarters: { q1: q, q2: makeQuarter(), q3: makeQuarter(), q4: makeQuarter() },
    months: {},
    year: {
      planCount: 15, factCount: 10,
      planFB: 0, planKB: 0, planMB: 0,
      planTotal: overrides.planTotal ?? 50_000_000,
      factFB: 0, factKB: 0, factMB: 0,
      factTotal: overrides.factTotal ?? 25_000_000,
      economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0,
      executionPct: 0.5, execCountPct: 0.67,
      compExecCountPct: 0.6, epExecCountPct: 0.8,
    },
    epSharePct: overrides.epSharePct ?? 0.33,
    dataRowCount: 15,
    byActivity: {},
    bySubordinate: [],
    conflicts: 0,
    economyTotalMath: 0,
    // Корзины волны 0 (реестр расхождений 08.08 §2): факт без планового
    // квартала и строки без года плана вынесены из года отдельными полями.
    // В фикстуре пусты — профиль управления их не читает, но тип обязан
    // сойтись, иначе тест разошёлся бы с продовой формой данных.
    orphanFact: {
      factCount: 0, factFB: 0, factKB: 0, factMB: 0, factTotal: 0,
      economyTotal: 0, economyFB: 0, economyKB: 0, economyMB: 0,
    },
    noYearRows: null,
  };
}

// ===========================================================================
// anomaly.ts
// ===========================================================================
describe('anomaly — benfordAnalysis', () => {
  it('returns passes=true for < 30 values (insufficient data)', () => {
    const result = benfordAnalysis([100, 200, 300]);
    expect(result.passes).toBe(true);
    expect(result.sampleSize).toBe(3);
    expect(result.chiSquare).toBe(0);
    expect(result.pValue).toBe(1);
  });

  it('ignores values < 1 (zeros, tiny decimals)', () => {
    const result = benfordAnalysis([0, 0.5, 0.001, 0.99]);
    expect(result.sampleSize).toBe(0);
    expect(result.passes).toBe(true);
  });

  it('passes for Benford-conforming data (n=500)', () => {
    const data = generateBenfordData(500);
    const result = benfordAnalysis(data);
    expect(result.sampleSize).toBeGreaterThanOrEqual(30);
    expect(result.passes).toBe(true);
  });

  it('fails for non-conforming data (all same first digit)', () => {
    // 50 values all starting with 9
    const data = Array.from({ length: 50 }, (_, i) => 9000 + i);
    const result = benfordAnalysis(data);
    expect(result.sampleSize).toBe(50);
    expect(result.passes).toBe(false);
  });

  it('observed distribution sums to ~1', () => {
    const data = generateBenfordData(200);
    const result = benfordAnalysis(data);
    const sum = result.observed.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 1);
  });

  it('expected distribution has 9 elements matching Benford', () => {
    const result = benfordAnalysis([100]);
    expect(result.expected).toHaveLength(9);
    expect(result.expected[0]).toBeCloseTo(0.301, 3);
  });
});

describe('anomaly — ewmaDetection', () => {
  it('returns empty outliers for < 3 values', () => {
    const result = ewmaDetection([10, 20]);
    expect(result.smoothed).toEqual([10, 20]);
    expect(result.outliers).toEqual([]);
    expect(result.ucl).toEqual([]);
    expect(result.lcl).toEqual([]);
  });

  it('returns no outliers for a stable series', () => {
    const series = [100, 102, 98, 101, 99, 100, 103, 97, 101, 100];
    const result = ewmaDetection(series);
    expect(result.smoothed).toHaveLength(series.length);
    expect(result.outliers).toEqual([]);
  });

  it('detects outlier in series with sustained deviation', () => {
    // EWMA smooths values, so single spike may not trigger. Use sustained high values
    // that push smoothed above control limits (which are based on overall mean/stdDev).
    // With very tight sigma (1.0), even moderate deviations get flagged.
    const series = [10, 10, 10, 10, 10, 10, 10, 10, 10, 500];
    const result = ewmaDetection(series, 0.9, 1.0); // high lambda (reactive), tight limits
    expect(result.outliers.length).toBeGreaterThan(0);
  });

  it('ucl/lcl arrays have length series.length - 1', () => {
    const series = [1, 2, 3, 4, 5];
    const result = ewmaDetection(series);
    expect(result.ucl).toHaveLength(series.length - 1);
    expect(result.lcl).toHaveLength(series.length - 1);
  });

  it('respects custom lambda and sigma', () => {
    const series = [10, 11, 10, 12, 11, 10, 30, 10, 11, 10];
    const tight = ewmaDetection(series, 0.3, 1.5);   // tighter limits
    const loose = ewmaDetection(series, 0.3, 5.0);   // looser limits
    expect(tight.outliers.length).toBeGreaterThanOrEqual(loose.outliers.length);
  });
});

describe('anomaly — zScoreAnalysis', () => {
  it('returns zScore=0 for < 3 departments', () => {
    const result = zScoreAnalysis({ A: 10, B: 20 });
    expect(result).toHaveLength(2);
    result.forEach(r => {
      expect(r.zScore).toBe(0);
      expect(r.isOutlier).toBe(false);
    });
  });

  it('returns zScore=0 when all values identical (stdDev=0)', () => {
    const result = zScoreAnalysis({ A: 50, B: 50, C: 50 });
    result.forEach(r => expect(r.zScore).toBe(0));
  });

  it('detects outlier with clear deviation', () => {
    // With many similar values and one extreme, the z-score will be large
    const result = zScoreAnalysis({
      A: 10, B: 10, C: 10, D: 10, E: 10,
      F: 10, G: 10, H: 10, I: 10, J: 100,
    });
    const outlierJ = result.find(r => r.deptId === 'J')!;
    expect(outlierJ.isOutlier).toBe(true);
    expect(outlierJ.zScore).toBeGreaterThan(2);
  });

  it('no outliers for similar values', () => {
    const result = zScoreAnalysis({ A: 50, B: 52, C: 48, D: 51 });
    result.forEach(r => expect(r.isOutlier).toBe(false));
  });

  it('respects custom threshold', () => {
    const result = zScoreAnalysis({ A: 10, B: 10, C: 10, D: 10, E: 50 }, 10.0);
    result.forEach(r => expect(r.isOutlier).toBe(false));
  });
});

// ===========================================================================
// forecast.ts
// ===========================================================================
describe('forecast — linearForecast', () => {
  it('returns zeros when all months are zero', () => {
    const result = linearForecast([0, 0, 0], 1_000_000);
    expect(result.yearEndExecution).toBe(0);
    expect(result.yearEndFact).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('returns zeros when yearPlan <= 0', () => {
    const result = linearForecast([100, 200, 300], 0);
    expect(result.yearEndExecution).toBe(0);
    expect(result.yearEndFact).toBe(0);
  });

  it('projects correctly for 3 months of data', () => {
    const monthly = [100, 200, 300]; // avg=200, total=600, remaining=9
    const result = linearForecast(monthly, 2400);
    // projected = 600 + 200*9 = 2400 => execution = 1.0
    expect(result.yearEndExecution).toBeCloseTo(1.0, 2);
    expect(result.yearEndFact).toBeCloseTo(2400, 0);
    expect(result.monthlyProjection).toHaveLength(12);
  });

  it('caps execution at 2.0 (200%)', () => {
    const monthly = [1000, 1000, 1000]; // avg=1000, total=3000+9000=12000
    const result = linearForecast(monthly, 1000);
    expect(result.yearEndExecution).toBe(2);
  });

  it('confidence grows with more data months', () => {
    const r3 = linearForecast([100, 200, 300], 10000);
    const r6 = linearForecast([100, 200, 300, 400, 500, 600], 10000);
    expect(r6.confidence).toBeGreaterThan(r3.confidence);
  });

  it('label is "Базовый (линейный)"', () => {
    const result = linearForecast([100], 1000);
    expect(result.label).toBe('Базовый (линейный)');
  });

  it('interior-zero месяцы не завышают прогноз (делитель = истёкшие месяцы, не non-zero)', () => {
    // 3 истёкших месяца, месяц 2 = 0. Истина: avg=400/3, прогноз=400+avg·9 ≈ 1600.
    // Баг (делитель nonZero=2): avg=200, прогноз=400+200·10=2400 — завышение.
    const result = linearForecast([100, 0, 300], 1_000_000);
    expect(result.yearEndFact).toBeCloseTo(1600, 0);
    // внутренняя согласованность: сумма помесячной проекции == годовой прогноз
    const projSum = result.monthlyProjection.reduce((s, v) => s + v, 0);
    expect(projSum).toBeCloseTo(result.yearEndFact, 0);
  });
});

describe('forecast — seasonalForecast', () => {
  it('returns zeros when < 2 non-zero months', () => {
    const result = seasonalForecast([100, 0, 0], 1_000_000);
    expect(result.yearEndExecution).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it('returns zeros when yearPlan <= 0', () => {
    const result = seasonalForecast([100, 200], -1);
    expect(result.yearEndExecution).toBe(0);
  });

  it('produces 12-element projection', () => {
    const result = seasonalForecast([100, 200, 300], 10000);
    expect(result.monthlyProjection).toHaveLength(12);
  });

  it('label is "Сезонный"', () => {
    const result = seasonalForecast([100, 200], 1000);
    expect(result.label).toBe('Сезонный');
  });

  it('ведущие нулевые месяцы не раздувают scaleFactor (делитель = истёкшие месяцы, не non-zero; bug-hunt #2)', () => {
    // 3 ведущих нулевых месяца — это истёкшие месяцы без факта, а не «данных ещё нет».
    // До фикса expectedByNow считался по nonZero.length=3 (веса 0.04+0.05+0.10=0.19) =>
    // yearEndExecution = scaleFactor = 1.1684 (кратное завышение).
    // После фикса делитель = monthlyFacts.length=6 (веса до 0.45) => scaleFactor ≈ 0.6667,
    // что совпадает с фактической долей исполнения (6000/9000 ожидаемых по сезону на 6 месяцев).
    const result = seasonalForecast([0, 0, 0, 1000, 2000, 3000], 20000);
    expect(result.yearEndExecution).toBeCloseTo(0.6667, 3);
    expect(result.yearEndExecution).not.toBeCloseTo(1.1684, 1);
  });
});

describe('forecast — buildScenarios', () => {
  it('returns insufficient_data for < 2 months', () => {
    const result = buildScenarios([100, 0, 0], 1_000_000);
    expect(result.trend).toBe('insufficient_data');
    expect(result.scenarios).toHaveLength(0);
  });

  it('returns 4 scenarios for adequate data', () => {
    const monthly = [100, 200, 300, 400, 500, 600];
    const result = buildScenarios(monthly, 5000);
    expect(result.scenarios).toHaveLength(4);
    const labels = result.scenarios.map(s => s.label);
    expect(labels).toContain('Базовый (линейный)');
    expect(labels).toContain('Сезонный');
    expect(labels).toContain('Оптимистичный');
    expect(labels).toContain('Пессимистичный');
  });

  it('detects accelerating trend', () => {
    // diffs: [200-100=100, 400-200=200]; 200 > 100*1.1 => accelerating
    const monthly = [100, 200, 400];
    const result = buildScenarios(monthly, 10000);
    expect(result.trend).toBe('accelerating');
  });

  it('detects decelerating trend', () => {
    // diffs: [200-100=100, 210-200=10]; 10 < 100*0.9 => decelerating
    const monthly = [100, 200, 210];
    const result = buildScenarios(monthly, 10000);
    expect(result.trend).toBe('decelerating');
  });

  it('uses grbsId from profile when provided', () => {
    const result = buildScenarios([100, 200, 300], 1000, {
      grbsId: 'test-grbs', grbsShort: 'TG', role: 'ОПЕРАЦИОННЫЙ',
      expectedExecQ1: 0.5, normalEpShare: 0.3,
    });
    expect(result.grbsId).toBe('test-grbs');
  });

  it('граница факт/проекция = истёкшие месяцы, не non-zero: свершившийся факт не переписывается сценарным множителем (bug-hunt #3)', () => {
    // nonZero.length=2 (5000, 7000), monthlyFacts.length=4. До фикса граница i < nonZero.length
    // считала индекс 3 (последний ИСТЁКШИЙ месяц, факт 7000) уже проекцией и умножала его на 1.2/0.8.
    // После фикса граница i < monthlyFacts.length — индексы 0..3 остаются фактом в обоих сценариях.
    const result = buildScenarios([0, 5000, 0, 7000], 100_000);
    const optimistic = result.scenarios.find(s => s.label === 'Оптимистичный');
    const pessimistic = result.scenarios.find(s => s.label === 'Пессимистичный');
    expect(optimistic?.monthlyProjection[3]).toBe(7000);
    expect(pessimistic?.monthlyProjection[3]).toBe(7000);
  });
});

// ===========================================================================
// compliance-44fz.ts
// ===========================================================================
describe('compliance — checkEPContractLimits', () => {
  it('flags EP contract above 600K', () => {
    const rows = [{ rowIndex: 1, method: 'ЕП', planTotal: 700_000, factTotal: 0, economy: 0, subject: 'test' }];
    const issues = checkEPContractLimits(rows, 'dept1');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].ruleCode).toBe('ep_contract_limit');
  });

  it('does not flag EP contract at exactly 600K', () => {
    // planTotal — тыс. руб. (канон колонок книг ГРБС): 600 = 600 тыс. руб., граница лимита.
    const rows = [{ rowIndex: 1, method: 'ЕП', planTotal: 600, factTotal: 0, economy: 0, subject: '' }];
    const issues = checkEPContractLimits(rows, 'dept1');
    expect(issues).toHaveLength(0);
  });

  it('ignores non-EP rows', () => {
    const rows = [{ rowIndex: 1, method: 'ЭА', planTotal: 1_000_000, factTotal: 0, economy: 0, subject: '' }];
    const issues = checkEPContractLimits(rows, 'dept1');
    expect(issues).toHaveLength(0);
  });

  it('returns empty for empty rows', () => {
    expect(checkEPContractLimits([], 'dept1')).toEqual([]);
  });
});

describe('compliance — checkAntiDumping', () => {
  it('flags economy > 25% on competitive method', () => {
    const rows = [{ rowIndex: 1, method: 'ЭА', planTotal: 1_000_000, factTotal: 700_000, economy: 300_000, subject: '' }];
    const issues = checkAntiDumping(rows, 'dept1');
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleCode).toBe('anti_dumping');
  });

  it('does not flag economy at exactly 25%', () => {
    const rows = [{ rowIndex: 1, method: 'ЭА', planTotal: 1_000_000, factTotal: 750_000, economy: 250_000, subject: '' }];
    const issues = checkAntiDumping(rows, 'dept1');
    expect(issues).toHaveLength(0);
  });

  it('ignores EP rows (anti-dumping is for competitive only)', () => {
    const rows = [{ rowIndex: 1, method: 'ЕП', planTotal: 1_000_000, factTotal: 0, economy: 500_000, subject: '' }];
    const issues = checkAntiDumping(rows, 'dept1');
    expect(issues).toHaveLength(0);
  });

  it('skips rows with planTotal <= 0', () => {
    const rows = [{ rowIndex: 1, method: 'ЭА', planTotal: 0, factTotal: 0, economy: 100, subject: '' }];
    const issues = checkAntiDumping(rows, 'dept1');
    expect(issues).toHaveLength(0);
  });
});

describe('compliance — checkEPShareLimits', () => {
  it('flags EP share exceeding role limit', () => {
    // ОПЕРАЦИОННЫЙ role limit = 50%
    const issues = checkEPShareLimits(60, 100, 50_000_000, 200_000_000, 'ОПЕРАЦИОННЫЙ', 'dept1');
    expect(issues.some(i => i.ruleCode === 'ep_share_role')).toBe(true);
  });

  it('does not flag EP share within role limit', () => {
    const issues = checkEPShareLimits(30, 100, 10_000_000, 200_000_000, 'ОПЕРАЦИОННЫЙ', 'dept1');
    expect(issues.some(i => i.ruleCode === 'ep_share_role')).toBe(false);
  });

  it('flags annual EP absolute > 50M', () => {
    const issues = checkEPShareLimits(10, 100, 50_000_001, 500_000_000, 'ОПЕРАЦИОННЫЙ', 'dept1');
    expect(issues.some(i => i.ruleCode === 'ep_annual_absolute')).toBe(true);
  });

  it('returns no issues for zero totalCount', () => {
    // epTotal — тыс. руб.: 50_000 = 50 млн руб., ровно на границе годового лимита (не превышает).
    const issues = checkEPShareLimits(0, 0, 50_000, 200_000, 'ОПЕРАЦИОННЫЙ', 'dept1');
    expect(issues.some(i => i.ruleCode === 'ep_share_role')).toBe(false);
    expect(issues.some(i => i.ruleCode === 'ep_annual_absolute')).toBe(false);
  });
});

describe('compliance — classifyEPReason', () => {
  it('classifies monopoly subjects', () => {
    expect(classifyEPReason('Единственный поставщик электроэнергии')).toBe('п1_монополии');
  });

  it('classifies small purchases', () => {
    expect(classifyEPReason('закупка до 600 тыс')).toBe('п4_малые');
  });

  it('classifies education', () => {
    expect(classifyEPReason('Учебные методические пособия')).toBe('п5_образование');
  });

  it('classifies utilities', () => {
    expect(classifyEPReason('Коммунальные услуги')).toBe('п29_жкх');
  });

  it('returns "иное" for unknown subject', () => {
    expect(classifyEPReason('Какая-то непонятная закупка')).toBe('иное');
  });
});

describe('compliance — analyzeEPReasons', () => {
  it('counts only EP rows', () => {
    const rows = [
      { rowIndex: 1, method: 'ЕП', planTotal: 100, factTotal: 0, economy: 0, subject: 'Канцелярия до 600' },
      { rowIndex: 2, method: 'ЭА', planTotal: 200, factTotal: 0, economy: 0, subject: 'Канцелярия' },
      { rowIndex: 3, method: 'ЕП', planTotal: 300, factTotal: 0, economy: 0, subject: 'Коммунальные услуги' },
    ];
    const result = analyzeEPReasons(rows);
    expect(result.total).toBe(2);
    expect(result.byReason['п4_малые'].count).toBe(1);
    expect(result.byReason['п29_жкх'].count).toBe(1);
  });

  it('returns zero totals for empty rows', () => {
    const result = analyzeEPReasons([]);
    expect(result.total).toBe(0);
  });
});

// ===========================================================================
// centralization.ts
// ===========================================================================
describe('centralization — findCentralizationOpportunities', () => {
  it('returns empty for < 3 departments in same category', () => {
    const rows = [
      { grbsId: 'A', subject: 'Канцелярские товары', planTotal: 500, method: 'ЭА' },
      { grbsId: 'B', subject: 'Канцелярские ручки', planTotal: 500, method: 'ЭА' },
    ];
    const opps = findCentralizationOpportunities(rows);
    expect(opps).toHaveLength(0);
  });

  it('finds opportunity when 3+ depts procure same category above 3 млн ₽ (в тыс.)', () => {
    const rows = [
      { grbsId: 'A', subject: 'Канцелярские товары', planTotal: 1_500, method: 'ЭА' },
      { grbsId: 'B', subject: 'Канцелярские ручки', planTotal: 1_500, method: 'ЭА' },
      { grbsId: 'C', subject: 'Канцелярские скрепки', planTotal: 1_500, method: 'ЭА' },
    ];
    const opps = findCentralizationOpportunities(rows);
    expect(opps.length).toBeGreaterThanOrEqual(1);
    expect(opps[0].category).toBe('Канцелярия');
    expect(opps[0].departments).toHaveLength(3);
  });

  // Страж-тест брифа переплавки §5.2: ЕП-строки ОБЯЗАНЫ попадать в кандидаты.
  // Прежний фильтр «только конкурентные» исключал ровно те закупки, ради
  // которых исход «меньше ЕП» существует.
  it('включает ЕП-строки в кандидаты по умолчанию (страж §5.2)', () => {
    const rows = [
      { grbsId: 'A', subject: 'Канцелярские товары', planTotal: 1_500, method: 'ЕП' },
      { grbsId: 'B', subject: 'Канцелярские ручки', planTotal: 1_500, method: 'ЕП' },
      { grbsId: 'C', subject: 'Канцелярские скрепки', planTotal: 1_500, method: 'ЭА' },
    ];
    const opps = findCentralizationOpportunities(rows);
    expect(opps).toHaveLength(1);
    expect(opps[0].departments).toHaveLength(3);
    expect(opps[0].epCount).toBe(2);
    expect(opps[0].epAmount).toBe(3_000);
    expect(opps[0].totalAmount).toBe(4_500);
    // Раскрытие до строк: участники группы доступны с адресом управления.
    expect(opps[0].members).toHaveLength(3);
    expect(opps[0].members.filter(m => m.method === 'ЕП')).toHaveLength(2);
  });

  it('режим includeEP: false возвращает старый периметр «только конкурентные»', () => {
    const rows = [
      { grbsId: 'A', subject: 'Канцелярские товары', planTotal: 1_500, method: 'ЕП' },
      { grbsId: 'B', subject: 'Канцелярские ручки', planTotal: 1_500, method: 'ЕП' },
      { grbsId: 'C', subject: 'Канцелярские скрепки', planTotal: 1_500, method: 'ЕП' },
    ];
    expect(findCentralizationOpportunities(rows, { includeEP: false })).toHaveLength(0);
  });

  it('не обещает экономию числом: у группы объём и заказчики, а не коэффициент', () => {
    const rows: Array<{ grbsId: string; subject: string; planTotal: number; method: string }> = [];
    for (const id of ['A', 'B', 'C', 'D', 'E']) {
      rows.push({ grbsId: id, subject: 'Мебель столы', planTotal: 15_000, method: 'ЭА' });
    }
    const opps = findCentralizationOpportunities(rows);
    expect(opps).toHaveLength(1);
    expect(opps[0].totalAmount).toBe(75_000); // тыс. ₽ — факт из строк
    expect(opps[0].priority).toBe('high');
    // Выдуманного процента экономии в контракте больше нет.
    expect('potentialSavings' in opps[0]).toBe(false);
    expect(opps[0].recommendation).not.toMatch(/потенциальная экономия/);
  });

  it('сортирует кандидатов по объёму группы (крупнейшие первыми)', () => {
    const rows = [
      { grbsId: 'A', subject: 'Канцелярские товары', planTotal: 2_000, method: 'ЕП' },
      { grbsId: 'B', subject: 'Канцелярские ручки', planTotal: 2_000, method: 'ЭА' },
      { grbsId: 'C', subject: 'Канцелярские скрепки', planTotal: 2_000, method: 'ЭА' },
      { grbsId: 'A', subject: 'Мебель столы', planTotal: 20_000, method: 'ЭА' },
      { grbsId: 'B', subject: 'Мебель стулья', planTotal: 20_000, method: 'ЕП' },
      { grbsId: 'C', subject: 'Мебель шкафы', planTotal: 20_000, method: 'ЭА' },
    ];
    const opps = findCentralizationOpportunities(rows);
    expect(opps).toHaveLength(2);
    expect(opps[0].totalAmount).toBeGreaterThan(opps[1].totalAmount);
  });

  it('skips "Другое" category', () => {
    const rows = [
      { grbsId: 'A', subject: 'Something unknown xyz', planTotal: 5_000, method: 'ЭА' },
      { grbsId: 'B', subject: 'Another unknown abc', planTotal: 5_000, method: 'ЭА' },
      { grbsId: 'C', subject: 'Third unknown def', planTotal: 5_000, method: 'ЭА' },
    ];
    expect(findCentralizationOpportunities(rows)).toHaveLength(0);
  });
});

// ===========================================================================
// grbs-profile.ts
// ===========================================================================
describe('grbs-profile — buildGRBSProfiles', () => {
  it('returns high risk when no recalc data for a baseline', () => {
    const profiles = buildGRBSProfiles({});
    expect(profiles).toHaveLength(GRBS_BASELINES.length);
    profiles.forEach(p => {
      expect(p.riskLevel).toBe('high');
      expect(p.totalProcurements).toBe(0);
    });
  });

  // Единицы planTotal — ТЫС. руб. (канон колонок книг ГРБС): 200_000 тыс. =
  // 200 млн руб. Свип БАГ #1 (bug-hunt 2026-08-08): прежние числа теста были
  // в рублях и закрепляли баг единиц (порог «>100 млн» был недостижим).
  it('assigns ВЫСОКИЙ volume for planTotal > 100 млн (200_000 тыс. руб.)', () => {
    const recalc = { uer: makeRecalc({ planTotal: 200_000 }) };
    const profiles = buildGRBSProfiles(recalc);
    const uer = profiles.find(p => p.grbsId === 'uer')!;
    expect(uer.procurementVolume).toBe('ВЫСОКИЙ');
  });

  it('assigns НИЗКИЙ volume for planTotal < 10 млн (5_000 тыс. руб.)', () => {
    const recalc = { uer: makeRecalc({ planTotal: 5_000 }) };
    const profiles = buildGRBSProfiles(recalc);
    const uer = profiles.find(p => p.grbsId === 'uer')!;
    expect(uer.procurementVolume).toBe('НИЗКИЙ');
  });

  it('calculates risk level medium for moderate deviation', () => {
    // UER baseline: expectedExecQ1=0.65, normalEpShare=0.35
    // actualExec = 0.50, dev = -0.15 => medium
    const recalc = { uer: makeRecalc({ q1ExecutionPct: 0.50, epSharePct: 0.35 }) };
    const profiles = buildGRBSProfiles(recalc);
    const uer = profiles.find(p => p.grbsId === 'uer')!;
    expect(uer.riskLevel).toBe('medium');
  });

  it('calculates risk level low for on-target metrics', () => {
    // UER: expectedExecQ1=0.65, normalEpShare=0.35
    const recalc = { uer: makeRecalc({ q1ExecutionPct: 0.65, epSharePct: 0.35 }) };
    const profiles = buildGRBSProfiles(recalc);
    const uer = profiles.find(p => p.grbsId === 'uer')!;
    expect(uer.riskLevel).toBe('low');
  });

  it('computes avgContractSize correctly', () => {
    // totalCompetitive=10, totalEP=5 => totalProc=15, planTotal=50M => avg ~3.33M
    const recalc = { uer: makeRecalc({ totalCompetitive: 10, totalEP: 5, planTotal: 50_000_000 }) };
    const profiles = buildGRBSProfiles(recalc);
    const uer = profiles.find(p => p.grbsId === 'uer')!;
    expect(uer.avgContractSize).toBeCloseTo(50_000_000 / 15, 0);
  });
});

// ===========================================================================
// subject-classify.ts
// ===========================================================================
describe('subject-classify — classifySubject', () => {
  it.each([
    ['Канцелярские товары (бумага, тонер)', 'Канцелярия'],
    ['Мебель офисная — столы и стулья', 'Мебель'],
    ['Закупка компьютеров и принтеров', 'Оргтехника'],
    ['Автомобили легковые (транспорт)', 'Транспорт'],
    ['Поставка ГСМ и бензина', 'ГСМ'],
    ['Реконструкция фасада здания', 'Строительство'],
    ['Текущий ремонт помещения', 'Ремонт'],
    ['Продукты питания и продовольствие', 'Питание'],
    ['Коммунальные услуги теплоснабжение', 'Коммуналка'],
    ['Услуги охраны и видеонаблюдения', 'Охрана'],
    ['Медицинские препараты', 'Медицина'],
    ['Учебные пособия и литература', 'Образование'],
    ['Спецодежда рабочая каски перчатки', 'Спецодежда'],
    ['Услуги связи интернет телефон', 'Связь'],
    ['Услуги клининга уборки помещений', 'Клининг'],
    ['Проектная документация и сметы', 'Проектирование'],
  ] as const)('classifies "%s" as %s', (subject, expected) => {
    expect(classifySubject(subject)).toBe(expected);
  });

  it('returns "Другое" for unknown subject', () => {
    expect(classifySubject('Что-то совершенно неизвестное')).toBe('Другое');
  });

  it('returns "Другое" for empty string', () => {
    expect(classifySubject('')).toBe('Другое');
  });

  it('returns "Другое" for whitespace-only string', () => {
    expect(classifySubject('   ')).toBe('Другое');
  });
});

describe('subject-classify — buildSubjectAnalysis', () => {
  it('counts categories correctly', () => {
    const rows = [
      { subject: 'Канцелярские товары', planTotal: 100 },
      { subject: 'Канцелярские ручки', planTotal: 200 },
      { subject: 'Мебель офисная', planTotal: 500 },
    ];
    const report = buildSubjectAnalysis(rows);
    expect(report.totalRows).toBe(3);
    expect(report.categories['Канцелярия'].count).toBe(2);
    expect(report.categories['Канцелярия'].totalAmount).toBe(300);
    expect(report.categories['Канцелярия'].avgAmount).toBe(150);
    expect(report.categories['Мебель'].count).toBe(1);
  });

  it('returns empty report for empty rows', () => {
    const report = buildSubjectAnalysis([]);
    expect(report.totalRows).toBe(0);
    expect(report.topSubjects).toEqual([]);
  });

  it('topSubjects sorted by count descending', () => {
    const rows = [
      { subject: 'Бумага А4', planTotal: 100 },
      { subject: 'Бумага А4', planTotal: 100 },
      { subject: 'Мебель', planTotal: 500 },
    ];
    const report = buildSubjectAnalysis(rows);
    expect(report.topSubjects[0].subject).toBe('бумага а4');
    expect(report.topSubjects[0].count).toBe(2);
  });
});
