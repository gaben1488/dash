import { productLabel } from '@aemr/shared';
/**
 * Режим «Справочник организаций» — лист «Справочник заказчиков» (спека §2.4).
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
import { MonitoringPerimeterCaption } from './PerimeterProvider';
import { CARD, RULE_HEAD, RULE_ROW } from './surfaces';

export interface DirectoryTableProps {
  directory: DirectoryPayload;
  readAtLabel: string;
  sourceSheetName?: string;
  sourceBookName?: string;
  /** Нажатие на написание заказчика — отобрать его в реестре. */
  onPickCustomer?: (name: string) => void;
}

export function DirectoryTable({ directory, readAtLabel, onPickCustomer, sourceSheetName = 'Справочник заказчиков', sourceBookName = 'План-реестр процедур определения поставщика' }: DirectoryTableProps) {
  const shortMissing = directory.rows.filter((r) => r.shortMissing).length;
  const unused = directory.rows.filter((r) => r.usedInBook === 0).length;
  const jointGroups = directory.rows.filter((r) => r.entityKind === 'joint_group').length;

  return (
    <div className="space-y-3">
      <section
        aria-label="Справочник организаций и групп заказчиков"
        className={`${CARD} p-3 sm:p-4 space-y-3`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Лист «{sourceSheetName}»</h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 max-w-2xl">
              {pluralCount(directory.rows.length, 'запись', 'записи', 'записей')} об организациях и группах заказчиков;
              групп совместных закупок — {fmtCount(jointGroups)}. У {fmtCount(shortMissing)} записей сокращение
              повторяет полное название; {fmtCount(unused)} записей не используются в прочитанном реестре.
              Даты смены названий в источнике не указаны, поэтому периоды действия не предполагаются.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <BookPeriodBadge label={readAtLabel} note="справочник живёт отдельно от реестра и обновляется реже" />
            <p className="mt-1 text-xs leading-tight text-zinc-500 dark:text-zinc-400">
              Источник: лист «{sourceSheetName}» книги «{sourceBookName}»
            </p>
            <MonitoringPerimeterCaption scope="district" className="max-w-[18rem]" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[44rem]">
            <thead className="text-xs text-zinc-500 dark:text-zinc-400">
              <tr className={RULE_HEAD}>
                <th className="px-2 py-1.5 text-left font-medium">№</th>
                <th className="px-2 py-1.5 text-left font-medium">ГРБС-владелец</th>
                <th className="px-2 py-1.5 text-left font-medium">Тип записи</th>
                <th className="px-2 py-1.5 text-left font-medium">Полное наименование</th>
                <th className="px-2 py-1.5 text-left font-medium">Сокращённое</th>
                <th className="px-2 py-1.5 text-right font-medium">Встречается в книге</th>
              </tr>
            </thead>
            <tbody>
              {directory.rows.map((r, i) => (
                <tr key={r.institutionId ?? r.sourceAddress ?? `${r.num ?? i}:${r.fullName ?? i}`} className={`${RULE_ROW} align-top`}>
                  <td className="px-2 py-1.5 tabular-nums text-zinc-500 dark:text-zinc-400">{r.num ?? '—'}</td>
                  <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-300">{productLabel(r.grbs ?? '—')}</td>
                  <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-300">
                    {r.entityKind === 'joint_group' ? 'Группа закупки'
                      : r.entityKind === 'department' ? 'Орган управления'
                      : r.entityKind === 'institution' ? 'Учреждение' : 'Не установлен'}
                    {r.status === 'Ликвидирован' && <p className="text-xs text-amber-700 dark:text-amber-400">Ликвидировано</p>}
                  </td>
                  <td className="px-2 py-1.5 max-w-[24rem] text-zinc-700 dark:text-zinc-200">{r.fullName ?? '—'}
                    {r.sourceAddress && <p className="mt-1 text-xs text-[var(--ink-muted)]">{r.sourceAddress}</p>}
                    {r.institutionId && <details className="mt-1 text-xs text-[var(--ink-muted)]"><summary className="cursor-pointer">Идентификатор записи</summary><p className="mt-1 break-all font-mono">{r.institutionId}</p></details>}
                    {(r.nameEvidence?.length ?? 0) > 0 ? (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer">Названия и источники</summary>
                        <ul className="mt-1 space-y-1">
                          {r.nameEvidence!.map((e, j) => (
                            <li key={`${e.sourceAddress}:${j}`}>
                              <span>{e.name}</span>
                              <span className="ml-1 text-[var(--ink-muted)]">
                                ({e.role === 'previous' ? 'прежнее сокращение'
                                  : e.role === 'source_book' ? 'в реестре ГРБС'
                                  : e.role === 'current' ? 'название в округе'
                                  : e.role === 'canonical' ? 'каноническое'
                                  : 'вариант написания'}; {e.sourceAddress})
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (r.aliases?.length ?? 0) > 1 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer">Названия и алиасы</summary>
                        <ul>{r.aliases!.map(name => <li key={name}>{name}</li>)}</ul>
                      </details>
                    )}</td>
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
                      ? <span className="text-zinc-500 dark:text-zinc-400" title="Совпадения не считались">—</span>
                      : r.usedInBook === 0
                        ? <span className="text-zinc-500 dark:text-zinc-400" title="Ни одна строка реестра на это учреждение не ссылается">0</span>
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
          className={`${CARD} p-3 sm:p-4`}
        >
          <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            Написания заказчика, которых в справочнике нет —{' '}
            {pluralCount(directory.unmatchedCustomers.length, 'написание', 'написания', 'написаний')}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 max-w-3xl">
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
                  className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-700/50 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 max-w-full"
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
        <div className="space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {directory.notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}
    </div>
  );
}
