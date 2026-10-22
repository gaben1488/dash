import { expect, it } from 'vitest';
import { scatterScope } from './scatter-scope';

it('sends actual N-based months, year and institution instead of broadening to a quarter', () => {
  const base = { year: 2026 as const, period: 'q1', periodMode: 'explicit',
    activeMonths: new Set([2]), selectedDepartments: new Set(['УЭР']), selectedSubordinates: new Set(['Школа 1']) };
  expect(scatterScope(base)).toMatchObject({ year: '2026', months: '2', dept: 'УЭР', subordinate: 'Школа 1' });
  // Week roller is not a date filter: neither stale months nor quarter may
  // silently narrow the yearly data, including when a past quarter is stored.
  const weekly = scatterScope({ ...base, periodMode: 'week' });
  expect(weekly).not.toHaveProperty('months');
  expect(weekly).not.toHaveProperty('period');
  expect(scatterScope({ ...base, periodMode: 'week', period: 'q4', activeMonths: new Set([11]) }))
    .not.toHaveProperty('period');
  // An explicit quarter with no selected months must still narrow by quarter.
  expect(scatterScope({ ...base, activeMonths: new Set(), period: 'q3' })).toHaveProperty('period', 'q3');
  expect(scatterScope({ ...base, year: 'all' })).toHaveProperty('year', 'all');
});
