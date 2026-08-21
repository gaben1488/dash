/**
 * «Где деньги» — концентрация начальных цен по заказчикам (разрез витрины §1).
 *
 * ПОЧЕМУ ЭТО ПЕРВЫЙ ВОПРОС РУКОВОДИТЕЛЯ. Средний процент снижения по району —
 * это на деле средневзвешенное по горстке крупных заказчиков: пока пять
 * учреждений держат больше половины денег, разговор «как торгуемся» без
 * разговора «у кого деньги» беспредметен.
 *
 * ФОРМА — КРИВАЯ ПАРЕТО, А НЕ СТОЛБИКИ. Столбики отвечают «сколько у каждого»,
 * кривая накопленной доли отвечает «сколько нужно взять сверху, чтобы набрать
 * половину», а это и есть вопрос концентрации. Обе величины на одной оси
 * жить не могут — у столбиков рубли, у кривой проценты, поэтому осей две, и
 * у каждой стоит подпись с единицей.
 *
 * ИМЕНА НЕ СКЛЕИВАЮТСЯ. Одно учреждение, записанное в книге двумя способами,
 * даёт две строки — так же, как в реестре, куда ведёт клик. Витрина не имеет
 * права обещать больше строк, чем читатель увидит, провалившись в основания.
 */
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import type { CustomerConcentration } from '../../lib/monitoring/bi';
import { BI_KB, biKbProps } from '../../lib/monitoring/bi-kb';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { getAxisColor, getChartColor, getGridColor, getTooltipStyle } from '../../lib/chart-colors';
import { useTheme } from '../ThemeProvider';
import { KBTooltip } from '../ui/kb-tooltip';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';
import { RULE_ROW_TOP, TILE } from './surfaces';

/** Сколько заказчиков рисуем: дальше кривая ложится и столбики не читаются. */
const SHOWN = 12;

export interface CustomerWeightProps {
  concentration: CustomerConcentration;
  periodLabel: string;
  /** Клик по заказчику — разрез реестра тем же написанием (п.119). */
  onPickCustomer?: (customer: string) => void;
}

