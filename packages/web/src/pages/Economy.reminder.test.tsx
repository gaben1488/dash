// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Issue } from '@aemr/shared';
import { EconomyPage } from './Economy';
import { useStore } from '../store';
import { TooltipProvider } from '../components/ui/tooltip';

const fixture = vi.hoisted(() => ({ issues: [] as Partial<Issue>[] | undefined }));
vi.mock('../hooks/useFilteredData', () => ({ useFilteredData: () => ({
  depts: [{ id: 'uo', nameShort: 'УО', planTotal: 100, factTotal: 80, economyTotal: 5 }],
  allDepts: [{}], periodKey: 'year', periodResolution: { hasActiveMonths: false }, issues: fixture.issues,
}) }));
vi.mock('../components/economy/EconomyCharts', () => ({ EconomyCharts: () => null }));
vi.mock('../components/PeriodBadge', () => ({ PeriodBadge: () => null }));
const recommendation = 'К дате последнего контракта проверить итог и решение по экономии; ГРБС/УФ подготовить варианты';
function reminder(overrides: Partial<Issue> = {}): Partial<Issue> {
  return { id: 'test-reminder', severity: 'info', signal: 'economyDecisionUpcoming',
    checkId: 'future_economy_decision', category: 'signal:economyDecisionUpcoming',
    departmentId: 'uo', sheet: 'ВСЕ', row: 4, rowSeq: '173/18', title: 'Итог позиции впереди',
    description: 'Последний контракт ещё не завершён', ...overrides };
}
beforeEach(() => {
  fixture.issues = [reminder()];
  useStore.setState({ page: 'economy', loading: false, error: null, dashboardData: null,
    selectedDepartments: new Set(), selectedSubordinates: new Set(), deptOnlyMode: new Set(),
    selectedBudgets: new Set(), selectedMethods: new Set(), selectedActivities: new Set(),
    searchQuery: '', searchQueryDebounced: '', registrySignalSeed: [],
  });
});
afterEach(cleanup);
describe('Economy upcoming decision — preparation, not financial totals', () => {
  it('shows the informational preparation message on the existing page', () => {
    render(<TooltipProvider><EconomyPage /></TooltipProvider>);
    expect(screen.getByText(recommendation)).toBeTruthy();
    expect(document.querySelector('[data-address]')?.textContent).toContain('№ п/п 173/18');
    expect(screen.getByText(/Итог позиции впереди/)).toBeTruthy();
  });
  it('uses the existing registry navigation and preserves the full fractional number', () => {
    render(<TooltipProvider><EconomyPage /></TooltipProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Найти.*173\/18/ }));
    expect(useStore.getState().page).toBe('data');
    expect(useStore.getState().searchQuery).toBe('173/18');
    expect([...useStore.getState().selectedDepartments]).toEqual(['УО']);
  });
  it('does not invent reminders for old snapshots without the issues field', () => {
    fixture.issues = undefined;
    render(<TooltipProvider><EconomyPage /></TooltipProvider>);
    expect(screen.queryByText(recommendation)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Экономия' })).toBeTruthy();
  });
  it('does not infer a reminder from arbitrary titles or other signals', () => {
    fixture.issues = [reminder({ signal: 'unknown', checkId: 'other', category: 'unknown' })];
    render(<TooltipProvider><EconomyPage /></TooltipProvider>);
    expect(screen.queryByText(recommendation)).toBeNull();
  });
  it('keeps a known informational case visible but names missing identity and disables the action', () => {
    fixture.issues = [reminder({ signal: undefined, departmentId: undefined, rowSeq: undefined, row: undefined, sheet: undefined })];
    render(<TooltipProvider><EconomyPage /></TooltipProvider>);
    expect(screen.getByText(recommendation)).toBeTruthy();
    expect(screen.getByText(/Адрес строки не сохранён/)).toBeTruthy();
    const action = screen.getByRole('button', { name: /Найти.*реестре/ });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(action);
    expect(useStore.getState().page).toBe('economy');
  });
});

it('adding a preparation reminder leaves the displayed financial statement unchanged', () => {
  fixture.issues = undefined;
  const view = render(<TooltipProvider><EconomyPage /></TooltipProvider>);
  const before = screen.getByText(/экономии.*•/).textContent;
  fixture.issues = [reminder()];
  view.rerender(<TooltipProvider><EconomyPage /></TooltipProvider>);
  expect(screen.getByText(recommendation)).toBeTruthy();
  expect(screen.getByText(/экономии.*•/).textContent).toBe(before);
});

it('keeps the known ordinal visible when an old snapshot omits the physical row', () => {
  fixture.issues = [reminder({ row: undefined })];
  render(<TooltipProvider><EconomyPage /></TooltipProvider>);
  expect(screen.getByText(/№ п\/п 173\/18/)).toBeTruthy();
  expect((screen.getByRole('button', { name: /Найти.*173\/18/ }) as HTMLButtonElement).disabled).toBe(false);
});
it('keeps the known physical address without declaring the missing ordinal a source error', () => {
  fixture.issues = [reminder({ rowSeq: undefined })];
  render(<TooltipProvider><EconomyPage /></TooltipProvider>);
  expect(screen.getByText(/ВСЕ · строка 4 · № п\/п не сохранён/)).toBeTruthy();
});

it.each(['resolved', 'false_positive', 'wont_fix'] as const)('does not present %s decisions as pending preparation', status => {
  fixture.issues = [reminder({ status })];
  render(<TooltipProvider><EconomyPage /></TooltipProvider>);
  expect(screen.queryByText(recommendation)).toBeNull();
});
it('discloses that preparation cases are from the reading, not the financial period or method slice', () => {
  render(<TooltipProvider><EconomyPage /></TooltipProvider>);
  expect(screen.getByText('Открытые позиции выбранного чтения. Учитываются управление, учреждение, направление и поиск; период, способ закупки и бюджет этот список не ограничивают.')).toBeTruthy();
});


it('updates money formatting when moneyUnit changes without needing unrelated store updates', () => {
  const previousUnit = useStore.getState().moneyUnit;
  act(() => useStore.setState({ moneyUnit: 'тыс' }));
  try {
    render(<TooltipProvider><EconomyPage /></TooltipProvider>);
    const before = screen.getByText(/экономии.*•/).textContent;
    act(() => useStore.setState({ moneyUnit: 'млн' }));
    const after = screen.getByText(/экономии.*•/).textContent;
    expect(after).not.toBe(before);
    expect(after).toContain('млн');
  } finally {
    act(() => useStore.setState({ moneyUnit: previousUnit }));
  }
});
