// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PublishedWeeklySummarySchema } from '@aemr/shared';
import { PublishedWeeklySummaryCard } from './PublishedWeeklySummaryCard';

afterEach(cleanup);

it('shows exactly the previous verified weekly context and explains late entry', () => {
  const evidence = PublishedWeeklySummarySchema.parse({
    status: 'COMPARABLE', baseline_date: '2026-10-02',
    message: 'Сопоставлено с отчётом.', unmatched_positions: 2,
    recommendations_added: 1, recommendations_revised: 0, procedure_stage_changes: 1,
    totals: [{ label: 'Конкурентные закупки', plan_before: 20, plan_after: 19,
      fact_before: 15, fact_after: 17 }],
    changes: [{ label: 'Изменён плановый квартал', count: 3 }],
    examples: ['УО: бумага — в реестре появилась фактическая дата.'],
  });
  render(<PublishedWeeklySummaryCard value={evidence} />);
  expect(screen.getByText(/Сравнение с 02.10.2026/)).toBeTruthy();
  expect(screen.getByText(/План: 20 → 19/)).toBeTruthy();
  expect(screen.getByText(/Новых в сравнении рекомендаций УЭР: 1/)).toBeTruthy();
  expect(screen.getByText(/с прошлой неделей пока не подтверждена: 2/)).toBeTruthy();
  expect(screen.queryByText(/UNKNOWN|UID|snapshot_id/)).toBeNull();
});

it('renders a clearly separated human explanation when evidence is missing', () => {
  const evidence = PublishedWeeklySummarySchema.parse({
    status: 'NOT_AVAILABLE', baseline_date: null,
    message: 'Нет подтверждённой прошлой недели.', unmatched_positions: 0,
    recommendations_added: 0, recommendations_revised: 0, procedure_stage_changes: 0,
    totals: [], changes: [], examples: [],
  });
  render(<PublishedWeeklySummaryCard value={evidence} />);
  expect(screen.getByText('Нет подтверждённой прошлой недели.')).toBeTruthy();
  expect(screen.queryByText(/План:/)).toBeNull();
});
