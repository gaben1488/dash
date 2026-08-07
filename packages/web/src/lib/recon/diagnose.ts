// ── Эвристическая диагностика источника расхождения СВОД↔расчёт по управлению.
//    Извлечено move-only из pages/Recon.tsx (разрез E11-4).
//
//    Тексты читает человек за пультом, поэтому колонки называются по-русски
//    («колонка даты заключения»), а не буквой листа, и латиницы в них нет:
//    буква колонки допустима только как часть адреса ячейки (правило
//    §1 плана к запуску, оно же канон product-dictionary §6.3).

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
      detail: `Расчёт видит заметно больше заключённых контрактов (${fmtNum(row.fullFactCalculated)}), чем лист СВОД (${fmtNum(row.fullFactOfficial)}). Вероятная причина: продукт и формулы листа по-разному читают колонку даты заключения — например, заглушка «Х» или дата будущего периода.`,
      severity: 'error',
    };
  }

  // Plan delta > 10% → likely classification/method filter issue
  if (pAbs > 10) {
    return {
      source: 'Классификация строк',
      detail: `Расчёт по строкам даёт ${fmtNum(row.fullPlanCalculated)}, лист СВОД — ${fmtNum(row.fullPlanOfficial)} (расхождение ${fmtPct(pAbs)}). Вероятная причина: строки по-разному распределяются по способу закупки — пустой или нераспознанный способ попадает в конкурентные у одной стороны и никуда у другой.`,
      severity: 'error',
    };
  }

  // Plan within 5% but fact diverges → mixed issue
  if (pAbs < 5 && fAbs > 5) {
    return {
      source: 'Факт-классификация',
      detail: `План почти сходится (расхождение ${fmtPct(pAbs)}), а факт расходится (${fmtPct(fAbs)}). Что проверить: заполнена ли дата заключения у спорных строк и не выходит ли диапазон формулы листа за пределы данных.`,
      severity: 'warn',
    };
  }

  // Economy mismatch
  if (eAbs > 10 && Math.abs(row.ecoDelta) > 100) {
    return {
      source: 'Расчёт экономии',
      detail: `Экономия: лист СВОД — ${fmtNum(row.ecoTotalOfficial)}, расчёт — ${fmtNum(row.ecoTotalCalculated)}. Что проверить: суммы экономии по бюджетам в книге управления и отметку утверждения — лист считает только утверждённую экономию.`,
      severity: 'warn',
    };
  }

  // Small discrepancy
  if (pAbs < 5 && fAbs < 5) {
    return {
      source: 'Округление / граничные строки',
      detail: `Расхождение в пределах допустимого: план ${fmtPct(pAbs)}, факт ${fmtPct(fAbs)}. Скорее всего одна-две пограничные строки отнесены по-разному.`,
      severity: 'info',
    };
  }

  return {
    source: 'Комплексное расхождение',
    detail: `Расходятся и план (${fmtPct(pAbs)}), и факт (${fmtPct(fAbs)}). Нужна ручная проверка: формулы листа СВОД и состав строк в книге управления.`,
    severity: 'error',
  };
}
