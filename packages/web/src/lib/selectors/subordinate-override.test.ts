import { describe, expect, it } from 'vitest';
import { applySubordinateFilter } from './subordinate-override';

const school = {
  name: 'Школа №1',
  planTotal: 40, factTotal: 20, competitiveCount: 2, epCount: 1, economyTotal: 5, rowCount: 7,
  quarters: {
    q1: {
      planCount: 3, factCount: 1, planTotal: 40, factTotal: 20, economyTotal: 5,
      planFB: 30, planKB: 10, factFB: 15, factKB: 5,
    },
  },
  months: { 1: { planCount: 1, factCount: 1, planTotal: 10, factTotal: 10 } },
};

const sad = {
  name: 'Сад №2',
  planTotal: 60, factTotal: 30, competitiveCount: 1, epCount: 2, economyTotal: 3, rowCount: 4,
  quarters: { q1: { planCount: 2, factCount: 1, planTotal: 60, factTotal: 30 } },
};

const makeUer = () => ({
  department: { id: 'uer', nameShort: 'УЭР' },
  planTotal: 1000, factTotal: 500, competitiveCount: 10, soleCount: 5,
  quarters: { q1: { planTotal: 999, someOriginalField: 'x' } },
  months: {},
  subordinates: [school, sad],
});
const uio = { department: { id: 'uio', nameShort: 'УИО' }, subordinates: [] };
const subordinatesMap = { 'УЭР': ['Школа №1', 'Сад №2'], 'УИО': [] };

describe('applySubordinateFilter (извлечено из useFilteredData §2, выживший §3.4)', () => {
  it('фильтр пуст — депты возвращаются без изменений (та же ссылка)', () => {
    const depts = [makeUer(), uio];
    expect(applySubordinateFilter(depts, new Set(), subordinatesMap)).toBe(depts);
  });

  it('сужает до дептов с выбранным подведом и оверрайдит агрегаты суммой подведов', () => {
    const out = applySubordinateFilter([makeUer(), uio], new Set(['Школа №1']), subordinatesMap);
    expect(out).toHaveLength(1);
    const d = out[0];
    expect(d._subFiltered).toBe(true);
    expect(d.planTotal).toBe(40);
    expect(d.factTotal).toBe(20);
    expect(d.executionPercent).toBe(50);
    expect(d.competitiveCount).toBe(2);
    expect(d.soleCount).toBe(1);
    expect(d.economyTotal).toBe(5);
    expect(d._subRowCount).toBe(7);
    expect(d.subordinates).toEqual([school]);
  });

  it('суммирует квартальные разбивки подведов (вкл. per-budget) поверх исходного квартала', () => {
    const out = applySubordinateFilter([makeUer()], new Set(['Школа №1', 'Сад №2']), subordinatesMap);
    const q1 = out[0].quarters.q1;
    expect(q1.planCount).toBe(5);       // 3 + 2
    expect(q1.planTotal).toBe(100);     // 40 + 60
    expect(q1.factTotal).toBe(50);      // 20 + 30
    expect(q1.planFB).toBe(30);
    expect(q1.executionPct).toBe(50);
    expect(q1.someOriginalField).toBe('x'); // спред исходного квартала сохранён
    // месяц пришёл только от школы
    expect(out[0].months[1].planTotal).toBe(10);
    expect(out[0].months[1].executionPct).toBe(100);
  });

  it('«аппарат управления» (_org_itself) без записи в subordinatesMap не сужает депты (Б4)', () => {
    const depts = [makeUer(), uio];
    const out = applySubordinateFilter(depts, new Set(['_org_itself']), subordinatesMap);
    expect(out).toHaveLength(2);
  });

  it('депт без матчей в собственном subList возвращается без оверрайда', () => {
    // 'Сад №2' есть в subordinatesMap УЭР, но уберём его из subList
    const d = { ...makeUer(), subordinates: [school] };
    const out = applySubordinateFilter([d], new Set(['Сад №2']), subordinatesMap);
    expect(out).toHaveLength(1);
    expect(out[0]._subFiltered).toBeUndefined();
    expect(out[0].planTotal).toBe(1000);
  });
});
