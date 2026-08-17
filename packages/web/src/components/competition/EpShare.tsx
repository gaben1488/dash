// ────────────────────────────────────────────────────────────────
// «Доля ЕП» — блок 3 вкладки «Конкуренция».
//
// Канон п. 36: счётная доля и денежная стоят РЯДОМ и обе подписаны —
// «как часто уходим от торгов» и «сколько денег уходит без торгов» —
// это два разных вопроса, и один процент без подписи их смешивает.
// Ниже — динамика по кварталам обеими долями.
//
// Канон п. 82: у доли ЕП — ТУМБЛЕР «как в листе ↔ без выплат и платежей».
// «Как в листе» (дефолт) — все строки по колонке способа, совпадение со
// СВОДом; «юридически чистый» режим убирает выплаты физлицам и платежи без
// договора (подклассы стадии «в течение года», п.81) — там договора не будет
// по природе статьи. Оба режима подписаны, обе цифры видны одновременно.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { PieChart } from 'lucide-react';
import { quarterLabel } from '@aemr/shared';
import { clsx } from 'clsx';
import { useStore } from '../../store';
import { useFilteredData } from '../../hooks/useFilteredData';
import { EmptyState } from '../EmptyState';
import { pluralRu } from '../../lib/economy-copy';
import { useYearlongKinds } from '../yearlong/useYearlongKinds';
import { excludedEpTotals, excludedEpTotalsQuarter, type ExcludedEpTotals } from '../yearlong/legally-clean';
import { GROUP3_KB_ADDITIONS, kbCardProps } from '../../pages/kb-additions';
import { KBTooltip } from '../ui/kb-tooltip';
import { CompetitionCard, FOCUS_RING, fmtPct, sumEpKpQuarter, type EpKpTotals, type PeriodSel } from './primitives';

const procWord = (n: number) => pluralRu(n, 'процедуры', 'процедур', 'процедур');

