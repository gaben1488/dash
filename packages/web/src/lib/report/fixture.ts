/**
 * Тестовая фикстура Report — калибрована эталоном ручного отчёта 20.03.2026
 * (УЭР 1 кв: заключено 6 из 15 = 40,0%). Используется юнитами mappers/text;
 * в прод-коде не участвует.
 */
import type { BudgetMoney, GrbsReportBlock, PendingRemainder, PlanFactCounts, Report } from '@aemr/core';

function counts(planCount: number, doneCount: number, origin: 'calc' | 'svod' = 'calc'): PlanFactCounts {
  return {
    planCount,
    doneCount,
    pct: planCount > 0 ? (doneCount / planCount) * 100 : null,
    origin,
  };
}

/** Остаток в плановых деньгах: тройка бюджетов всегда сходится с итогом. */

/** Денежная тройка для фикстуры (total = сумма, как в проекции). */
function bm(fb: number, kb: number, mb: number): BudgetMoney {
  return { fb, kb, mb, total: fb + kb + mb, origin: 'calc' };
}

function pending(count: number, fb: number, kb: number, mb: number): PendingRemainder {
  return { count, fb, kb, mb, total: fb + kb + mb };
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
      pending: pending(9, 110, 220, 330),
      pendingByMethod: { kp: pending(6, 100, 200, 300), ep: pending(3, 10, 20, 30) },
      pendingPositions: [{
        sheetRow: 12,
        subject: 'Поставка учебной мебели',
        method: 'ЭА',
        planDate: '15.03.2026',
        planTotal: 610,
        explanations: [{ label: 'Комментарий ГРБСа', text: 'Ожидаем доведения лимитов, контракт будет подписан до 30.09.2026.' }],
        forecastDate: '30.09.2026',
      }],
      // Живой счёт (без гейта среза) на одну КП-процедуру больше отчётного —
      // так выглядит договор, заключённый уже после четверга: сверка со СВОДом
      // сходится, а разрыв объясняется подписью.
      moneyByMethod: {
        kp: { plan: bm(100, 400, 500), fact: bm(50, 150, 200) },
        ep: { plan: bm(0, 100, 150), fact: bm(0, 50, 50) },
      },
      live: { kp: counts(10, 5), ep: counts(5, 2) },
      svod: { kp: counts(10, 5, 'svod'), ep: counts(5, 2, 'svod') },
    },
    year: {
      counts: counts(50, 20),
      methods: { kp: counts(30, 12), ep: counts(20, 8) },
      pendingCount: 30,
      pending: pending(30, 500, 1000, 1500),
    },
    reasons: {
      epReasons: [
        { cluster: 'EP_LOWEST_PRICE', label: 'Закупка с ЕП по наименьшей цене', count: 12,
          sample: 'Закупка с ЕП предусматривает заключение по наименьшей цене', legitimate: true },
        { cluster: 'UNMAPPED', label: 'Формулировка не распознана', count: 2, sample: 'АО Кам Инжиниринг' },
      ],
      deviations: [
        { cluster: 'DEV_NO_FUNDING', label: 'Нет финансирования: лимиты не доведены', count: 8,
          sample: 'в связи отсутствием финансирования закупка переносится на 30.09.2026',
          owner: 'финансовый орган', actionable: true },
      ],
    },
    lifecycle: {
      byType: [
        { metricKey: 'lifecycle_type_current', count: 30, planTotal: 2000 },
        { metricKey: 'lifecycle_type_program', count: 20, planTotal: 2500 },
      ],
      byStage: [
        { metricKey: 'lifecycle_stage_concluded', count: 20, planTotal: 1500 },
        { metricKey: 'lifecycle_stage_in_work', count: 25, planTotal: 2200 },
        { metricKey: 'lifecycle_stage_overdue', count: 5, planTotal: 800 },
      ],
    },
    money: {
      plan: { fb: 1000, kb: 2000, mb: 500, total: 3500, origin: 'calc' },
      fact: { fb: 800, kb: 1500, mb: 200, total: 2500, origin: 'calc' },
    },
    economy: { fb: 50, kb: 100, mb: 0, total: 150, origin: 'calc' },
    signals: [{
      id: 'sig-1',
      severity: 'warning',
      title: 'Просрочен план размещения по 3 процедурам',
      description: 'Плановая дата размещения прошла, дата заключения не проставлена по трём строкам листа.',
      sheet: 'ВСЕ',
      cell: 'S12',
    }],
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
      pending: pending(0, 0, 0, 0),
      pendingByMethod: { kp: pending(0, 0, 0, 0), ep: pending(0, 0, 0, 0) },
      pendingPositions: [],
      moneyByMethod: {
        kp: { plan: bm(0, 0, 0), fact: bm(0, 0, 0) },
        ep: { plan: bm(0, 0, 0), fact: bm(0, 0, 0) },
      },
      live: { kp: counts(0, 0), ep: counts(0, 0) },
    },
    year: {
      counts: counts(30, 34),
      methods: { kp: counts(20, 24), ep: counts(10, 10) },
      pendingCount: 0,
      pending: pending(0, 0, 0, 0),
    },
    lifecycle: { byType: [], byStage: [] },
    reasons: { epReasons: [], deviations: [] },
    money: {
      plan: { fb: 0, kb: 900, mb: 100, total: 1000, origin: 'calc' },
      fact: { fb: 0, kb: 850, mb: 100, total: 950, origin: 'calc' },
    },
    economy: { fb: 0, kb: 0, mb: 0, total: 0, origin: 'calc' },
    signals: [],
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
      moneyByMethod: {
        kp: { plan: bm(100, 400, 500), fact: bm(50, 150, 200) },
        ep: { plan: bm(0, 100, 150), fact: bm(0, 50, 50) },
      },
      pending: {
        quarter: pending(9, 110, 220, 330),
        year: pending(30, 500, 1000, 1500),
      },
      svodQuarter: { kp: counts(10, 5, 'svod'), ep: counts(5, 2, 'svod') },
    },
    grbsBlocks: [uerBlock(), uoBlock()],
    notes: ['Лист СВОД за 1 квартал не передан для УД — сверка по нему не выполнялась'],
  };
}
