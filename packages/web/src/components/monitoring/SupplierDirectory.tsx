import type { RegistryProcedure, SupplierDirectoryPayload } from '../../lib/monitoring/contract';
import { fmtReadAt } from '../../lib/monitoring/format';

export function SupplierDirectory({ reading, procedures }: { reading: SupplierDirectoryPayload | null | undefined; procedures: readonly RegistryProcedure[] }) {
  if (!reading) return null;
  return <section aria-label="Справочник поставщиков" className="space-y-3 rounded-lg bg-[var(--surface-card)] p-4">
    <h3 className="text-sm font-semibold">Справочник поставщиков · {reading.rows.length} записей</h3>
    <p className="text-xs text-[var(--ink-muted)]">Источник: лист «_Поставщики»{reading.readAt && ` · ${fmtReadAt(reading.readAt)}`}. ИНН и основание проверки показаны дословно. Запись в справочнике сама по себе не подтверждает ИНН документом.</p>
    {reading.error ? <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Справочник не прочитан: {reading.error}</p> : reading.rows.length === 0 ? <p className="text-sm text-[var(--ink-muted)]">Лист прочитан, записей нет.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-left text-sm">
      <thead><tr>{['ID и адрес', 'Поставщик', 'ИНН', 'Основание проверки', 'Победы в выбранном реестре'].map(label => <th key={label} className="px-2 py-2 font-medium">{label}</th>)}</tr></thead>
      <tbody>{reading.rows.map((row, index) => <tr key={`${row.address}:${index}`} className="border-t border-[var(--line-strong)] align-top">
        <td className="px-2 py-3"><p>{row.id || 'ID не указан'}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{row.address}</p></td>
        <td className="max-w-80 px-2 py-3"><p>{row.name || 'Название не указано'}</p>{row.note && <p className="mt-1 text-xs text-[var(--ink-muted)]">{row.note}</p>}{row.ambiguous && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Неоднозначная запись. Автоматическая связь не построена.</p>}</td>
        <td className="px-2 py-3 font-mono">{row.inn ?? 'Не указан'}</td>
        <td className="max-w-80 px-2 py-3">{row.evidence ?? 'В источнике не указано'}</td>
        <td className="px-2 py-3 tabular-nums">{row.inn && !row.ambiguous ? procedures.filter(p => p.stage === 'awarded' && p.factsEligible !== false && p.winnerInn === row.inn).length : 'Связь не определена'}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
