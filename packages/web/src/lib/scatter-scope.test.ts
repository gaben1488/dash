import { expect, it } from 'vitest';
import { scatterScope } from './scatter-scope';

it('sends actual N-based months, year and institution instead of broadening to a quarter', () => {
  const base = { year: 2026 as const, period: 'q1', periodMode: 'explicit',
    activeMonths: new Set([2]), selectedDepartments: new Set(['УЭР']), selectedSubordinates: new Set(['Школа 1']) };
  expect(scatterScope(base)).toMatchObject({ year: '2026', months: '2', dept: 'УЭР', subordinate: 'Школа 1' });
  expect(scatterScope({ ...base, periodMode: 'week' })).not.toHaveProperty('months');
  expect(scatterScope({ ...base, year: 'all' })).toHaveProperty('year', 'all');
});
