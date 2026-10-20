/**
 * Reconciliation Engine
 * Compares official metrics from СВОД ТД-ПМ summary cells
 * against independently recalculated metrics from department rows.
 *
 * Assessment thresholds:
 *   < 1 %  — Совпадает          (ok)
 *   < 5 %  — Несопоставимо      (warning)  — check composition / period
 *   >= 5 % — Есть расхождение   (high)     — cause requires evidence
 */

import type { RootCauseGroup } from '@aemr/shared';

// Нормализация ключей ГРБС (canonGrbsKey/rekeyByGrbs) переехала в
// recon-keys.ts (разрез 20.08.2026): недельной сверке она не нужна,
// а помесячная и квартальная берут её оттуда.

// ── Interfaces ────────────────────────────────────────────────────

export interface OfficialMetrics {
  planTotal: number;
  factTotal: number;
  economyTotal: number;
}

export interface ReconAssessment {
  /** Подпись наблюдаемого результата; причина требует отдельного доказательства. */
  status: 'Совпадает' | 'Несопоставимо' | 'Есть расхождение' | 'Нечего сравнивать' | 'Официал не считается';
  kind: 'ok' | 'neutral' | 'warning' | 'high';
  reason: string;
  maxAbsDelta: number | null;
  /** Established cause only; numerical differences alone yield unknown. */
  source: 'none' | 'unknown' | 'methodology' | 'svod_error' | 'calc_error';
  sourceLabel: string;
}

export interface ReconRow {
  department: string;

  // Plan comparison
  fullPlanOfficial: number | null;
  fullPlanCalculated: number | null;
  planDelta: number | null;
  planDeltaPct: number | null;

  // Fact comparison
  fullFactOfficial: number | null;
  fullFactCalculated: number | null;
  factDelta: number | null;
  factDeltaPct: number | null;

  // Economy comparison
  ecoTotalOfficial: number | null;
  ecoTotalCalculated: number | null;
  ecoDelta: number | null;

  // Assessment
  assessment: ReconAssessment;

  /**
   * Первопричины расхождений строки, сгруппированные по каскадам
   * (требование владельца 07.08): почему числа разошлись и какие именно
   * строки книги виноваты. Поля нет — объяснять нечего: расхождение в
   * пределах допуска. Пустой массив при ненулевой дельте означал бы
   * необъяснённое расхождение и запрещён контрактом validateReconLine.
   */
  rootCauses?: RootCauseGroup[];
}

export interface ReconSummary {
  rows: ReconRow[];
  counts: {
    ok: number;
    neutral: number;
    warning: number;
    high: number;
  };
  overallStatus: string;
}

// ── Helpers ───────────────────────────────────────────────────────

function deltaPct(delta: number | null, base: number | undefined): number | null {
  return delta !== null && base !== undefined && base !== 0 ? (delta / base) * 100 : null;
}

function assess(
  planDelta: number,
  factDelta: number,
  ecoDelta: number,
  planOff: number,
  factOff: number,
  planCalc: number,
): ReconAssessment {
  const maxAbs = Math.max(
    Math.abs(planDelta),
    Math.abs(factDelta),
    Math.abs(ecoDelta),
  );

  if (planOff === 0 && factOff === 0 && planCalc === 0 && maxAbs === 0) {
    return {
      status: 'Нечего сравнивать', kind: 'neutral',
      reason: 'В обоих слоях наблюдаются нулевые значения', maxAbsDelta: 0,
      source: 'none', sourceLabel: '—',
    };
  }
  // Use the larger of plan/fact official values as the base (minimum 1 to avoid /0)
  const baseForPct = Math.max(Math.abs(planOff), Math.abs(factOff), 1);
  const pctDelta = (maxAbs / baseForPct) * 100;

  const { source, sourceLabel } = pctDelta < 1
    ? { source: 'none' as const, sourceLabel: '—' }
    : { source: 'unknown' as const, sourceLabel: 'Причина не установлена' };

  if (pctDelta < 1) {
    return {
      status: 'Совпадает',
      kind: 'ok',
      reason: 'Расчёт и свод согласованы (\u0394 < 1%)',
      maxAbsDelta: maxAbs,
      source: 'none',
      sourceLabel: '—',
    };
  }

  if (pctDelta < 5) {
    return {
      status: 'Несопоставимо',
      kind: 'warning',
      reason: `Дельта ${pctDelta.toFixed(1)}% \u2014 проверить состав и период`,
      maxAbsDelta: maxAbs,
      source,
      sourceLabel,
    };
  }

  return {
    status: 'Есть расхождение',
    kind: 'high',
    reason: `Дельта ${pctDelta.toFixed(1)}% \u2014 причина не установлена; проверить состав, период и методику`,
    maxAbsDelta: maxAbs,
    source,
    sourceLabel,
  };
}

