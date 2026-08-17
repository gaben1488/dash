import { describe, it, expect } from 'vitest';
import { selectDatasetAudit, BENFORD_LABELS, type DatasetAnalysisDTO } from './dataset-analyses';

/** Полный ГРБС — форма как в живом /api/dashboard → snapshot.datasetAnalyses.uo */
const fullDept: DatasetAnalysisDTO = {
  benford: {
    mad: 0.0116,
    observed: [0.27, 0.17, 0.12, 0.1, 0.08, 0.07, 0.06, 0.06, 0.07],
    expected: [0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046],
    sampleSize: 4465,
    conformity: 'acceptable',
  },
  outliers: { count: 39, indices: [4, 5], mean: 541.9, stdDev: 2837.9, threshold: 3 },
  compositeScore: {
    score: 37.75,
    grade: 'C',
    components: {
      execution: { raw: 15, weighted: 6, level: 'ХОРОШЕЕ' },
      epRisk: { raw: 100, weighted: 25, level: 'КРИТИЧЕСКИЙ' },
      anomaly: { raw: 30, weighted: 6, severity: 'ВЫСОКАЯ' },
      compliance: { raw: 5, weighted: 0.75, severity: 'ИНФОРМАЦИЯ' },
    },
  },
  epRisk: { epShare: 0.8694, normalShare: 0.3, excess: 0.5694, level: 'КРИТИЧЕСКИЙ' },
  executionLevel: 'ХОРОШЕЕ',
  // 23 сезонные аномалии — как у УО живьём
  seasonalAnomalies: Array.from({ length: 23 }, (_, i) => ({
    type: 'SCHOOL_REPAIR_OUTSIDE_HOLIDAYS',
    severity: 'critical',
    rowIndex: i,
    description: 'Ремонт образовательного учреждения в учебный период',
  })) as DatasetAnalysisDTO['seasonalAnomalies'],
  suspiciousSplitting: [],
};

describe('selectDatasetAudit', () => {
  it('маппит полный ГРБС в строку таблицы', () => {
    const rows = selectDatasetAudit({ uo: fullDept });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.deptId).toBe('uo');
    expect(r.compositeScore).toBe(37.75);
    expect(r.compositeGrade).toBe('C');
    expect(r.benfordConformity).toBe('acceptable');
    expect(r.benfordMad).toBeCloseTo(0.0116);
    expect(r.benfordSampleSize).toBe(4465);
    expect(r.outlierCount).toBe(39);
    // Образовательная развёртка (п.88/24): распределения и параметры z-оценки
    expect(r.benfordObserved).toHaveLength(9);
    expect(r.benfordExpected).toHaveLength(9);
    expect(r.outlierMean).toBeCloseTo(541.9);
    expect(r.outlierStdDev).toBeCloseTo(2837.9);
    expect(r.outlierThreshold).toBe(3);
    expect(r.epRiskLevel).toBe('КРИТИЧЕСКИЙ');
    expect(r.epSharePct).toBeCloseTo(86.94, 1);
    expect(r.seasonalCount).toBe(23);
    expect(r.splittingCount).toBe(0);
  });

  it('терпит отсутствующие поля — null/0 вместо падения', () => {
    // ГРБС, у которого пайплайн посчитал не всё (или поле выпало при сериализации)
    const rows = selectDatasetAudit({ uer: { outliers: { count: 3, indices: [], mean: 0, stdDev: 0, threshold: 3 } } });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.compositeScore).toBeNull();
    expect(r.compositeGrade).toBeNull();
    expect(r.benfordConformity).toBeNull();
    expect(r.benfordMad).toBeNull();
    expect(r.benfordObserved).toBeNull();
    expect(r.benfordExpected).toBeNull();
    expect(r.epRiskLevel).toBeNull();
    expect(r.epSharePct).toBeNull();
    expect(r.outlierCount).toBe(3);
    expect(r.seasonalCount).toBe(0);
    expect(r.splittingCount).toBe(0);
  });

  it('пустой объект и undefined → пустой список', () => {
    expect(selectDatasetAudit({})).toEqual([]);
    expect(selectDatasetAudit(undefined)).toEqual([]);
    expect(selectDatasetAudit(null)).toEqual([]);
  });

  it('сортирует худших первыми (score по убыванию), непосчитанные — в конец', () => {
    const mk = (score: number): DatasetAnalysisDTO => ({
      compositeScore: { ...fullDept.compositeScore!, score },
    });
    const rows = selectDatasetAudit({ a: mk(17.75), b: mk(47.75), c: {}, d: mk(37.75) });
    expect(rows.map((r) => r.deptId)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('BENFORD_LABELS покрывает все 4 уровня conformity', () => {
    for (const k of ['close', 'acceptable', 'marginal', 'nonconforming'] as const) {
      expect(BENFORD_LABELS[k].label.length).toBeGreaterThan(0);
      expect(BENFORD_LABELS[k].hint.length).toBeGreaterThan(0);
    }
    expect(BENFORD_LABELS.nonconforming.tone).toBe('bad');
    expect(BENFORD_LABELS.close.tone).toBe('ok');
  });
});