function share(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** Режим счёта ЕП (п.82): как считает лист/СВОД либо юридически чистый. */
type EpCountMode = 'sheet' | 'clean';

/** Подписи режимов — обе всегда на экране, активная просто выбрана. */
const MODE_LABELS: Record<EpCountMode, string> = {
  sheet: 'как в листе',
  clean: 'без выплат и платежей',
};

/** Вычет из итогов ЕП (счёт и план), с прижимом к нулю. */
function applyExclusion(t: EpKpTotals, ex: ExcludedEpTotals): EpKpTotals {
  return {
    ...t,
    epCount: Math.max(0, t.epCount - ex.count),
    epPlan: Math.max(0, t.epPlan - ex.plan),
  };
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
  const { overrides } = useYearlongKinds();

  // Тумблер п.82. Дефолт — «как в листе»: совпадение со СВОДом по умолчанию,
  // чистый режим — явный выбор читателя.
  const [mode, setMode] = useState<EpCountMode>('sheet');

  /** Периметр периода — тот же PeriodSel, каким страница считала totals. */
  const sel: PeriodSel = useMemo(() => ({
    periodKey: fd.periodKey,
    hasActiveMonths: fd.periodResolution.hasActiveMonths,
    coveredQuarters: fd.coveredQuarters,
    fullQuarters: fd.fullQuarters,
    partialMonths: fd.partialMonths,
    useMonthLevel: fd.useMonthLevel,
  }), [fd.periodKey, fd.periodResolution, fd.coveredQuarters, fd.fullQuarters, fd.partialMonths, fd.useMonthLevel]);

  const deptIds = useMemo(
    () => fd.depts.map((d: { id?: unknown }) => String(d.id ?? '')),
    [fd.depts],
  );

  /** Вычет чистого режима за периметр (разметка стадии + оверрайды владельца). */
  const excluded = useMemo(
    () => excludedEpTotals(deptIds, sel, overrides),
    [deptIds, sel, overrides],
  );

  const cleanTotals = useMemo(() => applyExclusion(totals, excluded), [totals, excluded]);
  const active = mode === 'clean' ? cleanTotals : totals;

  const quarters = useMemo(
    () => (['q1', 'q2', 'q3', 'q4'] as const).map((qk, i) => {
      const raw = sumEpKpQuarter(fd.depts, qk);
      const t = mode === 'clean'
        ? applyExclusion(raw, excludedEpTotalsQuarter(deptIds, qk, overrides))
        : raw;
      return {
        label: quarterLabel(i + 1),
        countShare: t.hasData ? share(t.epCount, t.epCount + t.kpCount) : null,
        moneyShare: t.hasData ? share(t.epPlan, t.epPlan + t.kpPlan) : null,
        epCount: t.epCount,
        epPlan: t.epPlan,
        hasData: t.hasData,
      };
    }),
    [fd.depts, mode, deptIds, overrides],
  );

  const countShareTotal = active.hasData ? share(active.epCount, active.epCount + active.kpCount) : null;
  const moneyShareTotal = active.hasData ? share(active.epPlan, active.epPlan + active.kpPlan) : null;
  // Обе цифры подписаны и видны одновременно (п.82): альтернативный режим —
  // строкой под большим числом.
  const altTotals = mode === 'clean' ? totals : cleanTotals;
  const altCountShare = altTotals.hasData ? share(altTotals.epCount, altTotals.epCount + altTotals.kpCount) : null;
  const altMoneyShare = altTotals.hasData ? share(altTotals.epPlan, altTotals.epPlan + altTotals.kpPlan) : null;
  const altLabel = MODE_LABELS[mode === 'clean' ? 'sheet' : 'clean'];
  const anyQuarterData = quarters.some((q) => q.hasData);

  const noData = !totals.hasData && !anyQuarterData;
  const nothingLoaded = (fd.allDepts?.length ?? 0) === 0;

  const cleanCaveats = mode === 'clean'
    ? [
        excluded.count > 0
          ? `Чистый режим исключил ${excluded.count} ${pluralRu(excluded.count, 'строку', 'строки', 'строк')} на ${formatMoney(excluded.plan)} плана — выплаты физлицам и платежи без договора по разметке стадии «в течение года». Деньги плана и факта в общих итогах остаются полными.`
          : 'В выбранный периметр не попало ни одной строки выплат физлицам или платежей без договора — чистый режим совпадает с листом.',
      ]
    : [];

  return (
    <CompetitionCard
      title="Доля закупок у единственного поставщика"
      subtitle="Две доли — два разных вопроса: счётная говорит, как часто заказчики уходят от торгов; денежная — сколько денег уходит без торгов. Одна без другой вводит в заблуждение: сто мелких ЕП и один крупный дают противоположные картины."
      icon={PieChart}
      caveats={cleanCaveats}
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
          {/* Тумблер режима счёта (п.82): оба режима подписаны, дефолт — лист. */}
          <div
            className="flex items-center gap-2 flex-wrap mb-3"
            role="group"
            aria-label="Режим счёта доли ЕП"
          >
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Счёт ЕП
            </span>
            <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              {(['sheet', 'clean'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  title={m === 'sheet'
                    ? 'Все строки по колонке способа — совпадение со СВОДом'
                    : 'Без выплат физлицам и платежей без договора (подклассы стадии «в течение года»): там договора не будет по природе статьи'}
                  className={clsx(
                    'px-2.5 py-1 text-[11px] font-medium transition',
                    FOCUS_RING,
                    mode === m
                      ? 'bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'bg-white dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/40',
                  )}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {/* Две доли рядом — обе подписаны (канон п. 36); под каждой — цифра
              второго режима, чтобы «и как правильно, и как считает свод»
              стояли рядом, а не по очереди (п.82). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-zinc-100 dark:border-zinc-700/50 px-3 py-2.5">
              {/* Карточка БЗ счётной доли (п.91-2): объяснение пары и тумблера. */}
              <KBTooltip {...kbCardProps(GROUP3_KB_ADDITIONS.ep_share_count)} showIcon>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  По числу процедур · {MODE_LABELS[mode]}
                </p>
              </KBTooltip>
              <p className="text-lg font-semibold tabular-nums text-sky-700 dark:text-sky-400 mt-0.5">
                {countShareTotal !== null ? fmtPct(countShareTotal) : '—'}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 tabular-nums">
                {countShareTotal !== null
                  ? `${active.epCount} ЕП из ${active.epCount + active.kpCount} ${procWord(active.epCount + active.kpCount)} за периметр`
                  : 'счётчиков процедур за периметр нет'}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 tabular-nums">
                {altLabel}: {altCountShare !== null ? fmtPct(altCountShare) : '—'}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-100 dark:border-zinc-700/50 px-3 py-2.5">
              {/* Денежная доля — главная в паре (канон п.90/32а); карточка БЗ своя. */}
              <KBTooltip {...kbCardProps(GROUP3_KB_ADDITIONS.ep_share_money)} showIcon>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  По деньгам (план) · {MODE_LABELS[mode]}
                </p>
              </KBTooltip>
              <p className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400 mt-0.5">
                {moneyShareTotal !== null ? fmtPct(moneyShareTotal) : '—'}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 tabular-nums">
                {moneyShareTotal !== null
                  ? `${formatMoney(active.epPlan)} ЕП из ${formatMoney(active.epPlan + active.kpPlan)} плана за периметр`
                  : 'плановых сумм за периметр нет'}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 tabular-nums">
                {altLabel}: {altMoneyShare !== null ? fmtPct(altMoneyShare) : '—'}
              </p>
            </div>
          </div>

          {/* Динамика по кварталам — обе доли, год целиком. */}
          <div className="mt-4">
            <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
              Динамика по кварталам года
              <span className="normal-case tracking-normal">
                {' '}— <span className="text-sky-700 dark:text-sky-400">счётная</span> и{' '}
                <span className="text-amber-700 dark:text-amber-400">денежная</span> доли
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
                            : <span className="text-[10px] text-zinc-500 dark:text-zinc-400">данных нет</span>}
                        </td>
                        <td className="py-1.5 w-[42%]">
                          {q.hasData
                            ? <ShareBar pct={q.moneyShare} tone="money" />
                            : <span className="text-[10px] text-zinc-500 dark:text-zinc-400">данных нет</span>}
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
