/**
 * «Где затык» — переходящий хвост прошлогодней нумерации (разрез витрины §4).
 *
 * ЧТО ЗА ВОПРОС. Книга мониторинга переходящая: в ней рядом лежат процедуры
 * двух лет нумерации, и лист «25-26» существует именно поэтому. Пока доля
 * прошлогодних номеров не названа, любой разговор об итогах текущего года
 * смешивает две разные работы — начатую в этом году и доставшуюся по
 * наследству.
 *
 * ГОД БЕРЁТСЯ ИЗ КОДА, А НЕ ИЗ ДАТЫ, и это главная тонкость разреза. У
 * переходящей процедуры дата публикации уже нового года — по датам хвост не
 * виден вовсе. Поэтому число здесь НЕ обязано сходиться с сезонностью,
 * которая считается по датам, и карточка базы знаний говорит об этом прямо.
 *
 * СТРОКА БЕЗ КОДА — НЕ ПРОШЛЫЙ ГОД. Она показана отдельной группой: приписать
 * ей год значило бы выдумать, а выдумывать витрина не имеет права.
 *
 * ХВОСТ САМ ПО СЕБЕ НЕ ЗАТЫК. Часть переходящих процедур закрыта в первые же
 * недели года — это нормальный ход. Затык виден только вместе со стадией,
 * поэтому у каждого года стоит разбивка по стадиям, а не один счётчик.
 */
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import type { CarryOver as CarryOverData } from '../../lib/monitoring/bi';
import { BI_KB, biKbProps } from '../../lib/monitoring/bi-kb';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import { STAGE_ORDER, stageLabel } from '../../lib/monitoring/stage-labels';
import {
  getAxisColor, getChartColor, getGridColor, getTooltipStyle,
} from '../../lib/chart-colors';
import { useTheme } from '../ThemeProvider';
import { KBTooltip } from '../ui/kb-tooltip';
import { AnalyticsCard, CardEmpty } from './AnalyticsCard';
import { RULE_ROW_TOP, TILE } from './surfaces';

export interface CarryOverProps {
  carry: CarryOverData;
  periodLabel: string;
  /** Клик по году — разрез реестра годом процедуры (п.119). */
  onPickYear?: (year: number) => void;
}