// ── Main reconciliation ───────────────────────────────────────────

/**
 * Compare official СВОД metrics with row-by-row recalculated metrics
 * for every department present in either dataset.
 *
 * @param officialMetrics    Map<departmentName, metrics> from summary cells.
 * @param calculatedMetrics  Map<departmentName, metrics> from CalcEngine (via calc-engine-adapter).
 */
export function reconcile(
  officialMetrics: Map<string, OfficialMetrics>,
  calculatedMetrics: Map<string, OfficialMetrics>,
): ReconSummary {
  const rows: ReconRow[] = [];
  const departments = new Set([
    ...officialMetrics.keys(),
    ...calculatedMetrics.keys(),
  ]);

  for (const dept of departments) {
    const off = officialMetrics.get(dept);
    const calc = calculatedMetrics.get(dept);
    const planDelta = off && calc ? calc.planTotal - off.planTotal : null;
    const factDelta = off && calc ? calc.factTotal - off.factTotal : null;
    const ecoDelta = off && calc ? calc.economyTotal - off.economyTotal : null;
    const assessment: ReconAssessment = off && calc
      ? assess(calc.planTotal - off.planTotal, calc.factTotal - off.factTotal,
        calc.economyTotal - off.economyTotal, off.planTotal, off.factTotal, calc.planTotal)
      : { status: 'Несопоставимо', kind: 'warning',
        reason: off ? 'Расчётный слой отсутствует' : 'Официальный слой отсутствует',
        maxAbsDelta: null, source: 'unknown', sourceLabel: 'Нет данных для сравнения' };
    rows.push({
      department: dept,
      fullPlanOfficial: off?.planTotal ?? null,
      fullPlanCalculated: calc?.planTotal ?? null,
      planDelta,
      planDeltaPct: deltaPct(planDelta, off?.planTotal),
      fullFactOfficial: off?.factTotal ?? null,
      fullFactCalculated: calc?.factTotal ?? null,
      factDelta,
      factDeltaPct: deltaPct(factDelta, off?.factTotal),
      ecoTotalOfficial: off?.economyTotal ?? null,
      ecoTotalCalculated: calc?.economyTotal ?? null,
      ecoDelta,
      assessment,
    });
  }

  const counts = {
    ok: rows.filter((r) => r.assessment.kind === 'ok').length,
    neutral: rows.filter((r) => r.assessment.kind === 'neutral').length,
    warning: rows.filter((r) => r.assessment.kind === 'warning').length,
    high: rows.filter((r) => r.assessment.kind === 'high').length,
  };

  let overallStatus: string;
  if (counts.high > 0) {
    overallStatus = 'Есть расхождения';
  } else if (counts.warning > 0) {
    overallStatus = 'Требует проверки';
  } else if (counts.ok === 0) {
    overallStatus = 'Нет данных для сравнения';
  } else {
    overallStatus = 'Данные согласованы';
  }

  return { rows, counts, overallStatus };
}

// ── Реэкспорт разрезанных сверок ─────────────────────────────────
// Разрез 20.08.2026 (зона В): помесячная и квартальная сверки переехали в
// свои файлы, а публичная дверь осталась одна — этот модуль. Все прежние
// импорты `from './reconcile.js'` (ядро, сервер, тесты) работают без правок.
export * from './reconcile-monthly.js';
export * from './reconcile-cross.js';
