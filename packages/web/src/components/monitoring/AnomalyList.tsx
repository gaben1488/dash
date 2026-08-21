/**
 * Несостоявшиеся процедуры и аномалии — карточками диагноста (спека §3.6,
 * §3.8; канон п.53).
 *
 * КАРТОЧКА ДИАГНОСТА — ЭТО ТРИ ВЕЩИ: механизм («отчего так вышло»), АДРЕС
 * («где именно») и действие («что сделать»). Аномалия без адреса заставляет
 * искать иголку в трёхстах семидесяти строках и потому не будет разобрана
 * никогда.
 *
 * НЕСОСТОЯВШИЕСЯ — НЕ АНОМАЛИЯ, А СОСТОЯНИЕ. Цена аукциона ровно ноль
 * означает «торги прошли, результата нет»: чаще всего заявок не подали. Это
 * содержательный ноль, а не пустая ячейка, и он показан отдельным блоком со
 * своими текстами исходов из книги.
 *
 * ТОН — МЕХАНИЗМ, НЕ УПРЁК (п.104). Снижение свыше половины начальной цены
 * может значить и завышенную начальную цену, и глубокий демпинг; экран
 * называет оба объяснения и просит посмотреть, а не обвиняет.
 */
import { useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type {
  AnomalyGroup, UnsuccessfulProcedures,
} from '../../lib/monitoring/analytics-contract';
import { anomalyOrder, refAddress } from '../../lib/monitoring/charts';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';
import { TILE } from './surfaces';

export interface AnomalyListProps {
  anomalies: AnomalyGroup[];
  unsuccessful: UnsuccessfulProcedures;
  periodLabel: string;
}

export function AnomalyList({ anomalies, unsuccessful, periodLabel }: AnomalyListProps) {
  const groups = anomalyOrder(anomalies);

  return (
    <AnalyticsCard
      kicker="Несостоявшиеся и аномалии"
      title={
        unsuccessful.sharePct === null
          ? 'Процедуры без результата и находки машинных проверок'
          : `Без результата закончились ${fmtPct(unsuccessful.sharePct, 1)} процедур реестра`
      }
      periodLabel={periodLabel}
      method={(
        <>
          «Без результата» — цена аукциона ровно ноль при состоявшихся торгах; текст исхода взят из
          колонки победителя как есть. Аномалии — шесть машинных проверок по всей книге: глубокое
          снижение, нулевая цена, одинаковые начальные цены, повтор кода, экономия, внесённая
          вручную, и расхождение собственного контроля книги. Каждая находка едет с адресом строки.
        </>
      )}
    >
      {/* ── Несостоявшиеся ── */}
      <div className={`${TILE} p-3`}>
        <p className="text-[11px] text-zinc-700 dark:text-zinc-200">
          {unsuccessful.count === 0
            ? 'Ни одна процедура среза не закончилась без результата.'
            : (
              <>
                {pluralCount(unsuccessful.count, 'процедура', 'процедуры', 'процедур')} закончились
                без результата; за ними стоит {fmtRub(unsuccessful.nmckRub)} руб. начальных цен —
                эти деньги остались неразыгранными и, если процедуру не объявят заново, вернутся в
                неисполненный план.
              </>
            )}
        </p>
        {unsuccessful.byDept.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
            {unsuccessful.byDept.map((d) => (
              <li key={d.dept} className="tabular-nums">
                {d.dept}: {fmtCount(d.count)} · {fmtRub(d.nmckRub)} руб.
              </li>
            ))}
          </ul>
        )}
        {unsuccessful.outcomes.length > 0 && (
          <div className="mt-1.5">
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
              Что записано в книге как причина:
            </p>
            <ul className="mt-0.5 space-y-0.5 text-[10px] text-zinc-600 dark:text-zinc-300">
              {unsuccessful.outcomes.slice(0, 6).map((o) => (
                <li key={o.text} className="tabular-nums">
                  «{o.text}» — {pluralCount(o.count, 'раз', 'раза', 'раз')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Аномалии ── */}
      {groups.length === 0 ? (
        <div className="mt-3">
          <CardEmpty>
            Машинные проверки не нашли ни одной находки. Это утверждение о книге, а не пропущенная
            проверка: шесть проверок отработали и промолчали.
          </CardEmpty>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {groups.map((g) => <AnomalyCard key={g.kind} group={g} />)}
        </ul>
      )}
    </AnalyticsCard>
  );
}

/**
 * Одна находка. Адреса сворачиваются: шестьдесят адресов в развёрнутом виде
 * хоронят под собой остальные находки. Число сказано на кнопке, список — под
 * ней.
 */
function AnomalyCard({ group }: { group: AnomalyGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`${TILE} p-3`}>
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={13}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-100">
            {group.title}
            <span className="ml-1.5 text-[10px] font-normal tabular-nums text-zinc-400 dark:text-zinc-500">
              {pluralCount(group.count, 'строка', 'строки', 'строк')}
            </span>
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {group.mechanism}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200">
            <span className="text-zinc-400 dark:text-zinc-500">Что сделать: </span>{group.action}
          </p>
          {group.refs.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 hover:underline"
              >
                <ChevronDown size={10} aria-hidden="true" className={open ? 'rotate-180' : ''} />
                {open ? 'скрыть адреса' : `показать адреса (${fmtCount(group.refs.length)})`}
              </button>
              {open && (
                <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto text-[10px] text-zinc-500 dark:text-zinc-400">
                  {group.refs.map((r) => (
                    <li key={`${r.sheet}:${r.row}`}>
                      <span className="font-mono">{refAddress(r)}</span> — {r.note}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}
