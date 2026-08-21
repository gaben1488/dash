/**
 * «Где деньги» — совместные закупки против одиночных (разрез витрины §5).
 *
 * ЧТО ЗА ВОПРОС. Совместная закупка собирает спрос нескольких заказчиков в
 * один лот: считается, что крупный лот интереснее поставщику и потому лучше
 * торгуется. Разрез проверяет это утверждение на живых числах книги, а не
 * принимает его на веру.
 *
 * СРАВНЕНИЕ ПОРТФЕЛЬНОЕ, ДЕНЬГИ НА ДЕНЬГИ. Совместных строк на порядок
 * меньше, и среднее построчных процентов у них шумит: одна крупная строка
 * перевешивает всё. Вопрос звучит «сколько сэкономил рубль, прошедший через
 * совместный лот», а не «как торговалась средняя строка».
 *
 * ГЛАВНАЯ ОГОВОРКА ЭТОГО РАЗРЕЗА — ДВОЙНОЙ СЧЁТ. Одна совместная процедура
 * штатно записана на листах ВСЕХ участвующих управлений, по строке на
 * управление. Её начальная цена входит в сумму книги столько раз, сколько
 * листов её несут, и сумма листов не сходится с итогом свода именно поэтому.
 * Разрез это не исправляет — он читает книгу как она есть и говорит о
 * двойном счёте словами: тихая «починка» суммы была бы подлогом.
 */
