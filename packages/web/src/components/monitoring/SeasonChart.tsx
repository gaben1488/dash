/**
 * Сезонность: сколько процедур и денег приходится на каждый месяц (спека §3.5).
 *
 * ОСНОВАНИЕ ДАТЫ — ВЫБОР ЧИТАТЕЛЯ, А НЕ УМОЛЧАНИЕ ЭКРАНА. По дате публикации
 * видно, когда уполномоченный орган ВЫХОДИЛ на торги; по дате торгов — когда
 * они РЕЗУЛЬТИРОВАЛИСЬ. Картины разные, и молчаливая подмена одного другим
 * означала бы разговор о разных вещах под одной подписью. Переключатель
 * стоит в шапке блока, выбранное основание названо словами.
 *
 * МЕСЯЦЫ НЕ ДОСТРАИВАЮТСЯ ДО КАЛЕНДАРЯ. Месяц, которого в книге нет,
 * пропускается, а не рисуется нулевым столбцом: «в мае процедур не было» и
 * «май ещё не наступил» — разные новости.
 *
 * СТРОКИ БЕЗ ДАТЫ ОБЪЯВЛЯЮТСЯ ВСЛУХ. Они не входят в сезонность, и их число
 * стоит оговоркой у плашки периода — иначе сумма столбцов молча не сойдётся
 * с итогом реестра.
 */
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import type { Seasonality } from '../../lib/monitoring/analytics-contract';
import { seasonBars, seasonBasisLabel } from '../../lib/monitoring/charts';
import type { SeasonBasis } from '../../lib/monitoring/analytics-contract';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import {
  getAxisColor, getChartColor, getGridColor, getTooltipStyle,
} from '../../lib/chart-colors';
import { useTheme } from '../ThemeProvider';
import { AnalyticsCard, CardEmpty, CardToggle } from './AnalyticsCard';

export interface SeasonChartProps {
  seasonality: Seasonality;
  periodLabel: string;
  /** Текущее основание и его смена — запрос уходит на сервер заново. */
  basis: SeasonBasis;
  onBasisChange: (basis: SeasonBasis) => void;
}

export function SeasonChart({ seasonality, periodLabel, basis, onBasisChange }: SeasonChartProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const bars = seasonBars(seasonality.months);
  const tooltip = getTooltipStyle(isDark);

  const peak = bars.reduce<typeof bars[number] | null>(
    (best, b) => (best === null || b.count > best.count ? b : best),
    null,
  );

  const title = peak === null
    ? 'Помесячная картина процедур'
    : `Больше всего процедур приходится на ${peak.label}: ${pluralCount(peak.count, 'процедура', 'процедуры', 'процедур')}`;

  return (
    <AnalyticsCard
      kicker="Сезонность"
      title={title}
      periodLabel={periodLabel}
      periodNote={seasonality.undated > 0
        ? `${fmtCount(seasonality.undated)} процедур без выбранной даты в сезонность не входят`
        : undefined}
      controls={(
        <>
          <CardToggle active={basis === 'publication'} onClick={() => onBasisChange('publication')}>
            по дате публикации
          </CardToggle>
          <CardToggle active={basis === 'auction'} onClick={() => onBasisChange('auction')}>
            по дате торгов
          </CardToggle>
        </>
      )}
      method={(
        <>
          Строки разложены по месяцам {seasonBasisLabel(seasonality)}. Столбец — число процедур
          месяца, линия — сумма начальных цен, руб. Месяцы без строк в книге пропущены, а не
          показаны нулём.
        </>
      )}
    >
      {bars.length === 0 ? (
        <CardEmpty>
          Ни у одной процедуры нет выбранной даты, поэтому разложить их по месяцам нельзя.
          Попробуйте другое основание — по дате торгов картина может собраться.
        </CardEmpty>
      ) : (
        <>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bars} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} vertical={false} />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fontSize: 9, fill: getAxisColor(isDark) }}
                  interval={0}
                  height={30}
                />
                <YAxis yAxisId="count" tick={{ fontSize: 10, fill: getAxisColor(isDark) }} width={30} />
                <YAxis
                  yAxisId="money"
                  orientation="right"
                  tick={{ fontSize: 9, fill: getAxisColor(isDark) }}
                  width={46}
                  tickFormatter={(v: number) => (v === 0 ? '0' : `${Math.round(v / 1_000_000)} млн`)}
                />
                <RechartsTooltip
                  {...tooltip}
                  formatter={(v: number, name: string) => (
                    name === 'Начальные цены, руб.'
                      ? [`${fmtRub(v)} руб.`, name]
                      : [fmtCount(v), name]
                  )}
                />
                <Bar
                  yAxisId="count"
                  dataKey="count"
                  name="Процедур"
                  fill={getChartColor(0, isDark)}
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  yAxisId="money"
                  type="monotone"
                  dataKey="nmckRub"
                  name="Начальные цены, руб."
                  stroke={getChartColor(3, isDark)}
                  strokeWidth={1.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <caption className="sr-only">Процедуры и деньги по месяцам</caption>
              <thead>
                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 font-normal">Месяц</th>
                  <th className="py-1 pr-2 text-right font-normal">Процедур</th>
                  <th className="py-1 pr-2 text-right font-normal">Начальные цены, руб.</th>
                  <th className="py-1 text-right font-normal">Снижение</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-200">
                {bars.map((b) => (
                  <tr key={b.period} className="border-t border-zinc-100 dark:border-zinc-700/50">
                    <td className="py-1 pr-2">{b.label}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(b.count)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(b.nmckRub)}</td>
                    <td className="py-1 text-right tabular-nums">{fmtPct(b.reductionPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AnalyticsCard>
  );
}
