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

/**
 * Пометка происхождения нормативов, уходящая в API вместе с каждым профилем
 * (/api/analytics/profiles). Причина: role/expectedExecQ1/normalEpShare ниже —
 * НЕ факт и не закон, источника в данных у них нет.
 */
export const BASELINE_UNCONFIRMED_NOTE =
  'Норматив не подтверждён: роль и ожидания (expectedExecQ1, normalEpShare) — внутренний '
  + 'ориентир из легаси-генератора предыдущей команды (procurement_report.gs), происхождение '
  + 'значений не документировано. Отклонения (execDeviation, epShareDeviation) и riskLevel '
  + 'считаются от этого ориентира и фактом не являются.';

/**
 * Роли и ожидания по каждому ГРБС — порт из легаси-генератора предыдущей
 * команды (procurement_report.gs, GRBS_BASELINES_). Это НЕ закон и не данные:
 * происхождение значений не документировано, в книгах ГРБС источника нет,
 * ожидание исполнения заточено под Q1 (тот же статус, что у EP_SHARE_BY_ROLE
 * в compliance-44fz.ts). Целевое место — редактируемый справочник настроек
 * аналитика (дизайн-док §5.1-3/4), не константа; до переноса каждый профиль
 * несёт BASELINE_UNCONFIRMED_NOTE, чтобы потребители API не читали
 * отклонения от этих чисел как факт.
 */
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
  /**
   * actual − expected (negative = underperforming); `null` при отсутствии базы.
   * Ожидание — неподтверждённый ориентир (см. baselineNote), не факт.
   */
  execDeviation: number | null;
  /** actual − normal (positive = too much EP); `null` при отсутствии базы. */
  epShareDeviation: number | null;
  /** Риск от отклонений против неподтверждённого ориентира (см. baselineNote). */
  riskLevel: 'low' | 'medium' | 'high';
  /**
   * Всегда true, пока нормативы не перенесены в редактируемый справочник
   * настроек: expectedExecQ1/normalEpShare/role взяты из легаси без источника.
   */
  baselineUnconfirmed: true;
  /** Текст пометки для потребителей API — см. BASELINE_UNCONFIRMED_NOTE. */
  baselineNote: string;
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
        baselineUnconfirmed: true as const,
        baselineNote: BASELINE_UNCONFIRMED_NOTE,
      };
    }

    const totalProc = recalc.totalCompetitive + recalc.totalEP;
    const avgContract = totalProc > 0 ? recalc.year.planTotal / totalProc : 0;
    const actualExecQ1 = recalc.quarters.q1.executionPct;
    const actualEpShare = recalc.epSharePct;
    // Отклонение существует, только если есть от чего отклоняться.
    const execDev = actualExecQ1 === null ? null : actualExecQ1 - baseline.expectedExecQ1;
    const epDev = actualEpShare === null ? null : actualEpShare - baseline.normalEpShare;

    // Единицы: planTotal — тыс. руб. (канон колонок книг ГРБС), поэтому пороги
    // объёма тоже в тысячах: 100_000 тыс. = 100 млн руб., 10_000 тыс. = 10 млн руб.
    // Свип БАГ #1 (bug-hunt 2026-08-08): литералы были в рублях (100_000_000 /
    // 10_000_000) — при данных в тысячах «ВЫСОКИЙ» требовал плана на 100 млрд руб.
    // (недостижимо), а «НИЗКИЙ» получал почти каждый ГРБС.
    let volume: VolumeLevel = 'СРЕДНИЙ';
    if (recalc.year.planTotal > 100_000) volume = 'ВЫСОКИЙ';
    else if (recalc.year.planTotal < 10_000) volume = 'НИЗКИЙ';

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
      baselineUnconfirmed: true as const,
      baselineNote: BASELINE_UNCONFIRMED_NOTE,
    };
  });
}
