/**
 * buildReport — TDD на синтетике, калиброванной эталоном ручного отчёта
 * «Отчёт по закупкам на 20.03.2026»: УЭР 1 кв план 15 / факт 6 → 40.00%
 * (та же калибровка, что у quarter-execution.test.ts).
 *
 * Обязательные инварианты кросс-фута (делта-спека
 * docs/superpowers/specs/2026-07-14-report-2-additional-delta.md §5.1):
 *   бюджет:    ФБ + КБ + МБ = ИТОГО;
 *   агрегация: Σ по блокам ГРБС = интегральная сводка.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS, type Issue, type SvodGridBlock, type SvodSheetExtras } from '@aemr/shared';
import { buildReport } from './build-report.js';

const COL = DEPT_COLUMNS;

interface RowOverrides {
  id?: string;
  method?: string;
  planQuarter?: number | string;
  planYear?: number | string;
  factDate?: string;
  ecoKB?: number;
  ecoFlag?: string;
}

/** Синтетическая строка ГРБС-листа (32 колонки), формат фикстур core-тестов. */
function makeRow(overrides: RowOverrides = {}): unknown[] {
  const row: unknown[] = new Array(32).fill('');
  row[COL.ID] = overrides.id ?? '1';
  row[COL.TYPE] = 'Текущая деятельность';
  row[COL.SUBJECT] = 'Закупка';
  row[COL.FB_PLAN] = 100;
  row[COL.KB_PLAN] = 200;
  row[COL.MB_PLAN] = 0;
  row[COL.TOTAL_PLAN] = 300;
  row[COL.METHOD] = overrides.method ?? 'ЭА';
  row[COL.PLAN_DATE] = '15.01.2026';
  row[COL.PLAN_QUARTER] = overrides.planQuarter ?? 1;
  row[COL.PLAN_YEAR] = overrides.planYear ?? 2026;
  row[COL.FACT_DATE] = overrides.factDate ?? '';
  if (overrides.factDate) {
    row[COL.FB_FACT] = 50;
    row[COL.KB_FACT] = 100;
    row[COL.MB_FACT] = 0;
    row[COL.TOTAL_FACT] = 150;
  }
  if (overrides.ecoKB !== undefined) {
    row[COL.ECONOMY_KB] = overrides.ecoKB;
    row[COL.FLAG] = overrides.ecoFlag ?? 'да';
  }
  return row;
}

/** n строк плана квартала q способом method, из них первые withFact — с фактом. */
function planRows(prefix: string, n: number, withFact: number, q: number, method: string): unknown[][] {
  return Array.from({ length: n }, (_, i) =>
    makeRow({
      id: `${prefix}-${i + 1}`,
      planQuarter: q,
      method,
      factDate: i < withFact ? '20.02.2026' : '',
    }),
  );
}

/**
 * Эталонная фикстура (калибровка отчётом 20.03.2026):
 *   УЭР:    1 кв план 15 (10 ЭА + 5 ЕП), факт 6 (4 ЭА + 2 ЕП) → 40.00%;
 *   УКСиМП: 1 кв план 30 ЭА, факт 4 → 13.33%.
 * У каждой факт-строки УЭР — утверждённая экономия КБ 10 (флаг AD='да').
 */
function fixtureRows(): Record<string, unknown[][]> {
  const uerKp = planRows('uer-kp', 10, 4, 1, 'ЭА');
  const uerEp = planRows('uer-ep', 5, 2, 1, 'ЕП');
  for (const row of [...uerKp, ...uerEp]) {
    if (row[COL.FACT_DATE]) {
      row[COL.ECONOMY_KB] = 10;
      row[COL.FLAG] = 'да';
    }
  }
  return {
    УЭР: [...uerKp, ...uerEp],
    УКСиМП: planRows('uksimp-kp', 30, 4, 1, 'ЭА'),
  };
}

