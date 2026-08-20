/**
 * Сверка реестра с книгами управлений по КАЖДОЙ СТРОКЕ (канон п.101а, спека §4).
 *
 * КЛЮЧ СВЯЗКИ — КОД ПРОЦЕДУРЫ. В книге управления он живёт в отдельной
 * колонке и заполняется вручную, поэтому исходов шесть, а не два: пара
 * нашлась; код есть только у книги; процедура есть только в мониторинге; один
 * код в нескольких книгах (совместная закупка — норма); один код дважды в
 * одной книге (уже не норма); в ячейке список кодов (парная сверка сумм
 * невозможна). Показаны ВСЕ шесть, включая нулевые: класс с нулём — это
 * утверждение «таких расхождений нет», а не пропущенная проверка.
 *
 * ЕДИНИЦЫ РАЗНЫЕ, И ЭТО ГЛАВНАЯ ЛОВУШКА СВЕРКИ. Книги управлений ведутся в
 * ТЫСЯЧАХ рублей, мониторинг — в рублях. Сервер приводит обе стороны к рублям
 * до сравнения; на экране единица подписана у каждой суммы, потому что
 * перепутать их значит ошибиться ровно в тысячу раз.
 *
 * ПРАВАЯ СТОРОНА НЕ ВЫБИРАЕТСЯ. При расхождении показаны обе суммы, оба
 * адреса и разница. Какая запись верна — решение человека, у которого есть
 * договор; продукт не назначает победителя.
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MatchViewPayload } from '../../lib/monitoring/analytics-contract';
import { matchClasses, matchDisagreements } from '../../lib/monitoring/charts';
import { fmtCount, fmtPct, fmtRub, fmtRubExact, pluralCount } from '../../lib/monitoring/format';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';

export interface MatchPanelProps {
  /** null — сверка не получена: роут не поднят либо книги не прочитаны. */
  match: MatchViewPayload | null;
  /** Русская причина отказа, если он был. */
  error: string | null;
  periodLabel: string;
  onReload: () => void;
}

