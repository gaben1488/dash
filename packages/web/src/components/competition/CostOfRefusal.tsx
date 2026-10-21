import { productLabel } from '@aemr/shared';
// Scenario on recorded K/Y positions. Financial semantics are source-defined.
// Approved economy is a separate AD-gated fact, never inferred from this ratio.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Scale } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../api';
import { useStore } from '../../store';
import { EmptyState } from '../EmptyState';
import { pluralRu } from '../../lib/economy-copy';
import { fmtThousands } from '../../lib/report/mappers';
import { buildDrill, type DrillFilters } from '../../lib/drill';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { scatterScope } from '../../lib/scatter-scope';
import type { LimitComparisonPoint as ScatterPoint } from '@aemr/shared';
import type { OrgScope } from '../../lib/selectors/org-scope';
import { GROUP3_KB_ADDITIONS } from '../../pages/kb-additions';
import {
  CompetitionCard, FOCUS_RING, RULE_HEAD, RULE_ROW, TILE, fmtPct,
} from './primitives';

/** Сколько строк расчёта показываем в раскрытии; остаток называется числом. */
const ROWS_VISIBLE_LIMIT = 30;

const procWord = (n: number) => pluralRu(n, 'позиция', 'позиции', 'позиций');

/**
 * Строка расчёта — дверь в свои основания (канон п.119: по каждому числу видно,
 * какая строка за ним стоит). Прежде строки раскрытия не кликались вовсе:
 * читатель видел предмет закупки и не мог дойти до самой закупки.
 *
 * Цель перехода собирает `buildDrill` (механизм М14), а не это место клика:
 * иначе каждая кнопка помнила бы про свою ось и роняла остальные. Подсказка
 * приходит оттуда же — она честно называет и то, что откроется, и то, чего в
 * цели не будет.
 */
function RowLink({ point, onNavigate }: {
  point: ScatterPoint;
  onNavigate: (page: 'data', filters: DrillFilters) => void;
}) {
  const quarter = point.quarter;
  const target = buildDrill(
    {
      dept: point.department,
      ...(quarter !== null ? { quarter } : {}),
      method: 'КП',
      search: point.subject,
    },
    'data',
  );
  const hint = target.warning === ''
    ? `${target.summary}. ${point.subject}`
    : `${target.summary}. ${target.warning}`;
  return (
    <button
      type="button"
      onClick={() => onNavigate('data', target.filters)}
      title={hint}
      className={clsx(
        'text-left line-clamp-2 hover:text-blue-600 dark:hover:text-blue-400 hover:underline rounded-sm',
        FOCUS_RING,
      )}
    >
      {point.subject}
    </button>
  );
}