/** Официальный блок СВОД (литерал вместо parseSvodGrid — тот же тип). */
function svodBlock(
  scope: string,
  method: 'КП' | 'ЕП',
  planCount: number,
  factCount: number,
  /** Строка листа — провенанс: адрес ячейки собирается из неё («D257»/«E257»). */
  row = 257,
): SvodGridBlock {
  return {
    scope,
    method,
    startRow: row,
    periods: [{
      quarter: 1, year: 2026, row,
      planCount, factCount, devCount: planCount - factCount,
      execPct: planCount > 0 ? factCount / planCount : 0,
      planFB: 0, planKB: 0, planMB: 0, planTotal: 0,
      factFB: 0, factKB: 0, factMB: 0, factTotal: 0,
      devMoney: 0, spentPct: 0,
      economyFB: 0, economyKB: 0, economyMB: 0, economyTotal: 0,
    }],
  };
}

const OPTS = { year: 2026, quarter: 1 as const, asOfDay: 20623 };

describe('buildReport — блок ГРБС (калибровка эталоном 20.03.2026)', () => {
  it('УЭР: 1 кв план 15, факт 6 → 40.00%, незаключённых 9', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР');
    expect(uer).toBeDefined();
    expect(uer!.quarter.execution.planCount).toBe(15);
    expect(uer!.quarter.execution.doneCount).toBe(6);
    expect(uer!.quarter.execution.pct).toBeCloseTo(40.0, 2);
    expect(uer!.quarter.pendingCount).toBe(9);
  });

  it('УКСиМП: 4/30 → 13.33% (эталон), незаключённых 26', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const uksimp = report.grbsBlocks.find((b) => b.dept === 'УКСиМП');
    expect(uksimp!.quarter.execution.pct).toBeCloseTo(13.33, 2);
    expect(uksimp!.quarter.pendingCount).toBe(26);
  });

  it('КП/ЕП-разрез квартала: УЭР КП 4/10, ЕП 2/5', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.quarter.methods.kp.planCount).toBe(10);
    expect(uer.quarter.methods.kp.doneCount).toBe(4);
    expect(uer.quarter.methods.ep.planCount).toBe(5);
    expect(uer.quarter.methods.ep.doneCount).toBe(2);
  });

  it('годовой срез: план/факт года и незаключённые (план − факт)', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.year.counts.planCount).toBe(15);
    expect(uer.year.counts.doneCount).toBe(6);
    expect(uer.year.pendingCount).toBe(9);
  });

  it('строка без планового квартала не входит в годовой ярус (правила счёта §2)', () => {
    // Год = сумма четырёх кварталов: у строки без квартала O нет места ни в
    // одном из них, значит нет и в году. До починки годовой ярус брал
    // негруппированный итог движка и тянул такие строки: на живых книгах
    // 26.06.2026 это давало +430 строк к плану года.
    const rows = fixtureRows();
    rows['УЭР'].push(makeRow({ id: 'no-q', planQuarter: '' }));
    // Вторая такая же, но уже заключённая, — чтобы факт года тоже проверился.
    rows['УЭР'].push(makeRow({ id: 'no-q-fact', planQuarter: '', factDate: '20.02.2026' }));
    const report = buildReport({ rowsByDept: rows }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.year.counts.planCount).toBe(15);
    expect(uer.year.counts.doneCount).toBe(6);
    expect(uer.year.methods.kp.planCount).toBe(10);
    expect(uer.year.methods.kp.doneCount).toBe(4);
    expect(uer.year.pending.count).toBe(9);
    expect(uer.year.pendingCount).toBe(9);
    // Интеграл наследует то же правило — иначе шапка отчёта разойдётся с блоками.
    expect(report.integralSummary.year.total.planCount).toBe(45);
    expect(report.integralSummary.year.kp.planCount).toBe(40);
    expect(report.integralSummary.pending.year.count).toBe(35);
  });

  it('год = сумма кварталов: строки следующих кварталов входят все', () => {
    // Зеркало предыдущего теста: правило «только с кварталом» не должно
    // превратиться в «только отчётный квартал» — год шире квартала.
    const rows = fixtureRows();
    rows['УЭР'].push(...planRows('uer-q3', 7, 2, 3, 'ЭА'));
    const report = buildReport({ rowsByDept: rows }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.year.counts.planCount).toBe(22);
    expect(uer.year.methods.kp.planCount).toBe(17);
    expect(uer.year.counts.doneCount).toBe(8);
    expect(uer.year.pending.count).toBe(14);
  });

  it('строки чужого план-года не входят (канон: явный год ≠ целевому — вне среза)', () => {
    const rows = fixtureRows();
    rows['УЭР'].push(makeRow({ id: 'y2025', planYear: 2025, factDate: '10.02.2025' }));
    const report = buildReport({ rowsByDept: rows }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.year.counts.planCount).toBe(15);
    expect(uer.quarter.execution.planCount).toBe(15);
  });

  it('деньги года в бюджетном трёхсрезе + утверждённая экономия (AD-гейт)', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    // Лимиты: 15 строк × (ФБ 100 + КБ 200) = 4500.
    expect(uer.money.plan).toMatchObject({ fb: 1500, kb: 3000, mb: 0, total: 4500 });
    // Факт: 6 строк × (ФБ 50 + КБ 100) = 900.
    expect(uer.money.fact).toMatchObject({ fb: 300, kb: 600, mb: 0, total: 900 });
    // Экономия: 6 факт-строк × КБ 10 (флаг 'да').
    expect(uer.economy).toMatchObject({ fb: 0, kb: 60, mb: 0, total: 60 });
  });

  it('экономия без флага AD="да" не считается утверждённой', () => {
    const rows = fixtureRows();
    rows['УКСиМП'].push(
      makeRow({ id: 'no-flag', factDate: '01.03.2026', ecoKB: 500, ecoFlag: '' }),
    );
    const report = buildReport({ rowsByDept: rows }, OPTS);
    const uksimp = report.grbsBlocks.find((b) => b.dept === 'УКСиМП')!;
    expect(uksimp.economy.total).toBe(0);
  });
});

