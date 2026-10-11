import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrustPage } from './Trust';

const fixture = vi.hoisted(() => ({
  dashboard: {
    trust: { overall: 91, components: [
      { name: 'data_quality', label: 'Качество данных', score: 91, weight: 30, issues: 0, criticalIssues: 0, details: 'district' },
      { name: 'formula_integrity', label: 'Целостность формул', score: 91, weight: 25, issues: 0, criticalIssues: 0, details: 'district' },
    ] },
  },
  filtered: { hasDeptFilter: true, hasSubFilter: false, depts: [] as unknown[], issues: [], deltas: [] },
}));
vi.mock('../store', () => ({ useStore: () => ({ dashboardData: fixture.dashboard, navigateTo: vi.fn(), refresh: vi.fn(), loading: false }) }));
vi.mock('../hooks/useFilteredData', () => ({ useFilteredData: () => fixture.filtered }));

afterEach(() => { fixture.filtered.depts = []; });

describe('TrustPage local scope', () => {
  it('shows unavailable rather than the district score for an empty selected scope', () => {
    const html = renderToStaticMarkup(<TrustPage />);
    expect(html).toContain('Оценка недоступна');
    expect(html).toContain('выбранные управления');
    expect(html).not.toContain('91 из 100');
    expect(html).not.toContain('все управления');
    expect(html).not.toContain('Критически низкая');
  });

  it('explains missing local components without showing a fabricated overall score', () => {
    fixture.filtered.depts = [{ department: { id: 'uksimp', name: 'УКСиМП' }, trustScore: 100,
      trustComponents: [{ ...fixture.dashboard.trust.components[0], score: 100 }] }];
    const html = renderToStaticMarkup(<TrustPage />);
    expect(html).toContain('Недоступные компоненты: Целостность формул');
    expect(html).toContain('Оценка недоступна');
    expect(html).not.toContain('91 из 100');
    expect(html).not.toContain('Качество заполнения книг: 100 из 100');
  });
});