export function MatchPanel({ match, error, periodLabel, onReload }: MatchPanelProps) {
  if (match === null) {
    return (
      <AnalyticsCard
        kicker="Сверка с книгами управлений"
        title="Сверка сейчас не получена"
        periodLabel={periodLabel}
        method="Сверка идёт отдельным запросом: она читает восемь книг управлений и книгу мониторинга сразу. Её отказ не влияет на остальную аналитику."
      >
        <CardEmpty>
          {error ?? 'Сервер не отдал сверку.'} Это состояние трубы чтения, а не отсутствие
          расхождений: пока сверка не получена, о совпадении сумм ничего сказать нельзя.
          <button
            type="button"
            onClick={onReload}
            className="ml-1 underline hover:no-underline"
          >
            Запросить ещё раз
          </button>
        </CardEmpty>
      </AnalyticsCard>
    );
  }

  const classes = matchClasses(match);
  const disagreements = matchDisagreements(match.matched);
  const s = match.summary;

  return (
    <AnalyticsCard
      kicker="Сверка с книгами управлений"
      title={
        s.coveragePct === null
          ? 'Связка реестра с книгами управлений'
          : `Пару в книгах управлений нашли ${fmtPct(s.coveragePct, 1)} процедур реестра`
      }
      periodLabel={periodLabel}
      periodNote={match.books.read.length === 0
        ? 'книги управлений не прочитаны — внешняя сверка пуста'
        : undefined}
      method={(
        <>
          Ключ связки — код процедуры: в книгах управлений он стоит в отдельной колонке, в
          мониторинге разбирается из кода строки. Сравниваются две пары сумм: план книги против
          начальной цены и факт книги против цены победителя. Книги управлений ведутся в тысячах
          рублей и приведены к рублям до сравнения.
          {match.books.read.length > 0 && (
            <> Книги в сверке: {match.books.read.join(', ')}; строк с кодом — {fmtCount(match.books.rowsWithCode)}.</>
          )}
        </>
      )}
    >
      {/* ── Итог сравнения сумм ── */}
      <div className="grid gap-2 sm:grid-cols-2">
        <SumsVerdict
          title="План книги ↔ начальная цена"
          agree={s.nmckAgree}
          disagree={s.nmckDisagree}
          noComparison={s.nmckNoComparison}
        />
        <SumsVerdict
          title="Факт книги ↔ цена победителя"
          agree={s.factAgree}
          disagree={s.factDisagree}
          noComparison={s.factNoComparison}
        />
      </div>

      {/* ── Шесть классов исхода ── */}
      <ul className="mt-3 space-y-2">
        {classes.map((c) => <MatchClassCard key={c.kind} row={c} />)}
      </ul>

      {/* ── Расхождения сумм с адресами обеих сторон ── */}
      <h4 className="mt-4 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
        Расхождения сумм по сошедшимся парам
      </h4>
      {disagreements.length === 0 ? (
        <div className="mt-1.5">
          <CardEmpty>
            По сошедшимся парам суммы совпадают в пределах допуска. Это утверждение о данных, а не
            отсутствие проверки.
          </CardEmpty>
        </div>
      ) : (
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full text-[11px]">
            <caption className="sr-only">Расхождения сумм между книгой управления и мониторингом</caption>
            <thead>
              <tr className="text-left text-zinc-500 dark:text-zinc-400">
                <th className="py-1 pr-2 font-normal">Процедура</th>
                <th className="py-1 pr-2 font-normal">Что сравнивалось</th>
                <th className="py-1 pr-2 text-right font-normal">Книга, руб.</th>
                <th className="py-1 pr-2 text-right font-normal">Мониторинг, руб.</th>
                <th className="py-1 text-right font-normal">Разница, руб.</th>
              </tr>
            </thead>
            <tbody className="text-zinc-700 dark:text-zinc-200">
              {disagreements.map((d) => (
                <tr
                  key={`${d.code}:${d.field}`}
                  className="border-t border-zinc-100 dark:border-zinc-700/50 align-top"
                >
                  <td className="py-1 pr-2">
                    <span className="font-medium">{d.code}</span>
                    <div className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                      книга {d.bookAddress} · мониторинг {d.monitoringAddress}
                    </div>
                  </td>
                  <td className="py-1 pr-2">{d.fieldLabel}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtRubExact(d.bookRub)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtRubExact(d.monitoringRub)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {fmtRubExact(d.deltaRub)}
                    {d.relDiff !== null && (
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {fmtPct(d.relDiff * 100)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
            Какая из двух записей верна, продукт не решает: показаны обе суммы и оба адреса.
          </p>
        </div>
      )}

      {/* ── Внутренняя сверка книги ── */}
      <InternalDiffBlock match={match} />

      {match.notes.length > 0 && (
        <div className="mt-3 space-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
          {match.notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}
    </AnalyticsCard>
  );
}

/** Итог одной пары сумм: сошлось / разошлось / сравнивать нечего. */
function SumsVerdict({
  title, agree, disagree, noComparison,
}: { title: string; agree: number; disagree: number; noComparison: number }) {
  return (
    <div className="rounded-lg border border-zinc-100 dark:border-zinc-700/50 bg-zinc-50/60 dark:bg-zinc-900/30 p-3">
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{title}</p>
      <p className="mt-0.5 text-[11px] tabular-nums text-zinc-700 dark:text-zinc-200">
        сошлось {fmtCount(agree)} · разошлось {fmtCount(disagree)} · сравнивать нечего {fmtCount(noComparison)}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        «Сравнивать нечего» — не совпадение и не расхождение: одной из двух сумм в источнике нет.
      </p>
    </div>
  );
}

function MatchClassCard({ row }: { row: ReturnType<typeof matchClasses>[number] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
      <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
        {row.title}
        <span className="ml-1.5 text-[10px] font-normal tabular-nums text-zinc-400 dark:text-zinc-500">
          {pluralCount(row.count, 'случай', 'случая', 'случаев')}
        </span>
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">{row.mechanism}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200">
        <span className="text-zinc-400 dark:text-zinc-500">Что сделать: </span>{row.action}
      </p>
      {row.examples.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 hover:underline"
          >
            <ChevronDown size={10} aria-hidden="true" className={open ? 'rotate-180' : ''} />
            {open ? 'скрыть примеры' : `показать примеры с адресами (${fmtCount(row.examples.length)})`}
          </button>
          {open && (
            <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto text-[10px] text-zinc-500 dark:text-zinc-400">
              {row.examples.map((e) => (
                <li key={e.code} className="font-mono">
                  {e.code} — {e.addresses.join(' · ')}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

/**
 * Внутренняя сверка: лист управления против переходящего реестра «25-26».
 * Это расхождения САМОЙ книги, а не спор с управлениями: одна процедура
 * записана дважды, и суммы разъехались.
 */
function InternalDiffBlock({ match }: { match: MatchViewPayload }) {
  const rows = match.internal.rows.filter((r) => r.kind === 'sums-differ');
  return (
    <>
      <h4 className="mt-4 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
        Внутренняя сверка книги: лист управления ↔ переходящий реестр «25-26»
      </h4>
      <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        Кодов на листах управлений — {fmtCount(match.internal.codesOnSheets)}, в переходящем
        реестре — {fmtCount(match.internal.codesInJournal)}, в обоих местах —{' '}
        {fmtCount(match.internal.codesInBoth)}. Совместная закупка расходится по природе формы:
        на листах лежат доли управлений, в реестре — вся закупка целиком.
      </p>
      {rows.length === 0 ? (
        <div className="mt-1.5">
          <CardEmpty>
            Суммы одной и той же процедуры на листе управления и в переходящем реестре совпадают.
          </CardEmpty>
        </div>
      ) : (
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full text-[11px]">
            <caption className="sr-only">Расхождения листов управлений с переходящим реестром</caption>
            <thead>
              <tr className="text-left text-zinc-500 dark:text-zinc-400">
                <th className="py-1 pr-2 font-normal">Процедура</th>
                <th className="py-1 pr-2 font-normal">Что расходится</th>
                <th className="py-1 pr-2 text-right font-normal">Начальная цена, руб.</th>
                <th className="py-1 text-right font-normal">Цена победителя, руб.</th>
              </tr>
            </thead>
            <tbody className="text-zinc-700 dark:text-zinc-200">
              {rows.slice(0, 25).map((r) => (
                <tr key={r.code} className="border-t border-zinc-100 dark:border-zinc-700/50 align-top">
                  <td className="py-1 pr-2">
                    <span className="font-medium">{r.code}</span>
                    <div className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                      {r.sheetRows.map((s) => `${s.sheet} · строка ${s.row}`).join(' · ')}
                      {r.journalRows.length > 0 && ' ↔ '}
                      {r.journalRows.map((j) => `${j.sheet} · строка ${j.row}`).join(' · ')}
                    </div>
                    {r.joint && (
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        совместная закупка: доли управлений против целого
                      </div>
                    )}
                  </td>
                  <td className="py-1 pr-2">{r.note}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(r.nmckDeltaRub)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtRub(r.priceDeltaRub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 25 && (
            <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              Показаны 25 расхождений из {fmtCount(rows.length)}.
            </p>
          )}
        </div>
      )}
    </>
  );
}
