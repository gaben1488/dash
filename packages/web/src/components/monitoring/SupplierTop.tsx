/**
 * Поставщики-победители: топ по деньгам и по числу побед, концентрация рынка
 * и доля тех, кто выиграл единственный раз (спека §3.3).
 *
 * ДВЕ ВЕЛИЧИНЫ, А НЕ ОДНА. «Кто выигрывает чаще» и «кто забирает больше
 * денег» — разные списки, и разрыв между ними и есть содержание блока:
 * пятёрка крупнейших по деньгам может выигрывать нечасто, зато брать самые
 * дорогие закупки. Поэтому переключатель величины стоит прямо в шапке, а
 * полоса концентрации показывает обе доли рядом.
 *
 * ТОН — ФАКТ О РЫНКЕ, НЕ ОБВИНЕНИЕ (п.104). Высокая концентрация не значит
 * сговор: на узком рынке (лифты, лекарства, квартиры для детей-сирот)
 * поставщиков физически мало. Экран называет число и объясняет механизм,
 * вывод остаётся человеку.
 *
 * ГРУППИРОВКА ПО ИНН, ЕСЛИ ОН ЕСТЬ. Победы без ИНН группируются по имени,
 * что менее надёжно: одно и то же общество, записанное дважды по-разному,
 * распадётся на двух поставщиков. Число таких побед объявляется вслух.
 */
import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import type { SupplierProfile } from '../../lib/monitoring/analytics-contract';
import {
  concentrationRows, supplierTop, type SupplierSortKey,
} from '../../lib/monitoring/charts';
import { fmtCount, fmtPct, fmtRub, pluralCount } from '../../lib/monitoring/format';
import {
  getAxisColor, getChartColor, getGridColor, getTooltipStyle,
} from '../../lib/chart-colors';
import { useTheme } from '../ThemeProvider';
import { AnalyticsCard, CardEmpty, CardToggle } from './AnalyticsCard';

export interface SupplierTopProps {
  profile: SupplierProfile;
  periodLabel: string;
}