export function CostOfRefusal({ epPlan, epHasData }: {
  /** Плановый объём ЕП за периметр шапки, тыс. ₽ (счёт — sumEpKp). */
  epPlan: number;
  epHasData: boolean;
  /** Режим подведов страницы (org-scope): здесь — только честная оговорка. */
  orgScope: OrgScope;
}) {
  const formatMoney = useStore((s) => s.formatMoney);
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const selectedSubordinates = useStore((s) => s.selectedSubordinates);
  const navigateTo = useStore((s) => s.navigateTo);
  const snapshotId = useStore(s => s.dashboardData?.snapshot.id);
  const dashboardLoading = useStore(s => s.loading);
  const dataYear = useStore(s => s.dataYear);
  const year = useStore(s => s.year);
  const period = useStore(s => s.period);
  const periodMode = useStore(s => s.periodMode);
  const activeMonths = useStore(s => s.activeMonths);
  const activityFilter = useStore(s => s.activityFilter);
  const selectedActivities = useStore(s => s.selectedActivities);
  const deptOnlyMode = useStore(s => s.deptOnlyMode);
  const searchQuery = useStore(s => s.searchQueryDebounced);

  const [open, setOpen] = useState(false);

  const scope = useMemo(() => scatterScope({ snapshotId, year, period, periodMode, activeMonths,
    selectedDepartments, selectedSubordinates, activityFilter, selectedActivities, deptOnlyMode, searchQuery,
    procurementFilter: 'competitive',
  }), [snapshotId, year, period, periodMode, activeMonths, selectedDepartments, selectedSubordinates, activityFilter, selectedActivities, deptOnlyMode, searchQuery]);

  const query = useScopedQuery(snapshotId ? JSON.stringify(scope) : '', signal => api.getScatterData(scope, signal));
  const resp = query.data ?? null;
  const loading = !snapshotId || query.loading;
  const error = query.error;
  const retry = query.retry;

  const rows = resp?.points ?? [];
  const stats = { sumPlan: resp?.summary.limitTotal ?? 0, sumFact: resp?.summary.contractTotal ?? 0,
    reductionPct: resp?.summary.limitReductionPercent ?? null };
  const refusalCost = stats.reductionPct !== null && epHasData && resp?.coverage.complete && !dashboardLoading && (year === 'all' || year === dataYear)
    ? epPlan * (stats.reductionPct / 100) : null;

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => b.planTotal - a.planTotal),
    [rows],
  );

  // ── Оговорки счёта — на карточке, не в тултипе ──
  const caveats: string[] = [];
  if (resp && resp.unreadDepartments.length > 0) {
    caveats.push(
      `Не прочитаны книги: ${resp.unreadDepartments.map((u) => u.department).join(', ')} — позиции этих управлений в расчёте не участвуют.`,
    );
  }
  if (resp?.truncated) {
    caveats.push(
      `В раскрытии не больше ${resp.pointLimit} строк; итог рассчитан по всем ${resp.total} подходящим позициям.`,
    );
  }
  if (resp && resp.excluded.unknownMethod > 0) caveats.push(`${resp.excluded.unknownMethod} строк с неподтверждённым способом не входят в конкурентную базу.`);
  if (resp && !resp.coverage.complete) caveats.push('Итоговая оценка не рассчитана: состав источников неполон.');

  const detailId = 'cost-of-refusal-rows';

  return (
    <CompetitionCard
      // Заголовок-существительное и ровно тот, каким метрика названа в базе
      // знаний («Цена отказа от конкурса»): одно имя у числа на всех экранах.
      title="Цена отказа от конкурса"
      subtitle="Условная оценка по разнице плана и отражённого факта конкурентных позиций. Смысл K и Y определяется источником. Эти колонки не устанавливают НМЦК или ЛБО автоматически; результат не доказывает потери от выбора ЕП."
      icon={Scale}
      caveats={caveats}
      kb={GROUP3_KB_ADDITIONS.refusal_cost}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 size={14} className="animate-spin text-zinc-400" aria-hidden="true" />
          Читаем конкурентные позиции с отражённым фактом…
        </div>
      ) : error ? (
        <EmptyState
          tone="problem"
          size="compact"
          title="Сравнение плана и факта не получено"
          description="Без позиций с отражённым фактом разницу с планом посчитать не из чего. Повторите запрос; если ошибка вернётся — проверьте сервер на странице «Система»."
          detail={error}
          action={{ label: 'Повторить запрос', onClick: retry }}
        />
      ) : rows.length === 0 ? (
        // Пустота трёх родов, а не одна на все случаи (канон п.53): «книги не
        // прочитаны» лечится обновлением, «отфильтровано в ноль» — снятием
        // фильтра, «торгов нет» не лечится ничем и требует другого разговора.
        // Прежде все три случая говорили одну фразу про фильтры, и читатель
        // непрочитанных книг снимал фильтры впустую.
        (resp?.points.length ?? 0) === 0 && (resp?.unreadDepartments.length ?? 0) > 0 ? (
          <EmptyState
            tone="problem"
            size="compact"
            title="Книги, по которым считается снижение, не прочитаны"
            description={`Подходящих позиций нет ни одной, а книги не прочитаны у: ${resp?.unreadDepartments.map((u) => u.department).join(', ')}. Запустите обновление на странице «Система» — до этого среднее снижение считать не из чего.`}
          />
        ) : (resp?.points.length ?? 0) > 0 ? (
          <EmptyState
            size="compact"
            title="За выбранный период позиций с отражённым фактом нет"
            description={`Конкурентные позиции с отражённым фактом в книгах есть (${resp?.points.length}), но ни одна не попала в выбранный период. Расширьте период до года в шапке — числа вернутся.`}
          />
        ) : (
          <EmptyState
            size="compact"
            title="Конкурентных позиций с отражённым фактом нет"
            description="В книгах выбранных управлений нет конкурентных позиций с отражённым фактом — считать среднее снижение не из чего. Снимите отбор управлений в шапке, чтобы посмотреть по району целиком."
          />
        )
      ) : (
        <>
          {/* Три числа расчёта: множители и произведение. Цвет — только у данных. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={clsx(TILE, 'px-3 py-2.5')}>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Разница плана и факта
              </p>
              <p className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
                {stats.reductionPct !== null ? fmtPct(stats.reductionPct) : '—'}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {resp?.total ?? rows.length} {procWord(resp?.total ?? rows.length)} с отражённым фактом
              </p>
            </div>
            <div className={clsx(TILE, 'px-3 py-2.5')}>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Плановый объём ЕП за периметр
              </p>
              <p className="text-lg font-semibold tabular-nums text-zinc-700 dark:text-zinc-200 mt-0.5">
                {epHasData ? formatMoney(epPlan) : '—'}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {epHasData
                  ? 'деньги, запланированные без торгов'
                  : 'счётных строк ЕП за периметр нет'}
              </p>
            </div>
            {/* Итог расчёта — единственная плитка с собственным тоном: в тёмной
                теме её отделяет янтарная подложка, а не обводка (п.129). */}
            <div className="rounded-lg border border-amber-200/70 dark:border-transparent bg-amber-50/50 dark:bg-amber-400/[0.07] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80">
                Цена отказа от конкурса
              </p>
              <p className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400 mt-0.5">
                {refusalCost !== null ? `≈ ${formatMoney(refusalCost)}` : '—'}
              </p>
              <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70 mt-0.5">
                {refusalCost !== null
                  ? 'оценка, не обещание — методика ниже'
                  : epHasData ? 'состав источников неполон — оценка не рассчитана' : 'без объёма ЕП оценка не считается'}
              </p>
            </div>
          </div>

          {/* Методика — прямо на карточке (канон п. 53: карточка диагноста). */}
          <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400 mt-3">
            Методика: взвешенная разница = 1 − Σ факт Y / Σ план K по конкурентным
            позициям с отражённым фактом в выбранном периметре ({rows.length} {procWord(rows.length)};
            план {formatMoney(stats.sumPlan)}, факт {formatMoney(stats.sumFact)}).
            Сценарная оценка = плановый объём ЕП × это снижение. Это условный перенос разницы плана и факта на объём ЕП, без доказанной причинной связи. Подтверждённая экономия определяется отдельно по AD и Z+AA+AB.
          </p>

          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={detailId}
              className={clsx(
                'flex items-center gap-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-zinc-100 rounded-md px-1.5 py-1 -mx-1.5 transition-colors',
                FOCUS_RING,
              )}
            >
              {open ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
              {open ? 'Скрыть строки расчёта' : `Показать строки расчёта (${rows.length})`}
            </button>
            {/* Шов с «Экономией» (п.91-8): цена отказа и фактическая экономия
                торгов — родня, считаются по одним состоявшимся процедурам. */}
            <button
              type="button"
              onClick={() => navigateTo('economy')}
              title="Фактическая утверждённая экономия торгов и её динамика по кварталам — на вкладке «Экономия»"
              className={clsx(
                'text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline rounded-md px-1.5 py-1 -mx-1.5',
                FOCUS_RING,
              )}
            >
              Фактическая экономия и динамика — на вкладке «Экономия»
            </button>
          </div>

          {open && (
            <div id={detailId} className="mt-2 overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className={clsx('text-left text-[10px] uppercase text-zinc-500 dark:text-zinc-400', RULE_HEAD)}>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Управление</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Предмет закупки</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">План, тыс. ₽</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Отражённый факт, тыс. ₽</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Снижение</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.slice(0, ROWS_VISIBLE_LIMIT).map((p, i) => (
                    <tr key={i} className={clsx(RULE_ROW, 'align-top')}>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{productLabel(p.department)}</td>
                      <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-200 max-w-[380px]">
                        {/* Из числа — в строки-основания (канон п.119). Цель
                            собирает `buildDrill` (М14): управление, квартал
                            строки, способ и предмет едут вместе, а ось, которую
                            Реестр принять не умеет, названа в подсказке, а не
                            потеряна молча. */}
                        <RowLink point={p} onNavigate={navigateTo} />
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {fmtThousands(p.planTotal)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {fmtThousands(p.factTotal)}
                      </td>
                      <td className={clsx(
                        'py-1.5 text-right tabular-nums',
                        p.limitReductionPercent > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-zinc-500 dark:text-zinc-400',
                      )}>
                        {fmtPct(p.limitReductionPercent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sortedRows.length > ROWS_VISIBLE_LIMIT && (
                <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                  Показаны крупнейшие {ROWS_VISIBLE_LIMIT} из {sortedRows.length} строк — среднее выше посчитано по всем.
                </p>
              )}
            </div>
          )}


        </>
      )}
    </CompetitionCard>
  );
}