describe('buildReport — интегральная сводка и кросс-фут', () => {
  it('интеграл = сумма блоков: 45/10 всего, КП 40/8, ЕП 5/2', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const q = report.integralSummary.quarter;
    expect(q.total.planCount).toBe(45);
    expect(q.total.doneCount).toBe(10);
    expect(q.kp.planCount).toBe(40);
    expect(q.kp.doneCount).toBe(8);
    expect(q.ep.planCount).toBe(5);
    expect(q.ep.doneCount).toBe(2);
    // Проверка суммой по блокам (инвариант агрегации §5.1).
    const sumPlan = report.grbsBlocks.reduce((s, b) => s + b.quarter.execution.planCount, 0);
    expect(q.total.planCount).toBe(sumPlan);
  });

  it('годовой интеграл КП+ЕП и деньги', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const y = report.integralSummary.year;
    expect(y.total.planCount).toBe(45);
    expect(y.kp.planCount).toBe(40);
    expect(y.ep.planCount).toBe(5);
    const m = report.integralSummary.money;
    expect(m.plan.total).toBe(45 * 300);
    expect(m.fact.total).toBe(10 * 150);
    expect(m.economy.total).toBe(60);
  });

  it('инвариант бюджета: ФБ + КБ + МБ = ИТОГО на каждой денежной тройке', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const triples = [
      report.integralSummary.money.plan,
      report.integralSummary.money.fact,
      report.integralSummary.money.economy,
      ...report.grbsBlocks.flatMap((b) => [b.money.plan, b.money.fact, b.economy]),
    ];
    for (const t of triples) {
      expect(t.fb + t.kb + t.mb).toBeCloseTo(t.total, 6);
    }
  });

  it('пустой план → pct = null (честное «нет плана», не 0 и не 100)', () => {
    const report = buildReport({ rowsByDept: { УЭР: [] } }, OPTS);
    const uer = report.grbsBlocks[0]!;
    expect(uer.quarter.execution.pct).toBeNull();
    expect(report.integralSummary.quarter.total.pct).toBeNull();
  });

  it('провенанс: официальное число несёт адрес своей ячейки листа', () => {
    const report = buildReport(
      {
        rowsByDept: fixtureRows(),
        svodGrid: [svodBlock('УЭР', 'КП', 40, 10, 257), svodBlock('УЭР', 'ЕП', 5, 2, 268)],
      },
      OPTS,
    );
    const cells = report.grbsBlocks.find((b) => b.dept === 'УЭР')!.quarter.svodCells!;
    // D — план, E — факт (шапка листа СВОД); строка — та, из которой прочитан период.
    expect(cells.kp).toEqual({ plan: 'D257', fact: 'E257' });
    expect(cells.ep).toEqual({ plan: 'D268', fact: 'E268' });
  });

  it('провенанс берёт строку периода, а не старт блока (блоки разной высоты)', () => {
    const block = svodBlock('УЭР', 'КП', 40, 10, 257);
    // Блок начинается выше своего первого периода — так бывает, когда у ГРБС
    // нет ранних кварталов: арифметика «старт + индекс» дала бы чужую ячейку.
    block.startRow = 250;
    const report = buildReport({ rowsByDept: fixtureRows(), svodGrid: [block] }, OPTS);
    expect(report.grbsBlocks.find((b) => b.dept === 'УЭР')!.quarter.svodCells).toBeUndefined();
    // ЕП-блока нет → адресов нет вовсе: провенанс либо полный, либо его нет.
  });

  it('без листа СВОД провенанса нет — и это не молчаливый ноль', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    expect(report.grbsBlocks[0]!.quarter.svodCells).toBeUndefined();
  });
});