/** Короткое имя для оси: длинное наименование съедает всю ширину графика. */
function shortName(name: string): string {
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

export function SupplierTop({ profile, periodLabel }: SupplierTopProps) {
  const isDark = useTheme((s) => s.theme) === 'dark';
  const [by, setBy] = useState<SupplierSortKey>('money');
  const rows = supplierTop(profile, by, 10);
  const concentration = concentrationRows(profile);
  const tooltip = getTooltipStyle(isDark);

  const chartRows = rows.map((r) => ({
    name: shortName(r.name),
    value: by === 'money' ? r.moneyRub : r.wins,
    full: r.name,
  })).reverse();

  const title = profile.uniqueCount === 0
    ? 'Победителей в этом срезе нет'
    : `${pluralCount(profile.uniqueCount, 'поставщик', 'поставщика', 'поставщиков')} выиграли ${pluralCount(profile.totalWins, 'процедуру', 'процедуры', 'процедур')}`;

  return (
    <AnalyticsCard
      kicker="Поставщики-победители"
      title={title}
      periodLabel={periodLabel}
      controls={(
        <>
          <CardToggle active={by === 'money'} onClick={() => setBy('money')}>
            по деньгам
          </CardToggle>
          <CardToggle active={by === 'wins'} onClick={() => setBy('wins')}>
            по числу побед
          </CardToggle>
        </>
      )}
      method={(
        <>
          Поставщик определяется по ИНН, а при его отсутствии — по написанию наименования.
          Деньги поставщика — сумма цен победителя по его процедурам, руб. Концентрация считается
          от итога того же среза: доля побед — от всех побед, доля денег — от всех денег.
          {profile.winsWithoutInn > 0 && (
            <> Побед без ИНН: {fmtCount(profile.winsWithoutInn)} — они сгруппированы по имени, и
              разные написания одного общества могли разойтись.</>
          )}
        </>
      )}
    >
      {rows.length === 0 ? (
        <CardEmpty>
          Состоявшихся процедур с названным победителем в этом срезе нет. Это пустая выборка, а не
          рынок без поставщиков.
        </CardEmpty>
      ) : (
        <>
          {/* График скрыт на узком экране: десять горизонтальных полос с
              длинными именами на телефоне нечитаемы, а таблица ниже несёт
              те же числа. */}
          <div className="hidden sm:block h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: getAxisColor(isDark) }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  tick={{ fontSize: 9, fill: getAxisColor(isDark) }}
                />
                <RechartsTooltip
                  {...tooltip}
                  formatter={(v: number) => [
                    by === 'money' ? `${fmtRub(v)} руб.` : fmtCount(v),
                    by === 'money' ? 'сумма контрактов' : 'побед',
                  ]}
                />
                <Bar dataKey="value" fill={getChartColor(1, isDark)} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <caption className="sr-only">
                Десять крупнейших поставщиков {by === 'money' ? 'по сумме контрактов' : 'по числу побед'}
              </caption>
              <thead>
                <tr className="text-left text-zinc-500 dark:text-zinc-400">
                  <th className="py-1 pr-2 font-normal">Поставщик</th>
                  <th className="py-1 pr-2 text-right font-normal">Побед</th>
                  <th className="py-1 pr-2 text-right font-normal">Сумма, руб.</th>
                  <th className="py-1 text-right font-normal">Доля</th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-200">
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-zinc-100 dark:border-zinc-700/50 align-top">
                    <td className="py-1 pr-2">
                      <span className="font-medium">{r.name}</span>
                      <span className="ml-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                        {r.inn === null ? 'ИНН в книге не указан' : `ИНН ${r.inn}`}
                      </span>
                      {r.customers.length > 0 && (
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                          заказчики: {r.customers.slice(0, 3).join('; ')}
                          {r.customers.length > 3 && ` и ещё ${r.customers.length - 3}`}
                        </div>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtCount(r.wins)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{fmtRub(r.moneyRub)}</td>
                    <td className="py-1 text-right tabular-nums">{fmtPct(r.sharePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Концентрация ── */}
      <h4 className="mt-4 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
        Насколько рынок собран в немногих руках
      </h4>
      <div className="mt-1.5 space-y-2">
        {concentration.map((c) => (
          <div key={c.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]">
              <span className="text-zinc-600 dark:text-zinc-300">{c.label}</span>
              <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                побед {fmtPct(c.winsPct, 0)} · денег {fmtPct(c.moneyPct, 0)}
              </span>
            </div>
            <div className="mt-1 space-y-0.5">
              <Meter value={c.winsPct} color={getChartColor(3, isDark)} label="доля побед" />
              <Meter value={c.moneyPct} color={getChartColor(1, isDark)} label="доля денег" />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        {profile.singleWinSharePct === null
          ? 'Долю поставщиков с единственной победой считать не из чего.'
          : `Выиграли ровно один раз ${fmtCount(profile.singleWinCount)} поставщиков — это ${fmtPct(profile.singleWinSharePct, 0)} всех победителей.`}
        {' '}Высокая доля разовых победителей означает открытый рынок; высокая доля денег у пятёрки
        при этом объясняется не сговором, а тем, что крупных закупок мало и они достаются немногим.
      </p>
    </AnalyticsCard>
  );
}

/** Полоса доли. Пустая величина рисуется прочерком, а не нулевой полосой. */
function Meter({ value, color, label }: { value: number | null; color: string; label: string }) {
  if (value === null) {
    return (
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{label}: считать не из чего</p>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded bg-zinc-100 dark:bg-zinc-700/40 overflow-hidden">
        <div
          className="h-full rounded"
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%`, backgroundColor: color }}
          role="presentation"
        />
      </div>
      <span className="w-24 shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">{label}</span>
    </div>
  );
}
