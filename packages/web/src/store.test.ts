import { describe, expect, it } from 'vitest';
import { useStore } from './store';

describe('useStore navigation filters', () => {
  it('opens the quality workspace on reconciliation by default', () => {
    expect(useStore.getState().qualityTab).toBe('recon');
  });

  it('syncs navigateTo activity filter into selectedActivities used by useFilteredData', () => {
    useStore.getState().resetAllFilters();

    useStore.getState().navigateTo('analytics', { activity: 'program' });

    expect(useStore.getState().activityFilter).toBe('program');
    expect([...useStore.getState().selectedActivities]).toEqual(['program']);
  });

  it('syncs navigateTo procurement filter into selectedMethods used by useFilteredData', () => {
    useStore.getState().resetAllFilters();

    useStore.getState().navigateTo('analytics', { procurement: 'single' });

    expect(useStore.getState().procurementFilter).toBe('single');
    expect([...useStore.getState().selectedMethods]).toEqual(['single']);
  });
});

describe('useStore changeWindow (история изменений)', () => {
  it('по умолчанию выключено, дата в формате YYYY-MM-DD', () => {
    const cw = useStore.getState().changeWindow;
    expect(cw.enabled).toBe(false);
    expect(cw.sinceISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('setChangeWindow мержит частично', () => {
    useStore.getState().setChangeWindow({ enabled: true });
    expect(useStore.getState().changeWindow.enabled).toBe(true);
    expect(useStore.getState().changeWindow.sinceISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    useStore.getState().setChangeWindow({ sinceISO: '2026-05-29' });
    expect(useStore.getState().changeWindow).toEqual({ enabled: true, sinceISO: '2026-05-29' });
  });
});
