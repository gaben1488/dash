/**
 * Стражи канона п.134 (владелец, 20.08.2026): «убери все проблемы рандомных
 * непонятных включений фильтров… и не допускай их больше».
 *
 * Правило, которое здесь закреплено:
 *   1. Обычный вход — фильтры чисты. Никакое поле-отбор не заполнено само.
 *   2. Никаких невидимых отборов. Каждый отбор, оставшийся в состоянии, обязан
 *      быть назван чипом. Поле `period` чипа не имело, поэтому «осиротевший»
 *      квартал (месяцы сняты, `period: 'q2'` остался) резал экран молча —
 *      каждая точка «период очищен» обязана обнулять и его.
 *   3. Затравка (`registrySignalSeed`) живёт ровно один переход: переход без
 *      признаков и «Сбросить» её снимают, иначе она всплывает фильтром при
 *      следующем входе в Реестр.
 *   4. Сохранённые настройки таблицы восстанавливают ВИД (сортировка, размер
 *      страницы, режим), но не ОТБОР: фильтр после перезагрузки молча не
 *      возвращается.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveFilterCount, hasExplicitPeriodFilter, useStore } from './store';
import { sanitizeBrowsePrefs } from './pages/DataBrowser';

const s = () => useStore.getState();

/** Снимок отборов состояния — то, чем меряется «фильтры чисты». */
function filterSnapshot() {
  const st = s();
  return {
    period: st.period,
    periodMode: st.periodMode,
    months: st.activeMonths.size,
    monthsByYear: Object.keys(st.monthsByYear).length,
    depts: st.selectedDepartments.size,
    subs: st.selectedSubordinates.size,
    deptOnly: st.deptOnlyMode.size,
    methods: st.selectedMethods.size,
    activities: st.selectedActivities.size,
    budgets: st.selectedBudgets.size,
    search: st.searchQuery,
    searchDebounced: st.searchQueryDebounced,
    procurement: st.procurementFilter,
    activity: st.activityFilter,
    seed: st.registrySignalSeed.length,
  };
}

const CLEAN = {
  period: 'year',
  periodMode: 'week',
  months: 0,
  monthsByYear: 0,
  depts: 0,
  subs: 0,
  deptOnly: 0,
  methods: 0,
  activities: 0,
  budgets: 0,
  search: '',
  searchDebounced: '',
  procurement: 'all',
  activity: 'all',
  seed: 0,
};

beforeEach(() => {
  s().resetAllFilters();
  useStore.setState({ page: 'dashboard' } as never);
});

describe('обычный вход — фильтры чисты', () => {
  it('после сброса ни одно поле-отбор не заполнено', () => {
    expect(filterSnapshot()).toEqual(CLEAN);
  });

  it('счётчик активных фильтров равен нулю', () => {
    const st = s();
    expect(getActiveFilterCount({
      yearChanged: false,
      moneyUnitChanged: false,
      selectedMethods: st.selectedMethods,
      selectedActivities: st.selectedActivities,
      selectedBudgets: st.selectedBudgets,
      selectedDepartments: st.selectedDepartments,
      selectedSubordinates: st.selectedSubordinates,
      activeMonths: st.activeMonths,
      monthsByYear: st.monthsByYear,
      periodMode: st.periodMode,
      searchQuery: st.searchQuery,
    })).toBe(0);
  });
});

describe('период: снятие месяцев не оставляет невидимого квартала', () => {
  it('переход с кварталом + toggleMonth по каждому месяцу → period возвращается к году', () => {
    s().navigateTo('data', { period: 'q2' });
    expect(s().period).toBe('q2');
    for (const m of [...s().activeMonths]) s().toggleMonth(m);
    const st = s();
    expect(st.activeMonths.size).toBe(0);
    // Раньше здесь оставался 'q2' — фильтр, невидимый и для чипов, и для URL.
    expect(st.period).toBe('year');
    expect(hasExplicitPeriodFilter(st.periodMode, st.activeMonths, st.monthsByYear)).toBe(false);
  });

  it('clearMonths очищает и period', () => {
    s().navigateTo('data', { period: 'q3' });
    s().clearMonths();
    expect(s().period).toBe('year');
  });

  it('clearAllPeriods очищает и period', () => {
    s().navigateTo('data', { period: 'q4' });
    s().clearAllPeriods();
    expect(s().period).toBe('year');
    expect(s().activeMonths.size).toBe(0);
    expect(Object.keys(s().monthsByYear).length).toBe(0);
  });

  it('setQuarterMonths дважды (включил-выключил) не оставляет квартала', () => {
    s().navigateTo('data', { period: 'q1' });
    s().setQuarterMonths('q1');
    expect(s().activeMonths.size).toBe(0);
    expect(s().period).toBe('year');
  });

  it('toggleQuarterInYear снимает выбранный квартал вместе с полем period', () => {
    const yr = s().year as number;
    s().navigateTo('data', { period: 'q2' });
    s().toggleQuarterInYear(yr, 'q2'); // квартал уже выбран → это снятие
    expect(s().activeMonths.size).toBe(0);
    expect(s().period).toBe('year');
  });

  it('toggleYearFull дважды не оставляет квартала', () => {
    const yr = s().year as number;
    s().navigateTo('data', { period: 'q3' });
    s().toggleYearFull(yr);
    s().toggleYearFull(yr);
    expect(s().period).toBe('year');
  });

  it('после снятия периода состояние отборов снова чисто', () => {
    s().navigateTo('data', { period: 'q2' });
    s().clearAllPeriods();
    expect(filterSnapshot()).toEqual(CLEAN);
  });
});

