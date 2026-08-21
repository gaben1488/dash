// ────────────────────────────────────────────────────────────────
// «Сколько стоит отказ от конкурса» — блок 1 вкладки «Конкуренция».
//
// Счёт по СОБСТВЕННЫМ торгам периметра, без внешних коэффициентов:
//   снижение = 1 − Σ цена контракта / Σ НМЦК
//     по состоявшимся конкурентным процедурам (заключённые контракты —
//     гейт заключения /api/rows/scatter, пп. 38-39);
//   цена отказа = плановый объём ЕП периметра × это снижение.
//
// Методика написана ПРЯМО на карточке: это оценка по своей статистике
// торгов, а не обещание экономии. Клик раскрывает строки расчёта.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Scale } from 'lucide-react';
import clsx from 'clsx';
import { api, humanizeRequestError } from '../../api';
import { useStore } from '../../store';
import { useFilteredData } from '../../hooks/useFilteredData';
import { EmptyState } from '../EmptyState';
import { pluralRu } from '../../lib/economy-copy';
import { fmtThousands } from '../../lib/report/mappers';
import { buildDrill, type DrillFilters } from '../../lib/drill';
import type { OrgScope } from '../../lib/selectors/org-scope';
import { GROUP3_KB_ADDITIONS } from '../../pages/kb-additions';
import {
  CompetitionCard, FOCUS_RING, RULE_HEAD, RULE_ROW, SubScopeNote, TILE, fmtPct,
} from './primitives';

interface ScatterPoint {
  department: string;
  subject: string;
  planTotal: number;
  factTotal: number;
  economyPercent: number;
  procurementType: string;
  quarter: unknown;
}

interface ScatterResponse {
  points: ScatterPoint[];
  unreadDepartments: Array<{ department: string; reason: string }>;
  truncated: boolean;
  pointLimit: number;
}

/** Сколько строк расчёта показываем в раскрытии; остаток называется числом. */
const ROWS_VISIBLE_LIMIT = 30;

const rowsWord = (n: number) => pluralRu(n, 'строка', 'строки', 'строк');
const procWord = (n: number) => pluralRu(n, 'процедура', 'процедуры', 'процедур');

/** Номер квартала из ячейки листа («1», «1 кв», «I кв.») — или null. */
function parseQuarter(raw: unknown): number | null {
  const m = String(raw ?? '').match(/[1-4]/);
  return m ? Number(m[0]) : null;
}

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
  const quarter = parseQuarter(point.quarter);
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

