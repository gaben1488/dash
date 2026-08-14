// ────────────────────────────────────────────────────────────────
// «Кандидаты на объединение» — блок 2 вкладки «Конкуренция».
//
// Группы одинаковых предметов у разных заказчиков (ядро —
// core/analytics/centralization, ЕП ВКЛЮЧЕНЫ: страж §5.2), сортировка
// по объёму; каждая группа раскрывается до строк с адресами управлений.
// Экономия числом не обещается: методики оценки эффекта объединения нет,
// группа показывает свой объём в деньгах и число заказчиков.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Layers, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { productLabel } from '@aemr/shared';
import { api, humanizeRequestError } from '../../api';
import { useStore } from '../../store';
import { useFilteredData } from '../../hooks/useFilteredData';
import { EmptyState } from '../EmptyState';
import { pluralRu } from '../../lib/economy-copy';
import { CompetitionCard, FOCUS_RING } from './primitives';

interface MemberDTO {
  grbsId: string;
  subject: string;
  planTotal: number;
  method: string;
}

interface OpportunityDTO {
  category: string;
  departments: string[];
  totalAmount: number;
  contractCount: number;
  epAmount: number;
  epCount: number;
  members: MemberDTO[];
  priority: 'high' | 'medium' | 'low';
}

interface CentralizationResponse {
  opportunities: OpportunityDTO[];
  totalOpportunities: number;
  totalAmount: number;
  totalEpAmount: number;
}

/** Сколько строк группы показываем в раскрытии; остаток называется числом. */
const MEMBERS_VISIBLE_LIMIT = 50;

const deptsWord = (n: number) => pluralRu(n, 'управление', 'управления', 'управлений');
const rowsWord = (n: number) => pluralRu(n, 'закупка', 'закупки', 'закупок');

export function MergeCandidates() {
  const formatMoney = useStore((s) => s.formatMoney);
  const fd = useFilteredData();

  const [data, setData] = useState<CentralizationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getAnalyticsCentralization()
      .then((resp: CentralizationResponse) => {
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

  const toggle = useCallback((cat: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // ── Оговорки периметра: блок считается по всем книгам всего года ──
  const caveats: string[] = [];
  if (fd.periodKey !== 'year' || fd.periodResolution.hasActiveMonths) {
    caveats.push(
      'Кандидаты ищутся по книгам всего года: выбор квартала или месяцев этот блок не сужает.',
    );
  }
  if (fd.hasDeptFilter) {
    caveats.push(
      'Отбор управлений не применяется: объединение по определению ищется поверх всех управлений разом.',
    );
  }

  return (
    <CompetitionCard
      title="Кандидаты на объединение закупок"
      subtitle="Одну и ту же категорию закупают несколько управлений по отдельности — включая закупки у единственного поставщика: это первые кандидаты на один общий конкурс (ст. 25 44-ФЗ). Экономию числом продукт не обещает — методики оценки эффекта объединения нет."
      icon={Layers}
      caveats={caveats}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 size={14} className="animate-spin text-zinc-400" aria-hidden="true" />
          Сверяем предметы закупок между управлениями…
        </div>
      ) : error ? (
        <EmptyState
          tone="problem"
          size="compact"
          title="Список кандидатов не получен"
          description="Сервер не отдал результат сверки категорий между управлениями. Повторите запрос; если ошибка вернётся — проверьте сервер на странице «Система»."
          detail={error}
          action={{ label: 'Повторить запрос', onClick: retry }}
        />
      ) : !data || data.opportunities.length === 0 ? (
        <EmptyState
          size="compact"
          title="Пересечений категорий между управлениями не найдено"
          description="Группа становится кандидатом, когда одну категорию закупают не меньше трёх управлений на сумму от 3 млн ₽ за год. Таких пересечений в книгах сейчас нет — либо книги ещё не прочитаны (запустите обновление в шапке)."
        />
      ) : (
        <>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-3">
            Найдено групп: <strong className="text-zinc-700 dark:text-zinc-200">{data.totalOpportunities}</strong>,
            их объём: <strong className="text-zinc-700 dark:text-zinc-200 tabular-nums">{formatMoney(data.totalAmount)}</strong>,
            из них без торгов (ЕП): <strong className="text-amber-700 dark:text-amber-400 tabular-nums">{formatMoney(data.totalEpAmount)}</strong>.
            Сортировка — по объёму группы.
          </p>

          <ul className="space-y-2">
            {data.opportunities.map((o) => {
              const open = openGroups.has(o.category);
              const panelId = `merge-group-${o.category}`;
              const sortedMembers = [...o.members].sort((a, b) => b.planTotal - a.planTotal);
              return (
                <li
                  key={o.category}
                  className="rounded-lg border border-zinc-100 dark:border-zinc-700/50 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggle(o.category)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    className={clsx(
                      'w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition-colors',
                      FOCUS_RING,
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                        {o.category}
                      </span>
                      <span className="block text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {o.departments.length} {deptsWord(o.departments.length)}: {o.departments.map((d) => productLabel(d)).join(', ')}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="text-right">
                        <span className="block text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                          {formatMoney(o.totalAmount)}
                        </span>
                        <span className="block text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                          {o.contractCount} {rowsWord(o.contractCount)}
                          {o.epCount > 0 && (
                            <>
                              {' · '}
                              <span className="text-amber-700 dark:text-amber-400">
                                ЕП: {formatMoney(o.epAmount)} в {o.epCount}
                              </span>
                            </>
                          )}
                        </span>
                      </span>
                      {open
                        ? <ChevronUp size={14} className="text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
                        : <ChevronDown size={14} className="text-zinc-500 dark:text-zinc-400" aria-hidden="true" />}
                    </span>
                  </button>

                  {open && (
                    <div id={panelId} className="border-t border-zinc-100 dark:border-zinc-700/50 px-3 py-2 overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-left text-[10px] uppercase text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-700/50">
                            <th scope="col" className="py-1.5 pr-3 font-medium">Управление</th>
                            <th scope="col" className="py-1.5 pr-3 font-medium">Предмет закупки</th>
                            <th scope="col" className="py-1.5 pr-3 font-medium">Способ</th>
                            <th scope="col" className="py-1.5 text-right font-medium">План, тыс. ₽</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedMembers.slice(0, MEMBERS_VISIBLE_LIMIT).map((m, i) => (
                            <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800/50 align-top">
                              <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                                {productLabel(m.grbsId)}
                              </td>
                              <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-200 max-w-[420px]">
                                <span className="line-clamp-2" title={m.subject}>{m.subject}</span>
                              </td>
                              <td className={clsx(
                                'py-1.5 pr-3 whitespace-nowrap',
                                m.method === 'ЕП'
                                  ? 'text-amber-700 dark:text-amber-400 font-medium'
                                  : 'text-zinc-500 dark:text-zinc-400',
                              )}>
                                {m.method === 'ЕП' ? 'ЕП (без торгов)' : m.method}
                              </td>
                              <td className="py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                                {m.planTotal.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {sortedMembers.length > MEMBERS_VISIBLE_LIMIT && (
                        <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                          Показаны крупнейшие {MEMBERS_VISIBLE_LIMIT} из {sortedMembers.length} строк группы — итоги выше посчитаны по всем.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </CompetitionCard>
  );
}
