/**
 * Режим «Переходящий реестр 25-26» (спека §2.3).
 *
 * ЗАЧЕМ ЛИСТУ ОТДЕЛЬНЫЙ РЕЖИМ. Он несёт то, чего на листах управлений нет:
 * победителя и ИНН по процедурам, которые до листов ещё не дошли, и
 * РОДОСЛОВНУЮ — колонку A, где человек рукой записал, из какой процедуры
 * выросла нынешняя. Девятнадцать таких ссылок складываются в цепочки
 * переобъявлений, и это единственное место в книгах, где видно, сколько
 * заходов стоила одна закупка.
 *
 * СКРЫТЫЕ СТРОКИ ПОКАЗЫВАЮТСЯ И ПОМЕЧАЮТСЯ. Прятать данные, которые
 * участвуют в расчётах книги, продукт не вправе; молча показывать
 * спрятанное человеком — тоже. Поэтому переключатель рядом, по умолчанию
 * включён, а каждая такая строка помечена словами.
 *
 * СТРОКИ НИЖЕ ГРАНИЦЫ АВТОФИЛЬТРА получают свою пометку: в самой книге при
 * работе с фильтром человек их не видит, и расхождение «у меня в книге
 * меньше строк» объясняется здесь, а не в переписке.
 */
import { useState } from 'react';
import { ArrowRight, EyeOff, Filter } from 'lucide-react';
import type { JournalPayload } from '../../lib/monitoring/contract';
import { fmtCount, fmtDate, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { BookPeriodBadge } from './BookPeriodBadge';
import { MonitoringPerimeterCaption } from './PerimeterProvider';
import { CARD, CHECKBOX, RULE_HEAD, RULE_ROW, RULE_SECTION } from './surfaces';

export interface JournalTableProps {
  journal: JournalPayload;
  readAtLabel: string;
  /** Поисковая строка разрезов — журнал слушает её так же, как реестр. */
  query?: string;
}

export function JournalTable({ journal, readAtLabel, query = '' }: JournalTableProps) {
  const [showHidden, setShowHidden] = useState(true);
  const needle = query.trim().toLowerCase();

  const rows = journal.rows.filter((r) => {
    if (!showHidden && r.hiddenInBook) return false;
    if (needle === '') return true;
    return [r.code, r.subject, r.customer, r.winnerName, r.winnerInn, r.fate]
      .some((v) => v !== null && v.toLowerCase().includes(needle));
  });

  const hiddenCount = journal.rows.filter((r) => r.hiddenInBook).length;
  const outsideCount = journal.rows.filter((r) => r.outsideFilter).length;

  return (
    <div className="space-y-3">
      {/* ── Родословная: цепочки переобъявлений ── */}
      {journal.lineage.length > 0 && (
        <section
          aria-label="Родословная процедур"
          className={`${CARD} p-3 sm:p-4`}
        >
          <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            Цепочки переобъявлений — {pluralCount(journal.lineage.length, 'цепочка', 'цепочки', 'цепочек')}
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 max-w-3xl">
            Собраны из колонки «Судьба» листа: там, где человек записал, из какой процедуры выросла
            нынешняя. Каждая стрелка — отдельный заход на ту же закупку.
          </p>
          <ul className="mt-2 space-y-1.5">
            {journal.lineage.map((chain) => (
              <li key={chain.codes.join('→')} className="text-[11px]">
                <span className="flex flex-wrap items-center gap-1.5">
                  {chain.codes.map((c, i) => (
                    <span key={c} className="inline-flex items-center gap-1.5">
                      {i > 0 && <ArrowRight size={10} className="text-zinc-400" aria-hidden="true" />}
                      <span className="font-mono text-zinc-700 dark:text-zinc-200">{c}</span>
                    </span>
                  ))}
                </span>
                {chain.notes.length > 0 && (
                  <span className="text-zinc-500 dark:text-zinc-400"> — {chain.notes.join('; ')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-label="Переходящий реестр 25-26"
        className={`${CARD} p-3 sm:p-4 space-y-3`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Лист «25-26»</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 max-w-2xl">
              Переходящий реестр двух лет: {pluralCount(journal.rows.length, 'строка', 'строки', 'строк')},
              победители с ИНН и судьба каждой процедуры.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <BookPeriodBadge label={readAtLabel} kind="period" note="лист переходящий: в нём соседствуют 2025 и 2026 годы" />
            <p className="mt-1 text-[10px] leading-tight text-zinc-400 dark:text-zinc-500">
              Источник: лист «25-26» книги «Ежедневный мониторинг»
            </p>
            <MonitoringPerimeterCaption scope="district" className="max-w-[18rem]" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className={CHECKBOX}
            />
            Показывать строки, спрятанные в книге
            <span className="tabular-nums">({fmtCount(hiddenCount)})</span>
          </label>
          {outsideCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Filter size={11} aria-hidden="true" />
              {fmtCount(outsideCount)} строк ниже границы автофильтра книги — при отборе в самой книге
              они не показываются
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[52rem]">
            <thead className="text-[10px] text-zinc-500 dark:text-zinc-400">
              <tr className={RULE_HEAD}>
                <th className="px-2 py-1.5 text-left font-medium">Строка</th>
                <th className="px-2 py-1.5 text-left font-medium">Судьба</th>
                <th className="px-2 py-1.5 text-left font-medium">Связь</th>
                <th className="px-2 py-1.5 text-left font-medium">Код</th>
                <th className="px-2 py-1.5 text-left font-medium">Заказчик</th>
                <th className="px-2 py-1.5 text-left font-medium">Предмет</th>
                <th className="px-2 py-1.5 text-right font-medium">НМЦК, руб.</th>
                <th className="px-2 py-1.5 text-left font-medium">Публикация</th>
                <th className="px-2 py-1.5 text-left font-medium">Итоги</th>
                <th className="px-2 py-1.5 text-right font-medium">Цена, руб.</th>
                <th className="px-2 py-1.5 text-right font-medium">Экономия, руб.</th>
                <th className="px-2 py-1.5 text-left font-medium">Победитель</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row} className={`${RULE_ROW} align-top`}>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-400 dark:text-zinc-500">
                    {r.row}
                    {r.hiddenInBook && (
                      <EyeOff size={10} className="inline ml-1" aria-label="строка спрятана в книге" />
                    )}
                    {r.outsideFilter && (
                      <span className="ml-1" title="строка ниже границы автофильтра книги">▽</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 max-w-[10rem] text-zinc-600 dark:text-zinc-300" title={r.fateRaw ?? undefined}>
                    {r.fate ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                    {r.linkedCode ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-mono text-zinc-800 dark:text-zinc-100">
                    {r.code ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 max-w-[10rem] truncate text-zinc-600 dark:text-zinc-300" title={r.customer}>
                    {r.customer || '—'}
                  </td>
                  <td className="px-2 py-1.5 max-w-[18rem] truncate text-zinc-600 dark:text-zinc-300" title={r.subject}>
                    {r.subject}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-800 dark:text-zinc-100">
                    {fmtRub(r.nmck)}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">
                    {fmtDate(r.publicationDate)}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">
                    {fmtDate(r.resultDate)}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-800 dark:text-zinc-100">
                    {fmtRub(r.auctionPrice)}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-300">
                    {fmtRub(r.savingsTotal)}
                  </td>
                  <td className="px-2 py-1.5 max-w-[14rem]">
                    <span className="block truncate text-zinc-600 dark:text-zinc-300" title={r.winnerName ?? undefined}>
                      {r.winnerName ?? r.outcome ?? '—'}
                    </span>
                    {r.winnerInn !== null && (
                      <span className="block font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{r.winnerInn}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Под поиск и переключатель скрытых строк не попала ни одна строка листа. Это отбор
            экрана, а не пустота листа: всего в нём {fmtCount(journal.rows.length)}.
          </p>
        )}

        {journal.notes.length > 0 && (
          <div className={`space-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400 ${RULE_SECTION} pt-2`}>
            {journal.notes.map((n) => <p key={n}>{n}</p>)}
          </div>
        )}
      </section>
    </div>
  );
}
