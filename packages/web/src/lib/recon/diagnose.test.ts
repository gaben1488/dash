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
  it('ok и neutral → «Нет расхождений» (info), даже при больших дельтах', () => {
    expect(diagnoseDelta(makeRow({ ...withKind('ok'), planDeltaPct: 90 }))).toMatchObject({ source: 'Нет расхождений', severity: 'info' });
    expect(diagnoseDelta(makeRow(withKind('neutral'))).severity).toBe('info');
  });

  it('факт сильно завышен расчётом (Δ>50% и >1.5× СВОД) → «Детекция факта» (error)', () => {
    const diag = diagnoseDelta(makeRow({ factDeltaPct: 80, fullFactOfficial: 100, fullFactCalculated: 180 }));
    expect(diag).toMatchObject({ source: 'Детекция факта', severity: 'error' });
  });

  it('план расходится > 10% → «Классификация строк» (error)', () => {
    const diag = diagnoseDelta(makeRow({ planDeltaPct: -15 }));
    expect(diag).toMatchObject({ source: 'Классификация строк', severity: 'error' });
  });

  it('план близок (<5%), факт расходится (>5%) → «Факт-классификация» (warn)', () => {
    const diag = diagnoseDelta(makeRow({ planDeltaPct: 2, factDeltaPct: 12 }));
    expect(diag).toMatchObject({ source: 'Факт-классификация', severity: 'warn' });
  });

  it('расхождение экономии (>10% и |Δ|>100) → «Расчёт экономии» (warn)', () => {
    const diag = diagnoseDelta(makeRow({ planDeltaPct: 7, factDeltaPct: 0, ecoTotalOfficial: 1000, ecoTotalCalculated: 800, ecoDelta: -200 }));
    expect(diag).toMatchObject({ source: 'Расчёт экономии', severity: 'warn' });
  });

  it('малые дельты (<5% оба) → «Округление / граничные строки» (info)', () => {
    const diag = diagnoseDelta(makeRow({ planDeltaPct: 1, factDeltaPct: 2 }));
    expect(diag).toMatchObject({ source: 'Округление / граничные строки', severity: 'info' });
  });

  it('расходятся и план и факт без явного паттерна → «Комплексное расхождение» (error)', () => {
    const diag = diagnoseDelta(makeRow({ planDeltaPct: 7, factDeltaPct: 8 }));
    expect(diag).toMatchObject({ source: 'Комплексное расхождение', severity: 'error' });
  });

  it('нулевая официальная экономия не приводит к делению на ноль', () => {
    const diag = diagnoseDelta(makeRow({ planDeltaPct: 7, factDeltaPct: 0, ecoTotalOfficial: 0, ecoDelta: 500 }));
    expect(diag.source).toBe('Комплексное расхождение');
  });
});
