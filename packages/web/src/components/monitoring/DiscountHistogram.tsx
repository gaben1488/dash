/**
 * Снижение на торгах: три коэффициента, распределение по корзинам и два
 * разреза — по способу закупки и по размеру закупки (спека §3.2, §2.6).
 *
 * ЭТОТ БЛОК — ФУНДАМЕНТ ЖИВОГО КОЭФФИЦИЕНТА ВМЕСТО ВОСЬМИ ПРОЦЕНТОВ. В
 * планировании до сих пор ходит одна цифра «примерно 8 %», взятая из
 * прошлого опыта и не проверяемая ничем. Здесь она заменяется тремя
 * измеренными числами с названными знаменателями — и, что важнее,
 * распределением, из которого видно, ПОЧЕМУ одного числа не бывает.
 *
 * ТРИ КОЭФФИЦИЕНТА, А НЕ ОДИН. Знаменатели у них разные: портфельный делит
 * деньги на деньги, средний построчный — проценты на число процедур, третий
 * считает только те процедуры, где снижение было. Ни один не имеет права
 * молча выступать от имени остальных: между ними разница втрое.
 *
 * ФОРМА РАСПРЕДЕЛЕНИЯ ДВУГОРБАЯ. Огромный столб на нуле — процедуры, где
 * цена в точности равна начальной (единственный участник), и второй горб в
 * зоне глубокого снижения — живые торги. Это два разных мира, и среднее
 * между ними не описывает ни один.
 *
 * ЦВЕТ НЕСЁТ СМЫСЛ, А НЕ УКРАШАЕТ. Корзина «ровно 0 %» серая — это не
 * провал, а отсутствие торга; корзина «свыше 50 %» янтарная — повод
 * посмотреть, а не нарушение. Остальные — один тон категориальной палитры.
 */
