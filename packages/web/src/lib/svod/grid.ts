/**
 * grid.ts — подготовка сводной сетки к показу одной таблицей.
 *
 * Сетка адресуется одним периодом за раз, а глобальный фильтр времени умеет
 * произвольный набор месяцев. Складывать проценты нельзя, складывать ЯЧЕЙКИ
 * можно: все одиннадцать полей ячейки аддитивны, а покрытие периода приходит
 * дизъюнктным (см. `period.ts`). Поэтому здесь суммируются именно ячейки —
 * проценты потом пересчитывает `deriveCell` по уже сложенным числам.
 */
import { emptyCell, type SvodPeriodKey, type UnifiedCell, type UnifiedGrid } from '@aemr/shared';

/** Период, под которым сложенные ячейки кладутся в производную сетку. */
const COLLAPSED_PERIOD: SvodPeriodKey = 'year';

function addInto(target: UnifiedCell, source: UnifiedCell): void {
  target.planCount += source.planCount;
  target.factCount += source.factCount;
  target.planFB += source.planFB;
  target.planKB += source.planKB;
  target.planMB += source.planMB;
  target.factFB += source.factFB;
  target.factKB += source.factKB;
  target.factMB += source.factMB;
  target.economyFB += source.economyFB;
  target.economyKB += source.economyKB;
  target.economyMB += source.economyMB;
}

/** Период в плоском ключе `грбс|срез|метод|период` — после последней черты. */
function periodOfKey(key: string): string {
  return key.slice(key.lastIndexOf('|') + 1);
}

export interface CollapsedGrid {
  grid: UnifiedGrid;
  /** Ключ, которым нужно резать полученную сетку. */
  period: SvodPeriodKey;
}

/**
 * Сводит выбранные периоды в одну адресуемую ячейку.
 * Один ключ — сетка возвращается как есть (ячейка периода точнее суммы её частей).
 * Ноль ключей — пустая сетка: показывать нечего, и это видно снаружи.
 */
export function collapsePeriods(grid: UnifiedGrid, keys: readonly SvodPeriodKey[]): CollapsedGrid {
  if (keys.length === 1) return { grid, period: keys[0] };
  if (keys.length === 0) {
    return { grid: { cells: {}, grbsIds: grid.grbsIds, scopes: grid.scopes }, period: COLLAPSED_PERIOD };
  }

  const wanted = new Set<string>(keys);
  const cells: Record<string, UnifiedCell> = {};
  for (const [key, cell] of Object.entries(grid.cells)) {
    const period = periodOfKey(key);
    if (!wanted.has(period)) continue;
    const target = `${key.slice(0, key.lastIndexOf('|'))}|${COLLAPSED_PERIOD}`;
    const acc = (cells[target] ??= emptyCell());
    addInto(acc, cell);
  }
  return { grid: { cells, grbsIds: grid.grbsIds, scopes: grid.scopes }, period: COLLAPSED_PERIOD };
}

/** В сетке вообще нет ячеек — книга не прочитана или расчёт не сделан. */
export function isGridEmpty(grid: UnifiedGrid | undefined): boolean {
  return !grid || Object.keys(grid.cells).length === 0;
}

/**
 * Есть ли в сетке хоть одна ячейка для этих периодов. Отличает «книга не
 * прочитана» (ячеек нет вовсе) от «за выбранный месяц строк нет» (ячейки
 * других периодов есть, а этих — нет): читателю это разные новости.
 */
export function hasCellsForPeriods(grid: UnifiedGrid, keys: readonly SvodPeriodKey[]): boolean {
  const wanted = new Set<string>(keys);
  for (const key of Object.keys(grid.cells)) {
    if (wanted.has(periodOfKey(key))) return true;
  }
  return false;
}
