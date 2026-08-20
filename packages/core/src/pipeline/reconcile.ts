/**
 * Reconciliation Engine
 * Compares official metrics from СВОД ТД-ПМ summary cells
 * against independently recalculated metrics from department rows.
 *
 * Assessment thresholds:
 *   < 1 %  — Совпадает          (ok)
 *   < 5 %  — Несопоставимо      (warning)  — check composition / period
 *   >= 5 % — Есть расхождение   (high)     — likely mapping error
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
  /**
   * Подпись для интерфейса. «Официал не считается» — отдельный вердикт, а
   * не разновидность «нечего сравнивать»: у управления есть свои строки, а
   * блок листа СВОД отдаёт нули из-за недоступного источника (слепая
   * зона №2). Слить их значило бы объявить сломанный лист нормой.
   */
  status: 'Совпадает' | 'Несопоставимо' | 'Есть расхождение' | 'Нечего сравнивать' | 'Официал не считается';
  kind: 'ok' | 'neutral' | 'warning' | 'high';
  reason: string;
  maxAbsDelta: number;
  /** Likely source of the discrepancy */
  source: 'none' | 'methodology' | 'svod_error' | 'calc_error';
  sourceLabel: string;
}

export interface ReconRow {
  department: string;

  // Plan comparison
  fullPlanOfficial: number;
  fullPlanCalculated: number;
  planDelta: number;
  planDeltaPct: number;

  // Fact comparison
  fullFactOfficial: number;
  fullFactCalculated: number;
  factDelta: number;
  factDeltaPct: number;

  // Economy comparison
  ecoTotalOfficial: number;
  ecoTotalCalculated: number;
  ecoDelta: number;

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

function deltaPct(delta: number, base: number): number {
  return base !== 0 ? (delta / base) * 100 : 0;
}

function diagnoseSource(
  planDelta: number,
  factDelta: number,
  planOff: number,
  planCalc: number,
): { source: ReconAssessment['source']; sourceLabel: string } {
  // Both plan and fact deltas point the same direction → systematic
  const planSign = Math.sign(planDelta);
  const factSign = Math.sign(factDelta);

  if (planSign === 0 && factSign === 0) {
    return { source: 'none', sourceLabel: '—' };
  }

  // Calculated > Official consistently → our recalculation likely overcounts
  if (planCalc > planOff && planDelta > 0) {
    return { source: 'calc_error', sourceLabel: 'Ошибка расчёта' };
  }
  // Official > Calculated consistently → СВОД likely has extra/wrong data
  if (planOff > planCalc && planDelta < 0) {
    return { source: 'svod_error', sourceLabel: 'Ошибка СВОД' };
  }
  // Mixed signals or small differences → methodology difference
  return { source: 'methodology', sourceLabel: 'Методология' };
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

  if (planOff === 0 && factOff === 0) {
    // Официал пуст, а расчёт нет — это не «нечего сравнивать», а слепая
    // зона №2: формулы блока на листе СВОД ссылаются на битое зеркало
    // (упавший IMPORTRANGE), поэтому COUNTIFS и SUMIFS дают нули, а доли
    // #DIV/0!. Прежде такой случай рапортовал «сверка чиста» либо мнимое
    // расхождение на весь объём управления — оба вывода ложные.
    if (planCalc > 0) {
      return {
        status: 'Официал не считается',
        kind: 'warning',
        reason: 'Блок этого управления на листе СВОД отдаёт нули: формулы ссылаются на недоступный источник. '
          + 'Сравнивать не с чем — сверка неприменима, пока лист не починен.',
        maxAbsDelta: 0,
        source: 'svod_error',
        sourceLabel: 'Лист СВОД не считает',
      };
    }
    return {
      status: 'Нечего сравнивать',
      kind: 'neutral',
      reason: 'Нет данных в обоих слоях',
      maxAbsDelta: 0,
      source: 'none',
      sourceLabel: '—',
    };
  }

  // Use the larger of plan/fact official values as the base (minimum 1 to avoid /0)
  const baseForPct = Math.max(Math.abs(planOff), Math.abs(factOff), 1);
  const pctDelta = (maxAbs / baseForPct) * 100;

  const { source, sourceLabel } = pctDelta < 1
    ? { source: 'none' as const, sourceLabel: '—' }
    : diagnoseSource(planDelta, factDelta, planOff, planCalc);

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
    reason: `Дельта ${pctDelta.toFixed(1)}% \u2014 вероятна ошибка маппинга`,
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
    const off: OfficialMetrics = officialMetrics.get(dept) ?? {
      planTotal: 0,
      factTotal: 0,
      economyTotal: 0,
    };
    const calc: OfficialMetrics = calculatedMetrics.get(dept) ?? {
      planTotal: 0,
      factTotal: 0,
      economyTotal: 0,
    };

    const planDelta = calc.planTotal - off.planTotal;
    const factDelta = calc.factTotal - off.factTotal;
    const ecoDelta = calc.economyTotal - off.economyTotal;

    const assessment = assess(
      planDelta,
      factDelta,
      ecoDelta,
      off.planTotal,
      off.factTotal,
      calc.planTotal,
    );

    rows.push({
      department: dept,
      fullPlanOfficial: off.planTotal,
      fullPlanCalculated: calc.planTotal,
      planDelta,
      planDeltaPct: deltaPct(planDelta, off.planTotal),
      fullFactOfficial: off.factTotal,
      fullFactCalculated: calc.factTotal,
      factDelta,
      factDeltaPct: deltaPct(factDelta, off.factTotal),
      ecoTotalOfficial: off.economyTotal,
      ecoTotalCalculated: calc.economyTotal,
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
