import type { PublishedWeeklySummary } from '@aemr/shared';

/** Only the verified Word release's weekly facts appear in this section. */
export function PublishedWeeklySummaryCard({ value }: { value: PublishedWeeklySummary | null | undefined }) {
  if (!value) return null;
  const hasPair = value.status === 'COMPARABLE';
  const older = value.baseline_date?.split('-').reverse().join('.') ?? null;
  return (
    <section aria-label="Изменения по проверенному недельному выпуску"
      className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Что изменилось с прошлого недельного отчёта
        </h3>
        {hasPair && older && <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Сравнение с {older}
        </span>}
      </div>
      {!hasPair ? (
        <p className="mt-2 border-l-2 border-amber-500 pl-3 text-sm text-zinc-700 dark:text-zinc-300">
          {value.message}
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {value.totals.map(row => (
              <div key={row.label} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{row.label}</h4>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  План: {row.plan_before} → {row.plan_after}
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  С датой факта: {row.fact_before} → {row.fact_after}
                </p>
              </div>
            ))}
          </div>
          {value.changes.length > 0 ? (
            <div className="mt-3 text-xs text-zinc-700 dark:text-zinc-300">
              <h4 className="font-semibold">Подтверждённые изменения записей</h4>
              <p className="mt-1">{value.changes.map(row => row.label + ' — ' + row.count).join('; ')}.</p>
              {value.examples.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {value.examples.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
              По однозначно сопоставленным закупкам изменений реквизитов не обнаружено.
            </p>
          )}
          {(value.recommendations_added > 0 || value.recommendations_revised > 0
            || value.procedure_stage_changes > 0) && (
            <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
              {value.recommendations_added > 0 && 'Новых в сравнении рекомендаций УЭР: ' + value.recommendations_added + '. '}
              {value.recommendations_revised > 0 && 'Уточнённых рекомендаций: ' + value.recommendations_revised + '. '}
              {value.procedure_stage_changes > 0 && 'Изменений стадий процедур в работе: ' + value.procedure_stage_changes + '.'}
            </p>
          )}
          {value.unmatched_positions > 0 && (
            <p className="mt-2 border-l-2 border-amber-500 pl-3 text-xs text-zinc-600 dark:text-zinc-400">
              Записей, связь которых с прошлой неделей пока не подтверждена: {value.unmatched_positions}.
              Их нельзя считать новыми или отменёнными закупками.
            </p>
          )}
          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            Здесь приведены сведения из того же проверенного выпуска, что и Word.
            Оперативная история таблиц ниже может обновляться в другое время.
          </p>
        </>
      )}
    </section>
  );
}
