import { expect, it } from 'vitest';
import { scatterScope } from './scatter-scope';

it('sends actual N-based months, year and institution instead of broadening to a quarter', () => {
  const base = { year: 2026 as const, period: 'q1', periodMode: 'explicit',
    activeMonths: new Set([2]), selectedDepartments: new Set(['УЭР']), selectedSubordinates: new Set(['Школа 1']) };
  expect(scatterScope(base)).toMatchObject({ year: '2026', months: '2', dept: 'УЭР', subordinate: 'Школа 1' });
  const weekly = scatterScope({ ...base, periodMode: 'week' });
  expect(weekly).not.toHaveProperty('months');
  expect(weekly).toHaveProperty('period', 'q1'); // Same quarter as other dashboard cards
  expect(scatterScope({ ...base, periodMode: 'week', period: 'year' })).not.toHaveProperty('period');
  expect(scatterScope({ ...base, year: 'all' })).toHaveProperty('year', 'all');
});
