/**
 * Тело документа из блоков text-blocks — ЕДИНСТВЕННОГО дома состава отчёта.
 *
 * Первая итерация Отчёта++: страница рендерит ровно те же утверждения, что
 * уходят в .docx (гарантия «страница = выгрузка» по построению, не тестом).
 * Заголовки секций получают якоря для оглавления. Следующий шаг — замена
 * текстовых абзацев на claim-строки с KbHover: состав уже на месте, интерактив
 * наращивается без смены источника чисел.
 */
import { useMemo } from 'react';
import {
  mainReportBlocks,
  type QuarterReports,
  type ReportForExport,
} from '../../lib/report/docx/text-blocks';

/** Якорь секции по её заголовку: ГРБС-заголовки уже несут «КОД — название». */
function anchorOf(headingText: string): string | undefined {
  const m = headingText.match(/^([А-ЯЁ]{2,7}) — /);
  if (m) return `grbs-${m[1]}`;
  if (headingText.startsWith('ПО КОНКУРЕНТНЫМ')) return 'competitive';
  if (headingText.startsWith('ЕДИНСТВЕННЫЙ')) return 'ep';
  return undefined;
}

export function DocumentBody(props: {
  report: ReportForExport;
  quarters: QuarterReports;
  asOfDate: string;
}) {
  const blocks = useMemo(
    () => mainReportBlocks(props.report, props.quarters, props.asOfDate),
    [props.report, props.quarters, props.asOfDate],
  );

  return (
    <div className="space-y-3 max-w-[72ch]">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          const id = anchorOf(b.text);
          return (
            <h2
              key={i}
              id={id}
              className="scroll-mt-4 pt-8 first:pt-0 text-[15px] font-semibold text-zinc-800 dark:text-zinc-100"
            >
              {b.text}
            </h2>
          );
        }
        if (b.kind === 'note') {
          return (
            <p key={i} className="italic text-[12px] text-zinc-500 dark:text-zinc-400">
              {b.text}
            </p>
          );
        }
        return (
          <p key={i} className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300 tabular-nums">
            {b.text}
          </p>
        );
      })}
    </div>
  );
}
