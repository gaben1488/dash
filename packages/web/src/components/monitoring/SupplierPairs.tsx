/**
 * Повторяющиеся связки «поставщик ↔ заказчик» (спека §3.3).
 *
 * ПОЧЕМУ ЭТО НЕ СПИСОК ПОДОЗРЕВАЕМЫХ. Повторяемость сама по себе ничего не
 * доказывает: одиннадцать побед одного продавца у одного заказчика — это
 * приобретение квартир для детей-сирот, где продавец физически единственный
 * на конкретную квартиру. Поэтому рядом с каждой парой стоят ПРЕДМЕТЫ
 * закупок: механизм объясняет сам себя (п.104), и читателю не приходится
 * гадать, тревожиться ли.
 *
 * ПОРОГ ПОВТОРА ЗАДАЁТ ЯДРО (по умолчанию три победы). Пара, встретившаяся
 * дважды, — это ещё не связка, а совпадение; показывать её значило бы
 * утопить настоящие находки в шуме.
 */
import type { SupplierCustomerPair } from '../../lib/monitoring/analytics-contract';
import { fmtCount, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';
import { RULE_ROW_TOP } from './surfaces';

export interface SupplierPairsProps {
  pairs: SupplierCustomerPair[];
  periodLabel: string;
}

export function SupplierPairs({ pairs, periodLabel }: SupplierPairsProps) {
  const top = pairs.slice(0, 15);
  const title = pairs.length === 0
    ? 'Повторяющихся связок «поставщик — заказчик» не нашлось'
    : `${pluralCount(pairs.length, 'связка', 'связки', 'связок')} «поставщик — заказчик» повторяются трижды и чаще`;

  return (
    <AnalyticsCard
      kicker="Повторяемость связок"
      title={title}
      periodLabel={periodLabel}
      method={(
        <>
          Пара — это поставщик (по ИНН, иначе по имени) и заказчик, приведённый к сравнимому виду.
          В список попадают пары от трёх побед. Деньги пары — сумма цен победителя по её
          процедурам, руб. Предметы закупок показаны рядом: чаще всего именно они и объясняют
          повтор.
        </>
      )}
    >
      {top.length === 0 ? (
        <CardEmpty>
          Ни один поставщик не выигрывал у одного и того же заказчика трижды. Это факт о срезе, а
          не отсутствие данных.
        </CardEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <caption className="sr-only">Повторяющиеся связки поставщика и заказчика</caption>
            <thead>
              <tr className="text-left text-zinc-500 dark:text-zinc-400">
                <th className="py-1 pr-2 font-normal">Поставщик</th>
                <th className="py-1 pr-2 font-normal">Заказчик</th>
                <th className="py-1 pr-2 text-right font-normal">Побед</th>
                <th className="py-1 text-right font-normal">Сумма, руб.</th>
              </tr>
            </thead>
            <tbody className="text-zinc-700 dark:text-zinc-200">
              {top.map((p) => (
                <tr
                  key={`${p.supplierKey}|${p.customer}`}
                  className={`${RULE_ROW_TOP} align-top`}
                >
                  <td className="py-1 pr-2">
                    <span className="font-medium">{p.supplierName}</span>
                    <span className="ml-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                      {p.inn === null ? 'ИНН в книге не указан' : `ИНН ${p.inn}`}
                    </span>
                  </td>
                  <td className="py-1 pr-2">
                    {p.customer}
                    {p.subjects.length > 0 && (
                      <div className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                        предметы: {p.subjects.join('; ')}
                      </div>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(p.wins)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtRub(p.moneyRub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pairs.length > top.length && (
            <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              Показаны {fmtCount(top.length)} связок из {fmtCount(pairs.length)} — остальные короче
              по числу побед.
            </p>
          )}
        </div>
      )}
    </AnalyticsCard>
  );
}