describe('buildReport — двухисточниковость (origin calc | svod)', () => {
  it('расчётные числа несут origin="calc"', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.quarter.methods.kp.origin).toBe('calc');
    expect(uer.year.counts.origin).toBe('calc');
    expect(uer.money.plan.origin).toBe('calc');
    expect(uer.economy.origin).toBe('calc');
    expect(report.integralSummary.quarter.total.origin).toBe('calc');
  });

  it('СВОД-колонка берёт числа листа как есть (origin="svod", без подмены расчётом)', () => {
    const svodGrid = [
      // Нарочно расходится с расчётом (10/4): официал говорит 11/4 — отчёт честно показывает 11.
      svodBlock('УЭР', 'КП', 11, 4),
      svodBlock('УЭР', 'ЕП', 5, 2),
      svodBlock('ВСЕ', 'КП', 41, 8),
      svodBlock('ВСЕ', 'ЕП', 5, 2),
    ];
    const report = buildReport({ rowsByDept: fixtureRows(), svodGrid }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.quarter.svod).toBeDefined();
    expect(uer.quarter.svod!.kp).toMatchObject({ planCount: 11, doneCount: 4, origin: 'svod' });
    expect(uer.quarter.svod!.ep.planCount).toBe(5);
    // Расчётная сторона не подменена официалом.
    expect(uer.quarter.methods.kp.planCount).toBe(10);
    // Интегральный официал — scope «ВСЕ».
    expect(report.integralSummary.svodQuarter!.kp.planCount).toBe(41);
    expect(report.integralSummary.svodQuarter!.kp.origin).toBe('svod');
  });

  it('без svodGrid: svod-срезы отсутствуют, в notes — честная плашка', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.quarter.svod).toBeUndefined();
    expect(report.integralSummary.svodQuarter).toBeUndefined();
    expect(report.notes.some((n) => n.includes('СВОД'))).toBe(true);
  });
});

describe('buildReport — остаток в плановых деньгах (правила счёта §4)', () => {
  // Строка фикстуры: план ФБ 100 + КБ 200 + МБ 0 = ИТОГО 300.
  const PLAN_PER_ROW = 300;

  it('квартал: 9 незаключённых УЭР — это плановые деньги строк без факта', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.quarter.pending).toEqual({
      count: 9, fb: 900, kb: 1800, mb: 0, total: 9 * PLAN_PER_ROW,
    });
    // Не «план − факт»: разность денег дала бы экономию, а не объём работ.
    expect(uer.quarter.pending.total).not.toBe(uer.money.plan.total - uer.money.fact.total);
  });

  it('разрез КП/ЕП сходится с итогом квартала (6 + 3 = 9)', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const { pending, pendingByMethod } = report.grbsBlocks.find((b) => b.dept === 'УЭР')!.quarter;
    expect(pendingByMethod.kp.count).toBe(6);
    expect(pendingByMethod.ep.count).toBe(3);
    expect(pendingByMethod.kp.count + pendingByMethod.ep.count).toBe(pending.count);
    expect(pendingByMethod.kp.total + pendingByMethod.ep.total).toBeCloseTo(pending.total, 6);
    expect(pendingByMethod.kp.fb + pendingByMethod.ep.fb).toBeCloseTo(pending.fb, 6);
  });

  it('годовой остаток ≥ квартального: следующие кварталы тоже не заключены', () => {
    const rows = fixtureRows();
    rows['УЭР'].push(...planRows('uer-q2', 4, 0, 2, 'ЭА'));
    const report = buildReport({ rowsByDept: rows }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.year.pending.count).toBe(uer.quarter.pending.count + 4);
    for (const b of report.grbsBlocks) {
      expect(b.year.pending.count).toBeGreaterThanOrEqual(b.quarter.pending.count);
      expect(b.year.pending.total).toBeGreaterThanOrEqual(b.quarter.pending.total);
    }
  });

  it('интеграл остатка = сумма блоков (УЭР 9 + УКСиМП 26 = 35)', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const p = report.integralSummary.pending;
    expect(p.quarter.count).toBe(35);
    expect(p.quarter.total).toBe(35 * PLAN_PER_ROW);
    expect(p.year.count).toBe(
      report.grbsBlocks.reduce((s, b) => s + b.year.pending.count, 0),
    );
  });
});

