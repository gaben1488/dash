import { useState } from 'react';
import type { RegistryProcedure, WorkQueuePayload } from '../../lib/monitoring/contract';
import { stageBadgeClass, stageShort } from '../../lib/monitoring/stage-labels';
import { procedureCodeLabel } from '../../lib/monitoring/format';

export function WorkQueue({ queue, procedures, readAtLabel, onOpen }: {
  queue: WorkQueuePayload | null | undefined;
  procedures: readonly RegistryProcedure[];
  readAtLabel: string;
  onOpen: (procedure: RegistryProcedure) => void;
}) {
  const [block, setBlock] = useState<'active' | 'closed'>('active');
  if (!queue) return <p className="text-sm text-zinc-500">Очередь ещё не получена от сервера.</p>;
  const allowed = new Map(procedures.map((p) => [`${p.sheet}:${p.row}`, p]));
  const scoped = (key: 'active' | 'closed') => queue[key].filter((item) => allowed.has(`${item.procedure.sheet}:${item.procedure.row}`));
  const items = scoped(block);
  const columns = [...(block === 'active' ? ['Дата ориентира', 'Дней к дате'] : []), 'Процедура', 'Действие', 'Заказчик и предмет', 'Стадия'];
  return <section className="space-y-3" aria-label="Ежедневная очередь процедур">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-2" role="group" aria-label="Вид очереди">
        {(['active', 'closed'] as const).map((key) => <button key={key} type="button" aria-pressed={block === key} onClick={() => setBlock(key)}
          className={`rounded-lg border border-[var(--line-strong)] px-3 py-2 text-sm ${block === key ? 'bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-300'}`}>
          {key === 'active' ? 'В работе' : 'Проверки закрытых'} <span className="ml-2 tabular-nums">{scoped(key).length}</span>
        </button>)}
      </div>
      <p className="text-xs text-zinc-500">{readAtLabel}</p>
    </div>
    <p className="max-w-3xl text-xs leading-relaxed text-zinc-500">
      {block === 'active' ? 'Действия уполномоченного органа по текущим процедурам. Для подведения итогов показана дата итогов из реестра. Сроки размещения и исправления данных в источнике не заданы.' : 'Закрытые процедуры с конкретным замечанием или недостающими сведениями. Эти строки не увеличивают число процедур в работе.'}
      {block === 'active' && ' Дни к дате показывают расстояние до ориентира и не означают юридическую просрочку.'}
    </p>
    {items.length === 0 ? <p className="rounded-lg bg-zinc-50 p-6 text-sm text-zinc-500 dark:bg-zinc-800">В выбранном срезе очередь пуста.</p> :
      <div className="overflow-x-auto rounded-lg bg-white dark:bg-zinc-900">
        <table className="w-full text-left text-sm" aria-label={block === 'active' ? 'Процедуры в работе' : 'Проверки закрытых процедур'}>
          <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-800"><tr>
            {columns.map((h) => <th key={h} className={`px-3 py-3 font-medium ${['Дата ориентира', 'Дней к дате', 'Заказчик и предмет', 'Стадия'].includes(h) ? 'hidden md:table-cell' : ''}`}>{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{items.map((item) => {
            const p = allowed.get(`${item.procedure.sheet}:${item.procedure.row}`) ?? item.procedure;
            const dateLabel = item.referenceDate ?? (block === 'closed' ? 'Не применяется' :
              item.action === 'Разместить извещение' || item.action.startsWith('Исправить: ') ? 'Срок не задан' : 'Дата итогов не внесена');
            return <tr key={`${p.sheet}:${p.row}`} className="align-top">
              {block === 'active' && <><td className="hidden whitespace-nowrap px-3 py-4 tabular-nums md:table-cell">{dateLabel}</td>
              <td className="hidden px-3 py-4 tabular-nums text-zinc-500 md:table-cell">{item.daysToDate ?? '—'}</td></>}
              <td className="px-3 py-4"><button type="button" onClick={() => onOpen(p)}
                title="Открыть процедуру в реестре" className="font-medium text-sky-700 underline decoration-sky-200 underline-offset-4 dark:text-sky-300">{procedureCodeLabel(p) ?? `Строка ${p.row}`}</button>
                <div className="mt-1 text-zinc-500">{p.dept}</div></td>
              <td className="max-w-80 px-3 py-4"><p className={item.action.startsWith('Исправить:') ? 'font-medium text-red-700 dark:text-red-300' : 'font-medium'}>{item.action}</p>
                {block === 'active' && item.action === 'Разместить извещение' && <p className="mt-2 text-zinc-500">{p.applicationDate ? `Заявка поступила ${p.applicationDate}` : 'Дата поступления заявки не внесена'}</p>}
                <div className="mt-2 space-y-1 break-words text-zinc-500 md:hidden"><p>{p.customer}</p><p>{p.subject}</p><p>{stageShort(p.stage)}{block === 'active' && ` · ${dateLabel} · дней к дате: ${item.daysToDate ?? '—'}`}</p></div>
                {p.qualityNote && <details className="mt-2 text-zinc-500"><summary className="cursor-pointer">Замечания</summary><p className="mt-2 whitespace-pre-wrap leading-relaxed">{p.qualityNote}</p></details>}</td>
              <td className="hidden max-w-xl px-3 py-4 md:table-cell"><p className="text-zinc-500">{p.customer}</p><p className="mt-1 leading-relaxed">{p.subject}</p></td>
              <td className="hidden px-3 py-4 md:table-cell"><span className={`inline-block rounded px-2 py-1 ${stageBadgeClass(p.stage)}`}>{stageShort(p.stage)}</span></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
  </section>;
}
