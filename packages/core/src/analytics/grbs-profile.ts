/**
 * ГРБС Profiling Module
 * Assigns roles, baselines, and performance assessments to each department.
 * Based on procurement_report.gs GRBS_BASELINES_ configuration.
 */

import type { RecalculatedMetrics } from '../pipeline/recalculate.js';

export type GRBSRole = 'ОПЕРАЦИОННЫЙ' | 'ИНВЕСТИЦИОННЫЙ' | 'СМЕШАННЫЙ';
export type VolumeLevel = 'ВЫСОКИЙ' | 'СРЕДНИЙ' | 'НИЗКИЙ';

export interface GRBSBaseline {
  grbsId: string;
  grbsShort: string;
  role: GRBSRole;
  expectedExecQ1: number;
  normalEpShare: number;
}

/** Static baselines from procurement_report.gs GRBS_BASELINES_ */
export const GRBS_BASELINES: GRBSBaseline[] = [
  { grbsId: 'uer',    grbsShort: 'УЭР',    role: 'ОПЕРАЦИОННЫЙ',     expectedExecQ1: 0.65, normalEpShare: 0.35 },
  { grbsId: 'uio',    grbsShort: 'УИО',    role: 'ОПЕРАЦИОННЫЙ',     expectedExecQ1: 0.45, normalEpShare: 0.55 },
  { grbsId: 'uagzo',  grbsShort: 'УАГЗО',  role: 'ИНВЕСТИЦИОННЫЙ',   expectedExecQ1: 0.40, normalEpShare: 0.60 },
  { grbsId: 'ufbp',   grbsShort: 'УФБП',   role: 'ОПЕРАЦИОННЫЙ',     expectedExecQ1: 0.70, normalEpShare: 0.25 },
  { grbsId: 'ud',     grbsShort: 'УД',     role: 'ОПЕРАЦИОННЫЙ',     expectedExecQ1: 0.60, normalEpShare: 0.40 },
  { grbsId: 'udtx',   grbsShort: 'УДТХ',   role: 'ИНВЕСТИЦИОННЫЙ',   expectedExecQ1: 0.35, normalEpShare: 0.20 },
  { grbsId: 'uksimp', grbsShort: 'УКСиМП', role: 'СМЕШАННЫЙ',        expectedExecQ1: 0.50, normalEpShare: 0.50 },
  { grbsId: 'uo',     grbsShort: 'УО',     role: 'ОПЕРАЦИОННЫЙ',     expectedExecQ1: 0.55, normalEpShare: 0.65 },
];

export interface GRBSProfile {
  grbsId: string;
  grbsShort: string;
  role: GRBSRole;
  expectedExecQ1: number;
  normalEpShare: number;
  procurementVolume: VolumeLevel;
  avgContractSize: number;
  totalProcurements: number;
  /**
   * `null` = базы нет (плана нет вовсе либо книга не читалась). Отличать
   * обязательно: ноль здесь означал бы «план есть, не исполнено», и профиль
   * ставил бы высокий риск управлению, которому просто нечего исполнять
   * (реестр расхождений 08.08 §2).
   */
  actualExecQ1: number | null;
  actualEpShare: number | null;
  /** actual − expected (negative = underperforming); `null` при отсутствии базы. */
  execDeviation: number | null;
  /** actual − normal (positive = too much EP); `null` при отсутствии базы. */
  epShareDeviation: number | null;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Build profiles for all departments based on recalculated metrics.
 */
export function buildGRBSProfiles(
  recalcResults: Record<string, RecalculatedMetrics>,
): GRBSProfile[] {
  return GRBS_BASELINES.map(baseline => {
    const recalc = recalcResults[baseline.grbsId];
    if (!recalc) {
      return {
        ...baseline,
        procurementVolume: 'НИЗКИЙ' as VolumeLevel,
        avgContractSize: 0,
        totalProcurements: 0,
        // Книги этого ГРБС в снимке нет — это отсутствие ДАННЫХ, а не нулевое
        // исполнение. Числа пусты, риск высокий именно из-за слепоты.
        actualExecQ1: null,
        actualEpShare: null,
        execDeviation: null,
        epShareDeviation: null,
        riskLevel: 'high' as const,
      };
    }

    const totalProc = recalc.totalCompetitive + recalc.totalEP;
    const avgContract = totalProc > 0 ? recalc.year.planTotal / totalProc : 0;
    const actualExecQ1 = recalc.quarters.q1.executionPct;
    const actualEpShare = recalc.epSharePct;
    // Отклонение существует, только если есть от чего отклоняться.
    const execDev = actualExecQ1 === null ? null : actualExecQ1 - baseline.expectedExecQ1;
    const epDev = actualEpShare === null ? null : actualEpShare - baseline.normalEpShare;

    let volume: VolumeLevel = 'СРЕДНИЙ';
    if (recalc.year.planTotal > 100_000_000) volume = 'ВЫСОКИЙ';
    else if (recalc.year.planTotal < 10_000_000) volume = 'НИЗКИЙ';

    // Риск поднимает только измеренное отклонение: неизвестная величина не
    // штрафует (снятие штрафа за «исполнение 0 %», реестр 08.08 §2 п.5).
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if ((execDev !== null && execDev < -0.20) || (epDev !== null && epDev > 0.20)) riskLevel = 'high';
    else if ((execDev !== null && execDev < -0.10) || (epDev !== null && epDev > 0.10)) riskLevel = 'medium';

    return {
      ...baseline,
      procurementVolume: volume,
      avgContractSize: avgContract,
      totalProcurements: totalProc,
      actualExecQ1,
      actualEpShare,
      execDeviation: execDev,
      epShareDeviation: epDev,
      riskLevel,
    };
  });
}
