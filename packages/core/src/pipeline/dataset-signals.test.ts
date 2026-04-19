import { describe, it, expect } from 'vitest';
import {
  benfordTest,
  detectOutliers,
  classifyEpRisk,
  classifyExecution,
  detectDataAnomalies,
  detectBehavioralAnomalies,
  detectSystemicAnomalies,
  computeCompositeScore,
  buildNoiseMap,
  analyzeDataset,
  detectSeasonalAnomalies,
  detectSuspiciousSplitting,
} from './dataset-signals.js';

// ────────────────────────────────────────────────────────────
// 1. Benford Test
// ────────────────────────────────────────────────────────────

describe('benfordTest', () => {
  it('returns expected Benford distribution for ideal data', () => {
    // Generate Benford-conforming data
    const amounts: number[] = [];
    for (let i = 1; i <= 9; i++) {
      const expected = Math.round(Math.log10(1 + 1 / i) * 1000);
      for (let j = 0; j < expected; j++) {
        amounts.push(i * 1000 + Math.random() * 900);
      }
    }
    const result = benfordTest(amounts);
    expect(result.sampleSize).toBeGreaterThan(900);
    expect(result.conformity).toBe('close');
    expect(result.mad).toBeLessThan(0.006);
  });

  it('detects non-conforming distribution', () => {
    // All amounts start with 5 — clearly non-Benford
    const amounts = Array.from({ length: 200 }, () => 5000 + Math.random() * 4000);
    const result = benfordTest(amounts);
    expect(result.conformity).toBe('nonconforming');
    expect(result.mad).toBeGreaterThan(0.015);
  });

  it('handles empty array', () => {
    const result = benfordTest([]);
    expect(result.sampleSize).toBe(0);
    // With 0 samples, observed frequencies are all 0, MAD = mean(|0 - expected|)
    // which equals mean of Benford expected values ≈ 0.111
    expect(result.mad).toBeGreaterThan(0);
  });

  it('ignores zero and near-zero values', () => {
    const result = benfordTest([0, 0.001, 0.5, 100, 200, 300]);
    expect(result.sampleSize).toBe(3); // only 100, 200, 300
  });

  it('expected frequencies sum to ~1', () => {
    const result = benfordTest([100]);
    const sum = result.expected.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});

// ────────────────────────────────────────────────────────────
// 2. Z-Score Outlier Detection
// ────────────────────────────────────────────────────────────

describe('detectOutliers', () => {
  it('finds outliers in normal distribution with extreme values', () => {
    // Need enough spread for Z > 3: values clustered around 11, outlier at 1000
    const values = [10, 11, 10, 11, 12, 10, 11, 10, 11, 12, 1000];
    const result = detectOutliers(values);
    expect(result.count).toBe(1);
    expect(result.indices).toContain(10);
  });

  it('returns empty for uniform data', () => {
    const values = [10, 10, 10, 10, 10];
    const result = detectOutliers(values);
    expect(result.count).toBe(0);
    expect(result.stdDev).toBe(0);
  });

  it('handles small arrays (< 3)', () => {
    const result = detectOutliers([1, 2]);
    expect(result.count).toBe(0);
  });

  it('respects custom threshold', () => {
    const values = [10, 11, 10, 11, 12, 10, 11, 10, 11, 12, 500];
    const strict = detectOutliers(values, 1.5);
    const loose = detectOutliers(values, 5);
    expect(strict.count).toBeGreaterThanOrEqual(loose.count);
  });
});

// ────────────────────────────────────────────────────────────
// 3. EP Risk Classification
// ────────────────────────────────────────────────────────────

describe('classifyEpRisk', () => {
  it('НИЗКИЙ when EP share <= normal', () => {
    expect(classifyEpRisk(0.20).level).toBe('НИЗКИЙ');
    expect(classifyEpRisk(0.30).level).toBe('НИЗКИЙ');
  });

  it('УМЕРЕННЫЙ when excess <= 0.10', () => {
    expect(classifyEpRisk(0.35).level).toBe('УМЕРЕННЫЙ');
    expect(classifyEpRisk(0.40).level).toBe('УМЕРЕННЫЙ');
  });

  it('ПОВЫШЕННЫЙ when excess <= 0.25', () => {
    expect(classifyEpRisk(0.50).level).toBe('ПОВЫШЕННЫЙ');
  });

  it('ВЫСОКИЙ when excess <= 0.40', () => {
    expect(classifyEpRisk(0.65).level).toBe('ВЫСОКИЙ');
  });

  it('КРИТИЧЕСКИЙ when excess > 0.40', () => {
    expect(classifyEpRisk(0.75).level).toBe('КРИТИЧЕСКИЙ');
    expect(classifyEpRisk(1.0).level).toBe('КРИТИЧЕСКИЙ');
  });

  it('uses custom normal share', () => {
    // With normal=0.50, ep=0.55 → excess=0.05 → УМЕРЕННЫЙ
    expect(classifyEpRisk(0.55, 0.50).level).toBe('УМЕРЕННЫЙ');
    expect(classifyEpRisk(0.55, 0.50).excess).toBeCloseTo(0.05);
  });
});

// ────────────────────────────────────────────────────────────
// 4. Execution Level
// ────────────────────────────────────────────────────────────

describe('classifyExecution', () => {
  it('ОТЛИЧНОЕ for >= 0.90', () => {
    expect(classifyExecution(0.95)).toBe('ОТЛИЧНОЕ');
    expect(classifyExecution(0.90)).toBe('ОТЛИЧНОЕ');
  });

  it('ХОРОШЕЕ for >= 0.70', () => {
    expect(classifyExecution(0.75)).toBe('ХОРОШЕЕ');
  });

  it('СРЕДНЕЕ for >= 0.50', () => {
    expect(classifyExecution(0.55)).toBe('СРЕДНЕЕ');
  });

  it('НИЗКОЕ for >= 0.30', () => {
    expect(classifyExecution(0.35)).toBe('НИЗКОЕ');
  });

  it('КРИТИЧЕСКОЕ for < 0.30', () => {
    expect(classifyExecution(0.10)).toBe('КРИТИЧЕСКОЕ');
    expect(classifyExecution(0)).toBe('КРИТИЧЕСКОЕ');
  });
});

// ────────────────────────────────────────────────────────────
// 5. Data Anomaly Detection (Level 1)
// ────────────────────────────────────────────────────────────

describe('detectDataAnomalies', () => {
  function makeRow(plan: number, fact: number, ecoFB = 0, ecoKB = 0, ecoMB = 0, ad = ''): unknown[] {
    const row = new Array(32).fill(null);
    row[10] = plan;  // K = plan total
    row[24] = fact;  // Y = fact total
    row[25] = ecoFB; // Z = economy FB
    row[26] = ecoKB; // AA = economy KB
    row[27] = ecoMB; // AB = economy MB
    row[29] = ad;    // AD = economy flag
    return row;
  }

  it('detects EXEC_OVER_200', () => {
    const rows = [makeRow(1_000_000, 3_000_000)];
    const result = detectDataAnomalies(rows);
    expect(result.get(0)?.some(a => a.type === 'EXEC_OVER_200')).toBe(true);
  });

  it('does NOT flag normal excess', () => {
    const rows = [makeRow(1_000_000, 1_500_000)]; // 150% - not > 200%
    const result = detectDataAnomalies(rows);
    expect(result.get(0)?.some(a => a.type === 'EXEC_OVER_200')).toBeFalsy();
  });

  it('detects FACT_NO_PLAN', () => {
    const rows = [makeRow(0, 500_000)];
    const result = detectDataAnomalies(rows);
    expect(result.get(0)?.some(a => a.type === 'FACT_NO_PLAN')).toBe(true);
  });

  it('detects NEGATIVE_PLAN', () => {
    const rows = [makeRow(-100_000, 0)];
    const result = detectDataAnomalies(rows);
    expect(result.get(0)?.some(a => a.type === 'NEGATIVE_PLAN')).toBe(true);
  });

  it('detects EXACT_MATCH', () => {
    const rows = [makeRow(1_000_000, 1_000_000)];
    const result = detectDataAnomalies(rows);
    expect(result.get(0)?.some(a => a.type === 'EXACT_MATCH')).toBe(true);
  });

  it('does NOT flag near-match above threshold', () => {
    const rows = [makeRow(1_000_000, 999_000)]; // 0.1% diff > 0.01%
    const result = detectDataAnomalies(rows);
    expect(result.get(0)?.some(a => a.type === 'EXACT_MATCH')).toBeFalsy();
  });

  it('detects ZERO_ECONOMY_WITH_FACT', () => {
    const rows = [makeRow(1_000_000, 800_000, 0, 0, 0, 'экономия')];
    const result = detectDataAnomalies(rows);
    expect(result.get(0)?.some(a => a.type === 'ZERO_ECONOMY_WITH_FACT')).toBe(true);
  });

  it('handles empty/short rows gracefully', () => {
    const rows = [[], [null, null], makeRow(100, 50)];
    const result = detectDataAnomalies(rows);
    // No crash, short rows skipped
    expect(result.size).toBe(0); // 100->50 is normal
  });
});

// ────────────────────────────────────────────────────────────
// 6. Behavioral Anomaly Detection (Level 2)
// ────────────────────────────────────────────────────────────

describe('detectBehavioralAnomalies', () => {
  function makeRow(plan: number, fact: number): unknown[] {
    const row = new Array(32).fill(null);
    row[10] = plan;
    row[24] = fact;
    return row;
  }

  it('detects SUDDEN_INCREASE in plan', () => {
    const prev = [makeRow(1_000_000, 0)];
    const curr = [makeRow(2_000_000, 0)]; // +100%
    const result = detectBehavioralAnomalies(curr, prev);
    expect(result.some(a => a.type === 'SUDDEN_INCREASE')).toBe(true);
  });

  it('detects STATUS_REGRESSION (fact disappears)', () => {
    const prev = [makeRow(1_000_000, 800_000)];
    const curr = [makeRow(1_000_000, 0)];
    const result = detectBehavioralAnomalies(curr, prev);
    expect(result.some(a => a.type === 'STATUS_REGRESSION')).toBe(true);
  });

  it('returns empty for null previous', () => {
    const curr = [makeRow(1_000_000, 0)];
    expect(detectBehavioralAnomalies(curr, null)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// 7. Composite Score
// ────────────────────────────────────────────────────────────

describe('computeCompositeScore', () => {
  it('perfect score: ОТЛИЧНОЕ + НИЗКИЙ + minimal anomalies', () => {
    const result = computeCompositeScore('ОТЛИЧНОЕ', 'НИЗКИЙ', 'ИНФОРМАЦИЯ', 'ИНФОРМАЦИЯ');
    expect(result.score).toBeLessThan(10);
    expect(result.grade).toBe('A');
  });

  it('worst score: КРИТИЧЕСКОЕ + КРИТИЧЕСКИЙ + critical anomalies', () => {
    const result = computeCompositeScore('КРИТИЧЕСКОЕ', 'КРИТИЧЕСКИЙ', 'КРИТИЧЕСКАЯ', 'КРИТИЧЕСКАЯ');
    expect(result.score).toBeGreaterThan(60);
    expect(result.grade).toBe('F');
  });

  it('weights sum to 1.0', () => {
    const total = 0.40 + 0.25 + 0.20 + 0.15;
    expect(total).toBeCloseTo(1.0);
  });

  it('returns correct components', () => {
    const result = computeCompositeScore('СРЕДНЕЕ', 'ПОВЫШЕННЫЙ', 'ВЫСОКАЯ', 'СРЕДНЯЯ');
    expect(result.components.execution.level).toBe('СРЕДНЕЕ');
    expect(result.components.epRisk.level).toBe('ПОВЫШЕННЫЙ');
    expect(result.components.anomaly.severity).toBe('ВЫСОКАЯ');
    expect(result.components.compliance.severity).toBe('СРЕДНЯЯ');
  });
});

// ────────────────────────────────────────────────────────────
// 8. Noise Map
// ────────────────────────────────────────────────────────────

describe('buildNoiseMap', () => {
  it('groups anomalies by type', () => {
    const anomalies = new Map<number, Array<{ type: string; rowIndex: number; details: string; severity: string }>>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anomalies.set(0, [{ type: 'EXACT_MATCH', rowIndex: 0, details: 'test1', severity: 'СРЕДНЯЯ' } as any]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anomalies.set(1, [{ type: 'EXACT_MATCH', rowIndex: 1, details: 'test2', severity: 'СРЕДНЯЯ' } as any]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = buildNoiseMap(anomalies as any);
    const exactGroup = result.find(g => g.key === 'data_EXACT_MATCH');
    expect(exactGroup).toBeDefined();
    expect(exactGroup!.count).toBe(2);
    expect(exactGroup!.rows).toEqual([0, 1]);
  });

  it('sorts by severity then count', () => {
    const anomalies = new Map<number, Array<{ type: string; rowIndex: number; details: string; severity: string }>>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anomalies.set(0, [{ type: 'NEGATIVE_PLAN', rowIndex: 0, details: '', severity: 'КРИТИЧЕСКАЯ' } as any]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anomalies.set(1, [{ type: 'EXACT_MATCH', rowIndex: 1, details: '', severity: 'СРЕДНЯЯ' } as any]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    anomalies.set(2, [{ type: 'EXACT_MATCH', rowIndex: 2, details: '', severity: 'СРЕДНЯЯ' } as any]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = buildNoiseMap(anomalies as any);
    expect(result[0].key).toBe('data_NEGATIVE_PLAN'); // КРИТИЧЕСКАЯ first
  });
});

// ────────────────────────────────────────────────────────────
// 9. Full Dataset Analysis (Integration)
// ────────────────────────────────────────────────────────────

describe('analyzeDataset', () => {
  function makeRow(plan: number, fact: number): unknown[] {
    const row = new Array(32).fill(null);
    row[10] = plan;
    row[24] = fact;
    return row;
  }

  it('produces complete analysis result', () => {
    const rows = [
      makeRow(1_000_000, 900_000),
      makeRow(500_000, 500_000),     // EXACT_MATCH
      makeRow(2_000_000, 0),
      makeRow(0, 100_000),           // FACT_NO_PLAN
      makeRow(300_000, 280_000),
      makeRow(1_500_000, 1_400_000),
    ];

    const result = analyzeDataset({
      rows,
      execCountPct: 0.65,
      epSharePct: 0.35,
    });

    // All sections present
    expect(result.benford).toBeDefined();
    expect(result.benford.sampleSize).toBeGreaterThan(0);
    expect(result.outliers).toBeDefined();
    expect(result.anomalies).toBeDefined();
    expect(result.anomalies.dataAnomalies.length).toBeGreaterThan(0); // EXACT_MATCH + FACT_NO_PLAN
    expect(result.compositeScore).toBeDefined();
    expect(result.compositeScore.grade).toBeDefined();
    expect(result.noiseMap.length).toBeGreaterThan(0);
    expect(result.epRisk.level).toBe('УМЕРЕННЫЙ'); // 0.35 - 0.30 = 0.05 ≤ 0.10
    expect(result.executionLevel).toBe('СРЕДНЕЕ'); // 0.65
  });

  it('handles empty dataset', () => {
    const result = analyzeDataset({
      rows: [],
      execCountPct: 0,
      epSharePct: 0,
    });

    expect(result.benford.sampleSize).toBe(0);
    expect(result.outliers.count).toBe(0);
    expect(result.anomalies.totalCount).toBe(0);
    expect(result.compositeScore.grade).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────
// 10. Seasonal Anomaly Detection
// ────────────────────────────────────────────────────────────

describe('detectSeasonalAnomalies', () => {
  /**
   * Build a minimal row with the columns needed for seasonal checks.
   * C=2 subordinate, D=3 description, E=4 program, L=11 method,
   * N=13 plan date, Q=16 fact date, U=20 status
   */
  function makeSeasonalRow(opts: {
    subordinate?: string;
    description?: string;
    program?: string;
    method?: string;
    planDate?: string;
    factDate?: string;
    status?: string;
  }): unknown[] {
    const row = new Array(32).fill(null);
    row[2] = opts.subordinate ?? '';
    row[3] = opts.description ?? '';
    row[4] = opts.program ?? '';
    row[11] = opts.method ?? '';
    row[13] = opts.planDate ?? '';
    row[16] = opts.factDate ?? '';
    row[20] = opts.status ?? '';
    return row;
  }

  // 1. SCHOOL_REPAIR_OUTSIDE_HOLIDAYS
  describe('SCHOOL_REPAIR_OUTSIDE_HOLIDAYS', () => {
    it('flags school repair during school year (October)', () => {
      const rows = [makeSeasonalRow({
        subordinate: 'БУ Школа №1',
        description: 'Ремонт здания',
        factDate: '15.10.2025',
      })];
      const result = detectSeasonalAnomalies(rows, 'DEPT1');
      const found = result.filter(r => r.type === 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS');
      expect(found.length).toBe(1);
      expect(found[0].severity).toBe('critical');
      expect(found[0].rowIndex).toBe(0);
    });

    it('does NOT flag school repair during summer holidays (July)', () => {
      const rows = [makeSeasonalRow({
        subordinate: 'БУ Школа №1',
        description: 'Ремонт здания',
        factDate: '15.07.2025',
      })];
      const result = detectSeasonalAnomalies(rows, 'DEPT1');
      expect(result.filter(r => r.type === 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS').length).toBe(0);
    });

    it('matches via program column (образование)', () => {
      const rows = [makeSeasonalRow({
        description: 'Ремонт кровли',
        program: 'Модернизация образования',
        factDate: '20.09.2025',
      })];
      const result = detectSeasonalAnomalies(rows);
      expect(result.some(r => r.type === 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS')).toBe(true);
    });
  });

  // 2. LATE_SCHOOL_FOOD_CONTRACT
  describe('LATE_SCHOOL_FOOD_CONTRACT', () => {
    it('flags unsigned school food contract after Aug 15', () => {
      const rows = [makeSeasonalRow({
        subordinate: 'МКУ Школа №3',
        description: 'Организация питания учащихся',
        planDate: '01.03.2025',
        status: 'в работе',
      })];
      const refDate = new Date(2025, 7, 20); // August 20
      const result = detectSeasonalAnomalies(rows, 'DEPT1', refDate);
      const found = result.filter(r => r.type === 'LATE_SCHOOL_FOOD_CONTRACT');
      expect(found.length).toBe(1);
      expect(found[0].severity).toBe('high');
    });

    it('does NOT flag signed food contract', () => {
      const rows = [makeSeasonalRow({
        subordinate: 'МКУ Школа №3',
        description: 'Организация питания учащихся',
        planDate: '01.03.2025',
        status: 'Контракт заключен',
      })];
      const refDate = new Date(2025, 8, 1); // September 1
      const result = detectSeasonalAnomalies(rows, 'DEPT1', refDate);
      expect(result.filter(r => r.type === 'LATE_SCHOOL_FOOD_CONTRACT').length).toBe(0);
    });

    it('does NOT flag before deadline', () => {
      const rows = [makeSeasonalRow({
        subordinate: 'МКУ Школа №3',
        description: 'Организация питания учащихся',
        planDate: '01.03.2025',
        status: 'в работе',
      })];
      const refDate = new Date(2025, 6, 10); // July 10
      const result = detectSeasonalAnomalies(rows, 'DEPT1', refDate);
      expect(result.filter(r => r.type === 'LATE_SCHOOL_FOOD_CONTRACT').length).toBe(0);
    });
  });

  // 3. WINTER_ROAD_WORK
  describe('WINTER_ROAD_WORK', () => {
    it('flags road work in January', () => {
      const rows = [makeSeasonalRow({
        description: 'Ремонт дороги по ул. Ленина',
        factDate: '20.01.2026',
      })];
      const result = detectSeasonalAnomalies(rows);
      const found = result.filter(r => r.type === 'WINTER_ROAD_WORK');
      expect(found.length).toBe(1);
      expect(found[0].severity).toBe('critical');
    });

    it('flags asphalt work in December', () => {
      const rows = [makeSeasonalRow({
        description: 'Асфальтирование территории',
        factDate: '05.12.2025',
      })];
      const result = detectSeasonalAnomalies(rows);
      expect(result.some(r => r.type === 'WINTER_ROAD_WORK')).toBe(true);
    });

    it('does NOT flag road work in summer', () => {
      const rows = [makeSeasonalRow({
        description: 'Ремонт дороги по ул. Ленина',
        factDate: '15.06.2025',
      })];
      const result = detectSeasonalAnomalies(rows);
      expect(result.filter(r => r.type === 'WINTER_ROAD_WORK').length).toBe(0);
    });
  });

  // 4. LATE_FUEL_PROCUREMENT
  describe('LATE_FUEL_PROCUREMENT', () => {
    it('flags unsigned fuel contract after September 1', () => {
      const rows = [makeSeasonalRow({
        description: 'Поставка угля для котельной',
        planDate: '01.05.2025',
        status: 'в работе',
      })];
      const refDate = new Date(2025, 8, 15); // September 15
      const result = detectSeasonalAnomalies(rows, 'DEPT1', refDate);
      const found = result.filter(r => r.type === 'LATE_FUEL_PROCUREMENT');
      expect(found.length).toBe(1);
      expect(found[0].severity).toBe('critical');
    });

    it('does NOT flag signed fuel contract', () => {
      const rows = [makeSeasonalRow({
        description: 'Поставка угля для котельной',
        status: 'Исполнен',
      })];
      const refDate = new Date(2025, 9, 1);
      const result = detectSeasonalAnomalies(rows, 'DEPT1', refDate);
      expect(result.filter(r => r.type === 'LATE_FUEL_PROCUREMENT').length).toBe(0);
    });

    it('matches ГСМ and дизельное топливо', () => {
      const rows = [
        makeSeasonalRow({ description: 'Закупка ГСМ', status: '' }),
        makeSeasonalRow({ description: 'Дизельное топливо для техники', status: '' }),
      ];
      const refDate = new Date(2025, 9, 1); // October 1
      const result = detectSeasonalAnomalies(rows, 'DEPT1', refDate);
      expect(result.filter(r => r.type === 'LATE_FUEL_PROCUREMENT').length).toBe(2);
    });
  });

  // 5. BOILER_REPAIR_HEATING_SEASON
  describe('BOILER_REPAIR_HEATING_SEASON', () => {
    it('flags boiler repair in November', () => {
      const rows = [makeSeasonalRow({
        description: 'Ремонт котельной №5',
        factDate: '10.11.2025',
      })];
      const result = detectSeasonalAnomalies(rows);
      const found = result.filter(r => r.type === 'BOILER_REPAIR_HEATING_SEASON');
      expect(found.length).toBe(1);
      expect(found[0].severity).toBe('high');
    });

    it('does NOT flag boiler repair in summer', () => {
      const rows = [makeSeasonalRow({
        description: 'Ремонт котельной №5',
        factDate: '15.07.2025',
      })];
      const result = detectSeasonalAnomalies(rows);
      expect(result.filter(r => r.type === 'BOILER_REPAIR_HEATING_SEASON').length).toBe(0);
    });

    it('requires both boiler AND repair keywords', () => {
      const rows = [makeSeasonalRow({
        description: 'Обслуживание котельной',
        factDate: '10.11.2025',
      })];
      const result = detectSeasonalAnomalies(rows);
      // "обслуживание" does not match /ремонт|модерниз|реконструк/
      expect(result.filter(r => r.type === 'BOILER_REPAIR_HEATING_SEASON').length).toBe(0);
    });
  });

  // 6. Q4_SPENDING_SPIKE
  describe('Q4_SPENDING_SPIKE', () => {
    it('flags when > 40% of contracts in Q4', () => {
      const rows = [
        makeSeasonalRow({ factDate: '15.03.2025' }),
        makeSeasonalRow({ factDate: '20.10.2025' }),
        makeSeasonalRow({ factDate: '05.11.2025' }),
        makeSeasonalRow({ factDate: '25.12.2025' }),
      ];
      // 3 out of 4 are Q4 = 75%
      const result = detectSeasonalAnomalies(rows, 'DEPT1');
      const found = result.filter(r => r.type === 'Q4_SPENDING_SPIKE');
      expect(found.length).toBe(1);
      expect(found[0].severity).toBe('high');
      expect(found[0].rowIndex).toBe(-1);
      expect(found[0].details.q4Share).toBe(0.75);
    });

    it('does NOT flag when Q4 share <= 40%', () => {
      const rows = [
        makeSeasonalRow({ factDate: '15.01.2025' }),
        makeSeasonalRow({ factDate: '20.04.2025' }),
        makeSeasonalRow({ factDate: '05.07.2025' }),
        makeSeasonalRow({ factDate: '25.10.2025' }),
        makeSeasonalRow({ factDate: '10.08.2025' }),
      ];
      // 1 out of 5 in Q4 = 20%
      const result = detectSeasonalAnomalies(rows, 'DEPT1');
      expect(result.filter(r => r.type === 'Q4_SPENDING_SPIKE').length).toBe(0);
    });
  });

  // 7. DECEMBER_RUSH_CONTRACT
  describe('DECEMBER_RUSH_CONTRACT', () => {
    it('flags contract signed fast in December', () => {
      const rows = [makeSeasonalRow({
        description: 'Закупка оборудования',
        planDate: '10.12.2025',
        factDate: '18.12.2025',
        status: 'Контракт подписан',
      })];
      const result = detectSeasonalAnomalies(rows);
      const found = result.filter(r => r.type === 'DECEMBER_RUSH_CONTRACT');
      expect(found.length).toBe(1);
      expect(found[0].severity).toBe('medium');
      expect(found[0].details.daysDiff).toBe(8);
    });

    it('does NOT flag when gap >= 15 days', () => {
      const rows = [makeSeasonalRow({
        description: 'Закупка оборудования',
        planDate: '01.12.2025',
        factDate: '25.12.2025',
        status: 'Контракт подписан',
      })];
      const result = detectSeasonalAnomalies(rows);
      expect(result.filter(r => r.type === 'DECEMBER_RUSH_CONTRACT').length).toBe(0);
    });

    it('does NOT flag fast contract in non-December month', () => {
      const rows = [makeSeasonalRow({
        description: 'Закупка оборудования',
        planDate: '01.06.2025',
        factDate: '05.06.2025',
        status: 'Контракт подписан',
      })];
      const result = detectSeasonalAnomalies(rows);
      expect(result.filter(r => r.type === 'DECEMBER_RUSH_CONTRACT').length).toBe(0);
    });
  });

  // Integration: empty rows
  it('returns empty array for empty dataset', () => {
    const result = detectSeasonalAnomalies([], 'DEPT1');
    expect(result).toEqual([]);
  });

  // Integration: multiple signals on same row
  it('can detect multiple signals on the same row', () => {
    // A school repair in December that was also rushed — should trigger both
    // SCHOOL_REPAIR_OUTSIDE_HOLIDAYS and DECEMBER_RUSH_CONTRACT
    const rows = [makeSeasonalRow({
      subordinate: 'БУ Гимназия №2',
      description: 'Ремонт спортзала',
      planDate: '05.12.2025',
      factDate: '12.12.2025',
      status: 'Контракт заключен',
    })];
    const result = detectSeasonalAnomalies(rows, 'DEPT_EDU');
    const types = result.map(r => r.type);
    expect(types).toContain('SCHOOL_REPAIR_OUTSIDE_HOLIDAYS');
    expect(types).toContain('DECEMBER_RUSH_CONTRACT');
  });
});

// ────────────────────────────────────────────────────────────
// Suspicious Splitting Detection
// ────────────────────────────────────────────────────────────

describe('detectSuspiciousSplitting', () => {
  // DEPT_COLUMNS: METHOD=11, TOTAL_PLAN=10, SUBJECT=6, DESCRIPTION=3, SUBORDINATE=2
  function makeSplitRow(subject: string, planTotal: number, subordinate = 'Школа №1'): unknown[] {
    const row = new Array(32).fill(null);
    row[2] = subordinate;       // C = subordinate
    row[3] = subject;           // D = description (fallback)
    row[6] = subject;           // G = subject
    row[10] = planTotal;        // K = plan total
    row[11] = 'ЕП';            // L = method
    return row;
  }

  it('detects 3+ similar EP rows < 600K from same subordinate', () => {
    const rows = [
      makeSplitRow('Поставка канцелярских товаров партия 1', 200_000),
      makeSplitRow('Поставка канцелярских товаров партия 2', 250_000),
      makeSplitRow('Поставка канцелярских товаров партия 3', 200_000),
    ];
    const result = detectSuspiciousSplitting(rows);
    expect(result.length).toBe(1);
    expect(result[0].count).toBe(3);
    expect(result[0].totalAmount).toBe(650_000);
    expect(result[0].rowIndices).toEqual([0, 1, 2]);
  });

  it('does NOT flag if less than 3 similar rows', () => {
    const rows = [
      makeSplitRow('Поставка канцелярских товаров партия 1', 200_000),
      makeSplitRow('Поставка канцелярских товаров партия 2', 250_000),
    ];
    const result = detectSuspiciousSplitting(rows);
    expect(result.length).toBe(0);
  });

  it('does NOT flag if plan >= 600K', () => {
    const rows = [
      makeSplitRow('Поставка канцелярских товаров партия 1', 600_000),
      makeSplitRow('Поставка канцелярских товаров партия 2', 600_000),
      makeSplitRow('Поставка канцелярских товаров партия 3', 600_000),
    ];
    const result = detectSuspiciousSplitting(rows);
    expect(result.length).toBe(0);
  });

  it('does NOT flag non-EP rows', () => {
    const rows = [
      makeSplitRow('Поставка канцелярских товаров партия 1', 200_000),
      makeSplitRow('Поставка канцелярских товаров партия 2', 250_000),
      makeSplitRow('Поставка канцелярских товаров партия 3', 200_000),
    ];
    // Change method to ЭА
    rows.forEach(r => { r[11] = 'ЭА'; });
    const result = detectSuspiciousSplitting(rows);
    expect(result.length).toBe(0);
  });

  it('does NOT flag if subjects are different', () => {
    const rows = [
      makeSplitRow('Поставка ГСМ', 200_000),
      makeSplitRow('Ремонт здания', 250_000),
      makeSplitRow('Уборка территории', 200_000),
    ];
    const result = detectSuspiciousSplitting(rows);
    expect(result.length).toBe(0);
  });

  it('separates groups by subordinate', () => {
    const rows = [
      makeSplitRow('Поставка канцелярских товаров партия 1', 200_000, 'Школа №1'),
      makeSplitRow('Поставка канцелярских товаров партия 2', 250_000, 'Школа №1'),
      makeSplitRow('Поставка канцелярских товаров партия 3', 200_000, 'Школа №2'),
    ];
    // Only 2 from Школа №1, 1 from Школа №2 — neither group has 3+
    const result = detectSuspiciousSplitting(rows);
    expect(result.length).toBe(0);
  });

  it('does NOT flag if total amount < 600K (splitting is harmless)', () => {
    const rows = [
      makeSplitRow('Поставка канцелярских товаров партия 1', 100_000),
      makeSplitRow('Поставка канцелярских товаров партия 2', 100_000),
      makeSplitRow('Поставка канцелярских товаров партия 3', 100_000),
    ];
    // Total = 300K < 600K — no point in splitting, it's under the limit anyway
    const result = detectSuspiciousSplitting(rows);
    expect(result.length).toBe(0);
  });

  it('handles empty rows gracefully', () => {
    const result = detectSuspiciousSplitting([[], [null], []]);
    expect(result.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────
// Systemic Anomalies (new: SUBORDINATE_CONCENTRATION, VAGUE_HIGH_VALUE, CANCELED_WITH_FACT)
// ────────────────────────────────────────────────────────────

describe('detectSystemicAnomalies — new signals', () => {
  function makeRow(overrides: Partial<Record<number, unknown>> = {}): unknown[] {
    const row = new Array(32).fill(null);
    row[10] = 1_000_000; // K = plan total (default 1M)
    for (const [k, v] of Object.entries(overrides)) {
      row[Number(k)] = v;
    }
    return row;
  }

  // Helpers: benford and dataAnomalies needed for detectSystemicAnomalies signature
  const emptyBenford = {
    mad: 0, observed: [], expected: [], sampleSize: 0, conformity: 'close' as const,
  };
  const emptyDataAnomalies = new Map();

  it('detects SUBORDINATE_CONCENTRATION when one sub has >80% budget', () => {
    // 10 rows: 9 for "Школа №1" (9M), 1 for "Школа №2" (1M) = 90% concentration
    const rows = [
      ...Array.from({ length: 9 }, () => makeRow({ 2: 'Школа №1' })),
      makeRow({ 2: 'Школа №2' }),
    ];
    const result = detectSystemicAnomalies(emptyDataAnomalies, emptyBenford, rows);
    const sub = result.find(a => a.type === 'SUBORDINATE_CONCENTRATION');
    expect(sub).toBeDefined();
    expect(sub!.details).toContain('90%');
    expect(sub!.affectedRows.length).toBe(9);
  });

  it('does NOT flag SUBORDINATE_CONCENTRATION when distribution is balanced', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => makeRow({ 2: 'Школа №1' })),
      ...Array.from({ length: 5 }, () => makeRow({ 2: 'Школа №2' })),
    ];
    const result = detectSystemicAnomalies(emptyDataAnomalies, emptyBenford, rows);
    expect(result.find(a => a.type === 'SUBORDINATE_CONCENTRATION')).toBeUndefined();
  });

  it('detects VAGUE_HIGH_VALUE on expensive rows with short descriptions', () => {
    const rows = [
      makeRow({ 3: 'Закупка', 6: '', 10: 10_000_000 }), // short desc, 10M
      makeRow({ 3: 'Поставка компьютерного оборудования для школы №3 с монтажом', 6: 'ПК', 10: 8_000_000 }), // detailed, ok
    ];
    const result = detectSystemicAnomalies(emptyDataAnomalies, emptyBenford, rows);
    const vague = result.find(a => a.type === 'VAGUE_HIGH_VALUE');
    expect(vague).toBeDefined();
    expect(vague!.affectedRows).toEqual([0]);
  });

  it('does NOT flag VAGUE_HIGH_VALUE on cheap rows', () => {
    const rows = [
      makeRow({ 3: 'Закупка', 6: '', 10: 100_000 }), // short but cheap
    ];
    const result = detectSystemicAnomalies(emptyDataAnomalies, emptyBenford, rows);
    expect(result.find(a => a.type === 'VAGUE_HIGH_VALUE')).toBeUndefined();
  });

  it('detects CANCELED_WITH_FACT when canceled row has factual amounts', () => {
    const rows = [
      makeRow({ 20: 'отменена', 24: 500_000 }), // canceled with 500K fact
      makeRow({ 20: 'подписан', 24: 500_000 }),  // signed, ok
    ];
    const result = detectSystemicAnomalies(emptyDataAnomalies, emptyBenford, rows);
    const canceled = result.find(a => a.type === 'CANCELED_WITH_FACT');
    expect(canceled).toBeDefined();
    expect(canceled!.affectedRows).toEqual([0]);
  });

  it('does NOT flag CANCELED_WITH_FACT if fact < 100K', () => {
    const rows = [
      makeRow({ 20: 'отменена', 24: 50_000 }), // canceled but small fact
    ];
    const result = detectSystemicAnomalies(emptyDataAnomalies, emptyBenford, rows);
    expect(result.find(a => a.type === 'CANCELED_WITH_FACT')).toBeUndefined();
  });
});
