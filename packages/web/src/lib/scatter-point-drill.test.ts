import { describe, expect, it } from 'vitest';
import type { LimitComparisonPoint } from '@aemr/shared';
import { ORG_ITSELF_SENTINEL } from '@aemr/shared';
import { scatterPointDrill } from './scatter-point-drill';

const makePoint = (overrides: Partial<LimitComparisonPoint> = {}): LimitComparisonPoint => ({
  id: '173/18', rowIndex: 71, department: 'УЭР',
  subject: 'Ноутбуки для школы', subordinate: 'Школа 1',
  planTotal: 1200, factTotal: 900, limitReductionPercent: 25,
  approvedEconomy: 0, activityType: 'current_non_program', procurementType: 'ЭА',
  planDate: '2026-02-04', factDate: '2026-03-01', planYear: 2026,
  month: 2, quarter: 1, ...overrides,
});

describe('C04.03: scatter point → same source row context', () => {
  it('carries the original department, school, month, year, method and subject', () => {
    const target = scatterPointDrill(makePoint());
    expect(target.page).toBe('data');
    expect(target.filters).toMatchObject({
      department: 'УЭР', subordinate: 'Школа 1',
      year: 2026, months: [2], procurement: 'competitive',
      activity: 'current_non_program',
      search: 'Ноутбуки для школы',
    });
    expect(target.filters).not.toHaveProperty('period'); // Month is more precise than Q1
  });

  it('does not turn an unknown method into a competitive procedure', () => {
    const target = scatterPointDrill(makePoint({ procurementType: 'unknown' }));
    expect(target.filters).not.toHaveProperty('procurement');
    expect(target.filters.months).toEqual([2]);
    expect(target.filters.activity).toBe('current_non_program');
  });

  it('keeps a confirmed sole-source method instead of changing it to tenders', () => {
    expect(scatterPointDrill(makePoint({ procurementType: 'ЕП' })).filters.procurement).toBe('single');
  });

  it('uses the canonical org-itself sentinel for rows without a subordinate', () => {
    expect(scatterPointDrill(makePoint({ subordinate: '' })).filters.subordinate).toBe(ORG_ITSELF_SENTINEL);
  });
});
