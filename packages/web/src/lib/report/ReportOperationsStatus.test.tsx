// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReportOperations } from '@aemr/shared';
import { ReportOperationsStatus } from './ReportOperationsStatus';

afterEach(cleanup);
const value: ReportOperations = {
  checked_at: '2026-10-16T23:03:40+00:00', worker_state: 'idle',
  running_duration_seconds: null, last_cycle_duration_seconds: 209,
  last_success_at: '2026-10-16T23:03:13+00:00', last_success_age_seconds: 27,
  check_stale: false, last_failure_at: '2026-10-15T12:00:00+00:00',
  last_failure_code: 'SOURCE_CHANGED_BEFORE_PUBLICATION', last_failure_stage: 'publication',
  failure_resolved: true, publication_cutoff_at: '2026-10-16T12:00:00+00:00',
};

it('keeps a resolved failure visible alongside fresh observations and distinguishes the Word cutoff', () => {
  render(<Tooltip.Provider><ReportOperationsStatus value={value} apiState="available" /></Tooltip.Provider>);
  expect(screen.getByText('27 с')).toBeTruthy();
  expect(screen.getByText('3 мин 29 с')).toBeTruthy();
  expect(screen.getByText('SOURCE_CHANGED_BEFORE_PUBLICATION')).toBeTruthy();
  expect(screen.getByText(/После отказа подтверждена успешная проверка/)).toBeTruthy();
  expect(screen.getByText(/Свежесть проверки не является датой среза Word/)).toBeTruthy();
});

it('marks an API read failure while preserving the last received measurements', () => {
  render(<Tooltip.Provider><ReportOperationsStatus value={value} apiState="unavailable" /></Tooltip.Provider>);
  expect(screen.getByText(/Последний запрос завершился ошибкой/)).toBeTruthy();
  expect(screen.getByText('3 мин 29 с')).toBeTruthy();
  expect(screen.getByText(/Показаны последние полученные сведения/)).toBeTruthy();
});

it('reports a missing contract as a defect instead of inventing zero durations or successful checks', () => {
  render(<ReportOperationsStatus value={null} apiState="available" />);
  expect(screen.getByText(/Сервер не передал эксплуатационные показатели/)).toBeTruthy();
  expect(screen.queryByText('0 с')).toBeNull();
});
