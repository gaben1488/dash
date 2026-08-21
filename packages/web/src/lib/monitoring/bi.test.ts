/**
 * Стражи разрезов витрины «Аналитика мониторинга».
 *
 * Проверяются ОБЕЩАНИЯ разрезов, а не оформление карточек:
 *   1) пустой знаменатель остаётся null и не превращается в «0 %» — иначе
 *      «делить нечего» и «делится в ноль» станут на экране одной новостью;
 *   2) концентрация группирует по НАПИСАНИЮ книги: клик по строке витрины
 *      обязан привести в реестр ровно к тем строкам, что она посчитала;
 *   3) экономия по бюджетам не сглаживает разрыв «ВСЕГО минус расписанное»,
 *      а выносит его отдельным числом с адресами строк;
 *   4) год переходящего хвоста берётся из суффикса кода, а строка без кода
 *      в хвост не записывается;
 *   5) маркер года из колонки A листа «25-26» не считается судьбой процедуры.
 */
import { describe, expect, it } from 'vitest';
import type { RegistryProcedure } from './contract';
import {
  budgetSavings, carryOver, customerConcentration, jointComparison,
  rejoinedFates, zeroReduction,
} from './bi';

function proc(over: Partial<RegistryProcedure> = {}): RegistryProcedure {
  return {
    sheet: '1. УЭР',
    row: 10,
    dept: 'УЭР',
    ppNum: '1',
    customer: 'МКУ «Заказчик»',
    code: 'ЭА1-26',
    codeNote: null,
    method: 'ЭА',
    year: 26,
    subject: 'Поставка бумаги',
    nmck: 1_000_000,
    applicationDate: '01.03.2026',
    publicationDate: '05.03.2026',
    deadlineDate: '14.03.2026',
    auctionDate: '18.03.2026',
    auctionPrice: 900_000,
    savingsTotal: 100_000,
    savingsMb: 100_000,
    savingsKb: null,
    savingsFb: null,
    savingsManual: false,
    selfCheck: 'верно',
    winner: 'ООО «Поставщик» ИНН 1234567890',
    winnerName: 'ООО «Поставщик»',
    winnerInn: '1234567890',
    outcome: null,
    stage: 'awarded',
    reductionRub: 100_000,
    reductionPct: 10,
    comment: null,
    customerNormalized: 'мку заказчик',
    savingsSplitSum: 100_000,
    controlAgrees: true,
    controlGapRub: 0,
    joint: false,
    innRepeated: false,
    durations: { toPublication: 4, toDeadline: 9, toAuction: 4, total: 17 },
    defects: [],
    ...over,
  };
}

// ── §1. Концентрация заказчиков ──────────────────────────────────────

describe('customerConcentration', () => {
  it('складывает деньги заказчика и накапливает доли сверху вниз', () => {
    const c = customerConcentration([
      proc({ customer: 'Школа', nmck: 600 }),
      proc({ customer: 'Сад', nmck: 300 }),
      proc({ customer: 'Школа', nmck: 100 }),
    ]);

    expect(c.customersTotal).toBe(2);
    expect(c.nmckTotalRub).toBe(1000);
    expect(c.rows.map((r) => r.customer)).toEqual(['Школа', 'Сад']);
    expect(c.rows[0]?.count).toBe(2);
    expect(c.rows[0]?.nmckRub).toBe(700);
    expect(c.rows[0]?.sharePct).toBeCloseTo(70);
    expect(c.rows[1]?.cumulativePct).toBeCloseTo(100);
    expect(c.customersForHalf).toBe(1);
  });

  it('не склеивает разные написания одного учреждения: клик обязан сойтись с реестром', () => {
    const c = customerConcentration([
      proc({ customer: 'МБОУ ЕСШ №1 им. М.В. Ломоносова', nmck: 100 }),
      proc({ customer: 'МБОУ "ЕСШ №1 ИМЕНИ М.В.ЛОМОНОСОВА"', nmck: 100 }),
    ]);
    expect(c.customersTotal).toBe(2);
    expect(c.rows.every((r) => r.sliceKey === r.customer)).toBe(true);
  });

  it('пустой вход не выдумывает нулевых долей', () => {
    const c = customerConcentration([]);
    expect(c.rows).toEqual([]);
    expect(c.topShares.top5).toBeNull();
    expect(c.medianCustomerRub).toBeNull();
    expect(c.customersForHalf).toBeNull();
  });

  it('строки без начальной цены остаются в счёте процедур, но не создают денег', () => {
    const c = customerConcentration([proc({ customer: 'Сад', nmck: null })]);
    expect(c.rows[0]?.count).toBe(1);
    expect(c.rows[0]?.nmckRub).toBe(0);
    expect(c.rows[0]?.sharePct).toBeNull();
  });
});

