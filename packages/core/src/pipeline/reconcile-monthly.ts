/**
 * Помесячная сверка ШДЮ ↔ построчный пересчёт (CalcEngine).
 *
 * Выделено из reconcile.ts разрезом 20.08.2026 (зона В): в одном файле жили
 * три разные сверки (недельная СВОД↔расчёт, помесячная ШДЮ и квартальная
 * перекрёстная) — тысяча строк о трёх механизмах. Поведение перенесено
 * дословно; публичная поверхность прежняя — reconcile.ts реэкспортирует всё
 * отсюда, и импорты вида `from './reconcile.js'` продолжают работать.
 * Характеризационные стражи: reconcile.test.ts, reconcile-nocalc.test.ts.
 */

import { rekeyByGrbs } from './recon-keys.js';


export interface MonthlyReconCell {
  shdyu: number;
  calc: number;
  delta: number;
  deltaPct: number;
  /** no_calc — расчётный слой за срез не построен (5.4-A): сравнение неприменимо, не «расхождение». */
  status: 'ok' | 'warning' | 'high' | 'empty' | 'no_calc';
}

/** Per-budget reconciliation for a single block (KP or EP) */
export interface BudgetReconCells {
  planFB: MonthlyReconCell;
  planKB: MonthlyReconCell;
  planMB: MonthlyReconCell;
  factFB: MonthlyReconCell;
  factKB: MonthlyReconCell;
  factMB: MonthlyReconCell;
  economyFB: MonthlyReconCell;
  economyKB: MonthlyReconCell;
  economyMB: MonthlyReconCell;
}

export type SHDYUReconRootCauseId =
  | 'formula_scope_limited'
  | 'economy_flag_gated'
  | 'procurement_method_mismatch'
  | 'activity_filter_hidden_rows'
  | 'department_alias_mismatch'
  | 'formula_source_mismatch'
  | 'contract_split_rows'
  | 'reserve_status_excluded';

export interface SHDYUReconRootCauseDefinition {
  id: SHDYUReconRootCauseId;
  label: string;
  severity: 'warning' | 'critical';
  suggestedAction: string;
}

export interface SHDYUReconRootCause extends SHDYUReconRootCauseDefinition {
  confidence: 'low' | 'medium' | 'high';
  evidence: string;
}

export const SHDYU_RECON_ROOT_CAUSES: readonly SHDYUReconRootCauseDefinition[] = [
  {
    id: 'formula_scope_limited',
    label: 'Формулы ШДЮ ограничены рабочим диапазоном',
    severity: 'critical',
    suggestedAction: 'Проверить диапазоны формул на листе ШДЮ и убедиться, что месяц/ГРБС попадает в рабочий диапазон.',
  },
  {
    id: 'economy_flag_gated',
    label: 'Экономия учитывается только при флаге AD="да"',
    severity: 'warning',
    suggestedAction: 'Проверить флаг AD="да" и колонки Z/AA/AB: CalcEngine считает только утверждённую экономию.',
  },
  {
    id: 'procurement_method_mismatch',
    label: 'Метод закупки попал в другую группу КП/ЕП',
    severity: 'warning',
    suggestedAction: 'Сверить исходное значение способа закупки и словарь классификации КП/ЕП для этой строки.',
  },
  {
    id: 'activity_filter_hidden_rows',
    label: 'Фильтр ТД/ПМ скрывает часть строк',
    severity: 'warning',
    suggestedAction: 'Сверить фильтры ТД/ПМ и программный контекст строк в исходном листе.',
  },
  {
    id: 'department_alias_mismatch',
    label: 'Алиас ГРБС не сопоставился',
    severity: 'critical',
    suggestedAction: 'Проверить алиас ГРБС, имя листа и ключ отдела в ШДЮ/реестре управлений.',
  },
  {
    id: 'formula_source_mismatch',
    label: 'Формула ШДЮ ссылается на другой источник',
    severity: 'critical',
    suggestedAction: 'Проверить диапазоны формул ШДЮ: лист, ГРБС, метод КП/ЕП и месяц должны ссылаться на тот же источник, который подписан в блоке.',
  },
  {
    id: 'contract_split_rows',
    label: 'Один контракт расщеплён на несколько строк',
    severity: 'warning',
    suggestedAction: 'Проверить исходные строки закупки/контракта: возможно, одна закупка отражена несколькими строками.',
  },
  {
    id: 'reserve_status_excluded',
    label: 'Строка в резервном статусе исключена на одной стороне',
    severity: 'warning',
    suggestedAction: 'Сверить статус строки и правила исключения резервных/отменённых закупок в источнике.',
  },
] as const;

