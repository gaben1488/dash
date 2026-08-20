/**
 * Квартальная перекрёстная сверка: суммы трёх месяцев ШДЮ ↔ квартальные
 * счётчики пересчёта (CalcEngine).
 *
 * Выделено из reconcile.ts разрезом 20.08.2026 (зона В) — см. пояснение в
 * reconcile-monthly.ts. Поведение перенесено дословно; reconcile.ts
 * реэкспортирует публичную поверхность.
 */

import { rekeyByGrbs } from './recon-keys.js';


export interface QuarterCrossCell {
  shdyuSum: number;
  svodValue: number;
  delta: number;
  deltaPct: number;
  status: 'ok' | 'warning' | 'high' | 'empty';
}

export interface QuarterCrossRow {
  deptId: string;
  deptName: string;
  quarter: number;
  compPlan: QuarterCrossCell;
  compFact: QuarterCrossCell;
  epPlan: QuarterCrossCell;
  epFact: QuarterCrossCell;
}

export interface QuarterCrossSummary {
  rows: QuarterCrossRow[];
  counts: { ok: number; warning: number; high: number; empty: number };
  overallStatus: string;
  /**
   * Внутренняя сходимость самого источника ШДЮ: блок «ВСЕ» обязан быть
   * суммой блоков ГРБС. Расхождение здесь означает, что спорить о разнице
   * расчёта и листа рано — сначала не сходится сам лист. Пусто/отсутствует
   * = проверка пройдена (слепая зона №21: валидатор был написан, но не
   * вызывался ни разу).
   */
  sourceConsistency?: {
    checked: boolean;
    errors: string[];
  };
}

function makeCrossCell(shdyuSum: number, svodValue: number): QuarterCrossCell {
  if (shdyuSum === 0 && svodValue === 0) {
    return { shdyuSum: 0, svodValue: 0, delta: 0, deltaPct: 0, status: 'empty' };
  }
  const delta = shdyuSum - svodValue;
  const base = Math.max(Math.abs(svodValue), 1);
  const pctVal = (delta / base) * 100;
  const absPct = Math.abs(pctVal);
  const status: 'ok' | 'warning' | 'high' = absPct < 1 ? 'ok' : absPct < 5 ? 'warning' : 'high';
  return { shdyuSum, svodValue, delta, deltaPct: pctVal, status };
}

const Q_MONTHS: Record<number, number[]> = {
  1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12],
};

/**
 * Форма стороны ШДЮ для перекрёстной сверки: только те поля, которые
 * сверка читает. Структурно совместима с SHDYUDeptData из @aemr/shared —
 * шире брать нельзя, иначе шов начнёт зависеть от чужих полей.
 */
export interface CrossVerifySHDYU {
  months?: Record<number, {
    compPlanCount?: number;
    compFactCount?: number;
    epPlanCount?: number;
    epFactCount?: number;
  } | undefined>;
}

/** Счётчики одного способа в квартале со стороны расчёта. */
interface CrossVerifyMethodCounts {
  plan?: number;
  fact?: number;
}

/**
 * Форма стороны расчёта: подмножество RecalculatedMetrics.quarters.
 * Совместима с ним структурно; квартал может отсутствовать целиком.
 */
export interface CrossVerifyRecalc {
  quarters?: Partial<Record<'q1' | 'q2' | 'q3' | 'q4', {
    competitive?: CrossVerifyMethodCounts;
    ep?: CrossVerifyMethodCounts;
  } | undefined>>;
}

/**
 * Cross-verify SHDYU monthly data against quarterly totals.
 * Sums 3 SHDYU months per quarter, compares with recalculated quarterly metrics.
 * Discrepancy > 1% warrants investigation.
 */
export function crossVerifyQuarterly(
  // Типизировано вместо Record<string, any> (пирамида агрегации §6, п.13):
  // на нетипизированном шве опечатка в имени поля молча давала нули и
  // «расхождение» на пустом месте. Формы обеих сторон описаны каноном.
  shdyuData: Record<string, CrossVerifySHDYU>,
  recalcResults: Record<string, CrossVerifyRecalc>,
  deptNames: Record<string, string>,
): QuarterCrossSummary {
  const rows: QuarterCrossRow[] = [];
  // Нормализуем ключи к каноническому кириллическому grbsId (SHDYU=латиница, recalc=кириллица)
  const shdyuByGrbs = rekeyByGrbs(shdyuData);
  const recalcByGrbs = rekeyByGrbs(recalcResults);
  // Exclude 'all' (SHDYU_ALL_BLOCK) — it's for cross-validation, not per-dept
  // reconciliation (P0-4: recalc не имеет ключа 'all' → агрегат сравнивался с нулём
  // и давал гарантированное ложное 'high'; reconcileMonthly исключает так же).
  const deptIds = new Set([
    ...Object.keys(shdyuByGrbs).filter(k => k !== 'all'),
    ...Object.keys(recalcByGrbs),
  ]);

  for (const deptId of deptIds) {
    const shdyu = shdyuByGrbs[deptId];
    const recalc = recalcByGrbs[deptId];
    const deptName = deptNames[deptId] ?? deptId;

    for (let q = 1; q <= 4; q++) {
      const months = Q_MONTHS[q];
      const qk = `q${q}` as 'q1' | 'q2' | 'q3' | 'q4';
      const rq = recalc?.quarters?.[qk];

      let shCompPlan = 0, shCompFact = 0, shEpPlan = 0, shEpFact = 0;
      for (const m of months) {
        const sm = shdyu?.months?.[m];
        if (sm) {
          shCompPlan += sm.compPlanCount ?? 0;
          shCompFact += sm.compFactCount ?? 0;
          shEpPlan += sm.epPlanCount ?? 0;
          shEpFact += sm.epFactCount ?? 0;
        }
      }

      const svodCompPlan = rq?.competitive?.plan ?? 0;
      const svodCompFact = rq?.competitive?.fact ?? 0;
      const svodEpPlan = rq?.ep?.plan ?? 0;
      const svodEpFact = rq?.ep?.fact ?? 0;

      if (shCompPlan + shCompFact + shEpPlan + shEpFact +
          svodCompPlan + svodCompFact + svodEpPlan + svodEpFact === 0) continue;

      rows.push({
        deptId, deptName, quarter: q,
        compPlan: makeCrossCell(shCompPlan, svodCompPlan),
        compFact: makeCrossCell(shCompFact, svodCompFact),
        epPlan: makeCrossCell(shEpPlan, svodEpPlan),
        epFact: makeCrossCell(shEpFact, svodEpFact),
      });
    }
  }

  const allCells = rows.flatMap(r => [r.compPlan, r.compFact, r.epPlan, r.epFact]);
  const counts = {
    ok: allCells.filter(c => c.status === 'ok').length,
    warning: allCells.filter(c => c.status === 'warning').length,
    high: allCells.filter(c => c.status === 'high').length,
    empty: allCells.filter(c => c.status === 'empty').length,
  };

  return {
    rows,
    counts,
    overallStatus: counts.high > 0 ? 'Есть расхождения'
      : counts.warning > 0 ? 'Требует проверки' : 'Данные согласованы',
  };
}
