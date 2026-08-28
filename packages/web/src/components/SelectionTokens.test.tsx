// @vitest-environment jsdom
/**
 * Стражи жетонов угла (канон пульс-2, пп.1–3 и 7–9 второго круга).
 *
 * Классы, которые сторожатся:
 *   • СХОЖДЕНИЕ: каждый включённый режим/отбор даёт РОВНО один жетон и ровно
 *     единицу счётчика «Сбросить» — по всем осям, включая режимы счёта
 *     (единицы, ставка) и срез недели. Жетон без счёта и счёт без жетона —
 *     один и тот же класс лжи (п.134: отбор обязан быть видим ЦЕЛИКОМ);
 *   • молчание на умолчании — ни рамки, ни нуля, ни общего ✕;
 *   • будущая неделя — «не наступила», а не «срез»: среза ещё не существует;
 *   • отбор-пустышка (все 8 управлений без подведов/deptOnly) коллапсирует
 *     в пустое множество — жетона и счёта нет;
 *   • гейт страницей: ось, не входящая в PAGE_FILTERS вкладки, жетоном не
 *     показывается — угол не обещает отбора, которого расчёт не ведёт.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ALL_DEPT_IDS } from '@aemr/shared';
import { SelectionTokens } from './SelectionTokens';
import { getActiveFilterCount, isWeekShifted, useStore, type Page } from '../store';

/** Умолчание продукта на заданной вкладке. */
function resetState(page: Page = 'data'): void {
  useStore.getState().resetAllFilters();
  useStore.setState({ page, liveStavka: null, liveStavkaAbsent: false });
}

/** Жетоны как их видит читатель. */
function renderTokens() {
  const { container } = render(<SelectionTokens />);
  return {
    container,
    chips: () => [...container.querySelectorAll<HTMLButtonElement>('button.sel-chip')],
    clearAll: () => container.querySelector<HTMLButtonElement>('button.sel-clear'),
  };
}

/** Счётчик кнопки «Сбросить» — ровно теми же входами, что Header. */
function counterOf(): number {
  const s = useStore.getState();
  return getActiveFilterCount({
    yearChanged: s.year !== new Date().getFullYear(),
    moneyUnitChanged: s.moneyUnit !== 'тыс',
    stavkaChanged: s.stavkaMode !== 'norm',
    weekShifted: isWeekShifted(s.periodMode, s.focusedWeekStart),
    selectedMethods: s.selectedMethods,
    selectedActivities: s.selectedActivities,
    selectedBudgets: s.selectedBudgets,
    selectedDepartments: s.selectedDepartments,
    selectedSubordinates: s.selectedSubordinates,
    activeMonths: s.activeMonths,
    monthsByYear: s.monthsByYear,
    periodMode: s.periodMode,
    searchQuery: s.searchQuery,
  });
}

beforeEach(() => resetState());
afterEach(() => {
  cleanup();
  resetState();
});

describe('молчание на умолчании', () => {
  it('ни жетонов, ни общего ✕, счётчик 0', () => {
    const t = renderTokens();
    expect(t.chips()).toHaveLength(0);
    expect(t.clearAll()).toBeNull();
    expect(counterOf()).toBe(0);
  });
});

describe('схождение: жетон ↔ счётчик по каждой оси (страж п.3)', () => {
  // Каждая ось включается поодиночке на вкладке «Реестр» (там действуют все
  // оси). Ровно один жетон = ровно единица счётчика — в обе стороны.
  const axes: [string, () => void][] = [
    ['срез недели назад', () => useStore.getState().shiftFocusedWeek(-1)],
    ['неделя вперёд (будущая)', () => useStore.getState().shiftFocusedWeek(1)],
    ['год не текущий', () => useStore.getState().setYear(2025)],
    ['явный месяц', () => useStore.getState().toggleMonthInYear(new Date().getFullYear(), 1)],
    ['способ закупки', () => useStore.getState().toggleMethod('single')],
    ['вид деятельности', () => useStore.getState().toggleActivity('program')],
    ['бюджет', () => useStore.getState().toggleBudget('fb')],
    ['управление', () => useStore.getState().toggleDepartment(ALL_DEPT_IDS[0])],
    ['подвед', () => useStore.getState().toggleSubordinate('МАУ «Проба»')],
    ['поиск', () => useStore.getState().setSearchQuery('шкаф')],
    ['единицы (млн)', () => useStore.getState().setMoneyUnit('млн')],
    ['живая ставка', () => useStore.getState().setStavkaMode('live')],
  ];

  for (const [name, engage] of axes) {
    it(`ось «${name}»: один жетон и единица счёта`, () => {
      resetState('data');
      engage();
      const t = renderTokens();
      expect(t.chips()).toHaveLength(1);
      expect(counterOf()).toBe(1);
      // Общий ✕ виден вместе с жетоном.
      expect(t.clearAll()).not.toBeNull();
    });
  }

  it('счётчик видит срез недели (обратное расхождение закрыто)', () => {
    useStore.getState().shiftFocusedWeek(-1);
    expect(counterOf()).toBe(1);
  });
});

