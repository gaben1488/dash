import { describe, expect, it } from 'vitest';
import { unifiedKey, emptyCell, type UnifiedCell, type UnifiedGrid } from '@aemr/shared';
import { sliceUnified } from './unified-svod-view.js';

/**
 * Тест среза единой сетки под фильтры. Строим минимальную сетку на ГРБС 'uo':
 *  • scope 'all', метод КП, период Q1: план ФБ=700, КБ=300, факт ФБ=500, экономия ФБ=30, КБ=20;
 *  • scope 'pm' — поднабор (план ФБ=400) — проверяем что срез берёт ИМЕННО выбранный scope.
 * Проверяем: (1) бюджет-фильтр складывает суммы только по выбранным бюджетам, количества
 * не делятся; (2) переключение scope меняет числа; (3) summary суммирует все ГРБС.
 */

function cell(p: Partial<UnifiedCell>): UnifiedCell {
  return { ...emptyCell(), ...p };
}

function buildGrid(): UnifiedGrid {
  const cells: Record<string, UnifiedCell> = {};
  // uo · all · kp · q1
  cells[unifiedKey('uo', 'all', 'kp', 'q1')] = cell({
    planCount: 10, factCount: 6,
    planFB: 700, planKB: 300, planMB: 0,
    factFB: 500, factKB: 100, factMB: 0,
    economyFB: 30, economyKB: 20, economyMB: 0,
  });
  // uo · all · ep · q1 (для ИТОГО)
  cells[unifiedKey('uo', 'all', 'ep', 'q1')] = cell({
    planCount: 4, factCount: 4,
    planFB: 100, planKB: 0, planMB: 0,
    factFB: 90, factKB: 0, factMB: 0,
  });
  // uo · pm · kp · q1 (поднабор — другой scope)
  cells[unifiedKey('uo', 'pm', 'kp', 'q1')] = cell({
    planCount: 3, factCount: 2,
    planFB: 400, planKB: 0, planMB: 0,
    factFB: 300, factKB: 0, factMB: 0,
  });
  return { cells, grbsIds: ['uo'], scopes: ['all', 'td', 'pm', 'td_pm'] };
}

describe('sliceUnified', () => {
  const grid = buildGrid();

  it('бюджет-фильтр: суммы только по выбранным бюджетам, количества не делятся', () => {
    const onlyFB = sliceUnified(grid, { scope: 'all', period: 'q1', budgets: new Set(['fb']) });
    const dept = onlyFB.view.departments.find((d) => d.id === 'uo')!;
    const kp = dept.block.kp.year; // обе ноги секции = выбранный период

    // Денежные суммы — только ФБ.
    expect(kp.planTotal).toBe(700);
    expect(kp.factTotal).toBe(500);
    expect(kp.economyTotal).toBe(30);
    // Количества НЕ делятся бюджетом.
    expect(kp.planCount).toBe(10);
    expect(kp.factCount).toBe(6);
    // «Потрачено %» = факт/план по выбранному бюджету.
    expect(kp.savingsPct).toBeCloseTo(500 / 700, 6);
  });

  it('без бюджет-фильтра суммируются все бюджеты (ФБ+КБ+МБ)', () => {
    const all = sliceUnified(grid, { scope: 'all', period: 'q1' });
    const kp = all.view.departments.find((d) => d.id === 'uo')!.block.kp.q1;
    expect(kp.planTotal).toBe(1_000); // 700 + 300
    expect(kp.factTotal).toBe(600);   // 500 + 100
    expect(kp.amountDeviation).toBe(-400); // fact - plan (как лист СВОД)
    expect(kp.economyTotal).toBe(50); // 30 + 20
  });

  it('переключение scope берёт другой срез (pm ≠ all)', () => {
    const pm = sliceUnified(grid, { scope: 'pm', period: 'q1' });
    const kp = pm.view.departments.find((d) => d.id === 'uo')!.block.kp.q1;
    expect(kp.planTotal).toBe(400); // только pm·kp·q1
    expect(kp.planCount).toBe(3);
  });

  it('ИТОГО = КП + ЕП (scope all, период Q1)', () => {
    const all = sliceUnified(grid, { scope: 'all', period: 'q1' });
    const total = all.view.departments.find((d) => d.id === 'uo')!.block.total.q1;
    expect(total.planCount).toBe(14);          // 10 + 4
    expect(total.planTotal).toBe(1_100);       // 1000 + 100
    expect(total.amountDeviation).toBe(-410);   // факт − план: (600 + 90) - (1000 + 100)
    expect(total.executionPct).toBeCloseTo(10 / 14, 6); // факт 6+4 / план 10+4
  });

  it('summary уважает ГРБС-фильтр: пустой выбор = все, непустой = выбранные', () => {
    const all = sliceUnified(grid, { scope: 'all', period: 'q1' });
    expect(all.view.summary.kp.q1.planTotal).toBe(1_000);

    const filtered = sliceUnified(grid, {
      scope: 'all', period: 'q1', depts: new Set(['nonexistent']),
    });
    // Ни одного построчного блока (фильтр никого не пропустил).
    expect(filtered.view.departments.length).toBe(0);
    expect(filtered.view.summary.kp.q1.planTotal).toBe(0);
  });

  it('пустой период (нет ячеек) → нулевые строки, не падает', () => {
    const empty = sliceUnified(grid, { scope: 'all', period: 'm7' });
    const kp = empty.view.summary.kp.q1;
    expect(kp.planCount).toBe(0);
    expect(kp.planTotal).toBe(0);
    expect(kp.executionPct).toBeNull();
  });
});