export function CostOfRefusal({ epPlan, epHasData, orgScope }: {
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
  const fd = useFilteredData();

  const [resp, setResp] = useState<ScatterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const deptParam = useMemo(
    () => [...selectedDepartments].sort().join(','),
    [selectedDepartments],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = { type: 'competitive' };
    if (deptParam) params.dept = deptParam;
    api.getScatterData(params)
      .then((data: ScatterResponse) => {
        if (cancelled) return;
        setResp(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(humanizeRequestError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [deptParam, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // ── Сужение облака торгов до выбранных кварталов ──
  const hasActiveMonths = fd.periodResolution.hasActiveMonths;
  const yearWide = fd.periodKey === 'year' && !hasActiveMonths;
  const coveredQ = useMemo(() => {
    if (yearWide) return null;
    const qs = hasActiveMonths && fd.coveredQuarters.length > 0
      ? fd.coveredQuarters
      : [fd.periodKey];
    return new Set(qs.map((q) => Number(q.replace('q', ''))));
  }, [yearWide, hasActiveMonths, fd.coveredQuarters, fd.periodKey]);

  const { rows, droppedNoQuarter } = useMemo(() => {
    const all = resp?.points ?? [];
    if (!coveredQ) return { rows: all, droppedNoQuarter: 0 };
    let dropped = 0;
    const kept = all.filter((p) => {
      const q = parseQuarter(p.quarter);
      if (q === null) { dropped++; return false; }
      return coveredQ.has(q);
    });
    return { rows: kept, droppedNoQuarter: dropped };
  }, [resp, coveredQ]);

  const stats = useMemo(() => {
    let sumPlan = 0;
    let sumFact = 0;
    for (const p of rows) { sumPlan += p.planTotal; sumFact += p.factTotal; }
    const reductionPct = sumPlan > 0 ? (1 - sumFact / sumPlan) * 100 : null;
    return { sumPlan, sumFact, reductionPct };
  }, [rows]);

  const refusalCost = stats.reductionPct !== null && epHasData
    ? epPlan * (stats.reductionPct / 100)
    : null;

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => b.planTotal - a.planTotal),
    [rows],
  );

  // ── Оговорки счёта — на карточке, не в тултипе ──
  const caveats: string[] = [];
  if (resp && resp.unreadDepartments.length > 0) {
    caveats.push(
      `Не прочитаны книги: ${resp.unreadDepartments.map((u) => u.department).join(', ')} — торги этих управлений в среднем не участвуют.`,
    );
  }
  if (resp?.truncated) {
    caveats.push(
      `Выборка упёрлась в потолок ${resp.pointLimit} строк — среднее посчитано по показанной части, не по всем торгам.`,
    );
  }
  if (droppedNoQuarter > 0) {
    caveats.push(
      `${droppedNoQuarter} ${rowsWord(droppedNoQuarter)} без определимого квартала в счёт выбранного периода не вошли.`,
    );
  }
  if (coveredQ && fd.partialMonths.length > 0) {
    caveats.push(
      'Выбор месяцев сужает торги только до кварталов: точнее квартала строка торгов к месяцу не привязана.',
    );
  }
  // Периметры двух множителей разошлись (канон п.58б): объём ЕП сужен отбором
  // учреждений (fd.depts), а облако торгов — нет: запрос /api/rows/scatter
  // принимает только адрес управления, колонки учреждения у строки торгов нет.
  // Молчаливое произведение двух разных периметров и есть запрещённый случай.
  if (selectedSubordinates.size > 0) {
    caveats.push(
      'Отбор учреждений сужает плановый объём ЕП, но не статистику торгов: строка торгов приходит с адресом управления — среднее снижение посчитано по управлению целиком.',
    );
  }

  const detailId = 'cost-of-refusal-rows';

  return (
    <CompetitionCard
      // Заголовок-существительное и ровно тот, каким метрика названа в базе
      // знаний («Цена отказа от конкурса»): одно имя у числа на всех экранах.
      title="Цена отказа от конкурса"
      subtitle="На состоявшихся торгах цена падает от НМЦК; у закупки у единственного поставщика снижение — ноль. Цена отказа — сколько снижения теряет объём ЕП при среднем проценте собственных торгов."
      icon={Scale}
      caveats={caveats}
      kb={GROUP3_KB_ADDITIONS.refusal_cost}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 size={14} className="animate-spin text-zinc-400" aria-hidden="true" />
          Читаем заключённые контракты конкурентных процедур…
        </div>
      ) : error ? (
        <EmptyState
          tone="problem"
          size="compact"
          title="Статистика торгов не получена"
          description="Без строк заключённых контрактов среднее снижение посчитать не из чего. Повторите запрос; если ошибка вернётся — проверьте сервер на странице «Система»."
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
            description={`Строк торгов нет ни одной, а книги не прочитаны у: ${resp?.unreadDepartments.map((u) => u.department).join(', ')}. Запустите обновление на странице «Система» — до этого среднее снижение считать не из чего.`}
          />
        ) : (resp?.points.length ?? 0) > 0 ? (
          <EmptyState
            size="compact"
            title="За выбранный период состоявшихся торгов нет"
            description={`Заключённые контракты по конкурентным процедурам в книгах есть (${resp?.points.length}), но ни один не попал в выбранный период. Расширьте период до года в шапке — числа вернутся.`}
          />
        ) : (
          <EmptyState
            size="compact"
            title="Состоявшихся конкурентных торгов нет"
            description="В книгах выбранных управлений нет ни одного заключённого контракта по конкурентной процедуре — считать среднее снижение не из чего. Снимите отбор управлений в шапке, чтобы посмотреть по району целиком."
          />
        )
      ) : (
        <>
          {/* Три числа расчёта: множители и произведение. Цвет — только у данных. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={clsx(TILE, 'px-3 py-2.5')}>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Среднее снижение на торгах
              </p>
              <p className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
                {stats.reductionPct !== null ? fmtPct(stats.reductionPct) : '—'}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                по {rows.length} {procWord(rows.length)} с заключённым контрактом
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
                  : 'без объёма ЕП оценка не считается'}
              </p>
            </div>
          </div>

          {/* Методика — прямо на карточке (канон п. 53: карточка диагноста). */}
          <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400 mt-3">
            Методика: среднее снижение = 1 − Σ цена контракта / Σ НМЦК по состоявшимся
            конкурентным процедурам периметра ({rows.length} {procWord(rows.length)};
            НМЦК {formatMoney(stats.sumPlan)}, контракты {formatMoney(stats.sumFact)}).
            Цена отказа = плановый объём ЕП × это снижение. Это оценка по собственной
            статистике торгов района, а не обещанная экономия: реальное снижение зависит
            от предмета и рынка.
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
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">НМЦК, тыс. ₽</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Контракт, тыс. ₽</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Снижение</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.slice(0, ROWS_VISIBLE_LIMIT).map((p, i) => (
                    <tr key={i} className={clsx(RULE_ROW, 'align-top')}>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{p.department}</td>
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
                        p.economyPercent > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-zinc-500 dark:text-zinc-400',
                      )}>
                        {fmtPct(p.economyPercent)}
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

          {/* Режим подведов: разбивки здесь нет — и это сказано словами вместе
              с механизмом (приказ 20.08). Строка торгов приходит с адресом
              управления; колонки учреждения у неё нет. */}
          <SubScopeNote
            mode={orgScope.mode}
            deptLabel={orgScope.dept}
            reason="строка торгов приходит с адресом управления, колонки учреждения у неё нет — разложить среднее снижение по учреждениям не из чего. Разбивка по учреждениям есть у доли закупок без торгов ниже."
          />
        </>
      )}
    </CompetitionCard>
  );
}
