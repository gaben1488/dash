/**
 * «Где риск» — торги, прошедшие без единого шага снижения (разрез витрины §3).
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ РАЗРЕЗ, А НЕ СТОЛБ ГИСТОГРАММЫ. На гистограмме
 * снижения нулевая корзина — один из семи столбов, и глаз читает её как
 * крайний случай. Здесь она главная новость, и содержание разреза — в
 * РАСХОЖДЕНИИ ДВУХ ДОЛЕЙ: доля бесторговых в счёте процедур и доля тех же
 * процедур в деньгах. Когда вторая заметно больше первой, значит без торга
 * прошли закупки крупнее среднего — а это уже вопрос к начальной цене.
 *
 * ЭТО НЕ УЛИКА, И ТОН БЛОКА ЭТО ГОВОРИТ. У закупки у единственного поставщика
 * снижения нет по природе способа, у аукциона с единственной заявкой — по
 * природе итога. Поэтому цвет здесь информационный, а не тревожный, а разбивка
 * по способам стоит прямо под числом: она и объясняет большую часть нулей.
 *
 * ЗНАМЕНАТЕЛЬ НАЗВАН ВСЛУХ. Несостоявшиеся процедуры (цена ровно ноль) в счёт
 * не входят: там цены нет вовсе, а не нулевое снижение — это разные новости с
 * разными действиями, и путать их значит соврать в обе стороны.
 */