export function CarryOverCard({ carry, periodLabel, onPickYear }: CarryOverProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const tooltip = getTooltipStyle(isDark);

  const bars = carry.rows.map((r) => ({
    key: r.year,
    label: yearLabel(r.year),
    count: r.count,
    nmckMln: r.nmckRub / 1_000_000,
    isCarried: r.year !== null && carry.currentYear !== null && r.year < carry.currentYear,
  }));

  const title = carry.carriedCountSharePct === null || carry.carriedCount === 0
    ? 'Годы нумерации в переходящей книге'
    : `${fmtPct(carry.carriedCountSharePct, 0)} строк книги — процедуры прошлогодней нумерации, и это ${fmtPct(carry.carriedMoneySharePct, 0)} её денег`;

  return (
    <AnalyticsCard
      kicker="Где затык · переходящий хвост"
      title={title}
      periodLabel={periodLabel}
      method={(
        <>
          Год берётся из суффикса кода процедуры: «ЭА152-26» — год 26. Самый свежий год книги
          считается текущим, всё, что старше, — переходящий хвост. Строки, где код не разобрался, в
          хвост не записываются: год им не приписывают, они показаны отдельной группой. По датам
          хвост не виден вовсе — у переходящей процедуры дата публикации уже нового года.
        </>
      )}
    >
      {carry.rows.length === 0 ? (
        <CardEmpty>
          В этом срезе нет ни одной строки, поэтому годов нумерации не из чего выводить. Это пустая
          книга на данном участке, а не отсутствие переходящих процедур.
        </CardEmpty>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <KBTooltip {...biKbProps(BI_KB.carry_over)} showIcon>
              <div className={`${TILE} p-3 text-left`}>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Прошлогодних процедур</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {fmtCount(carry.carriedCount)}
                </p>
                <p className="mt-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  {fmtPct(carry.carriedCountSharePct)} строк книги
                </p>
              </div>
            </KBTooltip>

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Их начальные цены</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {fmtRub(carry.carriedNmckRub)}
              </p>
              <p className="mt-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                руб. · {fmtPct(carry.carriedMoneySharePct)} денег книги
              </p>
            </div>

            <div className={`${TILE} p-3`}>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Год без кода</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                {fmtCount(carry.unknownYearCount)}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {pluralCount(carry.unknownYearCount, 'строка', 'строки', 'строк')} без разобранного
                кода — год неизвестен, а не «прошлый»
              </p>
            </div>
          </div>

          {carry.carriedCount > 0 && carry.carriedMoneySharePct !== null
            && carry.carriedCountSharePct !== null && (
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
              {carry.carriedMoneySharePct > carry.carriedCountSharePct + 2
                ? `Наследство весит больше своего счёта: ${fmtPct(carry.carriedCountSharePct)} строк держат ${fmtPct(carry.carriedMoneySharePct)} денег — переходят преимущественно крупные закупки.`
                : carry.carriedMoneySharePct < carry.carriedCountSharePct - 2
                  ? `Переходят преимущественно мелкие закупки: ${fmtPct(carry.carriedCountSharePct)} строк дают лишь ${fmtPct(carry.carriedMoneySharePct)} денег.`
                  : 'Переходящие закупки по размеру не отличаются от остальных: доли в счёте и в деньгах совпали.'}
            </p>
          )}

          {/* ── Столбцы по годам ── */}
          <div className="mt-3 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 26, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                  interval={0}
                  height={30}
                  label={{
                    value: 'год нумерации процедуры',
                    position: 'insideBottom', offset: -6,
                    style: { fontSize: 9, fill: getAxisColor(isDark) },
                  }}
                />
                <YAxis
                  yAxisId="count"
                  tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                  width={34}
                  label={{
                    value: 'процедур',
                    angle: -90, position: 'insideLeft',
                    style: { fontSize: 9, fill: getAxisColor(isDark) },
                  }}
                />
                <YAxis
                  yAxisId="money"
                  orientation="right"
                  tick={{ fontSize: 10, fill: getAxisColor(isDark) }}
                  width={46}
                  label={{
                    value: 'начальные цены, млн ₽',
                    angle: 90, position: 'insideRight',
                    style: { fontSize: 9, fill: getAxisColor(isDark) },
                  }}
                />
                <RechartsTooltip
                  {...tooltip}
                  formatter={(v: number, name: string) => (
                    name === 'начальные цены'
                      ? [`${fmtRub(v * 1_000_000)} руб.`, 'начальные цены']
                      : [fmtCount(v), 'процедур']
                  )}
                />
                <Bar
                  yAxisId="count"
                  dataKey="count"
                  name="процедур"
                  fill={getChartColor(0, isDark)}
                  radius={[3, 3, 0, 0]}
                  cursor={onPickYear !== undefined ? 'pointer' : undefined}
                  onClick={(d: { key?: number | null }) => {
                    if (onPickYear !== undefined && typeof d.key === 'number') onPickYear(d.key);
                  }}
                />
                <Bar
                  yAxisId="money"
                  dataKey="nmckMln"
                  name="начальные цены"
                  fill={getChartColor(3, isDark)}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {onPickYear !== undefined && (
            <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              Клик по столбу «процедур» ставит реестру выше разрез «год процедуры» — видно сами
              строки за числом.
            </p>
          )}

          {/* ── Стадии внутри года: без них хвост не отличить от затыка ── */}
          <h4 className="mt-4 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
            Что с этими процедурами сейчас
          </h4>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Прошлогодняя строка, дошедшая до договора, — нормальный переход. Прошлогодняя строка без
            итога торгов — вопрос к управлению.
          </p>
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full text-[11px]">
              <caption className="sr-only">Стадии процедур по годам нумерации</caption>
              <thead>
                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 font-normal">Год</th>
                  <th className="py-1 pr-2 text-right font-normal">Процедур</th>
                  <th className="py-1 pr-2 text-right font-normal">Начальные цены, руб.</th>
                  <th className="py-1 font-normal">Стадии</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-200">
                {carry.rows.map((r) => (
                  <tr key={String(r.year)} className={RULE_ROW_TOP}>
                    <td className="py-1 pr-2">
                      {onPickYear === undefined || r.year === null ? yearLabel(r.year) : (
                        <button
                          type="button"
                          onClick={() => onPickYear(r.year as number)}
                          className="underline decoration-dotted underline-offset-2 hover:text-zinc-900 dark:hover:text-white"
                        >
                          {yearLabel(r.year)}
                        </button>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(r.count)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(r.nmckRub)}</td>
                    <td className="py-1 text-zinc-600 dark:text-zinc-300">
                      {STAGE_ORDER
                        .filter((s) => (r.byStage[s] ?? 0) > 0)
                        .map((s) => `${stageLabel(s).toLowerCase()} — ${fmtCount(r.byStage[s] ?? 0)}`)
                        .join('; ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Где хвост лежит ── */}
          {carry.carriedCount > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
              Хвост лежит на листах:{' '}
              {carry.rows
                .filter((r) => r.year !== null && carry.currentYear !== null && r.year < carry.currentYear)
                .flatMap((r) => r.byDept)
                .map((d) => `${d.dept} — ${fmtCount(d.count)}`)
                .join('; ')}
              .
            </p>
          )}
        </>
      )}
    </AnalyticsCard>
  );
}

/** Год кода на экране — двузначный, как он и записан в книге. */
function yearLabel(year: number | null): string {
  return year === null ? 'код не разобран' : `20${String(year).padStart(2, '0')}`;
}
