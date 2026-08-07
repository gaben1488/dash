/**
 * Сборщик первопричин строки сверки — единственная дверь между
 * классификаторами и потребителями (роут сверки, отчёт).
 *
 * Порядок классификаторов не случаен: сначала механические классы с
 * бесспорными адресами (без финансирования, факт без квартала), затем
 * объяснимое поведение системы (после среза), затем трактовки (способ,
 * отменённые, знак) и последним — дефекты чтения. Непокрытый остаток
 * дельты честно становится причиной «первопричина не установлена»: ни
 * округления, ни умолчания.
 *
 * Спека: docs/superpowers/plans/2026-08-07-launch-readiness.md §1.
 */

import {
  unexplainedRemainder,
  type ReconLine,
  type ReconLineRootCause,
  type ReconRootCause,
  type ReconRootCauseClass,
} from '@aemr/shared';
import {
  classifyAfterSlice,
  classifyCancelled,
  classifyFactQuarterMissing,
  classifyMethod,
  classifyParsing,
  classifySign,
  classifyUnfunded,
  type ClassifyInput,
} from './recon-classify.js';

/** Классификатор: вход → причина или null, если находок нет. */
type Classifier = (input: ClassifyInput) => ReconRootCause | null;

/**
 * Очередь классификаторов. Порядок = приоритет объяснения: одна и та же
 * строка книги может подойти под два класса, и первым её объясняет тот,
 * чей дефект конкретнее и чьё действие понятнее исполнителю.
 */
const PIPELINE: readonly Classifier[] = [
  classifyUnfunded,
  classifyFactQuarterMissing,
  classifyAfterSlice,
  classifyMethod,
  classifyCancelled,
  classifySign,
  classifyParsing,
];

/** Стабильный идентификатор причины: класс + лист + показатель. */
function causeId(cls: ReconRootCauseClass, sheet: string, metric: string): string {
  return `${cls}:${sheet}:${metric}`;
}

export interface BuildCausesInput extends ClassifyInput {
  /** Ключ показателя сверки, для которого объясняется расхождение. */
  metric: string;
  /** Расхождение строки сверки (расчёт − официал) в единицах меры. */
  delta: number;
}

/**
 * Собрать первопричины для одной строки сверки.
 *
 * Возвращает список причин, сумма вкладов которых сходится с дельтой по
 * построению: остаток добирается классом 'unknown'. Результат сразу
 * пригоден для validateReconLine — контракт не нарушается.
 */
export function buildRootCauses(input: BuildCausesInput): ReconLineRootCause[] {
  const out: ReconLineRootCause[] = [];
  for (const classify of PIPELINE) {
    const cause = classify(input);
    if (!cause) continue;
    out.push({
      ...cause,
      id: causeId(cause.class, input.sheet, input.metric),
      affects: [],
    });
  }
  const rest = unexplainedRemainder(
    { metric: input.metric, official: 0, computed: input.delta, delta: input.delta },
    out,
  );
  if (rest) out.push(rest);
  return out;
}

/**
 * Строка сверки с объяснением. Расхождение в пределах допуска причин не
 * получает: объяснять нечего, и пустой список тут — не пробел, а факт.
 */
export function explainReconLine(
  line: Omit<ReconLine, 'rootCauses'>,
  input: Omit<BuildCausesInput, 'metric' | 'delta'>,
): ReconLine {
  if (Math.abs(line.delta) <= 0.01) return { ...line, rootCauses: [] };
  return {
    ...line,
    rootCauses: buildRootCauses({ ...input, metric: line.metric, delta: line.delta }),
  };
}

/**
 * Каскад: одна и та же причина в нескольких показателях получает список
 * задетых показателей (affects). Зовётся после того, как объяснены все
 * строки сверки, — иначе неизвестно, что ещё сломала та же причина.
 */
export function linkCascades(lines: ReconLine[]): ReconLine[] {
  const metricsById = new Map<string, string[]>();
  for (const line of lines) {
    for (const cause of line.rootCauses) {
      const list = metricsById.get(cause.id) ?? [];
      if (!list.includes(line.metric)) list.push(line.metric);
      metricsById.set(cause.id, list);
    }
  }
  return lines.map((line) => ({
    ...line,
    rootCauses: line.rootCauses.map((cause) => ({
      ...cause,
      // В affects — задетые показатели КРОМЕ текущего: свой показатель
      // читатель и так видит, дублировать его в списке следствий незачем.
      affects: (metricsById.get(cause.id) ?? []).filter((m) => m !== line.metric),
    })),
  }));
}
