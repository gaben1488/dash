import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, useStore } from './store';

/**
 * Поиск раздвоен намеренно: `searchQuery` — то, что в поле ввода прямо сейчас,
 * `searchQueryDebounced` — то, по чему считается дэш. Тесты стерегут не скорость,
 * а обещания: поле откликается на каждую букву, пересчёт — один на слово,
 * а снятие фильтра происходит немедленно и не воскресает отложенным таймером.
 */
describe('поиск с задержкой пересчёта', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.getState().resetAllFilters();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('поле ввода обновляется сразу, пересчёт ждёт паузы в наборе', () => {
    useStore.getState().setSearchQuery('ш');

    expect(useStore.getState().searchQuery).toBe('ш');
    expect(useStore.getState().searchQueryDebounced).toBe('');

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(useStore.getState().searchQueryDebounced).toBe('ш');
  });

  it('слово из нескольких букв даёт один пересчёт, а не по одному на букву', () => {
    for (const value of ['ш', 'шк', 'шко', 'школ', 'школа']) {
      useStore.getState().setSearchQuery(value);
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 20);
    }

    expect(useStore.getState().searchQueryDebounced).toBe('');

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    expect(useStore.getState().searchQueryDebounced).toBe('школа');
  });

  it('очистка поля снимает фильтр немедленно', () => {
    useStore.getState().setSearchQuery('школа');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

    useStore.getState().setSearchQuery('');

    expect(useStore.getState().searchQueryDebounced).toBe('');
  });

  it('отложенный пересчёт не воскрешает запрос после сброса фильтров', () => {
    useStore.getState().setSearchQuery('школа');
    useStore.getState().resetAllFilters();

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);

    expect(useStore.getState().searchQuery).toBe('');
    expect(useStore.getState().searchQueryDebounced).toBe('');
  });

  it('переход по ссылке применяет запрос сразу, без задержки', () => {
    useStore.getState().navigateTo('data', { search: 'лицей' });

    expect(useStore.getState().searchQuery).toBe('лицей');
    expect(useStore.getState().searchQueryDebounced).toBe('лицей');
  });

  it('отложенный пересчёт не перебивает запрос, пришедший переходом по ссылке', () => {
    useStore.getState().setSearchQuery('школа');
    useStore.getState().navigateTo('data', { search: 'лицей' });

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);

    expect(useStore.getState().searchQueryDebounced).toBe('лицей');
  });
});
