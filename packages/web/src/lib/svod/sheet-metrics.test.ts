/**
 * Числа в проверках взяты с живого листа «СВОД ТД-ПМ» (дамп книги
 * СВОД_ДЛЯ_GOOGLE от 18.08.2026): блок ЭА «Итого ЭА 2026» — строка 14,
 * блок ЕП «Итого ЕП 2026» — строка 26, сводная «ИТОГО 2026:» — строка 29,
 * шапка остатка — строка 2, доли — строки 31–32. Если наша арифметика
 * разойдётся с листом, тест назовёт ячейку, где это видно.
 */
import { describe, it, expect } from 'vitest';
import type { SvodBlock, SvodRow } from '@aemr/shared';
import { epShareByCount, methodShares, remainderToConclude } from './sheet-metrics';

/** Строка с нулями по умолчанию — в тесте задаются только нужные поля. */
function row(patch: Partial<SvodRow>): SvodRow {
  return {
    planCount: 0, factCount: 0, deviationCount: 0, executionPct: null,
    planFB: 0, planKB: 0, planMB: 0, planTotal: 0,
    factFB: 0, factKB: 0, factMB: 0, factTotal: 0,
    amountDeviation: 0, spentPct: null,
    economyFB: 0, economyKB: 0, economyMB: 0, economyTotal: 0,
    ...patch,
  };
}

/** «Итого ЭА 2026» — строка 14 листа. */
const KP_YEAR = row({
  planCount: 333, factCount: 284,
  planFB: 163185.72, planKB: 325369.59, planMB: 333913.03, planTotal: 822468.33,
  factFB: 92193.63, factKB: 223579.79, factMB: 267772.86, factTotal: 583546.28,
});

/** «Итого ЕП 2026» — строка 26 листа. */
const EP_YEAR = row({
  planCount: 2500, factCount: 2196,
  planFB: 20785.65, planKB: 31969.43, planMB: 457225.06, planTotal: 509980.14,
  factFB: 15523.45, factKB: 25572.54, factMB: 418569.47, factTotal: 459665.45,
});

/** «ИТОГО 2026:» — строка 29 листа (КП + ЕП). */
const TOTAL_YEAR = row({
  planCount: 2833, factCount: 2480,
  planFB: 183971.36, planKB: 357339.02, planMB: 791138.08, planTotal: 1332448.46,
  factFB: 107717.08, factKB: 249152.33, factMB: 686342.33, factTotal: 1043211.73,
});

const BLOCK: SvodBlock = {
  kp: { q1: KP_YEAR, year: KP_YEAR },
  ep: { q1: EP_YEAR, year: EP_YEAR },
  total: { q1: TOTAL_YEAR, year: TOTAL_YEAR },
};

describe('остаток к заключению — «План минус Факт разбивка» листа', () => {
  it('повторяет ячейки L2:O2 листа с точностью до копейки', () => {
    const r = remainderToConclude(KP_YEAR);
    // L2 = H14 − L14, M2 = I14 − M14, N2 = J14 − N14, O2 = K14 − O14
    expect(r.fb).toBeCloseTo(70992.09, 2);
    expect(r.kb).toBeCloseTo(101789.8, 2);
    expect(r.mb).toBeCloseTo(66140.17, 2);
    expect(r.total).toBeCloseTo(238922.05, 2);
  });

  it('сходится с «Отклонением, тыс. руб» листа по модулю: P14 = −O2', () => {
    const r = remainderToConclude(KP_YEAR);
    const amountDeviation = KP_YEAR.factTotal! - KP_YEAR.planTotal!;
    expect(r.total).toBeCloseTo(-amountDeviation, 6);
  });

  it('сумма по источникам равна итогу — как на листе', () => {
    const r = remainderToConclude(TOTAL_YEAR);
    // Допуск копеечный: в фикстуре стоят ОТОБРАЖАЕМЫЕ числа листа, округлённые
    // до сотых, а лист складывает полные. На самом листе K29 = SUM(H29:J29)
    // сходится точно — расхождение здесь целиком от округления фикстуры.
    expect(r.fb! + r.kb! + r.mb!).toBeCloseTo(r.total!, 1);
  });

  it('нет числа — нет остатка: пустота не превращается в ноль', () => {
    const r = remainderToConclude(row({ planFB: null, factFB: 10 }));
    expect(r.fb).toBeNull();
  });
});

describe('доли ЭА и ЕП — строки 31–32 листа, по деньгам', () => {
  it('доля ЭА: факт O14/O29 и план K14/K29', () => {
    const s = methodShares(BLOCK);
    expect(s.kp.fact).toBeCloseTo(0.5594, 4); // лист: 55,94 %
    expect(s.kp.plan).toBeCloseTo(0.6173, 4); // лист: 61,73 %
  });

  it('доля ЕП: факт O26/O29 и план K26/K29', () => {
    const s = methodShares(BLOCK);
    expect(s.ep.fact).toBeCloseTo(0.4406, 4); // лист: 44,06 %
    expect(s.ep.plan).toBeCloseTo(0.3827, 4); // лист: 38,27 %
  });

  it('две доли складываются в единицу — инвариант листа', () => {
    const s = methodShares(BLOCK);
    expect(s.kp.fact! + s.ep.fact!).toBeCloseTo(1, 6);
    expect(s.kp.plan! + s.ep.plan!).toBeCloseTo(1, 6);
  });

  it('нулевой знаменатель даёт «нет базы», а не 0 % (лист печатает «-»)', () => {
    const emptyBlock: SvodBlock = {
      kp: { q1: row({}), year: row({}) },
      ep: { q1: row({}), year: row({}) },
      total: { q1: row({}), year: row({}) },
    };
    const s = methodShares(emptyBlock);
    expect(s.kp.fact).toBeNull();
    expect(s.ep.plan).toBeNull();
  });
});

describe('доля ЕП по количеству — своё число, не листовое', () => {
  it('считается от планового количества процедур', () => {
    expect(epShareByCount(BLOCK)).toBeCloseTo(2500 / 2833, 6);
  });

  it('расходится с долей ЕП по деньгам — потому и названа иначе', () => {
    const byCount = epShareByCount(BLOCK)!;
    const byMoney = methodShares(BLOCK).ep.plan!;
    expect(Math.abs(byCount - byMoney)).toBeGreaterThan(0.4);
  });

  it('нет плановых процедур — нет доли', () => {
    const emptyBlock: SvodBlock = {
      kp: { q1: row({}), year: row({}) },
      ep: { q1: row({}), year: row({}) },
      total: { q1: row({}), year: row({}) },
    };
    expect(epShareByCount(emptyBlock)).toBeNull();
  });
});
