// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TrustPage } from './Trust';

const fixture = vi.hoisted(() => ({
  dashboard: {
    trust: { overall: 91, components: [
      { name: 'data_quality', label: 'Качество данных', score: 91, weight: 30, issues: 0, criticalIssues: 0, details: 'district' },
      { name: 'formula_integrity', label: 'Целостность формул', score: 91, weight: 25, issues: 0, criticalIssues: 0, details: 'district' },
    ] },
  },
  filtered: { hasDeptFilter: true, hasSubFilter: false, depts: [] as unknown[], issues: [] as Record<string, unknown>[], deltas: [] },
}));
vi.mock('../store', () => ({ useStore: () => ({ dashboardData: fixture.dashboard, navigateTo: vi.fn(), refresh: vi.fn(), loading: false }) }));
vi.mock('../hooks/useFilteredData', () => ({ useFilteredData: () => fixture.filtered }));

afterEach(() => { cleanup(); fixture.filtered.depts = []; fixture.filtered.issues = []; });

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

describe('TrustPage explanations match scoring eligibility', () => {
  it('excludes a saved false positive and header diagnostic from factors and component detail without dropping history', () => {
    fixture.filtered.issues = [
      ...['open', 'false_positive', 'resolved', 'wont_fix'].map(status => ({
        id: status, title: `Проверка ${status}`, severity: 'critical', status, group: 'data_integrity',
      })),
      { title: 'Историческая шапка', severity: 'critical', group: 'data_integrity',
        checkId: 'formula_overwritten', sheet: 'УЭР', row: 1, cell: 'AA1' },
    ];
    fixture.filtered.depts = [{ department: { id: 'uksimp', name: 'УКСиМП' }, trustScore: 91,
      trustComponents: fixture.dashboard.trust.components }];
    const { container } = render(<TrustPage />);
    expect(screen.getByText(/Для проверки: 3 замечания/)).toBeTruthy();
    expect(screen.queryByText('Проверка false_positive')).toBeNull();
    expect(screen.queryByText('Историческая шапка')).toBeNull();
    fireEvent.click(container.querySelector('button[aria-controls="trust-component-data_quality"]')!);
    const panel = container.querySelector('#trust-component-data_quality')!;
    expect(panel.textContent).toContain('Проверка resolved');
    expect(panel.textContent).toContain('Проверка wont_fix');
    expect(panel.textContent).not.toContain('false_positive');
    expect(panel.textContent).not.toContain('Историческая шапка');
    expect(fixture.filtered.issues).toHaveLength(5);
  });
});

it('renders an unassessed component explicitly without attributing a perfect score to it', () => {
  fixture.filtered.depts = [{ department: { id: 'uksimp', name: 'УКСиМП' }, trustScore: 91,
    trustComponents: [fixture.dashboard.trust.components[0], { ...fixture.dashboard.trust.components[1], score: null }] }];
  const html = renderToStaticMarkup(<TrustPage />);
  expect(html).toContain('Не проверено: Целостность формул');
  expect(html).toContain('не подтверждает достоверность непроверенной части');
  expect(html).not.toContain('NaN');
});