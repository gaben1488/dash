/**
 * Индекс дисциплины 0-100 + нарративные режимы — Layer B decision-engine port (aemr-bot passport 03 §7 / 09 §3).
 *
 * Формула: (0.25·Исп + 0.20·Дин + 0.15·ЕП + 0.10·Данные + 0.15·Аном + 0.15·44ФЗ)·100 + антикор-штраф.
 * Веса в сумме = 1.0. Каждый компонент — score 0-1 (1 = хорошо). Антикор-штраф (из Layer C) отрицательный.
 *
 * Нарратив: 5 режимов (ПОХВАЛА/ШТАТНЫЙ/ВНИМАНИЕ/ТРЕВОГА/КОНТЕКСТНЫЙ) + доминирующий фактор
 * (приоритет КОНТЕКСТ>АНОМАЛИЯ>ИСПОЛНЕНИЕ>ЕП>ДИНАМИКА>ЭКОНОМИЯ). Контекст смягчает тон.
 */

export type NarrativeMode = 'ПОХВАЛА' | 'ШТАТНЫЙ' | 'ВНИМАНИЕ' | 'ТРЕВОГА' | 'КОНТЕКСТНЫЙ';
export type DominantFactor = 'КОНТЕКСТ' | 'АНОМАЛИЯ' | 'ИСПОЛНЕНИЕ' | 'ЕП' | 'ДИНАМИКА' | 'ЭКОНОМИЯ';

export interface DisciplineInput {
  execScore: number; // 0-1, исполнение (1=хорошо)
  dynamicsScore: number; // 0-1, динамика/тренд
  epScore: number; // 0-1, доля ЕП в норме (1=в норме)
  dataScore: number; // 0-1, качество данных (из trust)
  anomalyScore: number; // 0-1, 1=нет аномалий
  complianceScore: number; // 0-1, 1=нет нарушений 44-ФЗ
  /** Из Layer C (detectAntiCorruption.disciplinaryPenalty), отрицательный. */
  anticorruptionPenalty?: number;
  /** КОНТЕКСТ-ввод оператора заполнен (лист КОНТЕКСТ). */
  hasContext?: boolean;
}

export interface DisciplineResult {
  index: number; // 0-100
  mode: NarrativeMode;
  dominantFactor: DominantFactor;
  narrative: string;
}

export const DISCIPLINE_WEIGHTS = {
  exec: 0.25,
  dynamics: 0.20,
  ep: 0.15,
  data: 0.10,
  anomaly: 0.15,
  compliance: 0.15,
} as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function disciplineIndex(input: DisciplineInput): DisciplineResult {
  const exec = clamp01(input.execScore);
  const dyn = clamp01(input.dynamicsScore);
  const ep = clamp01(input.epScore);
  const data = clamp01(input.dataScore);
  const anom = clamp01(input.anomalyScore);
  const comp = clamp01(input.complianceScore);

  const raw =
    DISCIPLINE_WEIGHTS.exec * exec +
    DISCIPLINE_WEIGHTS.dynamics * dyn +
    DISCIPLINE_WEIGHTS.ep * ep +
    DISCIPLINE_WEIGHTS.data * data +
    DISCIPLINE_WEIGHTS.anomaly * anom +
    DISCIPLINE_WEIGHTS.compliance * comp;

  const penalty = input.anticorruptionPenalty ?? 0; // отрицательный
  const index = Math.round(Math.min(100, Math.max(0, raw * 100 + penalty)));

  // Доминирующий фактор = худший компонент; приоритет — тай-брейк.
  const candidates: { factor: DominantFactor; score: number; priority: number }[] = [
    { factor: 'АНОМАЛИЯ', score: anom, priority: 1 },
    { factor: 'ИСПОЛНЕНИЕ', score: exec, priority: 2 },
    { factor: 'ЕП', score: ep, priority: 3 },
    { factor: 'ДИНАМИКА', score: dyn, priority: 4 },
  ];
  let worst = candidates[0];
  for (const c of candidates) {
    if (c.score < worst.score - 1e-9) worst = c;
    else if (Math.abs(c.score - worst.score) < 1e-9 && c.priority < worst.priority) worst = c;
  }
  const dominantFactor: DominantFactor = input.hasContext ? 'КОНТЕКСТ' : worst.factor;

  // Режим по индексу; контекст смягчает тон при проблемах.
  let mode: NarrativeMode;
  if (index >= 85) mode = 'ПОХВАЛА';
  else if (index >= 70) mode = 'ШТАТНЫЙ';
  else if (index >= 50) mode = 'ВНИМАНИЕ';
  else mode = 'ТРЕВОГА';
  if (input.hasContext && index < 70) mode = 'КОНТЕКСТНЫЙ';

  const narrative = `Дисциплина ${index}/100 — ${mode}${
    mode === 'ПОХВАЛА' ? '' : `; главный фактор: ${dominantFactor.toLowerCase()}`
  }`;

  return { index, mode, dominantFactor, narrative };
}