describe('жетон живой ставки (п.1)', () => {
  it('при stavkaMode=live с замером — «живой N %», ✕ возвращает норматив', () => {
    useStore.setState({
      stavkaMode: 'live',
      liveStavka: { pct: 9.79, q1: null, q3: null, count: 34, readAt: null },
    });
    const t = renderTokens();
    const chip = t.chips()[0];
    expect(chip.textContent).toContain('живой 9,79 %');
    // Паспорт разницы — в подсказке (план не загружен → честная фраза).
    expect(chip.title).toContain('норматив');
    fireEvent.click(chip);
    expect(useStore.getState().stavkaMode).toBe('norm');
  });

  it('без замера жетон живёт без выдуманного процента', () => {
    useStore.setState({ stavkaMode: 'live', liveStavka: null });
    const t = renderTokens();
    expect(t.chips()[0].textContent).toContain('живой');
    expect(t.chips()[0].textContent).not.toContain('%');
  });
});

describe('жетон единиц (п.2)', () => {
  it('млн — жетон, ✕ возвращает тысячи', () => {
    useStore.getState().setMoneyUnit('млн');
    const t = renderTokens();
    const chip = t.chips()[0];
    expect(chip.textContent).toContain('млн');
    fireEvent.click(chip);
    expect(useStore.getState().moneyUnit).toBe('тыс');
  });
});

describe('жетон будущей недели (п.7)', () => {
  it('неделя вперёд — «нX · не наступила», не «срез»', () => {
    useStore.getState().shiftFocusedWeek(1);
    const t = renderTokens();
    const chip = t.chips()[0];
    expect(chip.textContent).toMatch(/н\d+ · не наступила/);
    expect(chip.textContent).not.toContain('срез');
    expect(chip.title).toContain('ещё не наступила');
  });

  it('неделя назад — по-прежнему «срез нX»', () => {
    useStore.getState().shiftFocusedWeek(-1);
    const t = renderTokens();
    expect(t.chips()[0].textContent).toMatch(/срез н\d+/);
  });
});

describe('отбор-пустышка организаций (п.8)', () => {
  it('явный выбор всех 8 управлений коллапсирует в пустое множество — жетона и счёта нет', () => {
    for (const id of ALL_DEPT_IDS) useStore.getState().toggleDepartment(id);
    expect(useStore.getState().selectedDepartments.size).toBe(0);
    const t = renderTokens();
    expect(t.chips()).toHaveLength(0);
    expect(counterOf()).toBe(0);
  });

  it('с подведом коллапса нет: множество строк уже не «все»', () => {
    useStore.getState().toggleSubordinate('МАУ «Проба»');
    for (const id of ALL_DEPT_IDS) useStore.getState().toggleDepartment(id);
    expect(useStore.getState().selectedDepartments.size).toBe(ALL_DEPT_IDS.length);
    const t = renderTokens();
    expect(t.chips()[0].textContent).toContain('орг');
  });

  it('с deptOnly коллапса нет: «только управление» — не identity', () => {
    useStore.getState().setDeptOnly(ALL_DEPT_IDS[0]);
    for (const id of ALL_DEPT_IDS.slice(1)) useStore.getState().toggleDepartment(id);
    expect(useStore.getState().selectedDepartments.size).toBe(ALL_DEPT_IDS.length);
  });
});

describe('гейт страницей (п.9)', () => {
  it('Мониторинг: период/способ/поиск/единицы жетонами не показываются, управления — показываются (п.127)', () => {
    resetState('monitoring');
    useStore.getState().toggleMonthInYear(new Date().getFullYear(), 2);
    useStore.getState().toggleMethod('single');
    useStore.getState().setSearchQuery('котёл');
    useStore.getState().setMoneyUnit('млн');
    useStore.getState().toggleDepartment(ALL_DEPT_IDS[0]);
    const t = renderTokens();
    const labels = t.chips().map((c) => c.textContent ?? '');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain('орг');
  });

  it('Мониторинг: невидимые оси без видимых жетонов — предмет молчит целиком, общего ✕ нет', () => {
    resetState('monitoring');
    useStore.getState().toggleMonthInYear(new Date().getFullYear(), 2);
    const t = renderTokens();
    expect(t.container.querySelector('.sel-tokens')).toBeNull();
    expect(t.clearAll()).toBeNull();
  });

  it('Система: жетон ставки не показывается (там нет ни одного числа)', () => {
    resetState('settings');
    useStore.getState().setStavkaMode('live');
    const t = renderTokens();
    expect(t.chips()).toHaveLength(0);
  });
});
