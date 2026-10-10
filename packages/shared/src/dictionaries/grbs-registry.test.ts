import { describe, expect, it } from 'vitest';
import { getGrbs, resolveGrbsAlias } from './grbs-registry';
import { SUBORDINATE_REGISTRY } from './subordinate-registry';

/** Снимок только восьми публикуемых названий, без строк организаций или ID таблиц. */
const ACTIVE: ReadonlyArray<readonly [Parameters<typeof getGrbs>[0], string, string]> = [
  ['УАГиЗО', 'Управление архитектуры, градостроительства и земельных отношений администрации Елизовского муниципального округа', 'Управление архитектуры, градостроительства и земельных отношений'],
  ['УД', 'Управление делами администрации Елизовского муниципального округа', 'Управление делами'],
  ['УДТХ', 'Управление дорожно-транспортного хозяйства и благоустройства администрации Елизовского муниципального округа', 'Управление дорожно-транспортного хозяйства'],
  ['УИО', 'Управление имущественных отношений администрации Елизовского муниципального округа', 'Управление имущественных отношений'],
  ['УКСиМП', 'Управление культуры, спорта и молодежной политики администрации Елизовского муниципального округа', 'Управление культуры, спорта и молодёжной политики'],
  ['УО', 'Управление образования администрации Елизовского муниципального округа', 'Управление образования Администрации Елизовского муниципального района'],
  ['УФБП', 'Управление финансов администрации Елизовского муниципального округа', 'Управление финансово-бюджетной политики'],
  ['УЭР', 'Управление экономического развития администрации Елизовского муниципального округа', 'Управление экономического развития'],
];

describe('округ: действующее полное имя и историческая преемственность ГРБС', () => {
  it('все восемь полных имён распознаются из B план-реестров и E процедур', () => {
    expect(ACTIVE).toHaveLength(8);
    for (const [id, current] of ACTIVE) {
      expect(getGrbs(id).fullName).toBe(current);
      expect(resolveGrbsAlias(current)).toBe(id);
    }
  });
  it('старые полные названия продолжают разрешаться в те же GrbsId', () => {
    for (const [id, _current, old] of ACTIVE) expect(resolveGrbsAlias(old)).toBe(id);
    expect(resolveGrbsAlias('УАГЗО')).toBe('УАГиЗО');
    expect(resolveGrbsAlias('УАГиЗО')).toBe('УАГиЗО');
  });
  it('записи аппаратов остаются единственными, имеют нынешнее имя и исторический алиас', () => {
    const seen = new Set<string>();
    for (const [id, current] of ACTIVE) {
      const entries = SUBORDINATE_REGISTRY.filter((e) => e.grbsId === id && e.isOrgItself);
      expect(entries).toHaveLength(1);
      expect(entries[0].canonicalName).toBe(current);
      expect(entries[0].legacyCanonicalName).toBeTruthy();
      expect(entries[0].legacyCanonicalName).not.toBe(current);
      seen.add(entries[0].id);
    }
    expect(seen.size).toBe(8);
  });
  it('не угадывает незнакомый орган по строковому сходству', () => {
    expect(resolveGrbsAlias('Управление без подтверждённой преемственности')).toBeUndefined();
  });
});
