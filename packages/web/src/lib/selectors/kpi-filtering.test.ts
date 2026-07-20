import { describe, expect, it } from 'vitest';
import { filterKpiCards, selectTopKpis } from './kpi-filtering';

const cards = [
  { metricKey: 'competitive.q1.percent', label: 'КП %' },
  { metricKey: 'competitive.q1.count', label: 'КП кол-во' },
  { metricKey: 'sole.q1.percent', label: 'ЕП %' },
  { metricKey: 'sole.q1.count', label: 'ЕП кол-во' },
  { metricKey: 'grbs.uer.kp.q1.count', label: 'УЭР КП' },
  { metricKey: 'grbs.uio.kp.q1.count', label: 'УИО КП' },
];

describe('filterKpiCards (извлечено из useFilteredData §7/§7b)', () => {
  it('фильтров нет — все карточки (та же ссылка)', () => {
    expect(filterKpiCards(cards, { hasDeptFilter: false, depts: [], normalizedSearch: '' })).toBe(cards);
  });

  it('ГРБС-фильтр: grbs.* только выбранных дептов, сводные — всегда', () => {
    const depts = [{ department: { id: 'uer' } }];
    const out = filterKpiCards(cards, { hasDeptFilter: true, depts, normalizedSearch: '' });
    expect(out.map(c => c.metricKey)).toEqual([
      'competitive.q1.percent', 'competitive.q1.count',
      'sole.q1.percent', 'sole.q1.count',
      'grbs.uer.kp.q1.count',
    ]);
  });

  it('поиск по label/metricKey', () => {
    const out = filterKpiCards(cards, { hasDeptFilter: false, depts: [], normalizedSearch: 'уио' });
    expect(out.map(c => c.metricKey)).toEqual(['grbs.uio.kp.q1.count']);
  });
});

describe('selectTopKpis (извлечено из useFilteredData, фолбэк остался в хуке)', () => {
  it('способ не выбран — КП и ЕП карточки текущего периода', () => {
    const out = selectTopKpis(cards, 'q1', new Set());
    expect(out.map(c => c.metricKey)).toEqual([
      'competitive.q1.percent', 'competitive.q1.count',
      'sole.q1.percent', 'sole.q1.count',
    ]);
  });

  it('выбран только КП — только competitive-ключи', () => {
    const out = selectTopKpis(cards, 'q1', new Set(['competitive']));
    expect(out.map(c => c.metricKey)).toEqual(['competitive.q1.percent', 'competitive.q1.count']);
  });

  it('выбран только ЕП — только sole-ключи', () => {
    const out = selectTopKpis(cards, 'q1', new Set(['single']));
    expect(out.map(c => c.metricKey)).toEqual(['sole.q1.percent', 'sole.q1.count']);
  });

  it('нет точных ключей периода — пусто (фолбэк — забота хука, DEPRECATED)', () => {
    expect(selectTopKpis(cards, 'year', new Set())).toEqual([]);
  });
});
