/**
 * buildReport — TDD на синтетике, калиброванной эталоном ручного отчёта
 * «Отчёт по закупкам на 20.03.2026»: УЭР Q1 план 15 / факт 6 → 40.00%
 * (та же калибровка, что у quarter-execution.test.ts).
 *
 * Обязательные инварианты кросс-фута (делта-спека
 * docs/superpowers/specs/2026-07-14-report-2-additional-delta.md §5.1):
 *   бюджет:    ФБ + КБ + МБ = ИТОГО;
 *   агрегация: Σ по блокам ГРБС = интегральная сводка.
 */
import { describe, it, expect } from 'vitest';
import { DEPT_COLUMNS, type Issue, type SvodGridBlock } from '@aemr/shared';
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
 *   УЭР:    Q1 план 15 (10 ЭА + 5 ЕП), факт 6 (4 ЭА + 2 ЕП) → 40.00%;
 *   УКСиМП: Q1 план 30 ЭА, факт 4 → 13.33%.
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
): SvodGridBlock {
  return {
    scope,
    method,
    startRow: 1,
    periods: [{
      quarter: 1, year: 2026,
      planCount, factCount, devCount: planCount - factCount,
      execPct: planCount > 0 ? factCount / planCount : 0,
      planFB: 0, planKB: 0, planMB: 0, planTotal: 0,
      factFB: 0, factKB: 0, factMB: 0, factTotal: 0,
      devMoney: 0, spentPct: 0,
      economyFB: 0, economyKB: 0, economyMB: 0, economyTotal: 0,
    }],
  };
}

const OPTS = { year: 2026, quarter: 1 as const };

describe('buildReport — блок ГРБС (калибровка эталоном 20.03.2026)', () => {
  it('УЭР: Q1 план 15, факт 6 → 40.00%, незаключённых 9', () => {
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

  it('topSignals: только свой ГРБС, по критичности, не больше трёх', () => {
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
    // 4 сигнала УЭР → топ-3 по критичности; чужой (uksimp) не попадает.
    expect(uer.topSignals.map((s) => s.id)).toEqual(['i2', 'i4', 'i3']);
    const uksimp = report.grbsBlocks.find((b) => b.dept === 'УКСиМП')!;
    expect(uksimp.topSignals.map((s) => s.id)).toEqual(['i5']);
  });
});
