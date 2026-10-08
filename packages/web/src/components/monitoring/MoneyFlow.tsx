import { KBTooltip } from '../ui/kb-tooltip';
import { MONITORING_KB_ADDITIONS, kbCardProps } from '../../pages/kb-additions';
import type { RegistryProcedure } from '../../lib/monitoring/contract';
import { MONEY_CATEGORY_LABELS, moneyFlowFrom, type MoneyCategory } from '../../lib/monitoring/money-flow';
import { fmtCount, fmtRub } from '../../lib/monitoring/format';
import { CARD, CONTROL } from './surfaces';

export function MoneyFlow({ procedures, onPick }: {
  procedures: readonly RegistryProcedure[];
  onPick: (category: MoneyCategory) => void;
}) {
  const flow = moneyFlowFrom(procedures);
  return <section aria-label="НМЦК по состоянию процедур" className={`${CARD} p-4 sm:p-5`}>
    <KBTooltip {...kbCardProps(MONITORING_KB_ADDITIONS.monitoring_money_categories)} showIcon>
      <h2 className="text-sm font-semibold">НМЦК по состоянию процедур</h2>
    </KBTooltip>
    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Текущая выборка. Нажмите состояние, чтобы открыть входящие процедуры. Переоформленные показаны отдельно от текущего плана.</p>
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-zinc-200 dark:border-zinc-700">
          <th scope="col" className="py-2 text-left">Состояние</th>
          <th scope="col" className="px-3 py-2 text-right">Процедур</th>
          <th scope="col" className="py-2 text-right">НМЦК, ₽</th>
        </tr></thead>
        <tbody>{(Object.keys(MONEY_CATEGORY_LABELS) as MoneyCategory[]).filter((key) => key !== 'unknown' || flow.categories[key].count > 0).map((key) => {
          const value = flow.categories[key];
          return <tr key={key} className="border-b border-zinc-100 dark:border-zinc-800">
            <th scope="row" className="py-2 text-left font-normal"><button type="button" disabled={value.count === 0}
              onClick={() => onPick(key)} className={`${CONTROL} px-3 py-2 text-left disabled:opacity-50`}>{MONEY_CATEGORY_LABELS[key]}</button></th>
            <td className="px-3 py-2 text-right tabular-nums">{fmtCount(value.count)}</td>
            <td className="py-2 text-right tabular-nums whitespace-nowrap">{value.count > 0 && value.missing === value.count ? 'неизвестна' : fmtRub(value.nmck)}{value.missing > 0 && <span className="block text-xs text-amber-700 dark:text-amber-400">Без суммы: {value.missing}</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {flow.awaitingDate > 0 && <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">Результат внесён, но денежный факт не учтён по дате: {flow.awaitingDate}. НМЦК этих процедур остаётся в категории «В работе и ожидании даты»; стадия источника и рабочая очередь не меняются.</p>}
    {flow.categories.unknown.count > 0 && <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">Процедуры с неизвестной стадией показаны отдельно. Распределение по четырём состояниям требует уточнения данных.</p>}
  </section>;
}