describe('buildReport — official: числа, которые лист считает сам', () => {
  const extras = (): SvodSheetExtras => ({
    remainderToConclude: { fb: 86965.19, kb: 117518.12, mb: 90963.95, total: 295447.27, row: 2 },
    scopes: [
      { scope: 'ВСЕ', calcEconomy: { total: 23635.78, fb: 6957.22, kb: 9401.45, mb: 7277.12, row: 12 } },
      // У управления расч. экономии лист не считает; кладём чужое число, чтобы
      // проверить, что берётся именно районный скоуп, а не первый попавшийся.
      { scope: 'УЭР', calcEconomy: { total: 1, fb: 1, kb: 0, mb: 0, row: 99 } },
    ],
  });

  it('официальные числа проносятся как есть, с адресами строк листа', () => {
    const report = buildReport({ rowsByDept: fixtureRows(), svodExtras: extras() }, OPTS);
    expect(report.official!.remainderToConclude).toEqual({
      fb: 86965.19, kb: 117518.12, mb: 90963.95, total: 295447.27, row: 2,
    });
    expect(report.official!.calcEconomy).toEqual({
      total: 23635.78, fb: 6957.22, kb: 9401.45, mb: 7277.12, row: 12,
    });
  });

  it('свой расчёт официалом не подменяется — обе стороны видны', () => {
    const report = buildReport({ rowsByDept: fixtureRows(), svodExtras: extras() }, OPTS);
    // Лист говорит про район 295 447,27; наш пересчёт синтетики — 10 500.
    expect(report.integralSummary.pending.quarter.total).toBe(10500);
    expect(report.official!.remainderToConclude!.total).toBe(295447.27);
  });

  it('ярус не передан — поля нет вовсе (честная пустота, не ноль)', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    expect(report.official).toBeUndefined();
  });
});

