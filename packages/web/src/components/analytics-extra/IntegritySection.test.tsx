// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrityResponse, SequenceReportDto } from './contract';
import { IntegritySection } from './IntegritySection';

const state = vi.hoisted(() => ({
  selected: new Set<string>(),
  data: null as IntegrityResponse | null,
}));

vi.mock('../../store', () => ({
  useStore: (selector: (s: { selectedDepartments: Set<string>; navigateTo: () => void }) => unknown) =>
    selector({ selectedDepartments: state.selected, navigateTo: () => undefined }),
}));
vi.mock('./useExtraSignals', () => ({
  useIntegrity: () => ({ data: state.data, loading: false, error: null, reload: () => undefined }),
}));
vi.mock('../../lib/selectors/org-scope', () => ({
  useOrgScope: () => ({ mode: 'district', hasSubs: false, dept: null, subordinates: [] }),
}));
vi.mock('../ui/card', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../ui/kb-tooltip', () => ({
  KBTooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function seq(gaps: number, duplicateCount: number): SequenceReportDto {
  return {
    rows: 15, countable: 10, numbered: 10, countableWithoutSeq: 0,
    coveragePct: 100, range: null, gaps: [], gapCount: gaps,
    duplicates: Array.from({ length: duplicateCount }, (_, i) => ({
      rowSeq: String(i + 1), sheetRows: [4, 5], subjects: ['A', 'B'],
    })),
    unnumbered: [], note: '',
  };
}

function report(): IntegrityResponse {
  return {
    asOf: '2026-10-22T09:05:00.000Z',
    books: [
      { dept: 'УО', deptName: 'Управление образования', sheet: 'ВСЕ',
        rowsAvailable: true, sequence: seq(2, 1), dateFormat: [],
        lastReadAt: '2026-10-22T09:00:00.000Z', note: '' },
      { dept: 'УД', deptName: 'Управление делами', sheet: 'ВСЕ',
        rowsAvailable: true, sequence: seq(9, 2), dateFormat: [],
        lastReadAt: '2026-10-22T09:02:00.000Z', note: '' },
    ],
    totals: { gapCount: 11, duplicates: 3, countableWithoutSeq: 0, dateFormat: 0 },
    comparison: null, comparisonNote: 'Нет подтверждённого четверга.',
    weeklyComparison: null, weeklyComparisonNote: 'Нет смежной пары.',
    notes: [],
  };
}

afterEach(() => {
  cleanup();
  state.selected = new Set<string>();
  state.data = null;
});

describe('Control: scope, actual source time and incomplete evidence', () => {
  it('shows only the selected GRBS and derives visible counts from those books', () => {
    state.data = report();
    state.selected = new Set(['УО']);
    const { rerender } = render(<IntegritySection />);
    const line = screen.getByText(/пропущено номеров:/);
    expect(line.textContent).toMatch(/пропущено номеров:\s*2/u);
    expect(line.textContent).toMatch(/повторов\s+номера:\s*1/u);
    expect(screen.getByText('Управление образования')).toBeTruthy();
    expect(screen.queryByText('Управление делами')).toBeNull();

    state.selected = new Set<string>();
    rerender(<IntegritySection />);
    expect(screen.getByText(/пропущено номеров:/).textContent)
      .toMatch(/пропущено номеров:\s*11/u);
    expect(screen.getByText('Управление делами')).toBeTruthy();
  });

  it('never turns an unread GRBS into zero confirmed violations', () => {
    state.selected = new Set(['УД']);
    state.data = {
      ...report(),
      books: [
        { dept: 'УД', deptName: 'Управление делами', sheet: 'ВСЕ',
          rowsAvailable: false, sequence: null, dateFormat: [], lastReadAt: null,
          note: 'Источник не прочитан' },
      ],
    };
    render(<IntegritySection />);
    expect(screen.getByText(/Нумерация выбранных книг не проверена/u)).toBeTruthy();
    expect(screen.getByText(/Проверено 0 из 1 выбранных книг/u)).toBeTruthy();
  });

  it('shows incomplete forced reads instead of claiming a successful live comparison', () => {
    state.data = {
      ...report(),
      sourceRefresh: {
        attempted: true, complete: false, checkedAt: '2026-10-22T09:05:00.000Z',
        failedBooks: ['УО'], error: 'Не удалось завершить принудительное чтение источников',
      },
    };
    render(<IntegritySection />);
    expect(screen.getByText(/Сверка с текущими книгами неполна:/u).textContent)
      .toContain('Не проверены: УО');
  });
});
