/**
 * Стражи режима счёта «ставка снижения» (канон п.144, интервью 22.08.2026).
 *
 * Класс, который сторожится: ставка — РЕЖИМ СЧЁТА, как тыс/млн, а не отбор
 * строк. Умолчание — норматив 8 % (им посчитаны формулы книг); живое положение
 * включается только рукой читателя; «Сбросить фильтры» возвращает умолчание и
 * считает изменённое положение в счётчик кнопки — молчание на умолчании.
 */
import { describe, expect, it } from 'vitest';
import { getActiveFilterCount, useStore } from './store';

describe('ставка снижения — режим счёта в хранилище', () => {
  it('умолчание — норматив (norm), живой замер не выдуман (null)', () => {
    useStore.getState().resetAllFilters();
    expect(useStore.getState().stavkaMode).toBe('norm');
    expect(useStore.getState().liveStavka).toBeNull();
  });

  it('setStavkaMode переключает положение, resetAllFilters возвращает норматив', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().setStavkaMode('live');
    expect(useStore.getState().stavkaMode).toBe('live');
    useStore.getState().resetAllFilters();
    expect(useStore.getState().stavkaMode).toBe('norm');
  });

  it('переключение ставки не трогает отбор строк (способ/вид/бюджет/период)', () => {
    useStore.getState().resetAllFilters();
    useStore.getState().setStavkaMode('live');
    const st = useStore.getState();
    expect(st.selectedMethods.size).toBe(0);
    expect(st.selectedActivities.size).toBe(0);
    expect(st.selectedBudgets.size).toBe(0);
    expect(st.periodMode).toBe('week');
    expect(st.activeMonths.size).toBe(0);
  });
});

describe('ставка в счётчике активных фильтров', () => {
  const baseInput = () => ({
    yearChanged: false,
    moneyUnitChanged: false,
    selectedMethods: new Set<string>(),
    selectedActivities: new Set<string>(),
    selectedBudgets: new Set<string>(),
    selectedDepartments: new Set<string>(),
    selectedSubordinates: new Set<string>(),
    activeMonths: new Set<number>(),
    monthsByYear: {},
    periodMode: 'week' as const,
    searchQuery: '',
  });

  it('умолчание (поле не передано либо false) не считается', () => {
    expect(getActiveFilterCount(baseInput())).toBe(0);
    expect(getActiveFilterCount({ ...baseInput(), stavkaChanged: false })).toBe(0);
  });

  it('живое положение считается одним изменением', () => {
    expect(getActiveFilterCount({ ...baseInput(), stavkaChanged: true })).toBe(1);
  });
});
