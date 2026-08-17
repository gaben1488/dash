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
import { GROUP3_KB_ADDITIONS } from '../../pages/kb-additions';
import { CompetitionCard, FOCUS_RING, fmtPct } from './primitives';

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

export function CostOfRefusal({ epPlan, epHasData }: {
  /** Плановый объём ЕП за периметр шапки, тыс. ₽ (счёт — sumEpKp). */
  epPlan: number;
  epHasData: boolean;
}) {
  const formatMoney = useStore((s) => s.formatMoney);
  const selectedDepartments = useStore((s) => s.selectedDepartments);
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

  const detailId = 'cost-of-refusal-rows';

  return (
    <CompetitionCard
      title="Сколько стоит отказ от конкурса"
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
        <EmptyState
          size="compact"
          title="Состоявшихся конкурентных торгов за периметр нет"
          description="В выбранный период и отбор управлений не попало ни одного заключённого контракта по конкурентной процедуре — среднее снижение считать не из чего. Расширьте период до года или снимите отбор управлений в шапке."
        />
      ) : (
        <>
          {/* Три числа расчёта: множители и произведение. Цвет — только у данных. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-zinc-100 dark:border-zinc-700/50 px-3 py-2.5">
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
            <div className="rounded-lg border border-zinc-100 dark:border-zinc-700/50 px-3 py-2.5">
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
            <div className="rounded-lg border border-amber-200/70 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-900/10 px-3 py-2.5">
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
                  <tr className="text-left text-[10px] uppercase text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-700/50">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Управление</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Предмет закупки</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">НМЦК, тыс. ₽</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Контракт, тыс. ₽</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Снижение</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.slice(0, ROWS_VISIBLE_LIMIT).map((p, i) => (
                    <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50 align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{p.department}</td>
                      <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-200 max-w-[380px]">
                        <span className="line-clamp-2" title={p.subject}>{p.subject}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {p.planTotal.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                        {p.factTotal.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}
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
        </>
      )}
    </CompetitionCard>
  );
}