describe('buildReport — период, порядок, сигналы', () => {
  it('asOfDay пробрасывается в period; Date.now не участвует', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, { ...OPTS, asOfDay: 20623 });
    expect(report.period).toEqual({ year: 2026, quarter: 1, asOfDay: 20623 });
  });

  it('блоки идут в каноническом порядке DEPARTMENT_REGISTRY', () => {
    // Вход нарочно в «неправильном» порядке ключей.
    const rows = fixtureRows();
    const shuffled = { УКСиМП: rows['УКСиМП'], УЭР: rows['УЭР'] };
    const report = buildReport({ rowsByDept: shuffled }, OPTS);
    expect(report.grbsBlocks.map((b) => b.dept)).toEqual(['УЭР', 'УКСиМП']);
  });

  it('deptLabel — полное имя из реестра', () => {
    const report = buildReport({ rowsByDept: fixtureRows() }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.deptLabel).toBe('Управление экономического развития');
  });

  it('pendingPositions: незаключённые квартала с пояснениями и адресом строки', () => {
    const rows = fixtureRows();
    // Десятая строка УЭР (uer-kp-10, без факта) получает пояснения в листе.
    const bare = rows['УЭР'][9];
    bare[COL.COMMENT_GRBS] = 'Ожидаем доведения лимитов.';
    bare[COL.DEVIATION_REASON] = 'Перенос срока поставки.';
    const report = buildReport({ rowsByDept: rows }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    const positions = uer.quarter.pendingPositions;
    // 15 плановых, 6 с фактом → 9 незаключённых.
    expect(positions).toHaveLength(9);
    // Адрес первички: атом 9 (0-based) → строка листа 9 + 3 шапки + 1 = 13.
    const withNotes = positions.find((pp) => pp.sheetRow === 13)!;
    expect(withNotes.explanations).toEqual([
      { label: 'Причина отклонения', text: 'Перенос срока поставки.' },
      { label: 'Комментарий ГРБСа', text: 'Ожидаем доведения лимитов.' },
    ]);
    expect(withNotes.planTotal).toBe(300);
    expect(withNotes.subject).toBe('Закупка');
    // Позиции без пояснений — тоже видны (качество заполнения — информация).
    expect(positions.filter((pp) => pp.explanations.length === 0)).toHaveLength(8);
  });

  it('signals: только свой ГРБС, по критичности, ЦЕЛИКОМ — топ-N режет UI', () => {
    const mkIssue = (id: string, departmentId: string, severity: Issue['severity']): Issue => ({
      id, severity, origin: 'bi_heuristic', category: 'signal',
      title: `Сигнал ${id}`, description: '', departmentId,
      status: 'open', detectedAt: '2026-03-20', detectedBy: 'test',
    });
    const issues = [
      mkIssue('i1', 'uer', 'info'),
      mkIssue('i2', 'uer', 'critical'),
      mkIssue('i3', 'uer', 'warning'),
      mkIssue('i4', 'uer', 'error'),
      mkIssue('i5', 'uksimp', 'critical'),
    ];
    const report = buildReport({ rowsByDept: fixtureRows(), issues }, OPTS);
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    // Все 4 сигнала УЭР, по критичности; чужой (uksimp) не попадает.
    expect(uer.signals.map((s) => s.id)).toEqual(['i2', 'i4', 'i3', 'i1']);
    const uksimp = report.grbsBlocks.find((b) => b.dept === 'УКСиМП')!;
    expect(uksimp.signals.map((s) => s.id)).toEqual(['i5']);
    // Полный текст и адрес первички доезжают до проекции.
    expect(uer.signals[0].description).toBe('');
  });
});

describe('срез отчёта: факт после даты среза не засчитывается', () => {
  // Канон методологии — «накопительно НА ДАТУ СРЕЗА»: отчёт «на четверг»
  // не должен включать заключения пятницы и мутировать всю неделю.
  const THURSDAY = 20657; // 2026-07-23, четверг эпохи

  function rowsWithLateFact() {
    return {
      УЭР: [
        makeRow({ id: 'до среза', planQuarter: 3, factDate: '22.07.2026' }),
        makeRow({ id: 'в день среза', planQuarter: 3, factDate: '23.07.2026' }),
        makeRow({ id: 'после среза', planQuarter: 3, factDate: '24.07.2026' }),
      ],
    };
  }

  it('план считает все три строки, факт — только две (день среза включительно)', () => {
    const report = buildReport({ rowsByDept: rowsWithLateFact() }, { year: 2026, quarter: 3, asOfDay: THURSDAY });
    const uer = report.grbsBlocks.find((b) => b.dept === 'УЭР')!;
    expect(uer.quarter.execution.planCount).toBe(3);
    expect(uer.quarter.execution.doneCount).toBe(2);
    expect(uer.quarter.pendingCount).toBe(1);
    // Остаток уважает срез так же: пятничная строка ещё не заключена.
    expect(uer.quarter.pending).toMatchObject({ count: 1, fb: 100, kb: 200, total: 300 });
  });

  it('срез недели спустя (следующий четверг) — пятничная строка уже в факте', () => {
    const report = buildReport({ rowsByDept: rowsWithLateFact() }, { year: 2026, quarter: 3, asOfDay: THURSDAY + 7 });
    expect(report.grbsBlocks[0].quarter.execution.doneCount).toBe(3);
  });

  it('деньги и экономия уважают срез так же, как счётчики', () => {
    const rows = {
      УЭР: [makeRow({ id: 'поздняя', planQuarter: 3, factDate: '24.07.2026', ecoKB: 10 })],
    };
    const report = buildReport({ rowsByDept: rows }, { year: 2026, quarter: 3, asOfDay: THURSDAY });
    expect(report.integralSummary.money.fact.total).toBe(0);
    expect(report.integralSummary.money.economy.total).toBe(0);
  });
});
