/**
 * Инварианты §7 спеки docs/UNIFIED_SVOD_DESIGN.md для computeUnifiedGrid +
 * cross-check reconcileUnified против листа СВОД ТД-ПМ.
 *
 * Мини-атомы: массив длиной 30 с заполненными нужными dept-индексами (0-based).
 * Канон колонок: 3=графа программы, 5=активность, 11=метод, 13=план-дата,
 * 14=план-квартал, 15=план-год, 16=факт-дата, 7/8/9=план ФБ/КБ/МБ,
 * 21/22/23=факт ФБ/КБ/МБ, 25/26/27=экономия ФБ/КБ/МБ, 29=гейт экономии.
 */
import { describe, it, expect } from 'vitest';
import { computeUnifiedGrid, reconcileUnified } from './unified-svod.js';
import { unifiedKey, type SvodMethod, type SvodPeriodKey } from '@aemr/shared';
import type { ActivityScope } from '@aemr/shared';

/** Собирает dept-строку, заполняя указанные индексы; остальное — пусто. */
function row(o: Partial<Record<number, unknown>>): unknown[] {
  const r = new Array(30).fill('');
  for (const k in o) r[Number(k)] = o[k as unknown as number];
  return r;
}

describe('computeUnifiedGrid — инварианты §7', () => {
  // uo: 3 строки.
  //   A: ПМ, КП(ЭА), Q1/2026 (план-дата фев), план ФБ=100, факт ФБ=90, эко ФБ=10, gate=да, есть факт
  //   B: ТД с программой → td_pm, ЕП, Q1 (фев), план ФБ=50, факт ФБ=50, эко=0, gate=нет, есть факт
  //   C: ТД без программы (X) → чистая ТД, КП(ЭА), Q1 (мар), план ФБ=30, факт=нет (Х), gate=нет
  const rows: Record<string, unknown[][]> = {
    uo: [
      row({ 3: 'Программа A', 5: 'Программное мероприятие', 11: 'ЭА', 13: '2026-02-01', 14: 1, 15: 2026, 16: '2026-02-10', 7: 100, 21: 90, 25: 10, 29: 'да' }),
      row({ 3: 'Программа B', 5: 'Текущая деятельность', 11: 'ЕП', 13: '2026-02-01', 14: 1, 15: 2026, 16: '2026-02-10', 7: 50, 21: 50, 25: 0, 29: 'нет' }),
      row({ 3: 'X', 5: 'Текущая деятельность', 11: 'ЭА', 13: '2026-03-01', 14: 1, 15: 2026, 16: 'Х', 7: 30, 21: 0, 25: 0, 29: 'нет' }),
    ],
  };
  const grid = computeUnifiedGrid(rows);
  const cell = (s: ActivityScope, m: SvodMethod, p: SvodPeriodKey) => grid.cells[unifiedKey('uo', s, m, p)];

  it('инвариант 1: ВСЕ = ПМ + ТД по planCount (Q1)', () => {
    const all = (['kp', 'ep'] as const).reduce((a, m) => a + (cell('all', m, 'q1')?.planCount ?? 0), 0);
    const pm = (['kp', 'ep'] as const).reduce((a, m) => a + (cell('pm', m, 'q1')?.planCount ?? 0), 0);
    const td = (['kp', 'ep'] as const).reduce((a, m) => a + (cell('td', m, 'q1')?.planCount ?? 0), 0);
    expect(all).toBe(3);
    expect(pm + td).toBe(3);
  });

  it('инвариант 1: ВСЕ = ПМ + ТД по planFB (Q1, КП)', () => {
    // КП Q1: строка A (ПМ, 100) + строка C (ТД, 30) = 130; ПМ=100, ТД=30
    const all = cell('all', 'kp', 'q1')?.planFB ?? 0;
    const pm = cell('pm', 'kp', 'q1')?.planFB ?? 0;
    const td = cell('td', 'kp', 'q1')?.planFB ?? 0;
    expect(all).toBe(130);
    expect(pm + td).toBe(130);
    expect(pm).toBe(100);
    expect(td).toBe(30);
  });

  it('инвариант: td_pm ⊂ td (td_pm.count ≤ td.count, ТД-без-программы → td_pm=0)', () => {
    expect(cell('td_pm', 'ep', 'q1')?.planCount).toBe(1); // строка B (ТД+программа)
    expect(cell('td', 'ep', 'q1')?.planCount).toBe(1);    // строка B
    expect(cell('td', 'kp', 'q1')?.planCount).toBe(1);    // строка C (ТД, X)
    expect(cell('td_pm', 'kp', 'q1')?.planCount ?? 0).toBe(0); // C без программы → нет td_pm
  });

  it('инвариант 2: год = Σ месяцев = Σ кварталов (planFB, ВСЕ КП)', () => {
    const year = cell('all', 'kp', 'year')?.planFB ?? 0;
    expect(year).toBe(130); // A(100) + C(30)
    const sumMonths = Array.from({ length: 12 }, (_, i) => cell('all', 'kp', `m${i + 1}` as SvodPeriodKey)?.planFB ?? 0)
      .reduce((a, b) => a + b, 0);
    const sumQuarters = (['q1', 'q2', 'q3', 'q4'] as const).reduce((a, q) => a + (cell('all', 'kp', q)?.planFB ?? 0), 0);
    expect(sumMonths).toBe(year);
    expect(sumQuarters).toBe(year);
  });

  it('инвариант 2: год.planCount = Σ месяцев = Σ кварталов (ВСЕ, оба метода)', () => {
    for (const m of ['kp', 'ep'] as const) {
      const year = cell('all', m, 'year')?.planCount ?? 0;
      const sumMonths = Array.from({ length: 12 }, (_, i) => cell('all', m, `m${i + 1}` as SvodPeriodKey)?.planCount ?? 0)
        .reduce((a, b) => a + b, 0);
      const sumQuarters = (['q1', 'q2', 'q3', 'q4'] as const).reduce((a, q) => a + (cell('all', m, q)?.planCount ?? 0), 0);
      expect(sumMonths).toBe(year);
      expect(sumQuarters).toBe(year);
    }
  });

  it('факт-суммы добавляются всегда (освоенные), без гейта', () => {
    // КП Q1 факт ФБ: строка A=90, строка C факт=0 (нет факта) → 90
    expect(cell('all', 'kp', 'q1')?.factFB).toBe(90);
    // factCount: A есть факт, C нет факта → КП Q1 factCount=1
    expect(cell('all', 'kp', 'q1')?.factCount).toBe(1);
    // ЕП Q1: строка B факт ФБ=50, есть факт
    expect(cell('all', 'ep', 'q1')?.factFB).toBe(50);
    expect(cell('all', 'ep', 'q1')?.factCount).toBe(1);
  });

  it('инвариант 5: экономия только при gate=да', () => {
    // строка A gate=да эко ФБ=10 → ПМ КП Q1 economyFB=10
    expect(cell('pm', 'kp', 'q1')?.economyFB).toBe(10);
    expect(cell('all', 'kp', 'q1')?.economyFB).toBe(10);
    // строка B gate=нет (эко=0 в любом случае); строка C gate=нет → ТД economyFB=0
    expect(cell('td', 'kp', 'q1')?.economyFB ?? 0).toBe(0);
    expect(cell('td_pm', 'ep', 'q1')?.economyFB ?? 0).toBe(0);
  });

  it('строка без план-даты (месяц null) пропускается', () => {
    const noDate = computeUnifiedGrid({
      x: [row({ 5: 'Программное мероприятие', 11: 'ЭА', 13: '', 14: 1, 15: 2026, 7: 99 })],
    });
    // нет ни одной ячейки для x
    const anyX = Object.keys(noDate.cells).some((k) => k.startsWith('x|'));
    expect(anyX).toBe(false);
  });

  it('месяц из план-даты раскладывается по правильному кварталу', () => {
    // строка C — март (m3, q1); строка A,B — фев (m2, q1)
    expect(cell('all', 'kp', 'm2')?.planFB).toBe(100); // A
    expect(cell('all', 'kp', 'm3')?.planFB).toBe(30);  // C
    expect(cell('all', 'ep', 'm2')?.planFB).toBe(50);  // B
  });

  it('grbsIds и scopes заполнены (порядок = ACTIVITY_SCOPES)', () => {
    expect(grid.grbsIds).toContain('uo');
    expect([...grid.scopes].sort()).toEqual(['all', 'pm', 'td', 'td_pm']);
    expect(grid.scopes).toContain('td_pm');
  });
});

