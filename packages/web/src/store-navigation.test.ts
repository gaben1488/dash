/**
 * Фильтр-фиксы 16.07 (§4 топ-5, п.1-2): период при навигации меняется АТОМАРНО
 * (period+activeMonths+monthsByYear+periodMode вместе), ключ ГРБС канонизируется
 * в кириллицу на входе в store.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore, QUARTER_MONTHS } from './store';
import { toCanonicalDeptId, bothDeptKeyForms } from './lib/dept-key';

const s = () => useStore.getState();

beforeEach(() => {
  useStore.setState({
    page: 'dashboard',
    period: 'year',
    periodMode: 'week' as any,
    activeMonths: new Set<number>(),
    monthsByYear: {},
    selectedDepartments: new Set<string>(),
    selectedSubordinates: new Set<string>(),
    year: 2026,
  } as any);
});

describe('navigateTo — период атомарно (Б1-Б3)', () => {
  it('period=q1 из week-режима: месяцы и explicit-режим выставляются вместе', () => {
    s().navigateTo('analytics', { period: 'q1' });
    const st = s();
    expect(st.period).toBe('q1');
    expect(st.periodMode).toBe('explicit');
    expect([...st.activeMonths].sort((a, b) => a - b)).toEqual([...QUARTER_MONTHS.q1].sort((a, b) => a - b));
    expect([...(st.monthsByYear[2026] ?? new Set())]).toEqual([...st.activeMonths]);
  });

  it('months=[2] : period сбрасывается в year, режим explicit', () => {
    s().navigateTo('data', { months: [2] });
    const st = s();
    expect(st.period).toBe('year');
    expect(st.periodMode).toBe('explicit');
    expect([...st.activeMonths]).toEqual([2]);
  });

  it('period=year: месяцы очищаются (старый выбор не перебивает)', () => {
    s().navigateTo('data', { months: [5, 6] });
    s().navigateTo('analytics', { period: 'year' });
    const st = s();
    expect(st.period).toBe('year');
    expect(st.activeMonths.size).toBe(0);
    expect((st.monthsByYear[2026]?.size ?? 0)).toBe(0);
  });
});

describe('канонизация ключа ГРБС (Б5)', () => {
  it('navigateTo с латиницей кладёт кириллицу', () => {
    s().navigateTo('data', { department: 'uer' });
    expect(s().selectedDepartments.has('УЭР')).toBe(true);
    expect(s().selectedDepartments.has('uer')).toBe(false);
  });

  it('toggleDepartment(латиница) и toggleDepartment(кириллица) — один и тот же выбор', () => {
    s().toggleDepartment('uer');
    expect(s().selectedDepartments.has('УЭР')).toBe(true);
    s().toggleDepartment('УЭР');
    expect(s().selectedDepartments.has('УЭР')).toBe(false);
    expect(s().selectedDepartments.size).toBe(0);
  });

  it('bothDeptKeyForms отдаёт обе формы для сравнения с данными', () => {
    const both = bothDeptKeyForms(new Set(['УЭР']));
    expect(both.has('УЭР')).toBe(true);
    expect(both.has('uer')).toBe(true);
    expect(toCanonicalDeptId('uo')).toBe('УО');
  });
});
