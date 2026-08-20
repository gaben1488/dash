import { describe, it, expect } from 'vitest';
import { buildSubBreakdown, subBreakdownTotals } from './sub-breakdown';

const groups = [
  { key: '_org_itself', label: 'Аппарат управления' },
  { key: 'МБОУ СОШ №1', label: 'МБОУ СОШ №1' },
  { key: 'МБДОУ «Ромашка»', label: 'МБДОУ «Ромашка»' },
];

const subordinates = [
  {
    name: '_org_itself',
    planTotal: 1000, factTotal: 400, executionPct: 40, competitiveCount: 2, epCount: 5,
    quarters: { q1: { planTotal: 300, factTotal: 120, executionPct: 40, competitiveCount: 1, epCount: 2 } },
  },
  { name: 'МБОУ СОШ №1', planTotal: 500, factTotal: 0, executionPct: 0, competitiveCount: 0, epCount: 3, quarters: {} },
];

describe('разбивка управления по организациям', () => {
  it('организация канона без строк остаётся в списке с честными пустотами', () => {
    const rows = buildSubBreakdown({ groups, subordinates, periodKey: 'year' });
    const romashka = rows.find((r) => r.key === 'МБДОУ «Ромашка»');
    expect(romashka).toBeDefined();
    expect(romashka?.hasRows).toBe(false);
    expect(romashka?.planTotal).toBeNull();
    expect(romashka?.executionPct).toBeNull();
  });

  it('аппарат идёт первым и получает свои числа', () => {
    const rows = buildSubBreakdown({ groups, subordinates, periodKey: 'year' });
    expect(rows[0].label).toBe('Аппарат управления');
    expect(rows[0].planTotal).toBe(1000);
    expect(rows[0].epCount).toBe(5);
  });

  it('суженный период берёт квартальный срез, а не годовой итог', () => {
    const rows = buildSubBreakdown({ groups, subordinates, periodKey: 'q1' });
    expect(rows[0].planTotal).toBe(300);
    // У организации квартального среза нет — числа пустые, а не годовые.
    const school = rows.find((r) => r.key === 'МБОУ СОШ №1');
    expect(school?.hasRows).toBe(true);
    expect(school?.planTotal).toBeNull();
  });

  it('итоги считают организации, которые действительно ведут закупки', () => {
    const totals = subBreakdownTotals(buildSubBreakdown({ groups, subordinates, periodKey: 'year' }));
    expect(totals.plan).toBe(1500);
    expect(totals.fact).toBe(400);
    expect(totals.withRows).toBe(2);
  });
});
