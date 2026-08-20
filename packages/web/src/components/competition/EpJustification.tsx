// ────────────────────────────────────────────────────────────────
// «Из чего состоит ЕП» — блок 4 вкладки «Конкуренция» (канон п. 98ж).
//
// Идея руководства 18.08.2026: показывать, насколько меньше становится
// закупок у единственного поставщика и особенно НЕОБОСНОВАННОГО ЕП.
// Одна доля ЕП на это не отвечает: она складывает монополиста, которого
// конкурсом не заменить, и «сочли аукцион нецелесообразным», который
// заменить можно. Блок разделяет объём на четыре степени обоснованности
// и называет ту часть, которую в принципе можно вывести на торги.
//
// Три честности блока:
//   • «сокращаемый ЕП» — верхняя граница возможного, а не обещанная
//     экономия и не обвинение: закон разрешает обе первые степени;
//   • степень выводится из КЛАСТЕРА причины (колонка M через словарь),
//     свободный текст машинно не толкуется (канон п. 27);
//   • динамика идёт по кварталу ПЛАНА — тем же правилом, каким считает
//     кварталы расчётный движок, поэтому доля ЕП здесь не спорит с долей
//     ЕП соседнего блока.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Scale } from 'lucide-react';
import clsx from 'clsx';
import {
  CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import {
  EP_GRADE_EXPLAIN, EP_GRADE_LABELS, quarterLabel,
  type EpJustificationGrade,
} from '@aemr/shared';
import { topClustersOfGrade, type EpQuarterPoint } from '@aemr/core';
import { api, humanizeRequestError, type EpReasonsResponse } from '../../api';
import { useStore } from '../../store';
import { useFilteredData } from '../../hooks/useFilteredData';
import { useTheme } from '../ThemeProvider';
import { EmptyState } from '../EmptyState';
import { pluralRu } from '../../lib/economy-copy';
import { getAxisColor, getGridColor, getTooltipStyle } from '../../lib/chart-colors';
import { GROUP3_KB_ADDITIONS } from '../../pages/kb-additions';
import { activePeriodKeys } from '../../lib/selectors/period-resolution';
import type { OrgScope } from '../../lib/selectors/org-scope';
import {
  CompetitionCard, FOCUS_RING, RULE_HEAD, RULE_ROW, SubScopeNote, TILE, fmtPct,
} from './primitives';
import { reducibleTrend, selectEpGradeView } from './ep-grade-view';

const rowsWord = (n: number) => pluralRu(n, 'закупка', 'закупки', 'закупок');
const rowsAccWord = (n: number) => pluralRu(n, 'закупку', 'закупки', 'закупок');

/**
 * Цвет степени — шкала «нельзя сократить → можно сократить», а не шкала
 * критичности: высокая доля законной безальтернативности не нарушение, и
 * красным её красить нельзя. Пара читается как [светлая тема, тёмная];
 * тёмные значения проверены на подложке zinc-800, светлые — на белом.
 * Цвет ЗДЕСЬ не единственный признак: у каждой степени рядом стоят её
 * подпись, деньги и доля числом.
 */
const GRADE_COLORS: Record<EpJustificationGrade, readonly [string, string]> = {
  'lawful-exclusive': ['#475569', '#94a3b8'],
  'verified-benefit': ['#0e7490', '#22d3ee'],
  discretionary: ['#b45309', '#fbbf24'],
  unfounded: ['#be185d', '#f472b6'],
};

const gradeColor = (grade: EpJustificationGrade, isDark: boolean): string =>
  GRADE_COLORS[grade][isDark ? 1 : 0];

/** Классы текста степени — тот же смысл, что у цвета фигуры, но токенами Tailwind. */
const GRADE_TEXT: Record<EpJustificationGrade, string> = {
  'lawful-exclusive': 'text-slate-600 dark:text-slate-300',
  'verified-benefit': 'text-cyan-700 dark:text-cyan-300',
  discretionary: 'text-amber-700 dark:text-amber-400',
  unfounded: 'text-pink-700 dark:text-pink-400',
};

/** Степени, из которых складывается «сокращаемый ЕП» (канон п.98ж). */
const REDUCIBLE_GRADES: readonly EpJustificationGrade[] = ['discretionary', 'unfounded'];

/**
 * Признаки строк Реестра, которыми ловится ЕП без обоснования. Три признака
 * покрывают пустую графу, нераспознанную формулировку и названную процедуру
 * вместо основания — то есть почти всю степень «без обоснования». Точного
 * фильтра «по степени» у Реестра нет, и обещать его подписью нельзя.
 */
const UNFOUNDED_SIGNALS = ['epJustificationMissing', 'unmappedReasonEP', 'methodReasonMismatch'];

/** Стек-бар степеней: ширина — деньги, подпись — рядом в карточках ниже. */
function GradeStack({ slices, isDark }: {
  slices: { grade: EpJustificationGrade; sum: number; moneyShare: number | null }[];
  isDark: boolean;
}) {
  const total = slices.reduce((acc, s) => acc + s.sum, 0);
  if (!(total > 0)) return null;
  return (
    <div
      className="flex h-3 w-full rounded-full overflow-hidden bg-zinc-100 dark:bg-zinc-700/60"
      role="img"
      aria-label={
        'Состав закупок у единственного поставщика по деньгам: ' +
        slices
          .filter((s) => s.sum > 0)
          .map((s) => `${EP_GRADE_LABELS[s.grade]} — ${fmtPct(s.moneyShare ?? 0)}`)
          .join('; ')
      }
    >
      {slices.filter((s) => s.sum > 0).map((s) => (
        <div
          key={s.grade}
          style={{ width: `${(s.sum / total) * 100}%`, backgroundColor: gradeColor(s.grade, isDark) }}
          title={`${EP_GRADE_LABELS[s.grade]} — ${fmtPct(s.moneyShare ?? 0)}`}
        />
      ))}
    </div>
  );
}

export function EpJustification({ orgScope }: {
  /** Режим подведов страницы (org-scope): здесь — только честная оговорка. */
  orgScope: OrgScope;
}) {
  const formatMoney = useStore((s) => s.formatMoney);
  const navigateTo = useStore((s) => s.navigateTo);
  const isDark = useTheme((s) => s.theme) === 'dark';
  const fd = useFilteredData();

  const [data, setData] = useState<EpReasonsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getAnalyticsEPReasons()
      .then((resp) => {
        if (cancelled) return;
        setData(resp);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(humanizeRequestError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const deptKeys = useMemo(
    () => fd.depts.map((d: { id?: unknown }) => String(d.id ?? '')).filter(Boolean),
    [fd.depts],
  );
  const periodKeys = useMemo(() => activePeriodKeys(fd.periodResolution), [fd.periodResolution]);

  const view = useMemo(
    () => selectEpGradeView(data?.justification?.byDept, {
      deptKeys,
      periodKeys,
      hasActiveMonths: fd.periodResolution.hasActiveMonths,
    }),
    [data, deptKeys, periodKeys, fd.periodResolution.hasActiveMonths],
  );

  const { summary, dynamics } = view;
  const trend = useMemo(() => reducibleTrend(dynamics), [dynamics]);

  /** Точки графика: доли в процентах, кварталы без данных — разрыв линии. */
  const chartData = useMemo(
    () => dynamics.map((p: EpQuarterPoint) => ({
      name: quarterLabel(p.index),
      epShare: p.hasData ? p.epShareMoney : null,
      reducibleShare: p.hasData ? p.reducibleShareOfAll : null,
      reducibleSum: p.reducible.sum,
      epSum: p.ep.sum,
    })),
    [dynamics],
  );
  const anyQuarterData = dynamics.some((p) => p.hasData);

  const { contentStyle, itemStyle, labelStyle } = getTooltipStyle(isDark);

  // ── Оговорки периметра: сетка обоснований квартальная, месячной нет ──
  const caveats: string[] = [];
  if (view.roundedToQuarters) {
    caveats.push(
      'Выбраны отдельные месяцы: разбор обоснований живёт на квартальной сетке (столбец «квартал плана»), поэтому периметр округлён до кварталов, в которые эти месяцы попали.',
    );
  }
  if (!view.wholeYear && view.noQuarter.rows > 0) {
    caveats.push(
      `${view.noQuarter.rows} ${rowsWord(view.noQuarter.rows)} без торгов на ${formatMoney(view.noQuarter.sum)} плана не имеют квартала плана — в квартальный разбор они не входят; за год целиком они видны.`,
    );
  }
  if (view.wholeYear && view.noQuarter.rows > 0) {
    caveats.push(
      `${view.noQuarter.rows} ${rowsWord(view.noQuarter.rows)} без торгов не имеют квартала плана: в годовой итог они входят, а в динамику по кварталам — нет.`,
    );
  }

  const openRegistry = useCallback(
    (signals?: string[]) => navigateTo('data', signals
      ? { procurement: 'single', signals }
      : { procurement: 'single' }),
    [navigateTo],
  );

  const nothingLoaded = (fd.allDepts?.length ?? 0) === 0;

  return (
    <CompetitionCard
      title="Из чего состоит закупка у единственного поставщика"
      subtitle="Одна доля ЕП складывает монополиста и «сочли аукцион нецелесообразным» — а это разные закупки. Здесь объём без торгов разложен на четыре степени обоснованности, и отдельно назван сокращаемый ЕП: та часть, которую в принципе можно вывести на торги."
      icon={Scale}
      caveats={caveats}
      kb={GROUP3_KB_ADDITIONS.ep_justification}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 size={14} className="animate-spin text-zinc-400" aria-hidden="true" />
          Разбираем обоснования закупок без торгов…
        </div>
      ) : error ? (
        <EmptyState
          tone="problem"
          size="compact"
          title="Разбор обоснований не получен"
          description="Сервер не отдал разбор причин выбора единственного поставщика. Повторите запрос; если ошибка вернётся — проверьте сервер на странице «Система»."
          detail={error}
          action={{ label: 'Повторить запрос', onClick: retry }}
        />
      ) : !summary.hasData ? (
        nothingLoaded ? (
          <EmptyState
            size="compact"
            title="Книги управлений ещё не прочитаны"
            description="Обоснования читаются из графы «причина выбора способа» книг ГРБС. Нажмите «Обновить» в шапке — система перечитает книги и разберёт причины заново."
          />
        ) : view.noDeptsMatched ? (
          <EmptyState
            size="compact"
            title="Выбранных управлений нет в разборе обоснований"
            description="Сервер вернул разбор по другим управлениям — вероятно, книги выбранных ещё не прочитаны. Снимите отбор управлений в шапке или обновите данные."
          />
        ) : (
          <EmptyState
            size="compact"
            title="Закупок с определённым способом за периметр нет"
            description="В выбранный период и отбор управлений не попало ни одной строки со способом определения поставщика — разбирать обоснования не у чего. Расширьте период до года или снимите отбор управлений."
          />
        )
      ) : (
        <>
          {/* ── Главное число: сокращаемый ЕП ── */}
          <div className={clsx(TILE, 'px-4 py-3')}>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Сокращаемый ЕП — решение заказчика и закупки без обоснования
            </p>
            <p className="text-2xl font-semibold tabular-nums text-pink-700 dark:text-pink-400 mt-1">
              {formatMoney(summary.reducible.sum)}
            </p>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-1 tabular-nums">
              {summary.reducible.rows} {rowsWord(summary.reducible.rows)} без торгов
              {summary.reducibleShareOfEp !== null && (
                <> · {fmtPct(summary.reducibleShareOfEp)} денег ЕП</>
              )}
              {summary.reducibleShareOfAll !== null && (
                <> · {fmtPct(summary.reducibleShareOfAll)} всего плана периметра</>
              )}
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed max-w-2xl">
              Это верхняя граница объёма, который можно вынести на торги, а не обещанная
              экономия. Остальной ЕП сокращать нечем: монополиста, коммунальный ресурс,
              охрану и аварию конкурсом не заменить — закон прямо разрешает такие закупки,
              а объединение и торги на них не действуют.
            </p>
            <button
              type="button"
              onClick={() => openRegistry(UNFOUNDED_SIGNALS)}
              className={clsx(
                'mt-2 text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline rounded',
                FOCUS_RING,
              )}
            >
              Открыть закупки без обоснования в Реестре →
            </button>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
              Реестр отбирает строки по признакам «обоснование не заполнено», «формулировка
              не распознана» и «названа процедура вместо основания». Отдельного фильтра
              «решение заказчика» у Реестра нет — эти строки придётся смотреть глазами.
            </p>
          </div>

          {/* ── Стек-бар состава по деньгам ── */}
          <div className="mt-4">
            <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
              Состав объёма без торгов по деньгам плана
            </h3>
            <GradeStack slices={summary.grades} isDark={isDark} />
          </div>

          {/* ── Карточки степеней ── */}
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summary.grades.map((g) => {
              const clusters = topClustersOfGrade(view.clusters, g.grade, 3);
              const reducible = REDUCIBLE_GRADES.includes(g.grade);
              return (
                <li key={g.grade} className={clsx(TILE, 'px-3 py-2.5')}>
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1 h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: gradeColor(g.grade, isDark) }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className={clsx('text-[11px] font-semibold', GRADE_TEXT[g.grade])}>
                        {EP_GRADE_LABELS[g.grade]}
                        {reducible && (
                          <span className="ml-1.5 font-normal text-[10px] text-zinc-500 dark:text-zinc-400">
                            (сокращаемый)
                          </span>
                        )}
                      </p>
                      <p className="text-base font-semibold tabular-nums text-zinc-700 dark:text-zinc-200 mt-0.5">
                        {formatMoney(g.sum)}
                        <span className="ml-1.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                          {g.moneyShare !== null ? `${fmtPct(g.moneyShare)} денег ЕП` : 'доли нет'}
                        </span>
                      </p>
                      <p className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {g.rows} {rowsAccWord(g.rows)}
                        {g.countShare !== null && <> · {fmtPct(g.countShare)} процедур ЕП</>}
                      </p>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                        {EP_GRADE_EXPLAIN[g.grade]}
                      </p>
                      {clusters.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {clusters.map((c) => (
                            <li
                              key={c.cluster}
                              className="text-[10px] text-zinc-500 dark:text-zinc-400 flex justify-between gap-2"
                            >
                              <span className="truncate" title={c.evidence}>{c.label}</span>
                              <span className="tabular-nums shrink-0">{formatMoney(c.sum)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* ── Динамика: доля ЕП и доля сокращаемого ЕП по кварталам ── */}
          <div className="mt-4">
            <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
              Как меняются доли по кварталам года
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-2 leading-relaxed max-w-2xl">
              Обе доли считаются от всего планового объёма квартала (торги плюс закупки без
              торгов). Квартал строки — столбец «квартал плана», тот же, каким считает
              кварталы расчёт; строки без квартала в динамику не попадают.
              {trend && (
                <>
                  {' '}
                  {`От ${quarterLabel(trend.first.index)} к ${quarterLabel(trend.last.index)} сокращаемая доля `}
                  {trend.deltaPp < 0 ? 'упала' : trend.deltaPp > 0 ? 'выросла' : 'не изменилась'}
                  {trend.deltaPp === 0
                    ? `: ${fmtPct(trend.last.reducibleShareOfAll ?? 0)}.`
                    : ` с ${fmtPct(trend.first.reducibleShareOfAll ?? 0)} до ${fmtPct(trend.last.reducibleShareOfAll ?? 0)}.`}
                </>
              )}
            </p>
            {anyQuarterData ? (
              <div className="h-56 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                    <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                    <YAxis
                      fontSize={11}
                      tick={{ fill: getAxisColor(isDark) }}
                      domain={[0, 100]}
                      tickFormatter={(v: number) => `${v}%`}
                      width={44}
                    />
                    <RechartsTooltip
                      contentStyle={contentStyle}
                      itemStyle={itemStyle}
                      labelStyle={labelStyle}
                      formatter={(value: unknown) => (typeof value === 'number' ? fmtPct(value) : '—')}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: getAxisColor(isDark) }} />
                    <Line
                      type="monotone"
                      dataKey="epShare"
                      name="Доля закупок без торгов"
                      stroke={gradeColor('lawful-exclusive', isDark)}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="reducibleShare"
                      name="Из них сокращаемые"
                      stroke={gradeColor('unfounded', isDark)}
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={{ r: 3 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Ни у одной строки выбранных управлений не проставлен квартал плана — динамику
                по кварталам показать не из чего. Числа выше при этом верны: они считаются
                по году целиком.
              </p>
            )}

            {/* Текстовый дубль графика: линия читается и без цвета. */}
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-[11px]">
                <caption className="sr-only">
                  Доля закупок без торгов и доля сокращаемых закупок по кварталам года
                </caption>
                <thead>
                  <tr className={clsx('text-left text-[10px] uppercase text-zinc-500 dark:text-zinc-400', RULE_HEAD)}>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Квартал</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium text-right">Без торгов</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium text-right">Сокращаемые</th>
                    <th scope="col" className="py-1.5 font-medium text-right">Деньги сокращаемых</th>
                  </tr>
                </thead>
                <tbody>
                  {dynamics.map((p) => (
                    <tr key={p.quarter} className={clsx(RULE_ROW, 'last:border-0')}>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                        {quarterLabel(p.index)}
                      </td>
                      {p.hasData ? (
                        <>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                            {p.epShareMoney !== null ? fmtPct(p.epShareMoney) : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-pink-700 dark:text-pink-400">
                            {p.reducibleShareOfAll !== null ? fmtPct(p.reducibleShareOfAll) : '—'}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                            {formatMoney(p.reducible.sum)}
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="py-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                          строк с этим кварталом плана нет
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button
            type="button"
            onClick={() => openRegistry()}
            className={clsx(
              'mt-3 text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline rounded',
              FOCUS_RING,
            )}
          >
            Открыть все закупки без торгов в Реестре →
          </button>

          {/* Режим подведов: разбор обоснований приходит с сервера сведённым по
              управлениям — сочетания «учреждение × причина» расчёт не держит. */}
          <SubScopeNote
            mode={orgScope.mode}
            deptLabel={orgScope.dept}
            reason="разбор причин сервер сводит по управлениям целиком: сочетания «учреждение × причина выбора способа» расчёт не хранит. Разложить объём по учреждениям умеет доля закупок без торгов выше."
          />
        </>
      )}
    </CompetitionCard>
  );
}