// ── §2. Экономия по бюджетам ─────────────────────────────────────────

describe('budgetSavings', () => {
  it('делит расписанную экономию по трём бюджетам и держит разрыв отдельно', () => {
    const b = budgetSavings([
      proc({ savingsTotal: 100, savingsMb: 50, savingsKb: 30, savingsFb: 20, savingsSplitSum: 100 }),
      proc({ savingsTotal: 40, savingsMb: null, savingsKb: null, savingsFb: null, savingsSplitSum: null }),
    ]);

    expect(b.bookTotalRub).toBe(140);
    expect(b.splitTotalRub).toBe(100);
    expect(b.unallocatedRub).toBe(40);
    expect(b.levels.find((l) => l.key === 'mb')?.sharePct).toBeCloseTo(50);
    expect(b.rowsWithoutSplit).toBe(1);
    expect(b.rowsWithoutSplitRefs[0]?.rub).toBe(40);
  });

  it('собирает адреса строк, где самопроверка книги показывает «ошибка»', () => {
    const b = budgetSavings([
      proc({ row: 7, controlAgrees: false, controlGapRub: 12, selfCheck: 'ошибка' }),
      proc({ row: 8, controlAgrees: true }),
    ]);
    expect(b.rowsControlError).toBe(1);
    expect(b.rowsControlErrorRefs[0]).toMatchObject({ sheet: '1. УЭР', row: 7, rub: 12 });
  });

  it('без экономии доли остаются пустыми, а не нулевыми', () => {
    const b = budgetSavings([proc({ savingsTotal: null, savingsMb: null, savingsKb: null, savingsFb: null, savingsSplitSum: null })]);
    expect(b.levels.every((l) => l.sharePct === null)).toBe(true);
    expect(b.unallocatedSharePct).toBeNull();
  });

  it('складывает бюджеты внутри управлений, а не по всей книге разом', () => {
    const b = budgetSavings([
      proc({ dept: 'УО', savingsMb: 10, savingsKb: 1, savingsFb: 0 }),
      proc({ dept: 'УД', savingsMb: 3, savingsKb: 0, savingsFb: 0 }),
      proc({ dept: 'УО', savingsMb: 5, savingsKb: 0, savingsFb: 4 }),
    ]);
    const uo = b.byDept.find((d) => d.dept === 'УО');
    expect(uo).toMatchObject({ mbRub: 15, kbRub: 1, fbRub: 4, splitTotalRub: 20 });
    expect(b.byDept[0]?.dept).toBe('УО');
  });
});

// ── §3. Торги без снижения ───────────────────────────────────────────

describe('zeroReduction', () => {
  it('считает долю бесторговых отдельно в процедурах и отдельно в деньгах', () => {
    const z = zeroReduction([
      proc({ nmck: 900, auctionPrice: 900, reductionRub: 0 }),
      proc({ nmck: 100, auctionPrice: 50, reductionRub: 50 }),
    ]);
    expect(z.pricedCount).toBe(2);
    expect(z.zeroCount).toBe(1);
    expect(z.countSharePct).toBeCloseTo(50);
    expect(z.moneySharePct).toBeCloseTo(90);
  });

  it('несостоявшиеся в знаменатель не входят: там нет цены, а не нулевое снижение', () => {
    const z = zeroReduction([
      proc({ stage: 'no_result', auctionPrice: 0, reductionRub: null }),
      proc({ stage: 'published', auctionPrice: null, reductionRub: null }),
    ]);
    expect(z.pricedCount).toBe(0);
    expect(z.countSharePct).toBeNull();
    expect(z.moneySharePct).toBeNull();
  });

  it('раскладывает бесторговые по способу и показывает долю внутри способа', () => {
    const z = zeroReduction([
      proc({ method: 'ЭЕП', nmck: 100, auctionPrice: 100, reductionRub: 0 }),
      proc({ method: 'ЭА', nmck: 100, auctionPrice: 100, reductionRub: 0 }),
      proc({ method: 'ЭА', nmck: 100, auctionPrice: 40, reductionRub: 60 }),
    ]);
    expect(z.byMethod.find((m) => m.key === 'ЭЕП')?.sharePct).toBeCloseTo(100);
    expect(z.byMethod.find((m) => m.key === 'ЭА')?.sharePct).toBeCloseTo(50);
  });
});

// ── §4. Переходящий хвост ────────────────────────────────────────────