import {
  Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import type { ZeroReduction as ZeroReductionData } from '../../lib/monitoring/bi';
import { BI_KB, biKbProps } from '../../lib/monitoring/bi-kb';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { methodLabel } from '../../lib/monitoring/stage-labels';
import {
  getAxisColor, getChartColor, getGridColor, getSeverityColor, getTooltipStyle,
} from '../../lib/chart-colors';
import { useTheme } from '../ThemeProvider';
import { KBTooltip } from '../ui/kb-tooltip';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';
import { RULE_ROW_TOP, TILE } from './surfaces';

export interface ZeroReductionProps {
  zero: ZeroReductionData;
  periodLabel: string;
  /** Клик — разрез реестра корзиной «снижения не было» (п.119). */
  onPickZeroBucket?: () => void;
  /** Клик по способу — разрез реестра тем же способом. */
  onPickMethod?: (method: string) => void;
  /** Клик по управлению — разрез реестра его листом. */
  onPickDept?: (dept: string) => void;
}

export function ZeroReductionCard({
  zero, periodLabel, onPickZeroBucket, onPickMethod, onPickDept,
}: ZeroReductionProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const tooltip = getTooltipStyle(isDark);

  const bars = [
    {
      key: 'count',
      label: 'доля в процедурах',
      pct: zero.countSharePct ?? 0,
      note: `${fmtCount(zero.zeroCount)} из ${fmtCount(zero.pricedCount)} процедур`,
    },
    {
      key: 'money',
      label: 'доля в деньгах',
      pct: zero.moneySharePct ?? 0,
      note: `${fmtRub(zero.zeroNmckRub)} из ${fmtRub(zero.pricedNmckRub)} руб.`,
    },
  ];

  const gap = zero.moneySharePct !== null && zero.countSharePct !== null
    ? zero.moneySharePct - zero.countSharePct
    : null;

  const title = zero.countSharePct === null
    ? 'Торги без снижения цены'
    : `${fmtPct(zero.countSharePct, 0)} состоявшихся торгов прошли без единого шага снижения`;

  return (
    <AnalyticsCard
      kicker="Где риск · нулевое снижение"
      title={title}
      periodLabel={periodLabel}
      method={(
        <>
          Знаменатель — состоявшиеся процедуры, у которых заполнены и начальная цена, и цена
          аукциона. В числителе — те, где цена в точности равна начальной. Несостоявшиеся (цена
          ровно ноль) в счёт не входят: там цены нет вовсе, а не нулевое снижение. Доля считается
          дважды — в процедурах и в деньгах, и эти два числа не обязаны совпадать.
        </>
      )}
    >
      {zero.pricedCount === 0 ? (
        <CardEmpty>
          Состоявшихся процедур с обеими суммами в этом срезе нет, поэтому долю бесторговых считать
          не от чего. Это пустой знаменатель, а не «все торговались».
        </CardEmpty>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <KBTooltip {...biKbProps(BI_KB.zero_reduction)} showIcon>
              <div className={`${TILE} p-3 text-left`}>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Процедур без снижения</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {fmtCount(zero.zeroCount)}
                </p>
                <p className="mt-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  из {fmtCount(zero.pricedCount)} состоявшихся · {fmtPct(zero.countSharePct)}
                </p>
              </div>
            </KBTooltip>

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Их начальные цены</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {fmtRub(zero.zeroNmckRub)}
              </p>
              <p className="mt-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                руб. · {fmtPct(zero.moneySharePct)} денег состоявшихся
              </p>
            </div>

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Разрыв двух долей</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {gap === null ? '—' : `${gap > 0 ? '+' : ''}${fmtPct(gap)}`}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                деньги минус счёт — крупнее ли средней бесторговая закупка
              </p>
            </div>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {gap === null
              ? 'Сравнить две доли не из чего.'
              : gap > 2
                ? `Доля в деньгах выше доли в счёте на ${fmtPct(gap)}: без торга прошли закупки крупнее средней. Начальная цена таких закупок ничем, кроме расчёта заказчика, не проверена — на торгах её никто не подвинул.`
                : gap < -2
                  ? `Доля в деньгах ниже доли в счёте на ${fmtPct(Math.abs(gap))}: без торга проходят закупки мельче средней, а крупные торгуются. Для риска начальной цены это лучший расклад из возможных.`
                  : 'Доли в счёте и в деньгах почти совпали: бесторговые закупки по размеру не отличаются от остальных.'}
          </p>

          {/* ── Две доли рядом ── */}
          <div className="mt-3 h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={bars}
                layout="vertical"
                margin={{ top: 8, right: 16, bottom: 20, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                  height={30}
                  label={{
                    value: 'доля бесторговых, %',
                    position: 'insideBottom', offset: -4,
                    style: { fontSize: 9, fill: getAxisColor(isDark) },
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                  width={112}
                />
                <RechartsTooltip
                  {...tooltip}
                  formatter={(v: number, _n: string, item: { payload?: { note?: string } }) => [
                    `${fmtPct(v)} — ${item.payload?.note ?? ''}`, 'без снижения',
                  ]}
                />
                <Bar
                  dataKey="pct"
                  radius={[0, 3, 3, 0]}
                  cursor={onPickZeroBucket !== undefined ? 'pointer' : undefined}
                  onClick={() => onPickZeroBucket?.()}
                >
                  {bars.map((b) => (
                    <Cell
                      key={b.key}
                      fill={b.key === 'money' ? getChartColor(0, isDark) : getSeverityColor('info', isDark)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {onPickZeroBucket !== undefined && (
            <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              Клик по полосе ставит реестру выше разрез «снижения не было» — видно сами строки за
              числом.
            </p>
          )}

          {/* ── Разбивка по способу: она и объясняет большую часть нулей ── */}
          <h4 className="mt-4 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
            Откуда берутся нули: разрез по способу определения поставщика
          </h4>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            У закупки у единственного поставщика снижения нет по природе способа. Доля внутри способа
            показывает, насколько «нулевой» именно этот способ, а не сколько нулей он дал книге.
          </p>
          <SplitTable
            rows={zero.byMethod}
            headName="Способ"
            describe={(key) => methodLabel(key === '—' ? null : key)}
            {...(onPickMethod !== undefined ? { onPick: onPickMethod } : {})}
          />

          {/* ── Разбивка по управлениям ── */}
          <h4 className="mt-4 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
            Где нули лежат: разрез по управлениям
          </h4>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Управление с высокой долей внутри себя — не нарушитель: доля объясняется набором способов
            и предметов его закупок. Это адрес для разговора, а не оценка.
          </p>
          <SplitTable
            rows={zero.byDept}
            headName="Управление"
            describe={() => null}
            {...(onPickDept !== undefined ? { onPick: onPickDept } : {})}
          />
        </>
      )}
    </AnalyticsCard>
  );
}

function SplitTable({
  rows, headName, describe, onPick,
}: {
  rows: readonly { key: string; label: string; count: number; nmckRub: number; sharePct: number | null }[];
  headName: string;
  describe: (key: string) => string | null;
  onPick?: (key: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <CardEmpty>
        Ни одной бесторговой процедуры в этом разрезе нет — все состоявшиеся торги дали хотя бы шаг
        снижения.
      </CardEmpty>
    );
  }
  return (
    <div className="mt-1.5 overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-zinc-500 dark:text-zinc-400">
            <th className="py-1 pr-2 font-normal">{headName}</th>
            <th className="py-1 pr-2 text-right font-normal">Без снижения</th>
            <th className="py-1 pr-2 text-right font-normal">Их начальные цены, руб.</th>
            <th className="py-1 text-right font-normal">Доля внутри группы</th>
          </tr>
        </thead>
        <tbody className="text-zinc-700 dark:text-zinc-200">
          {rows.map((r) => {
            const note = describe(r.key);
            return (
              <tr key={r.key} className={RULE_ROW_TOP}>
                <td className="py-1 pr-2">
                  {onPick === undefined ? (
                    <span className="font-medium">{r.label}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onPick(r.key)}
                      className="font-medium underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:hover:text-white"
                    >
                      {r.label}
                    </button>
                  )}
                  {note !== null && (
                    <span className="ml-1 text-zinc-500 dark:text-zinc-400">— {note}</span>
                  )}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {pluralCount(r.count, 'процедура', 'процедуры', 'процедур')}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(r.nmckRub)}</td>
                <td className="py-1 text-right tabular-nums">{fmtPct(r.sharePct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
