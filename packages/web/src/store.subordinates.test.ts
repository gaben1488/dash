import { describe, it, expect } from 'vitest';
import { SUBORDINATES_FALLBACK } from './store';
import { ALL_DEPT_IDS, SUBORDINATE_REGISTRY } from '@aemr/shared';

// Guard: store fallback подведов — производное от канонического SUBORDINATE_REGISTRY
// через биекцию GrbsId→DepartmentId. Ловит разрыв single-source и моста.
describe('SUBORDINATES_FALLBACK — производные от канонического реестра', () => {
  it('покрывает все DepartmentId', () => {
    for (const id of ALL_DEPT_IDS) {
      expect(SUBORDINATES_FALLBACK[id], `нет ключа ${id}`).toBeDefined();
    }
  });

  it('УАГЗО (форма данных) получает подвед через мост УАГиЗО→УАГЗО', () => {
    expect(SUBORDINATES_FALLBACK['УАГЗО']).toContain('МКУ Елизовское РУС');
  });

  it('записи самого управления (org_itself) исключены', () => {
    const all = Object.values(SUBORDINATES_FALLBACK).flat();
    for (const s of SUBORDINATE_REGISTRY) {
      if (s.isOrgItself) expect(all).not.toContain(s.displayName);
    }
  });

  it('суммарно = записи реестра без org_itself (single source)', () => {
    const total = Object.values(SUBORDINATES_FALLBACK).flat().length;
    const expected = SUBORDINATE_REGISTRY.filter((s) => !s.isOrgItself).length;
    expect(total).toBe(expected);
  });
});