interface MonthlyRecalcBlock {
  plan?: number;
  fact?: number;
  planSum?: number;
  factSum?: number;
  planFB?: number;
  planKB?: number;
  planMB?: number;
  factFB?: number;
  factKB?: number;
  factMB?: number;
  economyFB?: number;
  economyKB?: number;
  economyMB?: number;
}

interface MonthlyRecalcMonth {
  planCount?: number;
  factCount?: number;
  competitive?: MonthlyRecalcBlock;
  ep?: MonthlyRecalcBlock;
}

export interface MonthlyRecalcDepartment {
  months?: Record<number, MonthlyRecalcMonth | undefined>;
}

interface MonthlySHDYUBlock {
  planFB?: number;
  planKB?: number;
  planMB?: number;
  factFB?: number;
  factKB?: number;
  factMB?: number;
  economyFB?: number;
  economyKB?: number;
  economyMB?: number;
}

export interface MonthlySHDYUMonth {
  compPlanCount?: number;
  compFactCount?: number;
  compPlanTotal?: number;
  compFactTotal?: number;
  epPlanCount?: number;
  epFactCount?: number;
  epPlanTotal?: number;
  epFactTotal?: number;
  comp?: MonthlySHDYUBlock;
  ep?: MonthlySHDYUBlock;
  formulaIssues?: Array<{
    type?: string;
    expectedSheet?: string;
    actualSheets?: string[];
    expectedFilter?: string;
    detectedFilter?: string;
    row?: number;
    month?: number;
    block?: 'comp' | 'ep';
    evidence?: string;
  }>;
}

export interface MonthlySHDYUDepartment {
  months?: Record<number, MonthlySHDYUMonth | undefined>;
}

export interface MonthlyReconRow {
  deptId: string;
  deptName: string;
  month: number;
  compPlan: MonthlyReconCell;
  compFact: MonthlyReconCell;
  compPlanTotal: MonthlyReconCell;
  compFactTotal: MonthlyReconCell;
  epPlan: MonthlyReconCell;
  epFact: MonthlyReconCell;
  epPlanTotal: MonthlyReconCell;
  epFactTotal: MonthlyReconCell;
  compBudget?: BudgetReconCells;
  epBudget?: BudgetReconCells;
  warnings?: string[];
  rootCause?: SHDYUReconRootCause;
}

export interface MonthlyReconSummary {
  rows: MonthlyReconRow[];
  counts: { ok: number; warning: number; high: number; empty: number; noCalc?: number };
  overallStatus: string;
}

function makeCell(shdyu: number, calc: number, noCalcLayer = false): MonthlyReconCell {
  if (shdyu === 0 && calc === 0) {
    return { shdyu: 0, calc: 0, delta: 0, deltaPct: 0, status: 'empty' };
  }
  // 5.4-A: расчётный слой за срез не построен (в книгах управлений нет строк
  // этого план-года) — сравнение официала с нулём НЕприменимо, это не «high».
  if (noCalcLayer) {
    return { shdyu, calc, delta: 0, deltaPct: 0, status: 'no_calc' };
  }
  const delta = calc - shdyu;
  const base = Math.max(Math.abs(shdyu), 1);
  const pctVal = (delta / base) * 100;
  const absPct = Math.abs(pctVal);
  const status: 'ok' | 'warning' | 'high' = absPct < 1 ? 'ok' : absPct < 5 ? 'warning' : 'high';
  return { shdyu, calc, delta, deltaPct: pctVal, status };
}

function n(value: number | undefined): number {
  return value ?? 0;
}