import {
  Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import type { JointComparison } from '../../lib/monitoring/bi';
import { BI_KB, biKbProps } from '../../lib/monitoring/bi-kb';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import {
  getAxisColor, getChartColor, getGridColor, getTooltipStyle,
} from '../../lib/chart-colors';
import { useTheme } from '../ThemeProvider';
import { KBTooltip } from '../ui/kb-tooltip';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';
import { RULE_ROW_TOP, TILE } from './surfaces';

export interface JointPurchasesProps {
  comparison: JointComparison;
  periodLabel: string;
  /** Клик по стороне «совместные» — разрез реестра совместным аукционом. */
  onPickJoint?: () => void;
  /** Клик по управлению — разрез реестра его листом. */
  onPickDept?: (dept: string) => void;
}

export function JointPurchasesCard({
  comparison, periodLabel, onPickJoint, onPickDept,
}: JointPurchasesProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const tooltip = getTooltipStyle(isDark);
  const { joint, solo } = comparison;

  const bars = [
    { key: 'joint', label: 'совместные', pct: joint.reductionPct, count: joint.count },
    { key: 'solo', label: 'одиночные', pct: solo.reductionPct, count: solo.count },
  ].filter((b) => b.pct !== null) as { key: string; label: string; pct: number; count: number }[];

  const title = joint.count === 0
    ? 'Совместных закупок в этом срезе нет'
    : joint.reductionPct === null || solo.reductionPct === null
      ? `Совместные лоты держат ${fmtPct(comparison.jointMoneySharePct, 0)} денег книги`
      : joint.reductionPct < solo.reductionPct
        ? `Крупный совместный лот торгуется хуже одиночного: ${fmtPct(joint.reductionPct)} против ${fmtPct(solo.reductionPct)}`
        : `Совместный лот торгуется лучше одиночного: ${fmtPct(joint.reductionPct)} против ${fmtPct(solo.reductionPct)}`;

  return (
    <AnalyticsCard
      kicker="Где деньги · совместные лоты"
      title={title}
      periodLabel={periodLabel}
      method={(
        <>
          Сторона «совместные» — строки, отмеченные признаком совместной закупки: способ «электронный
          аукцион совместный» либо заказчик-признак «Совместный …». Снижение считается портфельно:
          сумма начальных цен минус сумма цен аукционов, делённая на сумму начальных цен, по
          состоявшимся процедурам с обеими суммами.
        </>
      )}
    >
      {joint.count === 0 && solo.count === 0 ? (
        <CardEmpty>
          В этом срезе нет ни одной строки, поэтому сравнивать совместные с одиночными не из чего.
        </CardEmpty>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <KBTooltip {...biKbProps(BI_KB.joint_purchases)} showIcon>
              <div className={`${TILE} p-3 text-left`}>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Совместных процедур</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {fmtCount(joint.count)}
                </p>
                <p className="mt-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  {fmtPct(comparison.jointCountSharePct)} строк книги
                </p>
              </div>
            </KBTooltip>

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Их доля в деньгах</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {fmtPct(comparison.jointMoneySharePct)}
              </p>
              <p className="mt-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                {fmtRub(joint.nmckRub)} руб. начальных цен
              </p>
            </div>

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Средний совместный лот</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {fmtRub(joint.avgNmckRub)}
              </p>
              <p className="mt-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                руб. · одиночный — {fmtRub(solo.avgNmckRub)} руб.
              </p>
            </div>

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Экономия совместных</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {fmtRub(joint.reductionRub)}
              </p>
              <p className="mt-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                руб. · одиночные — {fmtRub(solo.reductionRub)} руб.
              </p>
            </div>
          </div>

          {/* ── Две стороны рядом ── */}
          {bars.length === 0 ? (
            <CardEmpty>
              Ни у одной стороны нет состоявшихся процедур с обеими суммами, поэтому портфельное
              снижение считать не от чего. Это пустой знаменатель, а не нулевое снижение.
            </CardEmpty>
          ) : (
            <div className="mt-3 h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={bars}
                  layout="vertical"
                  margin={{ top: 8, right: 16, bottom: 22, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                    height={30}
                    label={{
                      value: 'портфельное снижение, %',
                      position: 'insideBottom', offset: -4,
                      style: { fontSize: 9, fill: getAxisColor(isDark) },
                    }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                    width={92}
                  />
                  <RechartsTooltip
                    {...tooltip}
                    formatter={(v: number, _n: string, item: { payload?: { count?: number } }) => [
                      `${fmtPct(v)} по ${pluralCount(item.payload?.count ?? 0, 'процедуре', 'процедурам', 'процедурам')}`,
                      'снижение',
                    ]}
                  />
                  <Bar
                    dataKey="pct"
                    radius={[0, 3, 3, 0]}
                    cursor={onPickJoint !== undefined ? 'pointer' : undefined}
                    onClick={(d: { key?: string }) => {
                      if (onPickJoint !== undefined && d.key === 'joint') onPickJoint();
                    }}
                  >
                    {bars.map((b, i) => (
                      <Cell key={b.key} fill={getChartColor(b.key === 'joint' ? 2 : i, isDark)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {onPickJoint !== undefined && (
            <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              Клик по полосе «совместные» ставит реестру выше разрез способом «совместный аукцион» —
              видно сами строки за числом.
            </p>
          )}

          {/* ── Двойной счёт: главная оговорка разреза, сказанная словами ── */}
          <p className="mt-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            Одна совместная процедура записана на листах всех участвующих управлений — по строке на
            управление. Её начальная цена входит в сумму листов столько раз, сколько листов её несут,
            и сумма листов расходится с итогом свода книги именно поэтому. Витрина этого не
            исправляет: она читает книгу как есть, а расхождение разбирает лист «СВОДНЫЙ».
          </p>

          {/* ── Где лежат совместные строки ── */}
          {comparison.jointByDept.length > 0 && (
            <>
              <h4 className="mt-4 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                На чьих листах лежат совместные строки
              </h4>
              <div className="mt-1.5 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <caption className="sr-only">Совместные закупки в разрезе управлений</caption>
                  <thead>
                    <tr className="text-left text-zinc-500 dark:text-zinc-400">
                      <th className="py-1 pr-2 font-normal">Управление</th>
                      <th className="py-1 pr-2 text-right font-normal">Совместных строк</th>
                      <th className="py-1 text-right font-normal">Начальные цены, руб.</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-700 dark:text-zinc-200">
                    {comparison.jointByDept.map((d) => (
                      <tr key={d.dept} className={RULE_ROW_TOP}>
                        <td className="py-1 pr-2">
                          {onPickDept === undefined ? d.dept : (
                            <button
                              type="button"
                              onClick={() => onPickDept(d.dept)}
                              className="underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:hover:text-white"
                            >
                              {d.dept}
                            </button>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(d.count)}</td>
                        <td className="py-1 text-right tabular-nums">{fmtRub(d.nmckRub)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </AnalyticsCard>
  );
}