describe('carryOver', () => {
  it('берёт год из суффикса кода и называет хвостом всё, что старше свежего года', () => {
    const c = carryOver([
      proc({ year: 26, nmck: 100 }),
      proc({ year: 26, nmck: 100 }),
      proc({ year: 25, nmck: 800 }),
    ]);
    expect(c.currentYear).toBe(26);
    expect(c.carriedCount).toBe(1);
    expect(c.carriedNmckRub).toBe(800);
    expect(c.carriedCountSharePct).toBeCloseTo(33.33, 1);
    expect(c.carriedMoneySharePct).toBeCloseTo(80);
  });

  it('строка без разобранного кода в хвост не записывается — год ей не приписывают', () => {
    const c = carryOver([proc({ year: 26 }), proc({ year: null, code: null })]);
    expect(c.carriedCount).toBe(0);
    expect(c.unknownYearCount).toBe(1);
    expect(c.rows.some((r) => r.year === null)).toBe(true);
  });

  it('раскладывает год по стадиям — застрявшее видно только так', () => {
    const c = carryOver([
      proc({ year: 25, stage: 'awarded' }),
      proc({ year: 25, stage: 'published' }),
      proc({ year: 26, stage: 'awarded' }),
    ]);
    const y25 = c.rows.find((r) => r.year === 25);
    expect(y25?.byStage).toEqual({ awarded: 1, published: 1 });
  });

  it('пустая книга не даёт ни текущего года, ни долей', () => {
    const c = carryOver([]);
    expect(c.currentYear).toBeNull();
    expect(c.carriedCountSharePct).toBeNull();
  });
});

// ── §5. Совместные против одиночных ──────────────────────────────────

describe('jointComparison', () => {
  it('сравнивает стороны портфельно: деньги делятся на деньги', () => {
    const j = jointComparison([
      proc({ joint: true, nmck: 1000, auctionPrice: 900, reductionRub: 100 }),
      proc({ joint: false, nmck: 100, auctionPrice: 50, reductionRub: 50 }),
    ]);
    expect(j.joint.reductionPct).toBeCloseTo(10);
    expect(j.solo.reductionPct).toBeCloseTo(50);
    expect(j.jointMoneySharePct).toBeCloseTo(90.9, 1);
    expect(j.jointCountSharePct).toBeCloseTo(50);
  });

  it('берёт готовый признак ядра, а не ищет слово «совместный» в заказчике', () => {
    const j = jointComparison([proc({ joint: false, customer: 'Совместный аукцион ШКОЛЫ' })]);
    expect(j.joint.count).toBe(0);
    expect(j.solo.count).toBe(1);
  });

  it('сторона без состоявшихся не показывает снижение нулём', () => {
    const j = jointComparison([proc({ joint: true, stage: 'no_result', auctionPrice: 0 })]);
    expect(j.joint.reductionPct).toBeNull();
    expect(j.solo.reductionPct).toBeNull();
  });
});

// ── §6. Судьбы переобъявлений ────────────────────────────────────────

const FATE_LABELS = {
  repeat: 'Повторная процедура',
  'fas-complaint': 'Жалоба в ФАС',
  'year-marker': 'Маркер года',
};

describe('rejoinedFates', () => {
  it('маркер года судьбой не считается', () => {
    const f = rejoinedFates(
      [
        { fate: 'year-marker', fateRaw: '2026' },
        { fate: 'repeat', fateRaw: 'Повторный аукцион ЭА5-26' },
        { fate: null, fateRaw: null },
      ],
      FATE_LABELS,
    );
    expect(f.markedRows).toBe(1);
    expect(f.totalRows).toBe(3);
    expect(f.rows.map((r) => r.fate)).toEqual(['repeat']);
  });

  it('держит сырые написания рядом с классом — класс без исходника не проверить', () => {
    const f = rejoinedFates(
      [
        { fate: 'fas-complaint', fateRaw: 'ФАС' },
        { fate: 'fas-complaint', fateRaw: 'УФАС-жалоба' },
        { fate: 'fas-complaint', fateRaw: 'ФАС' },
      ],
      FATE_LABELS,
    );
    expect(f.rows[0]?.count).toBe(3);
    expect(f.rows[0]?.samples).toEqual(['ФАС', 'УФАС-жалоба']);
    expect(f.rows[0]?.sharePct).toBeCloseTo(100);
  });

  it('лист без пометок даёт пустоту, а не нулевые доли', () => {
    const f = rejoinedFates([{ fate: null, fateRaw: null }], FATE_LABELS);
    expect(f.rows).toEqual([]);
    expect(f.markedSharePct).toBeCloseTo(0);
  });

  it('неизвестный класс показывается ключом, а не выбрасывается', () => {
    const f = rejoinedFates([{ fate: 'treasury', fateRaw: 'не прошло в казне' }], FATE_LABELS);
    expect(f.rows[0]?.label).toBe('treasury');
    expect(f.rows[0]?.count).toBe(1);
  });
});
