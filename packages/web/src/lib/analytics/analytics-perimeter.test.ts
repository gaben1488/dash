import { describe, it, expect } from 'vitest';
import {
  ANALYTICS_CARD_DECLARATIONS,
  buildAnalyticsPerimeters,
  type AnalyticsCardId,
} from './analytics-perimeter';
import { perimeterBadge, perimeterHint, perimeterApplies } from '../perimeter';

const CARDS = Object.keys(ANALYTICS_CARD_DECLARATIONS) as AnalyticsCardId[];

/** Шапка «всё выбрано»: каждая ось сужает, и врать карточке есть чем. */
const NARROWED = {
  year: 2026 as const,
  dataYear: 2026,
  period: 'q3' as const,
  activeMonths: [7, 8, 9],
  selectedDepartments: ['УО'],
  selectedSubordinates: ['Школа 1'],
  selectedMethods: ['single'],
  selectedBudgets: ['fb'],
  selectedActivities: ['program'],
  lastRefreshed: '2026-08-20T09:12:00.000Z',
};

describe('паспорт периметра «Аналитики»', () => {
  it('год не вморожен в подпись — при данных за прошлый год бейдж называет их год', () => {
    const p = buildAnalyticsPerimeters({
      year: 2026, dataYear: 2025, yearMismatch: true, period: 'year',
    });
    for (const id of CARDS) {
      expect(perimeterBadge(p[id]), id).toContain('2025');
      expect(perimeterBadge(p[id]), id).not.toContain('2026');
    }
  });

  it('каждая карточка называет момент чтения — молчание не выдаётся за свежесть', () => {
    const p = buildAnalyticsPerimeters({ year: 2026, period: 'year', lastRefreshed: null });
    for (const id of CARDS) {
      expect(perimeterHint(p[id]), id).toContain('Момент чтения:');
    }
  });

  it('подсказка каждой карточки называет органы, даже когда выбраны все', () => {
    const p = buildAnalyticsPerimeters({ year: 2026, period: 'year' });
    for (const id of CARDS) {
      expect(perimeterHint(p[id]), id).toContain('все управления');
    }
  });

  it('карточки годового разрешения не носят бейдж квартала шапки (п.58б)', () => {
    const p = buildAnalyticsPerimeters(NARROWED);
    for (const id of ['quarterlyTrend', 'execTrend', 'velocity', 'forecast', 'fillQuality', 'anomalies', 'economy'] as const) {
      expect(perimeterApplies(p[id], 'period'), id).toBe(false);
      expect(perimeterBadge(p[id]), id).not.toContain('3 кв');
    }
  });

  it('карточки периода бейдж квартала носят по праву', () => {
    const p = buildAnalyticsPerimeters(NARROWED);
    for (const id of ['planFact', 'shares', 'structure', 'activity', 'summary', 'orgsWithSubs'] as const) {
      expect(perimeterApplies(p[id], 'period'), id).toBe(true);
    }
  });

  it('срез (способ, бюджет, вид) до карточек не доходит — и это сказано вслух', () => {
    const p = buildAnalyticsPerimeters(NARROWED);
    for (const id of ['planFact', 'shares', 'structure', 'activity', 'summary'] as const) {
      expect(perimeterApplies(p[id], 'activities'), id).toBe(false);
      expect(p[id].notes.length, id).toBeGreaterThan(0);
    }
  });

  it('централизация не подчиняется ни одной оси и говорит об этом', () => {
    const p = buildAnalyticsPerimeters(NARROWED).centralization;
    for (const axis of ['period', 'departments', 'subordinates', 'methods', 'budgets', 'activities'] as const) {
      expect(perimeterApplies(p, axis), axis).toBe(false);
    }
    expect(p.notes.length).toBeGreaterThan(0);
  });

  it('без выбора в шапке пометок о неподчинении нет — тревожить читателя нечем', () => {
    const p = buildAnalyticsPerimeters({ year: 2026, period: 'year' });
    for (const id of CARDS) {
      expect(p[id].notes, id).toEqual([]);
    }
  });
});