describe('затравка признаков живёт ровно один переход', () => {
  it('переход БЕЗ признаков обнуляет прежнюю затравку', () => {
    s().navigateTo('data', { signals: ['planYearMissing'] });
    expect(s().registrySignalSeed).toEqual(['planYearMissing']);
    s().navigateTo('dashboard');
    expect(s().registrySignalSeed).toEqual([]);
  });

  it('потребитель очищает затравку явно', () => {
    s().navigateTo('data', { signals: ['planYearMissing'] });
    s().clearRegistrySignalSeed();
    expect(s().registrySignalSeed).toEqual([]);
  });

  it('«Сбросить всё» снимает и непотреблённую затравку', () => {
    s().navigateTo('data', { signals: ['planYearMissing'] });
    s().resetAllFilters();
    expect(s().registrySignalSeed).toEqual([]);
  });
});

describe('переход проставляет только то, о чём попросили', () => {
  it('переход с управлением не трогает способ, вид и период', () => {
    s().navigateTo('data', { department: 'УЭР' });
    const st = s();
    expect(st.selectedDepartments.size).toBe(1);
    expect(st.selectedMethods.size).toBe(0);
    expect(st.selectedActivities.size).toBe(0);
    expect(st.period).toBe('year');
    expect(st.activeMonths.size).toBe(0);
  });

  it('переход с кварталом кладёт и месяцы — отбор виден чипом, а не только полем period', () => {
    s().navigateTo('data', { period: 'q2' });
    const st = s();
    expect(st.activeMonths.size).toBeGreaterThan(0);
    expect(hasExplicitPeriodFilter(st.periodMode, st.activeMonths, st.monthsByYear)).toBe(true);
  });
});

describe('сохранённые настройки таблицы — вид, но не отбор', () => {
  const FILTER_FIELDS = [
    'signalFilter', 'signals', 'initiativeOnly', 'search', 'searchQuery',
    'selectedDepartments', 'depts', 'selectedSubordinates', 'subs',
    'period', 'activeMonths', 'months', 'budgets', 'selectedBudgets',
    'method', 'activity', 'bucket', 'year',
  ];

  it('разбор настроек пропускает только поля вида', () => {
    const parsed = sanitizeBrowsePrefs({
      sortKey: 'subject', sortDir: 'desc', pageSize: 50, viewMode: 'editor',
    });
    expect(Object.keys(parsed).sort()).toEqual(['pageSize', 'sortDir', 'sortKey', 'viewMode']);
  });

  it('поля-отборы из хранилища не восстанавливаются ни при каком написании', () => {
    const raw: Record<string, unknown> = { sortKey: 'subject' };
    for (const f of FILTER_FIELDS) raw[f] = ['что-то'];
    const parsed = sanitizeBrowsePrefs(raw) as Record<string, unknown>;
    for (const f of FILTER_FIELDS) expect(parsed[f]).toBeUndefined();
  });

  it('испорченная запись даёт вид по умолчанию, а не наполовину применённый отбор', () => {
    expect(sanitizeBrowsePrefs('не объект')).toEqual({});
    expect(sanitizeBrowsePrefs(null)).toEqual({});
  });
});

describe('поиск: снятие мгновенно и окончательно', () => {
  it('пустой запрос не «догоняется» отложенным пересчётом', () => {
    vi.useFakeTimers();
    try {
      s().setSearchQuery('школа');
      s().setSearchQuery('');
      vi.advanceTimersByTime(1000);
      expect(s().searchQueryDebounced).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('«Сбросить всё» снимает и отложенный пересчёт', () => {
    vi.useFakeTimers();
    try {
      s().setSearchQuery('школа');
      s().resetAllFilters();
      vi.advanceTimersByTime(1000);
      expect(s().searchQuery).toBe('');
      expect(s().searchQueryDebounced).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});
