/**
 * unified-svod-view.ts — срез единой сетки СВОД (/api/svod/unified) под выбранные
 * фильтры в форму `SvodView`, чтобы рисовать ОДНУ таблицу теми же компонентами
 * (`SvodTableHead`/`BlockGroup`) и цветокодом План/Факт/Экономия, что и раньше.
 *
 * Источник — `UnifiedGrid` из ядра (CalcEngine из атомов): плоская карта
 * `unifiedKey(grbsId, scope, method, period)` → `UnifiedCell`. Здесь — чистая
 * проекция:
 *   • выбираем срез активности (all/td/pm/td_pm) и период (m1..m12 / q1..q4 / year);
 *   • метод-фильтр (КП/ЕП) применяется на уровне рендера (visibleKinds), поэтому
 *     слой всегда отдаёт обе секции kp/ep + ИТОГО;
 *   • бюджет-фильтр (ФБ/КБ/МБ) реальный — денежные суммы складываются только по
 *     выбранным бюджетам, количества не делятся (как лист СВОД);
 *   • ГРБС-фильтр оставляет выбранные управления (по latinId или краткому имени).
 *
 * `SvodRow` ждёт период `q1|year`; единая сетка одномоментно показывает один период,
 * поэтому выбранный `UnifiedCell` кладётся в ОБА слота секции (q1 и year) — родитель
 * (`BlockGroup`/`pickRow`) берёт любой и получает те же числа.
 *
 * Spec: docs/UNIFIED_SVOD_DESIGN.md §6, §8.
 */
import {
  DEPARTMENT_REGISTRY,
  deriveCell,
  emptyCell,
  unifiedKey,
  type ActivityScope,
  type SvodBlock,
  type SvodMethod,
  type SvodPeriodKey,
  type SvodRow,
  type SvodSection,
  type SvodView,
  type UnifiedCell,
  type UnifiedGrid,
} from '@aemr/shared';

/** Тип бюджета фильтра (как store: 'fb'|'kb'|'mb'). */
export type BudgetKey = 'fb' | 'kb' | 'mb';

export interface SliceOptions {
  /** Срез активности. */
  scope: ActivityScope;
  /** Период (месяц m1..m12 / квартал q1..q4 / год). */
  period: SvodPeriodKey;
  /** Метод-фильтр (КП/ЕП). Пусто/обе → показывать обе секции. */
  methods?: Set<SvodMethod>;
  /** Бюджет-фильтр. Пусто → все бюджеты (суммы по ФБ+КБ+МБ). */
  budgets?: Set<BudgetKey>;
  /** ГРБС-фильтр (latinId или краткое имя). Пусто → все управления. */
  depts?: Set<string>;
}

export interface UnifiedSliceResult {
  /** Сетка в форме SvodView (summary + departments) под BlockGroup. */
  view: SvodView;
}

