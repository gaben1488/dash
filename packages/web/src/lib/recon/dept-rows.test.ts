// Характеризация lib/recon/dept-rows — фильтр и счёты строк «По управлениям».
import { describe, expect, it } from 'vitest';
import { countReconKinds, filterReconRowsByDepartments } from './dept-rows';
import type { ReconDeptRow } from './types';

function makeRow(department: string, kind: ReconDeptRow['assessment']['kind'] = 'ok'): ReconDeptRow {
  return {
    department,
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
      status: 'Совпадает',
      kind,
      reason: '',
      maxAbsDelta: 0,
      source: 'none',
      sourceLabel: '—',
    },
  };
}

describe('filterReconRowsByDepartments', () => {
  it('undefined rows → пустой массив', () => {
    expect(filterReconRowsByDepartments(undefined, new Set())).toEqual([]);
  });

  it('пустой выбор ГРБС = все строки проходят (тот же массив)', () => {
    const rows = [makeRow('УКС'), makeRow('УО')];
    expect(filterReconRowsByDepartments(rows, new Set())).toBe(rows);
  });

  it('фильтрует по имени управления', () => {
    const rows = [makeRow('УКС'), makeRow('УО'), makeRow('УЗО')];
    const out = filterReconRowsByDepartments(rows, new Set(['УО']));
    expect(out.map(r => r.department)).toEqual(['УО']);
  });

  it('выбор без совпадений → пусто', () => {
    expect(filterReconRowsByDepartments([makeRow('УКС')], new Set(['НЕТ']))).toEqual([]);
  });
});

describe('countReconKinds', () => {
  it('пустой список → нули', () => {
    expect(countReconKinds([])).toEqual({ ok: 0, neutral: 0, warning: 0, high: 0 });
  });

  it('считает строки по видам оценки', () => {
    const rows = [
      makeRow('a', 'ok'), makeRow('b', 'ok'),
      makeRow('c', 'neutral'),
      makeRow('d', 'warning'),
      makeRow('e', 'high'), makeRow('f', 'high'), makeRow('g', 'high'),
    ];
    expect(countReconKinds(rows)).toEqual({ ok: 2, neutral: 1, warning: 1, high: 3 });
  });
});
