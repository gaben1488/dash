// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReportAssuranceSchema, type ReportAssurance } from '@aemr/shared';
import { ReportAssurancePanel } from './ReportAssurancePanel';

afterEach(cleanup);
const value: ReportAssurance = {
  contract: 'actionable-assurance-v1', fully_automated: false,
  user_action_count: 1, engine_action_count: 0, active_recommendations: 0,
  link_status_counts: {}, action_status_counts: {}, meaning: 'Verification is scoped.',
  actions: [{ signal_id: 'SIG-one', code: 'FACT_MONEY_WITHOUT_DATE', severity: 'needs_attention',
    owner_kind: 'SOURCE_OWNER', owner: 'УЭР', user_action_required: true,
    title: 'Сумма без даты', cause: 'Дата отсутствует', report_effect: 'Факт не увеличен',
    action: 'Внесите подтверждённую дату в Q', resolved_when: 'Дата появилась',
    recommendation_id: null, source_row_key: 'book::ВСЕ::4::1', locations: [{
      source_id: 'book', sheet: 'ВСЕ', sheet_id: 17, row: 4, column: 'Q', a1: 'Q4',
      url: 'https://docs.google.com/spreadsheets/d/book/edit#gid=17&range=Q4',
      subject: 'Синтетическая бумага', business_id: '1',
    }],
  }],
};
it('shows concrete ownership, location and action without a grey-only status', () => {
  render(<ReportAssurancePanel value={value} label="Выбранный выпуск" />);
  expect(screen.getByRole('heading', { name: 'Нужны уточнения в первичных данных: 1' })).toBeTruthy();
  expect(screen.getByText(/Сумма без даты.*УЭР.*Q4/)).toBeTruthy();
  // Details may be collapsed, but the exact address is already present in its summary.
  expect(screen.getByText('Внесите подтверждённую дату в Q', { exact: false })).toBeTruthy();
});
it('does not offer an injected source link as a clickable action', () => {
  const unsafe = structuredClone(value); unsafe.actions[0]!.locations[0]!.url = 'javascript:alert(1)';
  const { container } = render(<ReportAssurancePanel value={unsafe} label="Выпуск" />);
  expect(container.querySelector('a')).toBeNull();
});
it('keeps the server assurance in the parsed response rather than silently stripping it', () => {
  expect(ReportAssuranceSchema.parse(value)).toEqual(value);
});
