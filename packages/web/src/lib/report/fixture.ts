/**
 * Тестовая фикстура Report — калибрована эталоном ручного отчёта 20.03.2026
 * (УЭР 1 кв: заключено 6 из 15 = 40,0%). Используется юнитами mappers/text;
 * в прод-коде не участвует.
 */
import type { GrbsReportBlock, PlanFactCounts, Report } from '@aemr/core';

function counts(planCount: number, doneCount: number, origin: 'calc' | 'svod' = 'calc'): PlanFactCounts {
  return {
    planCount,
    doneCount,
    pct: planCount > 0 ? (doneCount / planCount) * 100 : null,
    origin,
  };
}

/** Блок УЭР: полный (деньги, экономия, СВОД-сверка, сигнал). */
function uerBlock(): GrbsReportBlock {
  return {
    dept: 'УЭР',
    deptLabel: 'Управление экономического развития',
    quarter: {
      execution: { planCount: 15, doneCount: 6, pct: 40 },
      methods: { kp: counts(10, 4), ep: counts(5, 2) },
      pendingCount: 9,
      // Живой счёт (без гейта среза) на одну КП-процедуру больше отчётного —
      // так выглядит договор, заключённый уже после четверга: сверка со СВОДом
      // сходится, а разрыв объясняется подписью.
      live: { kp: counts(10, 5), ep: counts(5, 2) },
      svod: { kp: counts(10, 5, 'svod'), ep: counts(5, 2, 'svod') },
    },
    year: {
      counts: counts(50, 20),
      methods: { kp: counts(30, 12), ep: counts(20, 8) },
      pendingCount: 30,
    },
    money: {
      plan: { fb: 1000, kb: 2000, mb: 500, total: 3500, origin: 'calc' },
      fact: { fb: 800, kb: 1500, mb: 200, total: 2500, origin: 'calc' },
    },
    economy: { fb: 50, kb: 100, mb: 0, total: 150, origin: 'calc' },
    topSignals: [{ id: 'sig-1', severity: 'warning', title: 'Просрочен план размещения по 3 процедурам' }],
  };
}

/** Блок УО: без СВОД-листа, без плана на квартал (pct = null), без экономии. */
function uoBlock(): GrbsReportBlock {
  return {
    dept: 'УО',
    deptLabel: 'Управление образования',
    quarter: {
      execution: { planCount: 0, doneCount: 0, pct: null },
      methods: { kp: counts(0, 0), ep: counts(0, 0) },
      pendingCount: 0,
      live: { kp: counts(0, 0), ep: counts(0, 0) },
    },
    year: {
      counts: counts(30, 34),
      methods: { kp: counts(20, 24), ep: counts(10, 10) },
      pendingCount: 0,
    },
    money: {
      plan: { fb: 0, kb: 900, mb: 100, total: 1000, origin: 'calc' },
      fact: { fb: 0, kb: 850, mb: 100, total: 950, origin: 'calc' },
    },
    economy: { fb: 0, kb: 0, mb: 0, total: 0, origin: 'calc' },
    topSignals: [],
  };
}

export function makeReportFixture(): Report {
  return {
    period: { year: 2026, quarter: 1, asOfDay: 79 },
    integralSummary: {
      year: {
        kp: counts(50, 30),
        ep: counts(30, 24),
        total: counts(80, 54),
      },
      quarter: {
        kp: counts(10, 4),
        ep: counts(5, 2),
        total: counts(15, 6),
      },
      money: {
        plan: { fb: 1000, kb: 2900, mb: 600, total: 4500, origin: 'calc' },
        fact: { fb: 800, kb: 2350, mb: 300, total: 3450, origin: 'calc' },
        economy: { fb: 50, kb: 100, mb: 0, total: 150, origin: 'calc' },
      },
      svodQuarter: { kp: counts(10, 5, 'svod'), ep: counts(5, 2, 'svod') },
    },
    grbsBlocks: [uerBlock(), uoBlock()],
    notes: ['Лист СВОД за 1 квартал не передан для УД — сверка по нему не выполнялась'],
  };
}
