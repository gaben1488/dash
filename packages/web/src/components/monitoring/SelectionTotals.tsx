import type { RegistryProcedure } from '../../lib/monitoring/contract';
import { portraitFrom } from '../../lib/monitoring/portrait';
import { fmtRubExact } from '../../lib/monitoring/format';

/** Totals describe exactly the rows of this view, from the accepted snapshot. */
export function SelectionTotals({ rows, label }: { rows: readonly RegistryProcedure[]; label: string }) {
  const totals = portraitFrom(rows);
  return <section aria-label={`Суммы · ${label}`} className="rounded-lg bg-[var(--surface-card)] p-4">
    <p className="mb-3 text-sm font-medium">{label} · {rows.length} процедур · рубли</p>
    <dl className="grid gap-4 sm:grid-cols-3">
      <div><dt className="text-xs text-[var(--ink-muted)]">НМЦК текущих процедур</dt><dd className="mt-1 whitespace-nowrap text-base font-semibold tabular-nums">{fmtRubExact(totals.nmckTotal)}</dd></div>
      <div><dt className="text-xs text-[var(--ink-muted)]">Цена учтённых результатов</dt><dd className="mt-1 whitespace-nowrap text-base font-semibold tabular-nums">{fmtRubExact(totals.priceTotal)}</dd></div>
      <div><dt className="text-xs text-[var(--ink-muted)]">Снижение по полным парам НМЦК и цены</dt><dd className="mt-1 whitespace-nowrap text-base font-semibold tabular-nums">{fmtRubExact(totals.savingsTotal)}</dd></div>
    </dl>
    <p className="mt-3 text-xs text-[var(--ink-muted)]">Итог этого отбора. Переоформленные попытки остаются в истории; их НМЦК не увеличивает текущую сумму.{totals.nmckMissing > 0 && ` Не заполнена НМЦК: ${totals.nmckMissing}; сумма неполная.`}</p>
  </section>;
}