export function CustomerWeight({ concentration, periodLabel, onPickCustomer }: CustomerWeightProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const tooltip = getTooltipStyle(isDark);
  const rows = concentration.rows.slice(0, SHOWN);

  const bars = rows.map((r) => ({
    key: r.customer,
    label: shortName(r.customer),
    nmckMln: r.nmckRub / 1_000_000,
    cumulativePct: r.cumulativePct,
    count: r.count,
  }));

  const half = concentration.customersForHalf;
  const title = half === null || concentration.customersTotal === 0
    ? 'Концентрация закупок по заказчикам'
    : `Половину денег книги набирают ${pluralCount(half, 'заказчик', 'заказчика', 'заказчиков')} из ${fmtCount(concentration.customersTotal)}`;

  return (
    <AnalyticsCard
      kicker="Где деньги · заказчики"
      title={title}
      periodLabel={periodLabel}
      method={(
        <>
          Строки реестра сложены по заказчику; сумма — начальные цены. Доля считается от начальных
          цен всей книги, накопленная доля читается сверху вниз. Заказчики группируются по написанию
          книги: одно учреждение, записанное двумя способами, даёт две строки — ровно так же, как в
          реестре, куда ведёт клик.
        </>
      )}
    >
      {concentration.customersTotal === 0 ? (
        <CardEmpty>
          В этом срезе нет ни одной строки с заказчиком, поэтому концентрацию считать не от чего.
          Это пустой знаменатель, а не нулевая концентрация.
        </CardEmpty>
      ) : (
        <>
          {/* ── Четыре числа концентрации ── */}
          <div className="grid gap-2 sm:grid-cols-4">
            <KBTooltip {...biKbProps(BI_KB.customer_concentration)} showIcon>
              <div className={`${TILE} p-3 text-left`}>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Заказчиков в книге</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {fmtCount(concentration.customersTotal)}
                </p>
                <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                  по написанию колонки «Заказчик»
                </p>
              </div>
            </KBTooltip>

            <ShareTile
              title="Доля топ-5"
              value={concentration.topShares.top5}
              note="пять крупнейших заказчиков в начальных ценах"
            />
            <ShareTile
              title="Доля топ-10"
              value={concentration.topShares.top10}
              note="десять крупнейших в начальных ценах"
            />

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Медианный заказчик</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {fmtRub(concentration.medianCustomerRub)}
              </p>
              <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                руб. начальных цен — против средней по району
              </p>
            </div>
          </div>

          {/* ── Кривая Парето ── */}
          <div className="mt-3 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bars} margin={{ top: 8, right: 44, bottom: 56, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: getAxisColor(isDark) }}
                  interval={0}
                  angle={-32}
                  textAnchor="end"
                  height={58}
                />
                <YAxis
                  yAxisId="money"
                  tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                  width={46}
                  label={{
                    value: 'начальные цены, млн ₽',
                    angle: -90, position: 'insideLeft',
                    style: { fontSize: 9, fill: getAxisColor(isDark) },
                  }}
                />
                <YAxis
                  yAxisId="share"
                  orientation="right"
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                  width={38}
                  label={{
                    value: 'накопленная доля, %',
                    angle: 90, position: 'insideRight',
                    style: { fontSize: 9, fill: getAxisColor(isDark) },
                  }}
                />
                <RechartsTooltip
                  {...tooltip}
                  formatter={(v: number, name: string) => (
                    name === 'накопленная доля'
                      ? [fmtPct(v), 'накопленная доля']
                      : [`${fmtRub(v * 1_000_000)} руб.`, 'начальные цены']
                  )}
                />
                <Bar
                  yAxisId="money"
                  dataKey="nmckMln"
                  name="начальные цены"
                  fill={getChartColor(0, isDark)}
                  radius={[3, 3, 0, 0]}
                  cursor={onPickCustomer !== undefined ? 'pointer' : undefined}
                  onClick={(d: { key?: string }) => {
                    if (onPickCustomer !== undefined && typeof d.key === 'string') onPickCustomer(d.key);
                  }}
                />
                <Line
                  yAxisId="share"
                  type="monotone"
                  dataKey="cumulativePct"
                  name="накопленная доля"
                  stroke={getChartColor(3, isDark)}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {onPickCustomer !== undefined && (
            <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              Клик по столбу ставит реестру выше разрез «Заказчик» тем же написанием — видно сами
              строки за числом.
            </p>
          )}

          {/* Текстовый дубль: печать бывает чёрно-белой, а часть читателей не
              различает тона. Числа обязаны быть словами тоже. */}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <caption className="sr-only">Заказчики по начальным ценам книги мониторинга</caption>
              <thead>
                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 font-normal">Заказчик</th>
                  <th className="py-1 pr-2 text-right font-normal">Процедур</th>
                  <th className="py-1 pr-2 text-right font-normal">Начальные цены, руб.</th>
                  <th className="py-1 pr-2 text-right font-normal">Доля</th>
                  <th className="py-1 text-right font-normal">Накопленная доля</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-200">
                {rows.map((r) => (
                  <tr key={r.customer} className={RULE_ROW_TOP}>
                    <td className="py-1 pr-2">
                      {onPickCustomer === undefined ? r.customer : (
                        <button
                          type="button"
                          onClick={() => onPickCustomer(r.sliceKey)}
                          className="text-left underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:hover:text-white"
                        >
                          {r.customer}
                        </button>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(r.count)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(r.nmckRub)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtPct(r.sharePct)}</td>
                    <td className="py-1 text-right tabular-nums">{fmtPct(r.cumulativePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {concentration.customersTotal > SHOWN && (
            <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              Показаны {SHOWN} крупнейших из {fmtCount(concentration.customersTotal)}; остальные
              видны в реестре разрезом «Заказчик». Ни один заказчик не выброшен — обрезан только
              показ.
            </p>
          )}
        </>
      )}
    </AnalyticsCard>
  );
}

function ShareTile({ title, value, note }: { title: string; value: number | null; note: string }) {
  return (
    <div className={`${TILE} p-3`}>
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{title}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
        {fmtPct(value)}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">{note}</p>
    </div>
  );
}

/** Подпись оси: длинное имя учреждения на оси не читается ни в одной ширине. */
function shortName(name: string): string {
  return name.length <= 22 ? name : `${name.slice(0, 21)}…`;
}