import {
  Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import type {
  DiscountBucket, NmckBucket, ReductionCoefficients,
} from '../../lib/monitoring/analytics-contract';
import {
  histogramBars, nmckBucketBars, reductionMethods,
  type ReductionByMethodRow,
} from '../../lib/monitoring/charts';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { methodLabel } from '../../lib/monitoring/stage-labels';
import {
  getAxisColor, getChartColor, getGridColor, getSeverityColor, getTooltipStyle,
} from '../../lib/chart-colors';
import { useTheme } from '../ThemeProvider';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';

export interface DiscountHistogramProps {
  reduction: ReductionCoefficients;
  histogram: DiscountBucket[];
  nmckBuckets: NmckBucket[];
  /** Разрез по способу закупки; null — строк реестра рядом нет. */
  byMethod: ReductionByMethodRow[] | null;
  periodLabel: string;
  /** Клик по корзине — отбор реестра по ней; необязателен. */
  onPickBucket?: (bucketKey: string) => void;
}

export function DiscountHistogram({
  reduction, histogram, nmckBuckets, byMethod, periodLabel, onPickBucket,
}: DiscountHistogramProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const bars = histogramBars(histogram);
  const methods = reductionMethods(reduction);
  const sizes = nmckBucketBars(nmckBuckets);
  const tooltip = getTooltipStyle(isDark);

  const barColor = (key: string): string => {
    if (key === 'zero') return getSeverityColor('info', isDark);
    if (key === '50+') return getSeverityColor('warning', isDark);
    return getChartColor(0, isDark);
  };

  const title = reduction.equalPriceSharePct === null
    ? 'Снижение на торгах: три коэффициента и распределение'
    : `У ${fmtPct(reduction.equalPriceSharePct, 0)} состоявшихся процедур цена в точности равна начальной`;

  return (
    <AnalyticsCard
      kicker="Снижение на торгах"
      title={title}
      periodLabel={periodLabel}
      method={(
        <>
          Снижение строки — (начальная цена − цена победителя) ÷ начальная цена. В счёт входят
          только состоявшиеся процедуры с обеими суммами. Три коэффициента ниже считаются по трём
          разным знаменателям и потому расходятся: подменять один другим нельзя.
        </>
      )}
    >
      {/* ── Три коэффициента с методикой ── */}
      <div className="grid gap-2 sm:grid-cols-3">
        {methods.map((m) => (
          <div
            key={m.id}
            className="rounded-lg border border-zinc-100 dark:border-zinc-700/50 bg-zinc-50/60 dark:bg-zinc-900/30 p-3"
          >
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{m.title}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
              {m.valuePct === null ? '—' : fmtPct(m.valuePct)}
            </p>
            {m.medianPct !== null && (
              <p className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                медиана {fmtPct(m.medianPct)}
              </p>
            )}
            <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">{m.basis}</p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-300">
              {m.question}
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {m.method}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        Разрыв между коэффициентами объясняется одним числом:{' '}
        {reduction.equalPriceCount === 0
          ? 'процедур, где цена в точности равна начальной, в этом срезе нет'
          : `${pluralCount(reduction.equalPriceCount, 'процедура', 'процедуры', 'процедур')} прошли без единого шага снижения`}
        . Пока их доля так велика, одна усреднённая цифра снижения в планировании будет ошибаться
        в обе стороны — в зависимости от того, какие процедуры попадут в период.
      </p>

      {/* ── Гистограмма ── */}
      {bars.length === 0 ? (
        <CardEmpty>
          Состоявшихся процедур с обеими суммами в этом срезе нет, поэтому распределение снижения
          строить не из чего. Это пустой знаменатель, а не нулевое снижение.
        </CardEmpty>
      ) : (
        <>
          <div className="mt-3 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: getAxisColor(isDark) }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={46}
                />
                <YAxis tick={{ fontSize: 10, fill: getAxisColor(isDark) }} width={34} />
                <RechartsTooltip
                  {...tooltip}
                  formatter={(v: number, _n: string, item: { payload?: { savingsRub?: number } }) => [
                    `${fmtCount(v)} — экономия ${fmtRub(item.payload?.savingsRub ?? null)} руб.`,
                    'процедур',
                  ]}
                />
                <Bar
                  dataKey="count"
                  radius={[3, 3, 0, 0]}
                  cursor={onPickBucket !== undefined ? 'pointer' : undefined}
                  onClick={(d: { key?: string }) => {
                    if (onPickBucket !== undefined && typeof d.key === 'string') onPickBucket(d.key);
                  }}
                >
                  {bars.map((b) => <Cell key={b.key} fill={barColor(b.key)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {onPickBucket !== undefined && (
            <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              Клик по столбу ставит реестру выше разрез той же корзиной снижения — видно сами
              строки за числом.
            </p>
          )}

          {/* Текстовый дубль графика: печать бывает чёрно-белой, а часть
              читателей не различает тона. Числа обязаны быть словами тоже. */}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <caption className="sr-only">Распределение процедур по величине снижения</caption>
              <thead>
                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 font-normal">Снижение</th>
                  <th className="py-1 pr-2 text-right font-normal">Процедур</th>
                  <th className="py-1 pr-2 text-right font-normal">Доля</th>
                  <th className="py-1 text-right font-normal">Экономия, руб.</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-200">
                {bars.map((b) => (
                  <tr key={b.key} className="border-t border-zinc-100 dark:border-zinc-700/50">
                    <td className="py-1 pr-2">{b.label}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(b.count)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtPct(b.sharePct, 0)}</td>
                    <td className="py-1 text-right tabular-nums">{fmtRub(b.savingsRub)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Разрез по способу закупки ── */}
      <h4 className="mt-4 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
        Разрез по способу определения поставщика
      </h4>
      <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        Складывать электронный аукцион и закупку у единственного поставщика в один средний процент
        бессмысленно: у второй снижения нет по природе способа.
      </p>
      {byMethod === null || byMethod.length === 0 ? (
        <CardEmpty>
          Разрез по способу считается из строк реестра, и сейчас их рядом нет. Числа не потеряны —
          они появятся вместе с таблицей реестра.
        </CardEmpty>
      ) : (
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-zinc-500 dark:text-zinc-400">
                <th className="py-1 pr-2 font-normal">Способ</th>
                <th className="py-1 pr-2 text-right font-normal">Процедур</th>
                <th className="py-1 pr-2 text-right font-normal">Снижение</th>
                <th className="py-1 text-right font-normal">Без снижения</th>
              </tr>
            </thead>
            <tbody className="text-zinc-700 dark:text-zinc-200">
              {byMethod.map((r) => (
                <tr key={r.method} className="border-t border-zinc-100 dark:border-zinc-700/50">
                  <td className="py-1 pr-2">
                    <span className="font-medium">{r.method}</span>
                    <span className="ml-1 text-zinc-500 dark:text-zinc-400">
                      — {methodLabel(r.method === 'способ не определён' ? null : r.method)}
                    </span>
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(r.count)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtPct(r.portfolioPct)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtCount(r.equalPriceCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Разрез по размеру закупки ── */}
      <h4 className="mt-4 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
        Разрез по размеру закупки
      </h4>
      <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        Мелкие и крупные закупки торгуются по-разному: у мелких сильнее конкуренция за счёт низкого
        порога входа, у крупных выше цена ошибки в начальной цене.
      </p>
      {sizes.length === 0 ? (
        <CardEmpty>Корзин по размеру закупки сервер не прислал.</CardEmpty>
      ) : (
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-zinc-500 dark:text-zinc-400">
                <th className="py-1 pr-2 font-normal">Размер</th>
                <th className="py-1 pr-2 text-right font-normal">Процедур</th>
                <th className="py-1 pr-2 text-right font-normal">Начальные цены, руб.</th>
                <th className="py-1 text-right font-normal">Снижение</th>
              </tr>
            </thead>
            <tbody className="text-zinc-700 dark:text-zinc-200">
              {sizes.map((b) => (
                <tr key={b.key} className="border-t border-zinc-100 dark:border-zinc-700/50">
                  <td className="py-1 pr-2">{b.label}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(b.count)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(b.nmckRub)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtPct(b.reductionPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsCard>
  );
}
