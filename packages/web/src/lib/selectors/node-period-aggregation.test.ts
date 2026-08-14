// Страж дефекта Д5 (реестр 05.08.2026): итоги считались за выбранный период,
// а разрезы — управление, подведомственная, укрупнённая сводка — брали годовые
// поля объекта. При выборе квартала целое и части расходились.
// Здесь закреплено: один узел за период, сумма частей = целое, бюджет и
// экономия тоже сужаются периодом.
import { describe, expect, it } from 'vitest';
import { aggregateNodeTotals, aggregateTotals } from './totals-aggregation';
import { resolvePeriodSelection } from './period-resolution';
import type { PeriodScope } from '../../store';

const NO_MONTHS = new Set<number>();
const BOTH = { showKP: true, showEP: true, activeMonths: NO_MONTHS, hasMonthData: false };

function q(planCount: number, factCount: number, planTotal: number, factTotal: number, extra: any = {}) {
  return {
    planCount, factCount, planTotal, factTotal,
    kpCount: extra.kpCount ?? 0, epCount: extra.epCount ?? 0,
    economyTotal: extra.economyTotal ?? 0,
    planFB: extra.planFB ?? 0, planKB: extra.planKB ?? 0, planMB: extra.planMB ?? planTotal,
    factFB: 0, factKB: 0, factMB: extra.factMB ?? factTotal,
    economyFB: 0, economyKB: 0, economyMB: extra.economyMB ?? 0,
  };
}

/** Подведомственная с квартальной базой. */
function sub(name: string, quarters: Record<string, any>, year: any = {}) {
  return {
    name, quarters,
    rowCount: year.rowCount ?? 0,
    planTotal: year.planTotal ?? 0, factTotal: year.factTotal ?? 0,
    competitiveCount: year.competitiveCount ?? 0, soleCount: year.soleCount ?? 0,
  };
}

const resolution = (p: PeriodScope) => resolvePeriodSelection(p, NO_MONTHS, false);

describe('aggregateNodeTotals — период применяется к узлу', () => {
  const node = sub('УКСиМП', {
    q1: q(10, 8, 1000, 700, { kpCount: 2, epCount: 8, economyTotal: 30 }),
    q2: q(6, 3, 600, 200, { kpCount: 1, epCount: 5, economyTotal: 10 }),
    q3: q(8, 1, 900, 100, { kpCount: 3, epCount: 5, economyTotal: 5 }),
    q4: q(4, 0, 400, 0, { kpCount: 0, epCount: 4 }),
  }, { planTotal: 2900, factTotal: 1000, competitiveCount: 6, soleCount: 22 });

  it('квартал берёт только свой квартал, а не год', () => {
    const r = aggregateNodeTotals(node, resolution('q3'), BOTH);
    expect(r.planCount).toBe(8);
    expect(r.factCount).toBe(1);
    expect(r.planTotal).toBe(900);
    expect(r.factTotal).toBe(100);
    expect(r.kp).toBe(3);
    expect(r.ep).toBe(5);
    expect(r.economyTotal).toBe(5);
    expect(r.periodApplied).toBe(true);
  });

  it('разные кварталы дают разные числа (иначе период не применяется)', () => {
    const q1 = aggregateNodeTotals(node, resolution('q1'), BOTH);
    const q3 = aggregateNodeTotals(node, resolution('q3'), BOTH);
    expect(q1.planTotal).not.toBe(q3.planTotal);
    expect(q1.factCount).not.toBe(q3.factCount);
  });

  it('бюджет сужается периодом, а не суммирует четыре квартала', () => {
    const r = aggregateNodeTotals(node, resolution('q2'), BOTH);
    expect(r.budget.planMB).toBe(600);
    const year = aggregateNodeTotals(node, resolution('year'), BOTH);
    expect(year.budget.planMB).not.toBe(r.budget.planMB);
  });

  it('фильтр способа режет и счётчики, и деньги', () => {
    const onlyEP = aggregateNodeTotals(node, resolution('q3'), { ...BOTH, showKP: false });
    expect(onlyEP.kp).toBe(0);
    expect(onlyEP.ep).toBe(5);
  });

  it('нет квартальной базы → годовые поля и честная пометка', () => {
    const bare = { name: 'МКУ', planTotal: 500, factTotal: 100, competitiveCount: 2, soleCount: 3, rowCount: 5 };
    const r = aggregateNodeTotals(bare, resolution('q2'), BOTH);
    expect(r.periodApplied).toBe(false);
    expect(r.planTotal).toBe(500);
  });
});

