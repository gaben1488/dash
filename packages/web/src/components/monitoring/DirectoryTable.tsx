/**
 * Режим «Справочник учреждений» — лист «Перечень ГРБС» (спека §2.4).
 *
 * ДВЕ ДОБАВЛЕННЫЕ КОЛОНКИ И ОДИН СПИСОК — ради них режим и существует.
 *
 * «Встречается в книге» отвечает на вопрос, ради которого справочник заводят:
 * работает ли он вообще. Учреждение, на которое не ссылается ни одна строка
 * реестра, — либо мёртвая строка справочника, либо признак того, что в
 * реестре его пишут иначе.
 *
 * «Сокращение» помечает строки, где сокращённое наименование дословно
 * повторяет полное. Такое «сокращение» короче не делает ничего и в подписи
 * графика занимает три строки: честнее сказать «сокращения нет», чем
 * показывать длинный текст, притворяющийся коротким.
 *
 * СПИСОК НЕСОВПАВШИХ НАПИСАНИЙ под таблицей — рабочий инструмент отдела, а
 * не укор. По нему написания приводятся к одному виду за один заход, после
 * чего разрез «по заказчику» начинает собирать закупки, а не рассыпать их.
 */
import type { DirectoryPayload } from '../../lib/monitoring/contract';
import { fmtCount, pluralCount } from '../../lib/monitoring/format';
import { BookPeriodBadge } from './BookPeriodBadge';

export interface DirectoryTableProps {
  directory: DirectoryPayload;
  readAtLabel: string;
  /** Нажатие на написание заказчика — отобрать его в реестре. */
  onPickCustomer?: (name: string) => void;
}

export function DirectoryTable({ directory, readAtLabel, onPickCustomer }: DirectoryTableProps) {
  const shortMissing = directory.rows.filter((r) => r.shortMissing).length;
  const unused = directory.rows.filter((r) => r.usedInBook === 0).length;

  return (
    <div className="space-y-3">
      <section
        aria-label="Справочник учреждений"
        className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-700/50 p-3 sm:p-4 space-y-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Лист «Перечень ГРБС»</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 max-w-2xl">
              {pluralCount(directory.rows.length, 'учреждение', 'учреждения', 'учреждений')} района и их
              владельцы-ГРБС. Из них у {fmtCount(shortMissing)} сокращённое наименование дословно
              повторяет полное, а на {fmtCount(unused)} не ссылается ни одна строка реестра.
            </p>
          </div>
          <BookPeriodBadge label={readAtLabel} note="справочник живёт отдельно от реестра и обновляется реже" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[40rem]">
            <thead className="text-[10px] text-zinc-500 dark:text-zinc-400">
              <tr className="border-b border-zinc-100 dark:border-zinc-700/50">
                <th className="px-2 py-1.5 text-left font-medium">№</th>
                <th className="px-2 py-1.5 text-left font-medium">ГРБС-владелец</th>
                <th className="px-2 py-1.5 text-left font-medium">Полное наименование</th>
                <th className="px-2 py-1.5 text-left font-medium">Сокращённое</th>
                <th className="px-2 py-1.5 text-right font-medium">Встречается в книге</th>
              </tr>
            </thead>
            <tbody>
              {directory.rows.map((r, i) => (
                <tr key={`${r.num ?? i}:${r.fullName ?? i}`} className="border-b border-zinc-50 dark:border-zinc-700/30 align-top">
                  <td className="px-2 py-1.5 tabular-nums text-zinc-400 dark:text-zinc-500">{r.num ?? '—'}</td>
                  <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-300">{r.grbs ?? '—'}</td>
                  <td className="px-2 py-1.5 max-w-[24rem] text-zinc-700 dark:text-zinc-200">{r.fullName ?? '—'}</td>
                  <td className="px-2 py-1.5 max-w-[16rem] text-zinc-600 dark:text-zinc-300">
                    {r.shortMissing
                      ? (
                        <span className="text-amber-700 dark:text-amber-400" title="Сокращённое наименование дословно повторяет полное">
                          сокращения нет
                        </span>
                      )
                      : r.shortName ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.usedInBook === null
                      ? <span className="text-zinc-400 dark:text-zinc-500" title="Совпадения не считались">—</span>
                      : r.usedInBook === 0
                        ? <span className="text-zinc-400 dark:text-zinc-500" title="Ни одна строка реестра на это учреждение не ссылается">0</span>
                        : <span className="text-zinc-700 dark:text-zinc-200">{fmtCount(r.usedInBook)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {directory.unmatchedCustomers.length > 0 && (
        <section
          aria-label="Написания заказчика вне справочника"
          className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-100 dark:border-zinc-700/50 p-3 sm:p-4"
        >
          <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            Написания заказчика, которых в справочнике нет —{' '}
            {pluralCount(directory.unmatchedCustomers.length, 'написание', 'написания', 'написаний')}
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 max-w-3xl">
            По убыванию частоты. Пока написание не совпадает со справочником, закупки одного
            учреждения расходятся по разным строкам разреза «по заказчику» и выглядят как разные
            учреждения. Нажатие отбирает написание в реестре.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {directory.unmatchedCustomers.map((u) => (
              <li key={u.name}>
                <button
                  type="button"
                  onClick={() => onPickCustomer?.(u.name)}
                  className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-700/50 px-2 py-0.5 text-[10px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 max-w-full"
                >
                  <span className="truncate">{u.name}</span>
                  <span className="tabular-nums opacity-60">{u.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {directory.notes.length > 0 && (
        <div className="space-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
          {directory.notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}
    </div>
  );
}
