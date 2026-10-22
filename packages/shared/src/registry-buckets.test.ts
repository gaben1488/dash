import { describe, expect, it } from 'vitest';
import { REGISTRY_BUCKETS, type RegistryBucketId } from './registry-buckets.js';

describe('канонические корзины Реестра', () => {
  it('содержат имена для навигации, описание, БЗ и исполняемый предикат', () => {
    expect(Object.keys(REGISTRY_BUCKETS).sort()).toEqual(['unfunded', 'yearlong']);
    for (const id of Object.keys(REGISTRY_BUCKETS) as RegistryBucketId[]) {
      const d = REGISTRY_BUCKETS[id];
      expect(d.title).toBeTruthy();
      expect(d.navigationLabel).toBeTruthy();
      expect(d.navigationTitle).toBeTruthy();
      expect(d.mechanism).toBeTruthy();
      expect(d.emptyReason).toBeTruthy();
      expect(d.kbKey).toMatch(/^bucket_/);
    }
  });
  it('не подменяет план без года отсутствием сигналов', () => {
    expect(REGISTRY_BUCKETS.unfunded.predicate({ signals: ['planYearMissing'] })).toBe(true);
    expect(REGISTRY_BUCKETS.unfunded.predicate({ signals: [] })).toBe(false);
    expect(REGISTRY_BUCKETS.unfunded.predicate({})).toBe(false);
    expect(REGISTRY_BUCKETS.unfunded.predicate({ signals: ['initiativeRequest'] })).toBe(false);
  });
  it('в течение года — ЕП + сырая Q-заглушка + положительная Y', () => {
    for (const date of ['X', 'Х', 'x', '', null]) {
      expect(REGISTRY_BUCKETS.yearlong.predicate({ method: 'ЕП', factDateRaw: date, factSum: 12 })).toBe(true);
    }
    expect(REGISTRY_BUCKETS.yearlong.predicate({ method: 'ЭА', factDateRaw: 'X', factSum: 12 })).toBe(false);
    expect(REGISTRY_BUCKETS.yearlong.predicate({ method: 'ЕП', factDateRaw: '2026-10-22', factSum: 12 })).toBe(false);
    expect(REGISTRY_BUCKETS.yearlong.predicate({ method: 'ЕП', factDateRaw: 'X', factSum: 0 })).toBe(false);
    expect(REGISTRY_BUCKETS.yearlong.predicate({ method: 'ЕП', factDateRaw: 'X' })).toBe(false);
  });
  it('корзины могут пересекаться, это не два взаимоисключающих состояния', () => {
    const item = { signals: ['planYearMissing'], method: 'ЕП', factDateRaw: 'X', factSum: 12 };
    expect(REGISTRY_BUCKETS.unfunded.predicate(item)).toBe(true);
    expect(REGISTRY_BUCKETS.yearlong.predicate(item)).toBe(true);
  });
});
