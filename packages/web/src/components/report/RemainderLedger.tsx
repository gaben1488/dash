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
import { fmtCount, fmtThousands, type RemainderByMethodVM, type RemainderRowVM } from '../../lib/report/mappers';
import { BudgetTriple } from '../contract/BudgetTriple';
import { KbHover } from '../contract/KbHover';
import { SourceBadge } from '../contract/SourceBadge';
import { TILE, RULE_HEAD, RULE_ROW } from '../dashboard/surfaces';

export interface RemainderLedgerProps {
  rows: RemainderRowVM[];
  /** Подпись расхождения (null — сторон меньше двух либо они сходятся). */
  diff: string | null;
  /**
   * Остаток отчётного квартала по способам (канон п.26 — владелец считал это
   * руками). Периметр у разреза свой, уже годового: он и подписан отдельно.
   */
  byMethod?: RemainderByMethodVM | null;
}

export function RemainderLedger({ rows, diff, byMethod = null }: RemainderLedgerProps) {
  if (rows.length === 0) return null;
  return (
    // Плитка внутри карточки отчёта (канон п.129): в тёмной теме её
    // отделяет светлота; внутри остаются только линейки — шапка и разделители строк.
    <div className={`${TILE} mt-4 overflow-hidden`}>
      {/* Шапка плитки: в тёмной теме её отделяет от тела ступень светлоты
          (white/[0.05] поверх плитки — контраст 1,161:1 против 1,092:1 у
          прежней 0,03, порог читаемого разделения 1,12:1). Линейка снизу
          остаётся: у таблицы шапка отбивается линией в обеих темах. */}
      <div className={`flex items-center justify-between gap-3 border-b ${RULE_HEAD} bg-zinc-50 px-3 py-2 dark:bg-white/[0.05]`}>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Остаток к заключению — обе стороны
        </span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">до конца года</span>
      </div>

      {rows.map((r) => (
        <div
          key={`${r.label}-${r.cell ?? 'calc'}`}
          className={`grid grid-cols-1 items-center gap-x-3 gap-y-1 border-t ${RULE_ROW} px-3 py-2.5 first:border-t-0 sm:grid-cols-[minmax(180px,1.2fr)_120px_1fr_auto]`}
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

      {/* Разрез остатка по способам (работа P1-1 карты вкладки). Стоит ниже
          сверки сторон и НЕ выдаёт себя за её слагаемое: у него собственный
          период — отчётный квартал, а не год, — и это сказано первым словом
          строки. Ядро другого разреза не считает; выдумывать годовой из
          квартального означало бы поставить на экран число, которого никто
          не считал. */}
      {byMethod && (
        <div className={`border-t ${RULE_ROW} px-3 py-2.5`}>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            По способам — {byMethod.quarter} квартал, не год
          </div>
          <div className="mt-1 space-y-1">
            {([
              { key: 'kp', label: 'Конкурентные процедуры', row: byMethod.kp, metricKey: 'competitive_count' },
              { key: 'ep', label: 'Единственный поставщик', row: byMethod.ep, metricKey: 'ep_count' },
            ] as const).map(({ key, label, row, metricKey }) => (
              <div key={key} className="grid grid-cols-1 items-center gap-x-3 sm:grid-cols-[minmax(180px,1.2fr)_120px_1fr]">
                <KbHover
                  metricKey={metricKey}
                  live={`${fmtCount(row.count)} строк ${byMethod.quarter} квартала без даты заключения; плановые суммы — ${fmtThousands(row.total)} тыс. руб.`}
                >
                  <span className="text-[12px] text-zinc-700 dark:text-zinc-200">{label}</span>
                </KbHover>
                <span className="text-[13px] font-semibold tabular-nums text-zinc-800 dark:text-zinc-100 sm:text-right">
                  {fmtThousands(row.total)}
                  <span className="ml-1 text-[10px] font-normal text-zinc-400 dark:text-zinc-500">тыс. ₽</span>
                </span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {fmtCount(row.count)} позиций ·{' '}
                  <BudgetTriple fb={row.fb} kb={row.kb} mb={row.mb} metricPrefix="pending" />
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
            Сумма двух строк — {fmtThousands(byMethod.total.total)} тыс. руб. в{' '}
            {fmtCount(byMethod.total.count)} позициях: это остаток {byMethod.quarter} квартала,
            а не годовой остаток из строк выше.
          </p>
        </div>
      )}

      {diff && (
        /* Строка расхождения — янтарная заливка, а не янтарный край: над
           плиткой amber-950/20 давала 1,011:1 (полоса сливалась), amber-500/10
           даёт 1,199:1 при пороге 1,12:1, текст на ней — 7,5:1. Сверху
           остаётся обычная линейка строки, та же, что и у соседей. */
        <p className={`border-t ${RULE_ROW} bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-400`}>
          {diff}
        </p>
      )}
    </div>
  );
}