describe('reconcileUnified — cross-check vs СВОД ТД-ПМ', () => {
  // Одна строка: ВСЕ КП Q1/год planFB=100, planCount=1, factFB=90.
  const rows: Record<string, unknown[][]> = {
    uo: [
      row({ 3: 'Программа A', 5: 'Программное мероприятие', 11: 'ЭА', 13: '2026-02-01', 14: 1, 15: 2026, 16: '2026-02-10', 7: 100, 21: 90, 29: 'да' }),
    ],
  };
  const grid = computeUnifiedGrid(rows);

  it('status ok при Δ<1% (официальные = расчёт)', () => {
    const recon = reconcileUnified(grid, {
      'competitive.q1.count': { numericValue: 1 },
      'competitive.q1.total_plan': { numericValue: 100 },
      'competitive.year.count': { numericValue: 1 },
      'competitive.year.total_plan': { numericValue: 100 },
    });
    expect(recon.length).toBeGreaterThan(0);
    expect(recon.every((r) => r.status === 'ok')).toBe(true);
    const planRow = recon.find((r) => r.key === 'competitive.q1.total_plan');
    expect(planRow?.calc).toBe(100);
    expect(planRow?.official).toBe(100);
    expect(planRow?.deltaPct).toBe(0);
  });

  it('status high при Δ≥5%', () => {
    const recon = reconcileUnified(grid, {
      'competitive.q1.total_plan': { numericValue: 50 }, // расчёт 100 vs офиц 50 → 100% Δ
    });
    const planRow = recon.find((r) => r.key === 'competitive.q1.total_plan');
    expect(planRow?.status).toBe('high');
    expect(Math.abs(planRow?.deltaPct ?? 0)).toBeGreaterThanOrEqual(5);
  });

  it('status warning при 1%≤Δ<5%', () => {
    const recon = reconcileUnified(grid, {
      'competitive.q1.total_plan': { numericValue: 97 }, // 100 vs 97 → ~3.09%
    });
    const planRow = recon.find((r) => r.key === 'competitive.q1.total_plan');
    expect(planRow?.status).toBe('warning');
  });

  it('официальные null/отсутствуют → ключ пропускается (нечего сверять)', () => {
    const recon = reconcileUnified(grid, {
      'competitive.q1.total_plan': { numericValue: null },
    });
    expect(recon.find((r) => r.key === 'competitive.q1.total_plan')).toBeUndefined();
  });

  it('сверяет ЕП через ключи sole.*', () => {
    const epGrid = computeUnifiedGrid({
      uo: [row({ 5: 'Текущая деятельность', 11: 'ЕП', 13: '2026-02-01', 14: 1, 15: 2026, 7: 0, 8: 200, 29: 'нет' })],
    });
    const recon = reconcileUnified(epGrid, {
      'sole.q1.count': { numericValue: 1 },
    });
    const r = recon.find((x) => x.key === 'sole.q1.count');
    expect(r?.calc).toBe(1);
    expect(r?.official).toBe(1);
    expect(r?.status).toBe('ok');
  });
});
