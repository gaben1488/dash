/**
 * Single entry point to the actual control sources, inside the EXISTING
 * "Контроль → Замечания" page. This is a directory of evidence, not a new
 * scoring system, a second workflow database or a replacement for Monitoring.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { type ControlChannelId, type ControlPortfolioView } from '@aemr/shared';
import { fetchJSON, humanizeRequestError } from '../../api';
import { useStore } from '../../store';
import { CARD, RULE_DIVIDE, RULE_HEAD } from './surfaces';

const COVERAGE: Record<string, string> = {
  checked: 'Данные проверены в доступном периметре',
  partial: 'Проверка частичная',
  not_checked: 'Не проверено',
  failed: 'Сбой чтения',
  separate_authority: 'Отдельное официальное решение',
};

export function ControlPortfolioSection() {
  const navigateTo = useStore((s) => s.navigateTo);
  const [data, setData] = useState<ControlPortfolioView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchJSON<ControlPortfolioView>('/control/portfolio').then(
      result => { if (alive) setData(result); },
      e => { if (alive) setError(humanizeRequestError(e)); },
    ).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [attempt]);

  const openChannel = useCallback((id: ControlChannelId) => {
    if (id === 'reconciliation') navigateTo('quality', { qualityTab: 'recon' });
    else if (id === 'formula_integrity') navigateTo('quality', { qualityTab: 'issues', issuesSection: 'formulas' });
    else if (id === 'text_hygiene') navigateTo('quality', { qualityTab: 'issues', issuesSection: 'hygiene' });
    else if (id === 'procedure_monitoring') navigateTo('monitoring');
    else if (id === 'workload_events') navigateTo('discipline');
    else if (id === 'uer_recommendations') navigateTo('report');
    else navigateTo('quality', { qualityTab: 'issues', issuesSection: 'checks' });
  }, [navigateTo]);

  const unavailable = data?.channels.filter(x => x.coverage === 'not_checked' || x.coverage === 'failed' || x.coverage === 'partial').length;
  return (
    <section aria-label="Все источники контроля" className={`${CARD} rounded-xl overflow-hidden`}>
      <div className={`flex flex-wrap items-start gap-3 p-4 border-b ${RULE_HEAD}`}>
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Вся система контроля — один список источников</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
            Наблюдение, дело, событие работы и официальное решение — разные вещи.
            Данные исходных проверок и их история остаются в своих системах.
          </p>
          {data && (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              Источников: {data.channels.length}; требуют дополнительного чтения или имеют неполный охват: {unavailable}.
              Это не единый атомарный снимок.
            </p>
          )}
        </div>
        <button type="button" aria-expanded={opened} onClick={() => setOpened(v => !v)}
          className="inline-flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5">
          {opened ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {opened ? 'Свернуть источники' : 'Показать все источники'}
        </button>
        <button type="button" onClick={() => setAttempt(n => n + 1)}
          disabled={loading}
          title="Перечитать состояния источников. Сохранённые исходные книги не изменяются."
          className="inline-flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-50">
          <RefreshCw size={14} /> {loading ? 'Читаем…' : 'Проверить снова'}
        </button>
      </div>
      {error && (
        <p role="alert" className="p-4 text-xs text-red-700 dark:text-red-300">
          Не удалось собрать состояние источников: {error}. Это не означает, что замечаний нет.
        </p>
      )}
      {opened && data && (
        <div className={`divide-y ${RULE_DIVIDE}`}>
          {data.channels.map(channel => (
            <div key={channel.id} className="px-4 py-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-[200px] flex-1">
                <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{channel.title}</p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">{COVERAGE[channel.coverage] ?? 'Состояние неизвестно'}</p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 max-w-[66ch]">{channel.note}</p>
                {channel.sourceAsOf && <p className="text-[10px] text-zinc-500 mt-1">Источник: {channel.sourceAsOf}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-right">
                  <p className="text-sm tabular-nums font-semibold text-zinc-800 dark:text-zinc-100">
                    {channel.observations === null ? '—' : channel.observations.toLocaleString('ru-RU')}
                  </p>
                  <p className="text-[10px] text-zinc-500">наблюдений</p>
                  {channel.cases !== null && <p className="text-[10px] text-zinc-500">дел: {channel.cases}</p>}
                </div>
                <button type="button" onClick={() => openChannel(channel.id)}
                  aria-label={`Открыть источник: ${channel.title}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5">
                  Разобрать <ArrowRight size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!opened && data && (
        <p className="px-4 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Состав объединён в один каталог. Откройте список, чтобы увидеть состояние и адрес каждого источника.
          Числа разных механизмов не складываются: одна первопричина может иметь несколько наблюдений.
        </p>
      )}
    </section>
  );
}
