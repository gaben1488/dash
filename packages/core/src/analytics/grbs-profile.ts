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
  actualExecQ1: number;
  actualEpShare: number;
  execDeviation: number;   // actual - expected (negative = underperforming)
  epShareDeviation: number; // actual - normal (positive = too much EP)
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
        actualExecQ1: 0,
        actualEpShare: 0,
        execDeviation: -baseline.expectedExecQ1,
        epShareDeviation: 0,
        riskLevel: 'high' as const,
      };
    }

    const totalProc = recalc.totalCompetitive + recalc.totalEP;
    const avgContract = totalProc > 0 ? recalc.year.planTotal / totalProc : 0;
    const actualExecQ1 = recalc.quarters.q1.executionPct;
    const actualEpShare = recalc.epSharePct;
    const execDev = actualExecQ1 - baseline.expectedExecQ1;
    const epDev = actualEpShare - baseline.normalEpShare;

    let volume: VolumeLevel = 'СРЕДНИЙ';
    if (recalc.year.planTotal > 100_000_000) volume = 'ВЫСОКИЙ';
    else if (recalc.year.planTotal < 10_000_000) volume = 'НИЗКИЙ';

    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (execDev < -0.20 || epDev > 0.20) riskLevel = 'high';
    else if (execDev < -0.10 || epDev > 0.10) riskLevel = 'medium';

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
