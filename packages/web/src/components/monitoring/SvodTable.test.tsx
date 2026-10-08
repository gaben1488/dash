// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SvodRow } from '../../lib/monitoring/contract';
import { SheetTotalsRow } from './SvodTable';

afterEach(cleanup);

it('не скрывает одну процедуру и пятьдесят копеек в сверке', () => {
  const totals = { count: 10, nmck: 100, price: 90, savingsTotal: 10, mb: 10, kb: 0, fb: 0 };
  const row: SvodRow = { dept: 'УО', sheet: 'УО', bookLabel: 'УО', book: totals,
    product: { ...totals, count: 11, nmck: 100.5 }, budgetGap: 0.5, divergenceNote: null };
  render(<SheetTotalsRow row={row} />);
  expect(screen.getByText('11')).toBeTruthy();
  expect(screen.getByText('100,50')).toBeTruthy();
});
