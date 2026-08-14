// ────────────────────────────────────────────────────────────────
// «Доля ЕП» — блок 3 вкладки «Конкуренция».
//
// Канон п. 36: счётная доля и денежная стоят РЯДОМ и обе подписаны —
// «как часто уходим от торгов» и «сколько денег уходит без торгов» —
// это два разных вопроса, и один процент без подписи их смешивает.
// Ниже — динамика по кварталам обеими долями.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { PieChart } from 'lucide-react';
import { quarterLabel } from '@aemr/shared';
import { useStore } from '../../store';
import { useFilteredData } from '../../hooks/useFilteredData';
import { EmptyState } from '../EmptyState';
import { pluralRu } from '../../lib/economy-copy';
import { CompetitionCard, fmtPct, sumEpKp, sumEpKpQuarter, type EpKpTotals } from './primitives';

const procWord = (n: number) => pluralRu(n, 'процедуры', 'процедур', 'процедур');

function share(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** Полоска доли: ширина — данные, подпись — рядом числом (не только цветом). */
function ShareBar({ pct, tone }: { pct: number | null; tone: 'count' | 'money' }) {
  const color = tone === 'count'
    ? 'bg-sky-500/70 dark:bg-sky-400/60'
    : 'bg-amber-500/70 dark:bg-amber-400/60';
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="h-1.5 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-700/60 overflow-hidden"
        role="presentation"
      >
        {pct !== null && (
          <div
            className={`h-full rounded-full ${color}`}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        )}
      </div>
      <span className="text-[11px] tabular-nums text-zinc-600 dark:text-zinc-300 w-12 text-right shrink-0">
        {pct !== null ? fmtPct(pct) : '—'}
      </span>
    </div>
  );
}

export function EpShare({ totals }: {
  /** Итоги ЕП/КП за периметр шапки (счёт — sumEpKp, общий с блоком 1). */
  totals: EpKpTotals;
}) {
  const formatMoney = useStore((s) => s.formatMoney);
  const fd = useFilteredData();

  const quarters = useMemo(
    () => (['q1', 'q2', 'q3', 'q4'] as const).map((qk, i) => {
      const t = sumEpKpQuarter(fd.depts, qk);
      return {
        label: quarterLabel(i + 1),
        countShare: t.hasData ? share(t.epCount, t.epCount + t.kpCount) : null,
        moneyShare: t.hasData ? share(t.epPlan, t.epPlan + t.kpPlan) : null,
        epCount: t.epCount,
        epPlan: t.epPlan,
        hasData: t.hasData,
      };
    }),
    [fd.depts],
  );

  const countShareTotal = totals.hasData ? share(totals.epCount, totals.epCount + totals.kpCount) : null;
  const moneyShareTotal = totals.hasData ? share(totals.epPlan, totals.epPlan + totals.kpPlan) : null;
  const anyQuarterData = quarters.some((q) => q.hasData);

  const noData = !totals.hasData && !anyQuarterData;
  const nothingLoaded = (fd.allDepts?.length ?? 0) === 0;

  return (
    <CompetitionCard
      title="Доля закупок у единственного поставщика"
      subtitle="Две доли — два разных вопроса: счётная говорит, как часто заказчики уходят от торгов; денежная — сколько денег уходит без торгов. Одна без другой вводит в заблуждение: сто мелких ЕП и один крупный дают противоположные картины."
      icon={PieChart}
    >
      {noData ? (
        nothingLoaded ? (
          <EmptyState
            size="compact"
            title="Книги управлений ещё не прочитаны"
            description="Доля ЕП считается из строк книг ГРБС. Нажмите «Обновить» в шапке — система перечитает книги и пересчитает способ каждой закупки."
          />
        ) : (
          <EmptyState
            size="compact"
            title="Счётных строк за периметр нет"
            description="В выбранный период и отбор управлений не попало ни одной закупки с определённым способом. Расширьте период до года или снимите отбор управлений в шапке."
          />
        )
      ) : (
        <>
          {/* Две доли рядом — обе подписаны (канон п. 36). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-zinc-100 dark:border-zinc-700/50 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                По числу процедур
              </p>
              <p className="text-lg font-semibold tabular-nums text-sky-600 dark:text-sky-400 mt-0.5">
                {countShareTotal !== null ? fmtPct(countShareTotal) : '—'}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 tabular-nums">
                {countShareTotal !== null
                  ? `${totals.epCount} ЕП из ${totals.epCount + totals.kpCount} ${procWord(totals.epCount + totals.kpCount)} за периметр`
                  : 'счётчиков процедур за периметр нет'}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-100 dark:border-zinc-700/50 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                По деньгам (план)
              </p>
              <p className="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400 mt-0.5">
                {moneyShareTotal !== null ? fmtPct(moneyShareTotal) : '—'}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 tabular-nums">
                {moneyShareTotal !== null
                  ? `${formatMoney(totals.epPlan)} ЕП из ${formatMoney(totals.epPlan + totals.kpPlan)} плана за периметр`
                  : 'плановых сумм за периметр нет'}
              </p>
            </div>
          </div>

          {/* Динамика по кварталам — обе доли, год целиком. */}
          <div className="mt-4">
            <h3 className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
              Динамика по кварталам года
              <span className="normal-case tracking-normal">
                {' '}— <span className="text-sky-600 dark:text-sky-400">счётная</span> и{' '}
                <span className="text-amber-600 dark:text-amber-400">денежная</span> доли
              </span>
            </h3>
            {anyQuarterData ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">Квартал</th>
                      <th scope="col">Доля ЕП по числу процедур</th>
                      <th scope="col">Доля ЕП по деньгам (план)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quarters.map((q) => (
                      <tr key={q.label} className="border-b border-zinc-50 dark:border-zinc-800/50 last:border-0">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-300 w-14">
                          {q.label}
                        </td>
                        <td className="py-1.5 pr-4 w-[42%]">
                          {q.hasData
                            ? <ShareBar pct={q.countShare} tone="count" />
                            : <span className="text-[10px] text-zinc-400 dark:text-zinc-500">данных нет</span>}
                        </td>
                        <td className="py-1.5 w-[42%]">
                          {q.hasData
                            ? <ShareBar pct={q.moneyShare} tone="money" />
                            : <span className="text-[10px] text-zinc-400 dark:text-zinc-500">данных нет</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Поквартальных счётчиков способа закупки в расчёте нет — динамику показать не из чего.
              </p>
            )}
          </div>
        </>
      )}
    </CompetitionCard>
  );
}
