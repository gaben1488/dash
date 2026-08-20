/**
 * Остаток к заключению — обе стороны в одной таблице.
 *
 * До переплавки 03.08 это были три серых абзаца, приклеенных под сеткой
 * плиток: наш пересчёт, ярус официального листа и расчётная экономия —
 * одна тема, разбросанная по трём предложениям без связи. Здесь они стоят
 * рядом как сверка: подпись с БЗ, число, состав бюджетов, происхождение и
 * адрес ячейки листа ссылкой (закон «каждое число ведёт к первичке»).
 *
 * Расхождение сторон подписывается честно и не прячется: продукт не
 * подгоняет свой пересчёт под лист.
 */
import { SVOD_SHEET_NAME, SVOD_SPREADSHEET_ID, buildSheetUrl } from '@aemr/shared';
import type { RemainderRowVM } from '../../lib/report/mappers';
import { BudgetTriple } from '../contract/BudgetTriple';
import { KbHover } from '../contract/KbHover';
import { SourceBadge } from '../contract/SourceBadge';

export interface RemainderLedgerProps {
  rows: RemainderRowVM[];
  /** Подпись расхождения (null — сторон меньше двух либо они сходятся). */
  diff: string | null;
}

export function RemainderLedger({ rows, diff }: RemainderLedgerProps) {
  if (rows.length === 0) return null;
  return (
    // Тихая рамка (п.129): в тёмной теме блок отделяет светлота поверхности,
    // а не обводка — край едва заметен (white/5), как у примитивов карточек.
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200/70 bg-zinc-50/60 dark:border-white/5 dark:bg-zinc-900/25">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200/70 bg-zinc-50 px-3 py-2 dark:border-white/5 dark:bg-zinc-800/40">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Остаток к заключению — обе стороны
        </span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">до конца года</span>
      </div>

      {rows.map((r) => (
        <div
          key={`${r.label}-${r.cell ?? 'calc'}`}
          className="grid grid-cols-1 items-center gap-x-3 gap-y-1 border-t border-zinc-100 px-3 py-2.5 first:border-t-0 dark:border-white/5 sm:grid-cols-[minmax(180px,1.2fr)_120px_1fr_auto]"
        >
          <div>
            <KbHover metricKey={r.metricKey} live={r.live}>
              <span className="text-[12px] text-zinc-700 dark:text-zinc-200">{r.label}</span>
            </KbHover>
            <div className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
              {r.hint.map((part, i) => (
                part.metricKey
                  ? (
                    <KbHover key={i} metricKey={part.metricKey} live={part.live}>
                      <span className="text-zinc-500 dark:text-zinc-400">{part.text}</span>
                    </KbHover>
                  )
                  : <span key={i}>{part.text}</span>
              ))}
            </div>
          </div>
          <div
            className={`text-[15px] font-semibold tabular-nums sm:text-right ${
              r.accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-800 dark:text-zinc-100'
            }`}
          >
            {r.value}
            <span className="ml-1 text-[10px] font-normal text-zinc-400 dark:text-zinc-500">тыс. ₽</span>
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
            <BudgetTriple fb={r.budget.fb} kb={r.budget.kb} mb={r.budget.mb} metricPrefix={r.budgetPrefix} />
          </div>
          <div className="flex items-center justify-start gap-2 sm:justify-end">
            {r.cell && (
              <a
                href={buildSheetUrl(SVOD_SPREADSHEET_ID, r.cell)}
                target="_blank"
                rel="noreferrer"
                title={`Открыть ${SVOD_SHEET_NAME}!${r.cell} в Google Sheets`}
                className="font-mono text-[10px] text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700 dark:text-blue-400"
              >
                {SVOD_SHEET_NAME}!{r.cell}
              </a>
            )}
            <SourceBadge source={r.source} />
          </div>
        </div>
      ))}

      {diff && (
        <p className="border-t border-zinc-100 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-white/5 dark:bg-amber-950/20 dark:text-amber-400">
          {diff}
        </p>
      )}
    </div>
  );
}
