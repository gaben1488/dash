// ── Эвристическая диагностика источника расхождения СВОД↔расчёт по управлению.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).

import type { ReconDeptRow } from './types';
import { fmtNum, fmtPct } from './format';

export interface DeltaDiagnosis {
  source: string;
  detail: string;
  severity: 'info' | 'warn' | 'error';
}

/** Diagnose the likely source of a discrepancy */
export function diagnoseDelta(row: ReconDeptRow): DeltaDiagnosis {
  const pAbs = Math.abs(row.planDeltaPct);
  const fAbs = Math.abs(row.factDeltaPct);
  const eAbs = row.ecoTotalOfficial !== 0 ? Math.abs(row.ecoDelta / row.ecoTotalOfficial) * 100 : 0;

  if (row.assessment.kind === 'ok' || row.assessment.kind === 'neutral') {
    return { source: 'Нет расхождений', detail: 'Данные согласованы в пределах допустимого порога (< 1%).', severity: 'info' };
  }

  // Fact much higher than official → fact detection issue
  if (fAbs > 50 && row.fullFactCalculated > row.fullFactOfficial * 1.5) {
    return {
      source: 'Детекция факта',
      detail: `Расчёт определяет значительно больше фактов (${fmtNum(row.fullFactCalculated)}) чем СВОД (${fmtNum(row.fullFactOfficial)}). Причина: алгоритм классификации строк (col Q — дата факта) может отличаться от формулы COUNTIFS в СВОД.`,
      severity: 'error',
    };
  }

  // Plan delta > 10% → likely classification/method filter issue
  if (pAbs > 10) {
    return {
      source: 'Классификация строк',
      detail: `Расчёт по строкам даёт ${fmtNum(row.fullPlanCalculated)} vs СВОД ${fmtNum(row.fullPlanOfficial)} (Δ ${fmtPct(pAbs)}). Вероятная причина: различие в фильтрации строк по методу (col L) или score-порогу классификации.`,
      severity: 'error',
    };
  }

  // Plan within 5% but fact diverges → mixed issue
  if (pAbs < 5 && fAbs > 5) {
    return {
      source: 'Факт-классификация',
      detail: `План близок (Δ ${fmtPct(pAbs)}), но факт расходится (Δ ${fmtPct(fAbs)}). Проверьте: col Q (дата факта) заполнена корректно, формула СВОД использует правильный диапазон.`,
      severity: 'warn',
    };
  }

  // Economy mismatch
  if (eAbs > 10 && Math.abs(row.ecoDelta) > 100) {
    return {
      source: 'Расчёт экономии',
      detail: `Экономия: СВОД ${fmtNum(row.ecoTotalOfficial)} vs расчёт ${fmtNum(row.ecoTotalCalculated)}. Проверьте col Z-AC (экономия) и формулу SUMIFS в СВОД.`,
      severity: 'warn',
    };
  }

  // Small discrepancy
  if (pAbs < 5 && fAbs < 5) {
    return {
      source: 'Округление / граничные строки',
      detail: `Допустимое расхождение: план Δ ${fmtPct(pAbs)}, факт Δ ${fmtPct(fAbs)}. Вероятно 1-2 граничные строки по-разному классифицируются.`,
      severity: 'info',
    };
  }

  return {
    source: 'Комплексное расхождение',
    detail: `Расходятся и план (Δ ${fmtPct(pAbs)}) и факт (Δ ${fmtPct(fAbs)}). Требуется ручная проверка формул СВОД и состава строк в листе управления.`,
    severity: 'error',
  };
}
