/**
 * ГРБС management grade A-B-C-D — Layer A of the decision-engine port (aemr-bot passport 03/05).
 *
 * ВАЖНО: это оценка ИСПОЛНЕНИЯ закупок (управленческая), НЕ качества данных
 * (за качество данных отвечает trust/scorer.ts со шкалой A-F — это другое).
 *
 * Грейд (паспорт 05 табл.3): A — исполнение ≥ плана (с фазовой поправкой), 0 аномалий, 0 нарушений;
 * B — лёгкое отставание / 1-2 жёлтых; C — отставание 10-25% / аномалии; D — отставание >25% + нарушения.
 *
 * Реализация через штраф 0-100 → буква. Адаптивные пороги по фазе квартала
 * (паспорт 03 §1: масштаб ожидаемого исполнения по фазе).
 *
 * ШКАЛА ОДНА НА ПРОДУКТ — решение владельца п.137(9) от 21.08.2026, дословно:
 * «как в композите датасета везде» (меньше значит лучше). До правки этот
 * модуль считал БАЛЛ (100 — идеально), а композит датасета на соседнем экране
 * считал ШТРАФ (0 — идеально); буквы совпадали, арифметика была
 * противоположной, и число рядом с буквой читателю не помогало, а мешало.
 * Теперь первично поле `penalty` — штраф, ноль лучший исход, как в композите;
 * пороги букв живут в общем доме (@aemr/shared grade-scale.ts) и переносом
 * шкалы не сдвинуты: ни одно управление буквы не сменило.
 */
import { managementGradeOfPenalty, type ManagementGrade } from '@aemr/shared';

export type Grade = ManagementGrade;

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
  /**
   * ШТРАФ 0-100 — числовая основа грейда, меньше значит лучше. Единая шкала
   * продукта (решение владельца п.137(9)); та же арифметика, что у композита
   * датасета.
   */
  penalty: number;
  /**
   * Балл 0-100, зеркало штрафа (100 − penalty).
   *
   * @deprecated Оставлено ровно на время, пока таблица «Оценка управлений»
   * показывает подпись «Баллов: N из 100»: снять поле раньше подписи значит
   * поменять смысл цифры под неизменившимся текстом. Новый код читает
   * `penalty` и подписывает его GRADE_SCORE_CAPTION (@aemr/shared).
   */
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
 * Грейд ГРБС по исполнению. Считается ШТРАФ (0 — замечаний нет), буква берётся
 * из общей шкалы продукта: penalty ≤ 15 — A, ≤ 30 — B, ≤ 50 — C, дальше D.
 * Это зеркало прежней балльной записи (A ≥ 85, B ≥ 70, C ≥ 50), поэтому
 * ни одно управление буквы не меняет — меняется только направление числа.
 */
export function gradeGRBS(input: GrbsGradeInput): GrbsGradeResult {
  const { execPct, expectedExecPct, anomalyCount, epShare, epShareLimit, complianceViolations } = input;
  const reasons: string[] = [];
  let penalty = 0;

  // Отставание исполнения (относительное к ожидаемому с фазовой поправкой).
  // Плана нет (execPct === null) — отставать не от чего: штрафа нет, но и
  // молчания нет: причина названа, чтобы «A» не читалось как похвала.
  if (execPct === null) {
    reasons.push('плана нет — исполнение не оценивается');
  } else if (expectedExecPct > 0 && execPct < expectedExecPct) {
    const lag = (expectedExecPct - execPct) / expectedExecPct; // 0-1
    const pen = clampPenalty(lag * 100, 45);
    penalty += pen;
    if (lag > 0.10) reasons.push(`отставание исполнения ${(lag * 100).toFixed(0)}% от ожидаемого`);
  }

  // Аномалии
  if (anomalyCount > 0) {
    const pen = clampPenalty(anomalyCount * 5, 20);
    penalty += pen;
    reasons.push(`аномалий: ${anomalyCount}`);
  }

  // Превышение доли ЕП
  if (epShareLimit > 0 && epShare > epShareLimit) {
    const pen = clampPenalty((epShare - epShareLimit) * 100, 20);
    penalty += pen;
    reasons.push(`доля ЕП ${(epShare * 100).toFixed(0)}% > нормы ${(epShareLimit * 100).toFixed(0)}%`);
  }

  // Нарушения 44-ФЗ
  if (complianceViolations > 0) {
    const pen = clampPenalty(complianceViolations * 10, 30);
    penalty += pen;
    reasons.push(`нарушений 44-ФЗ: ${complianceViolations}`);
  }

  penalty = Math.min(100, Math.max(0, Math.round(penalty)));
  const grade: Grade = managementGradeOfPenalty(penalty);
  // score — зеркало штрафа для одной ещё не переписанной подписи на экране
  // («Баллов: N из 100» в таблице «Оценка управлений»). Считается здесь, а не
  // на месте показа, чтобы у зеркала был ровно один producer.
  return { grade, penalty, score: 100 - penalty, reasons };
}
