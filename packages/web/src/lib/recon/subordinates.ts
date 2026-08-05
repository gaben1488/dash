// ── Агрегация подведов внутри управления для вкладки «По подведам».
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).
//
//    05.08.2026 — исправлен корень «неправильных плана и факта».
//    Было: факт подведа считался как competitiveCount + epCount, то есть
//    сумма строк по способам определения поставщика. КП и ЕП вместе
//    покрывают весь план, поэтому исполнение выходило около 100 % всегда —
//    независимо от того, заключено что-нибудь или нет.
//    Стало: план и факт берутся из канона движка (SubPeriodMetrics по
//    кварталам, год = сумма четырёх кварталов). Если базы нет — null и
//    честная плашка, а не выдуманное число.

import type { ReconSubordinate } from './types';

const QUARTERS = ['q1', 'q2', 'q3', 'q4'] as const;

/** План и факт подведа в штуках: год = сумма четырёх плановых кварталов (канон движка). */
export function subordinateCounts(sub: ReconSubordinate): { planCount: number; factCount: number } | null {
  const q = sub.quarters;
  if (!q) return null;
  let planCount = 0;
  let factCount = 0;
  let seen = false;
  for (const key of QUARTERS) {
    const period = q[key];
    if (!period) continue;
    seen = true;
    planCount += period.planCount ?? 0;
    factCount += period.factCount ?? 0;
  }
  return seen ? { planCount, factCount } : null;
}

/** % исполнения подведа по СУММЕ: только готовое поле движка, иначе нет базы. */
export function subordinateExecutionPct(sub: ReconSubordinate): number | null {
  return sub.executionPct ?? null;
}

/** % исполнения подведа по КОЛИЧЕСТВУ: поле движка, иначе счёт по кварталам, иначе нет базы. */
export function subordinateExecCountPct(sub: ReconSubordinate): number | null {
  if (sub.execCountPct != null) return sub.execCountPct;
  const counts = subordinateCounts(sub);
  if (!counts || counts.planCount <= 0) return null;
  return +((counts.factCount / counts.planCount) * 100).toFixed(1);
}

export interface DeptSubordinateTotals {
  /** Плановых позиций (сумма кварталов). null — подведы не несут квартальной базы. */
  planCount: number | null;
  /** Заключённых позиций. null — базы нет. */
  factCount: number | null;
  /** Строк с распознанным способом (КП + ЕП). Это НЕ факт — отдельная величина. */
  methodCount: number;
  /** Строк в выборке подведов (rowCount из API). */
  rowCount: number;
  planTotal: number;
  factTotal: number;
  economy: number;
  /** Исполнение по количеству, %. null — нет базы для счёта. */
  execCountPct: number | null;
  /** Исполнение по сумме, %. null — план в деньгах нулевой. */
  execAmountPct: number | null;
}

/** Итоги по управлению = сумма его подведов (строка «Итого» под группой). */
export function aggregateDeptSubordinates(subs: ReconSubordinate[]): DeptSubordinateTotals {
  let planCount = 0;
  let factCount = 0;
  let hasCounts = false;
  let methodCount = 0;
  let rowCount = 0;
  let planTotal = 0;
  let factTotal = 0;
  let economy = 0;

  for (const sub of subs) {
    const counts = subordinateCounts(sub);
    if (counts) {
      hasCounts = true;
      planCount += counts.planCount;
      factCount += counts.factCount;
    }
    methodCount += (sub.competitiveCount ?? 0) + (sub.epCount ?? 0);
    rowCount += sub.rowCount ?? 0;
    planTotal += sub.planTotal ?? 0;
    factTotal += sub.factTotal ?? 0;
    economy += sub.economyTotal ?? 0;
  }

  return {
    planCount: hasCounts ? planCount : null,
    factCount: hasCounts ? factCount : null,
    methodCount,
    rowCount,
    planTotal,
    factTotal,
    economy,
    execCountPct: hasCounts && planCount > 0 ? +((factCount / planCount) * 100).toFixed(1) : null,
    execAmountPct: planTotal > 0 ? +((factTotal / planTotal) * 100).toFixed(1) : null,
  };
}
