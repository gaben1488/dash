// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SupplierDirectory } from './SupplierDirectory';
import { normalizeMonitoring } from '../../lib/monitoring/contract';
afterEach(cleanup);
it('names refusal separately from an empty directory', () => {
  render(<SupplierDirectory reading={{ rows: [], readAt: null, error: 'Источник недоступен' }} procedures={[]} />);
  expect(screen.getByRole('status').textContent).toContain('не прочитан');
  expect(screen.queryByText('Лист прочитан, записей нет.')).toBeNull();
});
it('keeps source identity and evidence, and does not match a conflicting supplier by name', () => {
  const procedures = normalizeMonitoring({ procedures: [{ winnerInn: '0012345678', winnerName: 'Поставщик', stage: 'awarded', factsEligible: true }] }).procedures;
  const reading = { readAt: '2026-10-08T10:00:00Z', error: null, rows: [{ id: 'P-001', name: 'Поставщик', inn: '0012345678', legalForm: 'ООО', note: null, evidence: 'Проверено по документу источника', address: '_Поставщики!A2', ambiguous: true }] };
  render(<SupplierDirectory reading={reading} procedures={procedures} />);
  expect(screen.getByText('P-001')).toBeTruthy();
  expect(screen.getByText('0012345678')).toBeTruthy();
  expect(screen.getByText('Проверено по документу источника')).toBeTruthy();
  expect(screen.getByText('Связь не определена')).toBeTruthy();
});
