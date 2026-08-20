/**
 * Воронка пути процедуры: заявка → публикация → торги → цена победителя →
 * экономия расписана по бюджетам (спека §3.1).
 *
 * ВОРОНКА СЧИТАЕТСЯ ПО ЗАПОЛНЕННОСТИ КОЛОНОК КНИГИ, а не по стадии строки, и
 * это принципиально: стадия отвечает «где процедура сейчас», воронка — «до
 * какой ступени дошла запись о ней». Из-за этого ступень может оказаться
 * заполнена полнее предыдущей (дата торгов есть, даты публикации нет). Такую
 * находку экран НЕ сглаживает: оговорка ядра печатается прямо под ступенью.
 *
 * ДЕНЬГИ РЯДОМ СО ШТУКАМИ. «Двести процедур дошли до торгов» и «до торгов
 * дошёл миллиард» — разные новости, и вторая обычно важнее. Суммы считаются
 * из строк реестра, потому что ядро отдаёт воронку счётами штук; если строк
 * реестра рядом нет, колонка денег честно молчит, а не показывает нули.
 *
 * ПОЛОСЫ — HTML, НЕ ГРАФИК. Пять горизонтальных полос с числами внутри
 * читаются и в тёмной теме, и на телефоне, и в чёрно-белой печати; библиотека
 * графиков здесь не дала бы ничего, кроме веса.
 */
import type { StageFunnelData } from '../../lib/monitoring/analytics-contract';
import { funnelBars, type FunnelMoneyStep } from '../../lib/monitoring/charts';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';

export interface StageFunnelProps {
  funnel: StageFunnelData;
  /** Деньги ступеней; null — строк реестра рядом нет, колонка молчит. */
  money: FunnelMoneyStep[] | null;
  periodLabel: string;
}

export function StageFunnel({ funnel, money, periodLabel }: StageFunnelProps) {
  const bars = funnelBars(funnel);
  const moneyByKey = new Map((money ?? []).map((m) => [m.key, m]));

  const title = funnel.reachedPricedPct === null
    ? 'Путь процедуры по ступеням книги'
    : `До цены победителя доходит ${fmtPct(funnel.reachedPricedPct, 0)} записей реестра`;

  return (
    <AnalyticsCard
      kicker="Воронка стадий"
      title={title}
      periodLabel={periodLabel}
      method={(
        <>
          Ступень засчитывается по заполненности колонки книги, а не по стадии строки: считается,
          сколько записей дошло до этой колонки. Конверсия — доля от предыдущей ступени.
          Знаменатель первой ступени — {pluralCount(funnel.total, 'строка', 'строки', 'строк')} реестра.
        </>
      )}
    >
      {bars.length === 0 ? (
        <CardEmpty>
          Ступеней воронки сервер не прислал. Это про незаконченную трубу чтения, а не про пустую
          книгу: строки реестра на месте, счёт ступеней по ним ещё не пришёл.
        </CardEmpty>
      ) : (
        <ol className="space-y-2">
          {bars.map((b) => {
            const m = moneyByKey.get(b.key);
            return (
              <li key={b.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-[11px] text-zinc-600 dark:text-zinc-300">{b.label}</span>
                  <span className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                    {b.conversionPct === null
                      ? 'первая ступень — сравнивать не с чем'
                      : `${fmtPct(b.conversionPct, 0)} от предыдущей`}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-5 flex-1 rounded bg-zinc-100 dark:bg-zinc-700/40 overflow-hidden">
                    <div
                      className="h-full rounded bg-zinc-400/70 dark:bg-zinc-400/50"
                      style={{ width: `${Math.max(b.widthPct, 1)}%` }}
                      role="presentation"
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
                    {fmtCount(b.count)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-zinc-500 dark:text-zinc-400">
                  {m !== undefined && (
                    <>
                      <span className="tabular-nums">
                        начальные цены: {fmtRub(m.nmckRub)} руб.
                      </span>
                      {m.priceRub !== null && (
                        <span className="tabular-nums">цены победителей: {fmtRub(m.priceRub)} руб.</span>
                      )}
                      {m.nmckMissing > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                          у {fmtCount(m.nmckMissing)} строк начальная цена не читается числом — сумма неполная
                        </span>
                      )}
                    </>
                  )}
                  {money === null && <span>суммы этой ступени показываются вместе с реестром</span>}
                </div>
                {b.note !== null && (
                  <p className="mt-0.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-400">
                    {b.note}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </AnalyticsCard>
  );
}