function rootCauseById(id: SHDYUReconRootCauseId): SHDYUReconRootCauseDefinition {
  const cause = SHDYU_RECON_ROOT_CAUSES.find((item) => item.id === id);
  if (!cause) throw new Error(`Unknown SHDYU root cause: ${id}`);
  return cause;
}

function calcPlanCount(rc: MonthlyRecalcMonth | undefined): number {
  return (rc?.competitive?.plan ?? 0) + (rc?.ep?.plan ?? 0);
}

function hasEconomyMismatch(cells: BudgetReconCells | undefined): boolean {
  if (!cells) return false;
  return [cells.economyFB, cells.economyKB, cells.economyMB]
    .some((cell) => cell.status === 'warning' || cell.status === 'high');
}

function closeEnough(a: number | undefined, b: number | undefined): boolean {
  return Math.abs((a ?? 0) - (b ?? 0)) < 0.0001;
}

function isNonZero(value: number | undefined): boolean {
  return Math.abs(value ?? 0) > 0.0001;
}

function hasCrossMethodMismatch(sh: MonthlySHDYUMonth | undefined, rc: MonthlyRecalcMonth | undefined): boolean {
  if (!sh || !rc) return false;

  const shCompMatchesCalcEp =
    isNonZero(sh.compPlanCount) &&
    closeEnough(sh.compPlanCount, rc.ep?.plan) &&
    closeEnough(sh.compPlanTotal, rc.ep?.planSum) &&
    !closeEnough(sh.compPlanCount, rc.competitive?.plan);

  const shEpMatchesCalcComp =
    isNonZero(sh.epPlanCount) &&
    closeEnough(sh.epPlanCount, rc.competitive?.plan) &&
    closeEnough(sh.epPlanTotal, rc.competitive?.planSum) &&
    !closeEnough(sh.epPlanCount, rc.ep?.plan);

  return shCompMatchesCalcEp || shEpMatchesCalcComp;
}

function formulaSourceMismatch(
  sh: MonthlySHDYUMonth | undefined,
): NonNullable<MonthlySHDYUMonth['formulaIssues']>[number] | undefined {
  return sh?.formulaIssues?.find((issue) => issue.type === 'sheet_reference_mismatch');
}

function formulaMethodInverted(
  sh: MonthlySHDYUMonth | undefined,
): NonNullable<MonthlySHDYUMonth['formulaIssues']>[number] | undefined {
  return sh?.formulaIssues?.find((issue) => issue.type === 'method_filter_inverted');
}