describe('целое = сумма частей за один и тот же период', () => {
  const subA = sub('А', { q3: q(5, 2, 500, 200, { kpCount: 1, epCount: 4, economyTotal: 7 }) });
  const subB = sub('Б', { q3: q(3, 1, 400, 150, { kpCount: 2, epCount: 1, economyTotal: 3 }) });
  // Управление = сумма своих подведомственных (данные согласованы по построению)
  const dept = {
    department: { id: 'uk', nameShort: 'УК' },
    subordinates: [subA, subB],
    quarters: { q3: q(8, 3, 900, 350, { kpCount: 3, epCount: 5, economyTotal: 10 }) },
    planTotal: 9999, factTotal: 9999, // годовые — не должны просочиться в квартальный расчёт
  };

  it('управление за квартал = сумма подведов за тот же квартал', () => {
    const res = resolution('q3');
    const d = aggregateNodeTotals(dept, res, BOTH);
    const a = aggregateNodeTotals(subA, res, BOTH);
    const b = aggregateNodeTotals(subB, res, BOTH);

    expect(d.planTotal).toBe(a.planTotal + b.planTotal);
    expect(d.factTotal).toBe(a.factTotal + b.factTotal);
    expect(d.planCount).toBe(a.planCount + b.planCount);
    expect(d.factCount).toBe(a.factCount + b.factCount);
    expect(d.economyTotal).toBe(a.economyTotal + b.economyTotal);
    // годовые поля управления в квартальный расчёт не попали
    expect(d.planTotal).not.toBe(9999);
  });

  it('итог страницы = тот же расчёт по управлениям', () => {
    const res = resolution('q3');
    const totals = aggregateTotals([dept], res, BOTH);
    const d = aggregateNodeTotals(dept, res, BOTH);
    expect(totals.totalPlan).toBe(d.planTotal);
    expect(totals.totalFact).toBe(d.factTotal);
    expect(totals.totalPlanCount).toBe(d.planCount);
    expect(totals.totalFactCount).toBe(d.factCount);
    expect(totals.totalKP).toBe(d.kp);
    expect(totals.totalEP).toBe(d.ep);
  });
});

// ── Страж бага #4 (реестр охоты 08.08; интервью пп. 5, 6, 11, 12) ──
// Фильтр по подведам ОТМЕНЯЛ выбранный период: ветвь _subFiltered коротко
// замыкалась на годовых значениях узла — под заголовком квартала стояли
// годовые числа. Здесь закреплено: оверрайднутый узел идёт через ту же
// периодную ветвь, а депт-уровневые метод-поля из спреда не читаются.
describe('_subFiltered: период применяется, депт-поля спреда не читаются (баг #4)', () => {
  // Узел, каким его отдаёт applySubordinateFilter: годовые поля — срез
  // подведов; quarters/months — суммы подведов; НО в кварталах остались
  // метод-поля УПРАВЛЕНИЯ (kpCount 40, kpPlanTotal 9000…) — ловушка спреда.
  const overridden = {
    _subFiltered: true,
    planTotal: 700, factTotal: 300, competitiveCount: 6, soleCount: 3,
    economyTotal: 44,
    quarters: {
      q1: {
        planCount: 4, factCount: 2, planTotal: 380, factTotal: 200, economyTotal: 30,
        planMB: 380, factMB: 200,
        kpCount: 40, epCount: 20, kpPlanTotal: 9000, kpFactTotal: 8000, epPlanTotal: 1000, epFactTotal: 500,
      },
      q3: {
        planCount: 5, factCount: 1, planTotal: 320, factTotal: 100, economyTotal: 14,
        planMB: 320, factMB: 100,
        kpCount: 41, epCount: 21, kpPlanTotal: 9100, kpFactTotal: 8100, epPlanTotal: 1100, epFactTotal: 600,
      },
    },
    months: {
      7: { planCount: 3, factCount: 1, planTotal: 210, factTotal: 100, economyTotal: 9, planMB: 210, factMB: 100 },
      8: { planCount: 2, factCount: 0, planTotal: 110, factTotal: 0, economyTotal: 5, planMB: 110, factMB: 0 },
    },
  };

  it('квартал: деньги/счётчики/экономия/бюджет — срез подведов за квартал, не год', () => {
    const r = aggregateNodeTotals(overridden, resolution('q3'), BOTH);
    expect(r.planTotal).toBe(320);   // не 700 (год) и не 9100+1100 (депт-деньги из спреда)
    expect(r.factTotal).toBe(100);
    expect(r.planCount).toBe(5);
    expect(r.factCount).toBe(1);
    expect(r.economyTotal).toBe(14);
    expect(r.budget.planMB).toBe(320);
  });

  it('квартал: КП/ЕП — годовые подведомственные (разбивки способа у подведов нет), не депт-поля спреда', () => {
    const r = aggregateNodeTotals(overridden, resolution('q3'), BOTH);
    expect(r.kp).toBe(6);  // не 41 (kpCount управления в спреде квартала)
    expect(r.ep).toBe(3);
  });

  it('месяц: срез подведов за месяц, не квартал и не год', () => {
    const res = resolvePeriodSelection('year', new Set([7]), true);
    const r = aggregateNodeTotals(overridden, res, { ...BOTH, activeMonths: new Set([7]), hasMonthData: true });
    expect(r.planTotal).toBe(210);
    expect(r.factTotal).toBe(100);
    expect(r.economyTotal).toBe(9);
  });

  it('год: короткое замыкание на годовых полях узла сохранено', () => {
    const r = aggregateNodeTotals(overridden, resolution('year'), BOTH);
    expect(r.planTotal).toBe(700);
    expect(r.factTotal).toBe(300);
    expect(r.economyTotal).toBe(44);
    expect(r.kp).toBe(6);
    expect(r.ep).toBe(3);
    expect(r.planCount).toBe(9); // 4 + 5 из квартальных сумм подведов
  });
});
