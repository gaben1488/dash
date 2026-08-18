/**
 * PlanSemanticsNote — сноска у сводных плановых чисел: что именно означает
 * «план» для управлений выбранного периметра (канон п.102, 18.08.2026).
 *
 * ПОЧЕМУ СНОСКА ВООБЩЕ НУЖНА. Столбцы H/I/J/K книг называются одинаково, а
 * несут разное: у одних управлений это начальная (максимальная) цена контракта,
 * у УКСиМП — та же цена, но правленная вниз на изъятое перераспределением, у
 * УДТХ — лимит, который снимается со строки при экономии. Сводное плановое
 * число складывает всё это в одну сумму. Пока колонки не разведены («Закупки
 * 2.0»), число не должно молчать о своей природе — иначе читатель строит вывод
 * на величине, которой не существует.
 *
 * УСТРОЙСТВО. Вся смысловая часть — в @aemr/shared (`plan-semantics.ts`), здесь
 * только показ: короткая подпись на экране, полное объяснение по наведению.
 * Тон п.53: механизм простыми словами, адрес (какие управления), действие
 * («смотрите управления по отдельности»), без упрёка заполняющим.
 *
 * ПАРА К PeriodBadge. Плашка периода отвечает на вопрос «за какое время это
 * число», эта сноска — «из чего это число сложено». Оба вопроса задают об одной
 * и той же сумме, поэтому и живут рядом.
 */
import { useMemo } from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { ALL_DEPT_IDS, summarizePlanSemantics, type PlanSemanticsSummary } from '@aemr/shared';
import { useStore } from '../store';

/**
 * Сводная подпись для текущего периметра фильтров. Пустой выбор управлений на
 * всех экранах означает «все восемь» — подпись обязана считать так же, иначе
 * при пустом фильтре она бы промолчала ровно там, где смешение максимально.
 */
export function usePlanSemantics(): PlanSemanticsSummary {
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  return useMemo(
    () =>
      summarizePlanSemantics(
        selectedDepartments.size > 0 ? [...selectedDepartments] : [...ALL_DEPT_IDS],
      ),
    [selectedDepartments],
  );
}

/** Полный текст для подсказки по наведению: подпись, объяснение, происхождение. */
export function planSemanticsHoverText(summary: PlanSemanticsSummary): string {
  return `${summary.label}.\n${summary.explain}`;
}

export interface PlanSemanticsNoteProps {
  /** Дополнительные классы размещения (выравнивание, отступы задаёт вызывающий блок). */
  className?: string;
  /**
   * Компактный вид для строки итогов: без иконки-восклицания, одной строкой.
   * Смысл тот же — сокращается только вёрстка.
   */
  compact?: boolean;
}

/**
 * Сама сноска. Янтарный — только когда величины действительно смешаны или есть
 * неподтверждённые управления: цвет здесь несёт смысл «на это число нельзя
 * опереться как на однородное», а не украшение.
 */
export function PlanSemanticsNote({ className, compact = false }: PlanSemanticsNoteProps) {
  const summary = usePlanSemantics();
  if (summary.kinds.length === 0) return null;

  const alarming = summary.mixed || summary.hasUnknown;
  const Icon = summary.mixed ? AlertTriangle : Info;
  const title = planSemanticsHoverText(summary);

  return (
    <span
      className={clsx(
        'inline-flex items-start gap-1 cursor-help',
        compact ? 'text-[10px] leading-tight' : 'text-[9px] leading-tight max-w-[15rem]',
        alarming
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-zinc-500 dark:text-zinc-400',
        className,
      )}
      title={title}
      aria-label={title}
      data-testid="plan-semantics-note"
    >
      <Icon size={compact ? 11 : 10} className="shrink-0 mt-px" aria-hidden="true" />
      <span>{summary.label}</span>
    </span>
  );
}
