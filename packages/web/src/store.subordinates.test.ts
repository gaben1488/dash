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

  it('значения = canonicalName (дословная колонка C книги), не displayName (п.51)', () => {
    // Класс дефекта «счётчик подведов завышен»: displayName («КДМШ») не
    // совпадал строково с живым значением C («МБУ ДО "КДМШ"») из
    // /api/rows/subordinates — объединение плодило дубль организации.
    const canon = new Set(SUBORDINATE_REGISTRY.map((s) => s.canonicalName));
    for (const name of Object.values(SUBORDINATES_FALLBACK).flat()) {
      expect(canon.has(name), `«${name}» не является canonicalName реестра`).toBe(true);
    }
  });

  it('УАГЗО (форма данных) получает подвед через мост УАГиЗО→УАГЗО', () => {
    expect(SUBORDINATES_FALLBACK['УАГЗО']).toContain('МКУ "Елизовское РУС"');
  });

  it('записи самого управления (org_itself) исключены', () => {
    const all = Object.values(SUBORDINATES_FALLBACK).flat();
    for (const s of SUBORDINATE_REGISTRY) {
      if (s.isOrgItself) expect(all).not.toContain(s.canonicalName);
    }
  });

  it('суммарно = записи реестра без org_itself (single source)', () => {
    const total = Object.values(SUBORDINATES_FALLBACK).flat().length;
    const expected = SUBORDINATE_REGISTRY.filter((s) => !s.isOrgItself).length;
    expect(total).toBe(expected);
  });

  it('п.51: УКСиМП — ровно 21 позиция (20 подведов + «Совместная закупка»), без выдуманных', () => {
    const uksimp = SUBORDINATES_FALLBACK['УКСиМП'];
    expect(uksimp).toHaveLength(21);
    // Страж от возврата демо-заглушки 18.04: КЦЕ и «Спортивная школа» в
    // книгах не существуют — реестр обязан совпадать с колонкой C книг.
    const joined = uksimp.join(' | ');
    expect(joined).not.toContain('КЦЕ');
    expect(joined).not.toContain('Культурный центр Елизово');
    expect(uksimp).not.toContain('МКУ «Спортивная школа»');
  });
});
