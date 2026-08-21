/**
 * Сравнение управлений по нормированным величинам (спека §3.7).
 *
 * ПОЧЕМУ НОРМИРОВАННЫЕ, А НЕ СУММЫ. У одного управления сто с лишним
 * процедур, у другого четыре. Любой столбик абсолютных сумм назовёт «лучшим»
 * самое большое управление и «худшим» самое маленькое — то есть не скажет
 * ничего. Доли и медианы сравнимы между собой независимо от размера.
 *
 * ЭТО НЕ ОЦЕНКА И НЕ РЕЙТИНГ (п.104). Крайние значения почти всегда
 * объясняются предметом закупок: управление, приобретающее квартиры, не
 * может показать снижение, потому что снижения там нет по природе предмета.
 * Поэтому у каждой величины стоит подпись «что означает высокое значение», и
 * ни одна не окрашена в «хорошо / плохо».
 *
 * УПРАВЛЕНИЕ БЕЗ ВЕЛИЧИНЫ ОСТАЁТСЯ В РЯДУ с прочерком: молча выпавшая
 * строка читалась бы как «такого управления нет».
 */
import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import type { DeptComparisonRow } from '../../lib/monitoring/analytics-contract';
import { DEPT_METRICS, deptBars, type DeptMetricKey } from '../../lib/monitoring/charts';
import { fmtCount, fmtDays, fmtPct, fmtRub } from '../../lib/monitoring/format';
import {
  getAxisColor, getChartColor, getGridColor, getTooltipStyle,
} from '../../lib/chart-colors';
import { useTheme } from '../ThemeProvider';
import { AnalyticsCard, CardEmpty, CardToggle } from './AnalyticsCard';
import { buildDrill } from '../../lib/drill';
import { RULE_ROW_TOP } from './surfaces';

export interface DeptCompareProps {
  depts: DeptComparisonRow[];
  periodLabel: string;
  /**
   * Провал по управлению. Цель перехода строит `lib/drill.ts` (механизм М14),
   * а не место клика: пока цель собиралась руками, каждое место помнило про
   * свою ось и молча теряло остальные. Здесь ось одна — управление, — но
   * доехать она обязана вместе с рассказом о том, ЧЕГО в цели не будет.
   */
  onPickDept?: (dept: string) => void;
}

export function DeptCompare({ depts, periodLabel, onPickDept }: DeptCompareProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const [metricKey, setMetricKey] = useState<DeptMetricKey>('reductionPct');
  const metric = DEPT_METRICS.find((m) => m.key === metricKey) ?? DEPT_METRICS[0]!;
  const rows = deptBars(depts, metricKey);
  const tooltip = getTooltipStyle(isDark);

  const withValue = rows.filter((r) => r.value !== null);
  const fmtValue = (v: number | null): string => (
    metric.unit === '%' ? fmtPct(v) : fmtDays(v)
  );

  return (
    <AnalyticsCard
      kicker="Сравнение управлений"
      title={
        withValue.length === 0
          ? 'Сравнивать управления по этой величине не из чего'
          : `${metric.label}: от ${fmtValue(withValue[withValue.length - 1]!.value)} до ${fmtValue(withValue[0]!.value)}`
      }
      periodLabel={periodLabel}
      controls={DEPT_METRICS.map((m) => (
        <CardToggle
          key={m.key}
          active={m.key === metricKey}
          onClick={() => setMetricKey(m.key)}
          title={m.meaning}
        >
          {m.label}
        </CardToggle>
      ))}
      method={metric.meaning}
    >
      {rows.length === 0 ? (
        <CardEmpty>
          Строк ни одного управления в этом срезе нет. Это пустая выборка, а не отсутствие
          управлений в книге.
        </CardEmpty>
      ) : (
        <>
          <div className="hidden sm:block h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} vertical={false} />
                <XAxis dataKey="dept" tick={{ fontSize: 9, fill: getAxisColor(isDark) }} interval={0} height={30} />
                <YAxis tick={{ fontSize: 10, fill: getAxisColor(isDark) }} width={38} />
                <RechartsTooltip
                  {...tooltip}
                  formatter={(v: number) => [fmtValue(v), metric.label]}
                />
                <Bar dataKey="value" fill={getChartColor(2, isDark)} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <caption className="sr-only">Управления в сравнении по выбранной величине</caption>
              <thead>
                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 font-normal">Управление</th>
                  <th className="py-1 pr-2 text-right font-normal">Процедур</th>
                  <th className="py-1 pr-2 text-right font-normal">Начальные цены, руб.</th>
                  <th className="py-1 text-right font-normal">{metric.label}</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-200">
                {rows.map((r) => (
                  <tr key={r.dept} className={RULE_ROW_TOP}>
                    <td className="py-1 pr-2">
                      {onPickDept === undefined ? r.dept : (
                        <button
                          type="button"
                          onClick={() => onPickDept(r.dept)}
                          title={drillHintFor(r.dept)}
                          className="text-left font-medium hover:underline"
                        >
                          {r.dept}
                        </button>
                      )}
                      <span className="ml-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                        лист «{r.sheet}»
                      </span>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(r.count)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(r.nmckRub)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {r.value === null ? 'считать не из чего' : fmtValue(r.value)}
                    </td>
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

/**
 * Подсказка провала одной фразой: что откроется и чего в цели не будет.
 * Считает её `buildDrill`, а не эта кнопка: у перехода в Мониторинг свои
 * правила — год, квартал и способ едут МЕСТНЫМ отбором вкладки, а не отбором
 * шапки, — и знать их месту клика не нужно и вредно (второе знание разошлось
 * бы с первым).
 */
function drillHintFor(dept: string): string {
  const target = buildDrill({ dept }, 'monitoring');
  return target.warning === ''
    ? `Показать только это управление. ${target.summary}`
    : `Показать только это управление. ${target.summary} ${target.warning}`;
}
