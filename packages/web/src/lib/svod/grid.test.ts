import { describe, expect, it } from 'vitest';
import { emptyCell, unifiedKey, type UnifiedCell, type UnifiedGrid } from '@aemr/shared';
import { collapsePeriods, hasCellsForPeriods, isGridEmpty } from './grid';

function cell(planCount: number, planFB: number): UnifiedCell {
  return { ...emptyCell(), planCount, planFB };
}

function gridWith(entries: Array<[string, UnifiedCell]>): UnifiedGrid {
  return { cells: Object.fromEntries(entries), grbsIds: ['uo'], scopes: ['all', 'td', 'pm', 'td_pm'] };
}

const GRID = gridWith([
  [unifiedKey('uo', 'all', 'kp', 'm1'), cell(3, 30)],
  [unifiedKey('uo', 'all', 'kp', 'm3'), cell(4, 40)],
  [unifiedKey('uo', 'all', 'ep', 'm1'), cell(1, 10)],
  [unifiedKey('uo', 'all', 'kp', 'q1'), cell(9, 90)],
  [unifiedKey('uo', 'all', 'kp', 'year'), cell(20, 200)],
]);

describe('сведение периодов сетки', () => {
  it('один период не копирует сетку — ячейка периода точнее суммы частей', () => {
    const out = collapsePeriods(GRID, ['q1']);
    expect(out.grid).toBe(GRID);
    expect(out.period).toBe('q1');
  });

  it('несколько месяцев складываются по ячейкам, а не по процентам', () => {
    const out = collapsePeriods(GRID, ['m1', 'm3']);
    const kp = out.grid.cells[unifiedKey('uo', 'all', 'kp', out.period)];
    expect(kp.planCount).toBe(7);
    expect(kp.planFB).toBe(70);
    // Разделы не смешиваются: у ЕП свой ключ и свои числа.
    expect(out.grid.cells[unifiedKey('uo', 'all', 'ep', out.period)].planCount).toBe(1);
  });

  it('годовая ячейка исходной сетки не подмешивается в сумму месяцев', () => {
    const out = collapsePeriods(GRID, ['m1', 'm3']);
    expect(out.grid.cells[unifiedKey('uo', 'all', 'kp', out.period)].planCount).toBe(7);
    expect(Object.keys(out.grid.cells)).toHaveLength(2);
  });

  it('оси сетки переживают сведение — срез по категориям на них опирается', () => {
    const out = collapsePeriods(GRID, ['m1', 'm3']);
    expect(out.grid.scopes).toEqual(GRID.scopes);
    expect(out.grid.grbsIds).toEqual(GRID.grbsIds);
  });

  it('пустой набор периодов даёт пустую сетку, а не тихо весь год', () => {
    expect(Object.keys(collapsePeriods(GRID, []).grid.cells)).toHaveLength(0);
  });
});

describe('пустота сетки различима по причине', () => {
  it('сетки нет вовсе — книга не прочитана', () => {
    expect(isGridEmpty(undefined)).toBe(true);
    expect(isGridEmpty({ cells: {}, grbsIds: [], scopes: [] })).toBe(true);
    expect(isGridEmpty(GRID)).toBe(false);
  });

  it('ячейки есть, но не за выбранный период — это другая новость', () => {
    expect(hasCellsForPeriods(GRID, ['m1'])).toBe(true);
    expect(hasCellsForPeriods(GRID, ['m7'])).toBe(false);
  });
});
