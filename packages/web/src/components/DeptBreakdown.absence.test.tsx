// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DeptBreakdown } from './HeroKPICard';

afterEach(cleanup);

describe('C05.02: department breakdown availability', () => {
  it('renders observed zero and missing-data reasons as different outcomes', () => {
    render(<DeptBreakdown unit="%" departments={[
      { id: 'uo', name: 'УО', value: 0 },
      { id: 'uer', name: 'УЭР', value: null, emptyReason: 'экономия не подтверждена' },
      { id: 'ud', name: 'УД', value: null, emptyReason: 'нет плана' },
      { id: 'uio', name: 'УИО', value: 40, secondaryValue: null, secondaryEmptyReason: 'факт не прочитан' },
    ]} />);
    expect(screen.getByRole('button', { name: /УО: 0/ }).textContent).toContain('0,0');
    expect(screen.getByRole('button', { name: 'УЭР: экономия не подтверждена' }).textContent).toContain('экономия не подтверждена');
    expect(screen.getByRole('button', { name: 'УД: нет плана' }).textContent).toContain('нет плана');
    expect(screen.getByRole('button', { name: /УИО: 40/ }).textContent).toContain('факт не прочитан');
  });
});
