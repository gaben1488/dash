// Юниты lib/recon/diagnose — эвристическая диагностика источника расхождения
// СВОД↔расчёт по управлению (порядок веток: факт-детекция → классификация →
// факт-классификация → экономия → округление → комплексное).
import { describe, expect, it } from 'vitest';
import { diagnoseDelta } from './diagnose';
import type { ReconDeptRow } from './types';

function makeRow(overrides: Partial<ReconDeptRow> = {}): ReconDeptRow {
  return {
    department: 'УЭР',
    fullPlanOfficial: 100,
    fullPlanCalculated: 100,
    planDelta: 0,
    planDeltaPct: 0,
    fullFactOfficial: 50,
    fullFactCalculated: 50,
    factDelta: 0,
    factDeltaPct: 0,
    ecoTotalOfficial: 10,
    ecoTotalCalculated: 10,
    ecoDelta: 0,
    assessment: {
      status: 'Есть расхождение',
      kind: 'warning',
      reason: '',
      maxAbsDelta: 0,
      source: 'methodology',
      sourceLabel: 'Методология',
    },
    ...overrides,
  };
}

function withKind(kind: ReconDeptRow['assessment']['kind']): Partial<ReconDeptRow> {
  return { assessment: { ...makeRow().assessment, kind } };
}

describe('diagnoseDelta', () => {
  it('distinguishes absent comparison from agreement within tolerance', () => {
    expect(diagnoseDelta(makeRow(withKind('ok'))).source).toBe('В пределах допуска');
    expect(diagnoseDelta(makeRow(withKind('neutral'))).source).toBe('Нет данных для сравнения');
  });
  it.each([-80, -15, 2, 12, 80])('does not invent a cause from percentage %s', factDeltaPct => {
    const diagnosis = diagnoseDelta(makeRow({ factDeltaPct, fullFactOfficial: 100, fullFactCalculated: 180 }));
    expect(diagnosis.source).toBe('Причина не установлена');
    expect(diagnosis.detail).toContain('тыс. ₽');
    expect(diagnosis.detail).not.toMatch(/заключённых контрактов|Вероятная причина/);
  });
});