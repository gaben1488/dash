/**
 * ГРБС management grade A-B-C-D — Layer A of the decision-engine port (aemr-bot passport 03/05).
 *
 * ВАЖНО: это оценка ИСПОЛНЕНИЯ закупок (управленческая), НЕ качества данных
 * (за качество данных отвечает trust/scorer.ts со шкалой A-F — это другое).
 *
 * Грейд (паспорт 05 табл.3): A — исполнение ≥ плана (с фазовой поправкой), 0 аномалий, 0 нарушений;
 * B — лёгкое отставание / 1-2 жёлтых; C — отставание 10-25% / аномалии; D — отставание >25% + нарушения.
 *
 * Реализация через score 0-100 (штрафы) → буква. Адаптивные пороги по фазе квартала
 * (паспорт 03 §1: масштаб ожидаемого исполнения по фазе).
 */

export type Grade = 'A' | 'B' | 'C' | 'D';

export interface GrbsGradeInput {
  /**
   * Фактическое исполнение, доля 0-1 (факт/план).
   *
   * `null` = ПЛАНА НЕТ, а не «исполнено ноль». Раньше сюда приходил ноль
   * вместо «нет базы», и беспланное управление получало максимальный штраф
   * за отставание (45 баллов) и грейд D за то, чего у него нет
   * (реестр расхождений 08.08 §2, волна 0 п.5; лист в такой ячейке печатает
   * прочерк — `IF(D13=0;"-";E13/D13)`).
   */
  execPct: number | null;
  /** Ожидаемое исполнение к этому моменту с учётом фазы квартала, доля 0-1. */
  expectedExecPct: number;
  /** Число аномалий (Бенфорд/Z-score). */
  anomalyCount: number;
  /** Доля ЕП, 0-1. */
  epShare: number;
  /** Порог доли ЕП для роли ГРБС, 0-1. */
  epShareLimit: number;
  /** Число нарушений 44-ФЗ (critical+warning). */
  complianceViolations: number;
}

export interface GrbsGradeResult {
  grade: Grade;
  /** 0-100 — числовая основа грейда. */
  score: number;
  /** Главные причины снижения (для нарратива Layer B). */
  reasons: string[];
}

/** Фазовая поправка ожидаемого исполнения (паспорт 03 §1): начало/середина/конец квартала. */
export function phaseAdjustedTarget(baseTarget: number, monthInQuarter: 1 | 2 | 3): number {
  const scale = monthInQuarter === 1 ? 0.15 : monthInQuarter === 2 ? 0.55 : 0.90;
  return baseTarget * scale;
}

const clampPenalty = (v: number, cap: number) => Math.min(Math.max(v, 0), cap);

/**
 * Грейд ГРБС по исполнению. score 100 − штрафы; A≥85, B≥70, C≥50, D<50.
 */
export function gradeGRBS(input: GrbsGradeInput): GrbsGradeResult {
  const { execPct, expectedExecPct, anomalyCount, epShare, epShareLimit, complianceViolations } = input;
  const reasons: string[] = [];
  let score = 100;

  // Отставание исполнения (относительное к ожидаемому с фазовой поправкой).
  // Плана нет (execPct === null) — отставать не от чего: штрафа нет, но и
  // молчания нет: причина названа, чтобы «A» не читалось как похвала.
  if (execPct === null) {
    reasons.push('плана нет — исполнение не оценивается');
  } else if (expectedExecPct > 0 && execPct < expectedExecPct) {
    const lag = (expectedExecPct - execPct) / expectedExecPct; // 0-1
    const pen = clampPenalty(lag * 100, 45);
    score -= pen;
    if (lag > 0.10) reasons.push(`отставание исполнения ${(lag * 100).toFixed(0)}% от ожидаемого`);
  }

  // Аномалии
  if (anomalyCount > 0) {
    const pen = clampPenalty(anomalyCount * 5, 20);
    score -= pen;
    reasons.push(`аномалий: ${anomalyCount}`);
  }

  // Превышение доли ЕП
  if (epShareLimit > 0 && epShare > epShareLimit) {
    const pen = clampPenalty((epShare - epShareLimit) * 100, 20);
    score -= pen;
    reasons.push(`доля ЕП ${(epShare * 100).toFixed(0)}% > нормы ${(epShareLimit * 100).toFixed(0)}%`);
  }

  // Нарушения 44-ФЗ
  if (complianceViolations > 0) {
    const pen = clampPenalty(complianceViolations * 10, 30);
    score -= pen;
    reasons.push(`нарушений 44-ФЗ: ${complianceViolations}`);
  }

  score = Math.max(0, Math.round(score));
  const grade: Grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
  return { grade, score, reasons };
}