function inferSHDYURootCause(args: {
  deptId: string;
  deptName: string;
  month: number;
  hasSHDYUDepartment: boolean;
  sh: MonthlySHDYUMonth | undefined;
  rc: MonthlyRecalcMonth | undefined;
  compBudget: BudgetReconCells | undefined;
  epBudget: BudgetReconCells | undefined;
}): SHDYUReconRootCause | undefined {
  const {
    deptId,
    deptName,
    month,
    hasSHDYUDepartment,
    sh,
    rc,
    compBudget,
    epBudget,
  } = args;
  const calcPlanCount = (rc?.competitive?.plan ?? 0) + (rc?.ep?.plan ?? 0);
  const formulaIssue = formulaSourceMismatch(sh);
  if (formulaIssue) {
    const definition = rootCauseById('formula_source_mismatch');
    const actualSheets = formulaIssue.actualSheets?.join(', ') || 'другой лист';
    return {
      ...definition,
      confidence: 'high',
      evidence: formulaIssue.evidence
        ?? `ШДЮ ${deptName}, месяц ${month}: формула строки ${formulaIssue.row ?? '?'} ожидает ${formulaIssue.expectedSheet ?? deptName}, но ссылается на ${actualSheets}`,
    };
  }

  const invertedFilter = formulaMethodInverted(sh);
  if (invertedFilter) {
    const definition = rootCauseById('procurement_method_mismatch');
    return {
      ...definition,
      confidence: 'high',
      evidence: invertedFilter.evidence
        ?? `ШДЮ ${deptName}, месяц ${month}: инвертированный фильтр способа КП/ЕП в формуле строки ${invertedFilter.row ?? '?'}; CalcEngine каноничен`,
    };
  }

  // Движок не видит плановых закупок, но строка расходится → данные есть на стороне ШДЮ.
  // Раньше тут возвращался undefined (расхождение без «почему»); объясняем явно.
  if (calcPlanCount <= 0) {
    if (!hasSHDYUDepartment) {
      return {
        ...rootCauseById('department_alias_mismatch'),
        confidence: 'medium',
        evidence: `ШДЮ-блок ГРБС ${deptId} (${deptName}) не сопоставлен, но строка месяца ${month} расходится — проверить алиас/ключ отдела.`,
      };
    }
    return {
      ...rootCauseById('activity_filter_hidden_rows'),
      confidence: 'low',
      evidence: `Месяц ${month} (${deptName}): ШДЮ показывает закупки, которых каноничный движок не видит (0) — вероятно фильтр ТД/ПМ, классификация метода или резервный статус исключают эти строки.`,
    };
  }

  if (!hasSHDYUDepartment) {
    const definition = rootCauseById('department_alias_mismatch');
    return {
      ...definition,
      confidence: 'medium',
      evidence: `ШДЮ не содержит блок ГРБС ${deptId} (${deptName}), CalcEngine видит ${calcPlanCount} плановых закупок за месяц ${month}`,
    };
  }

  if (!sh) {
    const definition = rootCauseById('formula_scope_limited');
    return {
      ...definition,
      confidence: 'high',
      evidence: `ШДЮ не содержит месяц ${month} для ${deptName}, CalcEngine видит ${calcPlanCount} плановых закупок`,
    };
  }

  if (hasCrossMethodMismatch(sh, rc)) {
    const definition = rootCauseById('procurement_method_mismatch');
    return {
      ...definition,
      confidence: 'medium',
      evidence: `За месяц ${month} одна и та же count/amount пара видна на противоположных группах КП/ЕП между ШДЮ и CalcEngine`,
    };
  }

  if (hasEconomyMismatch(compBudget) || hasEconomyMismatch(epBudget)) {
    const definition = rootCauseById('economy_flag_gated');
    return {
      ...definition,
      confidence: 'medium',
      evidence: `План/факт ШДЮ и CalcEngine сопоставимы за месяц ${month}, но экономия расходится; CalcEngine применяет gate AD="да"`,
    };
  }

  // Каждое расхождение должно иметь «почему». Нераспознанный остаток объясняем
  // по направлению расхождения сумм с низкой уверенностью (не оставляем undefined).
  const shdyuTotal = n(sh?.compPlanTotal) + n(sh?.epPlanTotal) + n(sh?.compFactTotal) + n(sh?.epFactTotal);
  const calcTotal = n(rc?.competitive?.planSum) + n(rc?.ep?.planSum) + n(rc?.competitive?.factSum) + n(rc?.ep?.factSum);
  if (calcTotal > shdyuTotal) {
    return {
      ...rootCauseById('formula_scope_limited'),
      confidence: 'low',
      evidence: `Месяц ${month} (${deptName}): движок Σ ${calcTotal.toFixed(2)} > ШДЮ Σ ${shdyuTotal.toFixed(2)} — диапазон формул ШДЮ вероятно уже каноничного.`,
    };
  }
  return {
    ...rootCauseById('activity_filter_hidden_rows'),
    confidence: 'low',
    evidence: `Месяц ${month} (${deptName}): ШДЮ Σ ${shdyuTotal.toFixed(2)} ≥ движок Σ ${calcTotal.toFixed(2)} — формула ШДЮ вероятно включает строки вне каноничного фильтра (ТД/ПМ, метод, резерв).`,
  };
}

/**
 * Compare SHDYU monthly dynamics data against row-by-row recalculation.
 *
 * @param recalcResults  Per-department RecalculatedMetrics (from pipeline)
 * @param shdyuData      Per-department SHDYUDeptData (from ШДЮ sheet)
 * @param deptNames      Map grbsId → display name
 */
