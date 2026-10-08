// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { normalizeMonitoring } from '../../lib/monitoring/contract';
import { SelectionTotals } from './SelectionTotals';

describe('selection totals', () => {
  it('shows active NMCK, excludes transferred history, and names missing amounts', () => {
    const rows = normalizeMonitoring({ procedures: [
      { nmck: 100, stage: 'application' }, { nmck: 200, stage: 'reissued' }, { nmck: null, stage: 'unknown' },
    ] }).procedures;
    render(<SelectionTotals rows={rows} label="В работе" />);
    expect(screen.getByText('100,00')).toBeTruthy();
    expect(screen.getByText(/Не заполнена НМЦК: 1/)).toBeTruthy();
  });
});