/** Складывает одну ячейку сетки в аккумулятор (для сводного блока). */
function addCellInto(target: UnifiedCell, source: UnifiedCell): void {
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

/**
 * Проецирует `UnifiedCell` в `SvodRow` с реальным бюджет-фильтром.
 * Количества (план/факт) и исполнение по штукам не делятся по бюджету.
 * Денежные суммы план/факт/экономия — только по выбранным бюджетам (пусто = все три).
 */
function toSvodRow(cell: UnifiedCell, budgets?: Set<BudgetKey>): SvodRow {
  const all = !budgets || budgets.size === 0;
  const fb = all || budgets.has('fb');
  const kb = all || budgets.has('kb');
  const mb = all || budgets.has('mb');

  const planFB = fb ? cell.planFB : 0;
  const planKB = kb ? cell.planKB : 0;
  const planMB = mb ? cell.planMB : 0;
  const factFB = fb ? cell.factFB : 0;
  const factKB = kb ? cell.factKB : 0;
  const factMB = mb ? cell.factMB : 0;
  const economyFB = fb ? cell.economyFB : 0;
  const economyKB = kb ? cell.economyKB : 0;
  const economyMB = mb ? cell.economyMB : 0;

  // deriveCell даёт итоги/проценты по уже отфильтрованным суммам.
  const filtered: UnifiedCell = {
    planCount: cell.planCount,
    factCount: cell.factCount,
    planFB, planKB, planMB,
    factFB, factKB, factMB,
    economyFB, economyKB, economyMB,
  };
  const d = deriveCell(filtered);

  return {
    planCount: cell.planCount,
    factCount: cell.factCount,
    deviationCount: d.deviationCount,
    executionPct: d.execCountPct,
    planFB, planKB, planMB,
    planTotal: d.planTotal,
    factFB, factKB, factMB,
    factTotal: d.factTotal,
    amountDeviation: d.amountDeviation,
    // Q «Потрачено, %» = факт/план (как лист СВОД и svod-view.sumRows).
    savingsPct: d.spentPct,
    economyFB, economyKB, economyMB,
    economyTotal: d.economyTotal,
  };
}

/** Складывает две SvodRow в ИТОГО (суммы +, проценты пересчёт по штукам/суммам). */
function sumRows(a: SvodRow, b: SvodRow): SvodRow {
  const planCount = (a.planCount ?? 0) + (b.planCount ?? 0);
  const factCount = (a.factCount ?? 0) + (b.factCount ?? 0);
  const planTotal = (a.planTotal ?? 0) + (b.planTotal ?? 0);
  const factTotal = (a.factTotal ?? 0) + (b.factTotal ?? 0);
  return {
    planCount,
    factCount,
    deviationCount: factCount - planCount,
    executionPct: planCount !== 0 ? factCount / planCount : null,
    planFB: (a.planFB ?? 0) + (b.planFB ?? 0),
    planKB: (a.planKB ?? 0) + (b.planKB ?? 0),
    planMB: (a.planMB ?? 0) + (b.planMB ?? 0),
    planTotal,
    factFB: (a.factFB ?? 0) + (b.factFB ?? 0),
    factKB: (a.factKB ?? 0) + (b.factKB ?? 0),
    factMB: (a.factMB ?? 0) + (b.factMB ?? 0),
    factTotal,
    // P «Отклонение сумм» = факт − план (как deriveCell.amountDeviation и лист СВОД).
    amountDeviation: factTotal - planTotal,
    savingsPct: planTotal !== 0 ? factTotal / planTotal : null,
    economyFB: (a.economyFB ?? 0) + (b.economyFB ?? 0),
    economyKB: (a.economyKB ?? 0) + (b.economyKB ?? 0),
    economyMB: (a.economyMB ?? 0) + (b.economyMB ?? 0),
    economyTotal: (a.economyTotal ?? 0) + (b.economyTotal ?? 0),
  };
}

/** Один SvodRow в обе ноги секции (единая сетка показывает один период за раз). */
function bothPeriods(row: SvodRow): SvodSection {
  return { q1: row, year: row };
}

/** Собирает SvodBlock (kp/ep/total) из двух уже спроецированных строк. */
function buildBlock(kpRow: SvodRow, epRow: SvodRow): SvodBlock {
  return {
    kp: bothPeriods(kpRow),
    ep: bothPeriods(epRow),
    total: bothPeriods(sumRows(kpRow, epRow)),
  };
}

/** Берёт ячейку сетки для (grbsId, scope, method, period); пустую если нет. */
function cellFor(
  grid: UnifiedGrid,
  grbsId: string,
  scope: ActivityScope,
  method: SvodMethod,
  period: SvodPeriodKey,
): UnifiedCell {
  return grid.cells[unifiedKey(grbsId, scope, method, period)] ?? emptyCell();
}

/** Подходит ли ГРБС под фильтр управлений (по latinId или краткому имени). */
function deptSelected(
  depts: Set<string> | undefined,
  latinId: string,
  shortName: string,
): boolean {
  if (!depts || depts.size === 0) return true;
  return depts.has(latinId) || depts.has(shortName);
}

/**
 * Срез единой сетки под выбранные фильтры → структура `SvodView` для одной таблицы.
 *
 * @param grid единая сетка из /api/svod/unified
 * @param opts срез активности, период, фильтры метод/бюджет/ГРБС
 */
export function sliceUnified(grid: UnifiedGrid, opts: SliceOptions): UnifiedSliceResult {
  const { scope, period, budgets, depts } = opts;

  // Сводный блок «ВСЕ ГРБС» аккумулирует ИМЕННО видимые управления — при ГРБС-фильтре
  // он показывает итог по выбранному подмножеству (один проход с построчными блоками).
  const sumKp = emptyCell();
  const sumEp = emptyCell();

  const departments = DEPARTMENT_REGISTRY.filter((d) =>
    deptSelected(depts, d.latinId, d.shortName),
  ).map((d) => {
    const grbsId = d.latinId;
    const kpCell = cellFor(grid, grbsId, scope, 'kp', period);
    const epCell = cellFor(grid, grbsId, scope, 'ep', period);
    addCellInto(sumKp, kpCell);
    addCellInto(sumEp, epCell);
    return {
      id: d.latinId,
      name: d.fullName,
      shortName: d.shortName,
      block: buildBlock(toSvodRow(kpCell, budgets), toSvodRow(epCell, budgets)),
    };
  });

  const summary = buildBlock(toSvodRow(sumKp, budgets), toSvodRow(sumEp, budgets));

  return { view: { summary, departments } };
}
