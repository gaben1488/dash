import { useState } from 'react';
import type { RegistryProcedure, WorkQueuePayload } from '../../lib/monitoring/contract';
import { stageBadgeClass, stageShort } from '../../lib/monitoring/stage-labels';
import { procedureCodeLabel } from '../../lib/monitoring/format';

const BLOCKS = { active: 'В работе', closed: 'Проверки закрытых', triage: 'Разобрать данные' } as const;

export function WorkQueue({ queue, procedures, readAtLabel, onOpen }: {
  queue: WorkQueuePayload | null | undefined;
  procedures: readonly RegistryProcedure[];
  readAtLabel: string;
  onOpen: (procedure: RegistryProcedure) => void;
}) {
  const [block, setBlock] = useState<keyof typeof BLOCKS>('active');
  if (!queue) return <p className="text-sm text-[var(--ink-muted)]">Очередь ещё не получена от сервера.</p>;
  const allowed = new Map(procedures.map((p) => [`${p.sheet}:${p.row}`, p]));
  const scoped = (key: keyof typeof BLOCKS) => (queue[key] ?? []).filter((item) => allowed.has(`${item.procedure.sheet}:${item.procedure.row}`));
  const items = scoped(block);
  const columns = ['Процедура', 'Действие', 'Заказчик и предмет', ...(block === 'active' ? ['Дата ориентира', 'Дней к дате'] : []), 'Стадия'];
  return <section className="space-y-4" aria-label="Ежедневная очередь процедур">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Вид очереди">
        {(Object.keys(BLOCKS) as Array<keyof typeof BLOCKS>).map((key) => <button key={key} type="button" aria-pressed={block === key} onClick={() => setBlock(key)}
          className={`min-h-11 rounded-lg border border-[var(--line-strong)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${block === key ? 'bg-zinc-800 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'}`}>
          {BLOCKS[key]} <span className="ml-2 tabular-nums">{scoped(key).length}</span>
        </button>)}
      </div>
      <p className="text-xs text-[var(--ink-muted)]">{readAtLabel}</p>
    </div>
    <div className="max-w-[75ch] space-y-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
      <p>{block === 'active' ? 'Откройте процедуру, чтобы выполнить действие и перейти к нужному полю книги.' : block === 'closed' ? 'Закрытые процедуры с замечаниями или недостающими сведениями.' : 'Стадия этих процедур не определена. Уточните данные в источнике.'}</p>
      <details><summary className="cursor-pointer">Как читать очередь</summary>
        <p className="mt-2">{block === 'active' ? 'Дата ориентирует по подведению итогов. Дни к дате не означают юридическую просрочку. Сроки размещения и исправления данных в источнике не заданы.' : 'Эти строки показаны отдельно и не увеличивают число процедур в работе.'}</p>
      </details>
    </div>
    {items.length === 0 ? <p className="rounded-lg bg-[var(--surface-sunken)] p-6 text-sm text-[var(--ink-muted)]">В выбранном срезе очередь пуста.</p> :
      <div className="overflow-x-auto rounded-lg bg-[var(--surface-card)]">
        <table className="w-full text-left text-sm" aria-label={block === 'active' ? 'Процедуры в работе' : block === 'closed' ? 'Проверки закрытых процедур' : 'Процедуры для разбора данных'}>
          <thead className="bg-[var(--surface-sunken)] text-[var(--ink-muted)]"><tr>
            {columns.map((h) => <th key={h} className={`px-3 py-3 font-medium ${['Дата ориентира', 'Дней к дате', 'Заказчик и предмет', 'Стадия'].includes(h) ? 'hidden md:table-cell' : ''}`}>{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{items.map((item) => {
            const p = allowed.get(`${item.procedure.sheet}:${item.procedure.row}`) ?? item.procedure;
            const dateLabel = item.referenceDate ?? (block === 'closed' ? 'Не применяется' :
              item.action === 'Разместить извещение' || item.action.startsWith('Исправить: ') ? 'Срок не задан' : 'Дата итогов не внесена');
            return <tr key={`${p.sheet}:${p.row}`} className="align-top">
              <td className="px-3 py-4"><button type="button" onClick={() => onOpen(p)}
                title="Открыть процедуру в реестре" className="inline-flex min-h-11 items-center font-medium text-sky-700 underline decoration-sky-200 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-300">{procedureCodeLabel(p) ?? `Строка ${p.row}`}</button>
                <div className="mt-1 text-[var(--ink-muted)]">{p.dept}</div></td>
              <td className="max-w-80 px-3 py-4"><p className={item.action.startsWith('Исправить:') ? 'font-medium text-red-700 dark:text-red-300' : 'font-medium'}>{item.action}</p>
                {block === 'active' && item.action === 'Разместить извещение' && <p className="mt-2 text-[var(--ink-muted)]">{p.applicationDate ? `Заявка поступила ${p.applicationDate}` : 'Дата поступления заявки не внесена'}</p>}
                <div className="mt-2 space-y-1 break-words text-[var(--ink-muted)] md:hidden"><p>{p.customer}</p><p>{p.subject}</p><p>{stageShort(p.stage)}{block === 'active' && ` · ${dateLabel} · дней к дате: ${item.daysToDate ?? '—'}`}</p></div>
                {p.qualityNote && <details className="mt-2 text-[var(--ink-muted)]"><summary className="cursor-pointer">Замечания</summary><p className="mt-2 whitespace-pre-wrap leading-relaxed">{p.qualityNote}</p></details>}</td>
              <td className="hidden max-w-xl px-3 py-4 md:table-cell"><p className="text-[var(--ink-muted)]">{p.customer}</p><p className="mt-1 leading-relaxed">{p.subject}</p></td>
              {block === 'active' && <><td className="hidden whitespace-nowrap px-3 py-4 tabular-nums md:table-cell">{dateLabel}</td>
              <td className="hidden px-3 py-4 tabular-nums text-[var(--ink-muted)] md:table-cell">{item.daysToDate ?? '—'}</td></>}
              <td className="hidden px-3 py-4 md:table-cell"><span className={`inline-block rounded px-2 py-1 ${stageBadgeClass(p.stage)}`}>{stageShort(p.stage)}</span></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
  </section>;
}