/** Все статус-ячейки побюджетного разбора (ФБ/КБ/МБ × план/факт/экономия) одной строки. */
function budgetReconCells(b: BudgetReconCells): MonthlyReconCell[] {
  return [
    b.planFB, b.planKB, b.planMB,
    b.factFB, b.factKB, b.factMB,
    b.economyFB, b.economyKB, b.economyMB,
  ];
}

function cellNeedsAttention(cell: MonthlyReconCell): boolean {
  return cell.status === 'warning' || cell.status === 'high';
}

export interface MonthlyReconOptions {
  /**
   * 5.4-A: расчётный слой за запрошенный срез НЕ ПОСТРОЕН (в книгах управлений
   * нет строк этого план-года). Определяет ВЫЗЫВАЮЩИЙ (роут знает год и годовые
   * суммы снапшота) — внутренняя эвристика неотличима от «всё по нулям».
   */
  calcLayerAbsent?: boolean;
}

export function reconcileMonthly(
  recalcResults: Record<string, MonthlyRecalcDepartment>,
  shdyuData: Record<string, MonthlySHDYUDepartment>,
  deptNames: Record<string, string>,
  opts?: MonthlyReconOptions,
): MonthlyReconSummary {
  const rows: MonthlyReconRow[] = [];
  // Нормализуем ключи к каноническому кириллическому grbsId (SHDYU=латиница, recalc=кириллица)
  const recalcByGrbs = rekeyByGrbs(recalcResults);
  const shdyuByGrbs = rekeyByGrbs(shdyuData);

  const calcLayerAbsent = opts?.calcLayerAbsent === true;
  const cell = (official: number, calc: number): MonthlyReconCell => makeCell(official, calc, calcLayerAbsent);

  // Exclude 'all' (SHDYU_ALL_BLOCK) — it's for cross-validation, not per-dept reconciliation
  const deptIds = new Set([
    ...Object.keys(recalcByGrbs),
    ...Object.keys(shdyuByGrbs).filter(k => k !== 'all'),
  ]);

  for (const deptId of deptIds) {
    const recalc = recalcByGrbs[deptId];
    const shdyu = shdyuByGrbs[deptId];
    const deptName = deptNames[deptId] ?? deptId;

    for (let m = 1; m <= 12; m++) {
      const sh = shdyu?.months?.[m];
      const rc = recalc?.months?.[m];

      // Skip months with no data on either side
      if (!sh && (!rc || (rc.planCount === 0 && rc.factCount === 0))) continue;

      const compPlan = cell(sh?.compPlanCount ?? 0, rc?.competitive?.plan ?? 0);
      const compFact = cell(sh?.compFactCount ?? 0, rc?.competitive?.fact ?? 0);
      const compPlanTotal = cell(sh?.compPlanTotal ?? 0, rc?.competitive?.planSum ?? 0);
      const compFactTotal = cell(sh?.compFactTotal ?? 0, rc?.competitive?.factSum ?? 0);
      const epPlan = cell(sh?.epPlanCount ?? 0, rc?.ep?.plan ?? 0);
      const epFact = cell(sh?.epFactCount ?? 0, rc?.ep?.fact ?? 0);
      const epPlanTotal = cell(sh?.epPlanTotal ?? 0, rc?.ep?.planSum ?? 0);
      const epFactTotal = cell(sh?.epFactTotal ?? 0, rc?.ep?.factSum ?? 0);

      // Per-budget reconciliation (ФБ/КБ/МБ) using full SHDYU data
      const shComp = sh?.comp;
      const shEp = sh?.ep;
      const compBudget: BudgetReconCells | undefined = shComp ? {
        planFB: cell(n(shComp.planFB), rc?.competitive?.planFB ?? 0),
        planKB: cell(n(shComp.planKB), rc?.competitive?.planKB ?? 0),
        planMB: cell(n(shComp.planMB), rc?.competitive?.planMB ?? 0),
        factFB: cell(n(shComp.factFB), rc?.competitive?.factFB ?? 0),
        factKB: cell(n(shComp.factKB), rc?.competitive?.factKB ?? 0),
        factMB: cell(n(shComp.factMB), rc?.competitive?.factMB ?? 0),
        economyFB: cell(n(shComp.economyFB), rc?.competitive?.economyFB ?? 0),
        economyKB: cell(n(shComp.economyKB), rc?.competitive?.economyKB ?? 0),
        economyMB: cell(n(shComp.economyMB), rc?.competitive?.economyMB ?? 0),
      } : undefined;
      const epBudget: BudgetReconCells | undefined = shEp ? {
        planFB: cell(n(shEp.planFB), rc?.ep?.planFB ?? 0),
        planKB: cell(n(shEp.planKB), rc?.ep?.planKB ?? 0),
        planMB: cell(n(shEp.planMB), rc?.ep?.planMB ?? 0),
        factFB: cell(n(shEp.factFB), rc?.ep?.factFB ?? 0),
        factKB: cell(n(shEp.factKB), rc?.ep?.factKB ?? 0),
        factMB: cell(n(shEp.factMB), rc?.ep?.factMB ?? 0),
        economyFB: cell(n(shEp.economyFB), rc?.ep?.economyFB ?? 0),
        economyKB: cell(n(shEp.economyKB), rc?.ep?.economyKB ?? 0),
        economyMB: cell(n(shEp.economyMB), rc?.ep?.economyMB ?? 0),
      } : undefined;

      // Detect missing SHDYU data: calculated > 0 but SHDYU = 0
      const warnings: string[] = [];
      const calcPlanCountValue = calcPlanCount(rc);
      if (!sh && calcPlanCountValue > 0) {
        warnings.push(`ШДЮ: данные за месяц ${m} отсутствуют, но расчёт содержит ${calcPlanCountValue} закупок`);
      }
      const rowHasMismatch = [
        compPlan, compFact, compPlanTotal, compFactTotal,
        epPlan, epFact, epPlanTotal, epFactTotal,
        ...(compBudget ? budgetReconCells(compBudget) : []),
        ...(epBudget ? budgetReconCells(epBudget) : []),
      ].some(cellNeedsAttention);
      const rootCause = rowHasMismatch
        ? inferSHDYURootCause({
          deptId,
          deptName,
          month: m,
          hasSHDYUDepartment: Boolean(shdyu),
          sh,
          rc,
          compBudget,
          epBudget,
        })
        : undefined;

      rows.push({
        deptId,
        deptName,
        month: m,
        compPlan,
        compFact,
        compPlanTotal,
        compFactTotal,
        epPlan,
        epFact,
        epPlanTotal,
        epFactTotal,
        ...(compBudget ? { compBudget } : {}),
        ...(epBudget ? { epBudget } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(rootCause ? { rootCause } : {}),
      });
    }
  }

  const allCells = rows.flatMap(r => {
    const cells: MonthlyReconCell[] = [
      r.compPlan, r.compFact, r.compPlanTotal, r.compFactTotal,
      r.epPlan, r.epFact, r.epPlanTotal, r.epFactTotal,
    ];
    // Учитываем вложенные побюджетные ячейки (ФБ/КБ/МБ): расхождение внутри
    // разбора должно попадать в общий counts, а не только top-level суммы.
    if (r.compBudget) cells.push(...budgetReconCells(r.compBudget));
    if (r.epBudget) cells.push(...budgetReconCells(r.epBudget));
    return cells;
  });

  const counts = {
    ok: allCells.filter(c => c.status === 'ok').length,
    warning: allCells.filter(c => c.status === 'warning').length,
    high: allCells.filter(c => c.status === 'high').length,
    empty: allCells.filter(c => c.status === 'empty').length,
    noCalc: allCells.filter(c => c.status === 'no_calc').length,
  };

  const overallStatus = calcLayerAbsent && counts.noCalc > 0
    ? 'Расчёт за этот срез не построен — сравнение неприменимо'
    : counts.high > 0
    ? 'Есть расхождения'
    : counts.warning > 0
    ? 'Требует проверки'
    : 'Данные согласованы';

  return { rows, counts, overallStatus };
}
