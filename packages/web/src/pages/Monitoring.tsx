/**
 * «Мониторинг · Реестр процедур определения поставщика» — книга «Ежедневный
 * мониторинг» (канон п.69в: отдельная вкладка, не сливать с планом; п.101а:
 * название дополнено «Реестром процедур», переносятся все листы книги —
 * эта волна несёт восемь листов управлений, остальные — следующей).
 *
 * Правила экрана:
 *  - деньги — РУБЛИ, и подпись единицы стоит у каждой суммы: книги управлений
 *    ведутся в тысячах, перепутать — значит ошибиться в тысячу раз (18.08);
 *  - плашка периметра (п.58): книга-источник, момент чтения, оговорка, что
 *    глобальные фильтры шапки к этой книге не применяются;
 *  - стадия — по числам (цена/даты), текст «Победителя» не интерпретируется
 *    (п.27) и показывается как есть;
 *  - честные пустоты: «книга не прочитана» ≠ «в книге нет процедур» ≠
 *    «фильтры всё срезали» — три разных экрана;
 *  - нераспознанные коды процедур — плашка с адресами (сигнал, не потеря).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RotateCcw, SearchX } from 'lucide-react';
import type { MonitoringProcedure, ProcedureStage } from '@aemr/core';
import { PROCEDURE_STAGE_LABELS } from '@aemr/core';
import { api, humanizeRequestError, type MonitoringResponse } from '../api';
import { EmptyState } from '../components/EmptyState';
import { SkeletonKPIRow, SkeletonTable } from '../components/Skeleton';
import { KBTooltip } from '../components/ui/kb-tooltip';
import { pluralRu } from '../lib/economy-copy';
import { MONITORING_KB_ADDITIONS, kbCardProps } from './kb-additions';

// ── Форматирование ───────────────────────────────────────────────────

/** Рубли с разрядами, без копеек: копейки в реестре — шум, точность в title. */
const fmtRub = (v: number): string =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

/** Момент чтения книги: «18.08.2026, 14:05» по часам читателя. */
function fmtReadAt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Порядок стадий на экране — жизненный цикл процедуры, не алфавит. */
const STAGE_ORDER: ProcedureStage[] = ['application', 'published', 'awarded', 'no_result'];

/** Тон бейджа стадии: цвет — данным, стадия и есть данные строки. */
const STAGE_BADGE: Record<ProcedureStage, string> = {
  application: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-300',
  published: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  awarded: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  no_result: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
};

// ── Страница ─────────────────────────────────────────────────────────

export function MonitoringPage() {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<ProcedureStage | null>(null);
  const [customerFilter, setCustomerFilter] = useState<string>('');

  const load = useCallback((refresh = false) => {
    setLoading(true);
    setError(null);
    api.getMonitoring(refresh)
      .then((resp) => setData(resp))
      .catch((e: unknown) => setError(humanizeRequestError(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Своя ссылка-мемо: «?? []» в теле рендера рождал бы новый массив на каждый
  // кадр и зря пересчитывал фильтры и список заказчиков ниже.
  const procedures = useMemo(() => data?.procedures ?? [], [data]);

  /** Заказчики для фильтра — по алфавиту, без дублей. */
  const customers = useMemo(
    () => [...new Set(procedures.map((p) => p.customer).filter((c) => c !== ''))]
      .sort((a, b) => a.localeCompare(b, 'ru')),
    [procedures],
  );

  const filtered = useMemo(
    () => procedures.filter((p) =>
      (stageFilter === null || p.stage === stageFilter)
      && (customerFilter === '' || p.customer === customerFilter)),
    [procedures, stageFilter, customerFilter],
  );

  const agg = data?.aggregates ?? null;
  const failedSheets = data ? Object.keys(data.source.sheetsFailed) : [];

  return (
    <div className="space-y-4">
      {/* ── Шапка раздела: название по п.101а + плашка периметра (п.58) ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">
            Мониторинг · Реестр процедур определения поставщика
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-2xl mt-0.5">
            Процедуры из книги «Ежедневный мониторинг»: заявка → публикация →
            торги → итог. Другая книга, чем планы управлений: деньги здесь —
            в рублях.
          </p>
        </div>
        {data && (
          <div className="text-right text-[11px] text-zinc-500 dark:text-zinc-400">
            <p>Книга «{data.source.bookName}» · все процедуры книги</p>
            <p className="mt-0.5">данные на {fmtReadAt(data.source.readAt)}</p>
            {/* Экран не подчиняется глобальным фильтрам шапки — честная
                пометка вместо унаследованного бейджа (п.58б). */}
            <p className="mt-0.5">фильтры года и управлений шапки здесь не действуют</p>
          </div>
        )}
      </div>

      {/* ── Книга не прочиталась целиком: поимённая плашка, не тишина ── */}
      {failedSheets.length > 0 && !loading && (
        <div className="flex items-start gap-2 text-xs bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 mt-px shrink-0" aria-hidden="true" />
          <div className="text-amber-800 dark:text-amber-300">
            <p>
              Листы книги не прочитались: {failedSheets.join(', ')}. Счётчики
              ниже собраны только по прочитанным листам и неполные.
            </p>
            <button
              type="button"
              onClick={() => load(true)}
              className="mt-1.5 inline-flex items-center gap-1 font-medium hover:underline"
            >
              <RotateCcw size={11} aria-hidden="true" /> Прочитать книгу ещё раз
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-4" role="status" aria-live="polite">
          <span className="sr-only">Читаем книгу «Ежедневный мониторинг»</span>
          <SkeletonKPIRow count={4} />
          <SkeletonTable rows={10} />
        </div>
      ) : error ? (
        <EmptyState
          tone="problem"
          title="Книга «Ежедневный мониторинг» не прочитана"
          description="Реестр процедур собрать не из чего: сервер не отдал ни одного листа книги. Это отказ чтения, а не «в книге пусто»."
          detail={error}
          action={{ label: 'Прочитать ещё раз', onClick: () => load(true) }}
        />
      ) : procedures.length === 0 ? (
        <EmptyState
          title="На прочитанных листах книги нет ни одной строки процедуры"
          description="Листы управлений прочитаны, но строк с данными в них не нашлось. Если процедуры ожидались — проверьте книгу-источник."
          action={{ label: 'Прочитать ещё раз', onClick: () => load(true) }}
        />
      ) : (
        <>
          {/* ── Карточки-агрегаты: цвет — данным, подпись единицы у денег ── */}
          {agg && (
            <section
              aria-label="Сводка по процедурам"
              className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-5"
            >
              <div className="flex items-start gap-8 flex-wrap">
                <KBTooltip {...kbCardProps(MONITORING_KB_ADDITIONS.monitoring_procedures_total)} showIcon>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                      {agg.total}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {pluralRu(agg.total, 'процедура', 'процедуры', 'процедур')} в реестре
                    </p>
                  </div>
                </KBTooltip>
                <div>
                  <p className="text-2xl font-semibold tabular-nums text-sky-700 dark:text-sky-400">
                    {agg.byStage.published}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">в торгах (объявлены, итога нет)</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {agg.byStage.awarded}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    состоялось · без результата — {agg.byStage.no_result}
                  </p>
                </div>
                <KBTooltip {...kbCardProps(MONITORING_KB_ADDITIONS.monitoring_auction_savings)} showIcon>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {fmtRub(agg.awarded.savingsTotal)} руб.
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      экономия на торгах: НМЦК {fmtRub(agg.awarded.nmckTotal)} → цена {fmtRub(agg.awarded.priceTotal)}
                    </p>
                  </div>
                </KBTooltip>
                <div>
                  <p className="text-2xl font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                    {agg.awarded.avgReductionPct !== null
                      ? `${agg.awarded.avgReductionPct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`
                      : '—'}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {agg.awarded.avgReductionPct !== null
                      ? `среднее снижение · без снижения — ${agg.awarded.noReductionCount} из ${agg.awarded.count}`
                      : 'среднего снижения нет: состоявшихся торгов нет'}
                  </p>
                </div>
              </div>
              <p className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-700/50 text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                НМЦК всех процедур реестра — {fmtRub(agg.nmckTotal)} руб. Деньги этой книги —
                в рублях; книги управлений ведутся в тысячах рублей.
              </p>
            </section>
          )}

          {/* ── Нераспознанные коды: сигнал с адресами (спека §2), не потеря ── */}
          {data && data.unparsedCodes.length > 0 && (
            <details className="text-xs bg-white dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-700/50 rounded-xl px-4 py-3 text-zinc-600 dark:text-zinc-300">
              <summary className="cursor-pointer font-medium">
                Код процедуры не распознан у {data.unparsedCodes.length}{' '}
                {pluralRu(data.unparsedCodes.length, 'строки', 'строк', 'строк')} — искажён формат
                записи; строки остались в реестре без кода
              </summary>
              <ul className="mt-2 space-y-1">
                {data.unparsedCodes.map((u) => (
                  <li key={`${u.sheet}:${u.row}`} className="tabular-nums">
                    Лист «{u.sheet}», строка {u.row}: «{u.text}» — поправить код в книге
                    (образец: ЭА152-26, без дефиса после букв и без приписок).
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* ── Фильтры страницы: стадия + заказчик ── */}
          <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Фильтр по стадии">
            <button
              type="button"
              onClick={() => setStageFilter(null)}
              aria-pressed={stageFilter === null}
              className={stageFilter === null
                ? 'px-2.5 py-1 text-xs font-medium rounded-full bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'px-2.5 py-1 text-xs font-medium rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/40 transition'}
            >
              Все стадии
            </button>
            {STAGE_ORDER.map((stage) => {
              const active = stageFilter === stage;
              const count = agg?.byStage[stage] ?? 0;
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setStageFilter(active ? null : stage)}
                  aria-pressed={active}
                  className={active
                    ? 'px-2.5 py-1 text-xs font-medium rounded-full bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'px-2.5 py-1 text-xs font-medium rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/40 transition'}
                >
                  {PROCEDURE_STAGE_LABELS[stage]} · {count}
                </button>
              );
            })}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Заказчик
              <select
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="max-w-[16rem] truncate text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 px-2 py-1"
              >
                <option value="">все заказчики</option>
                {customers.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>

          {/* ── Таблица реестра ── */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Под выбранные фильтры не попала ни одна процедура"
              description={`В реестре ${procedures.length} ${pluralRu(procedures.length, 'процедура', 'процедуры', 'процедур')} — фильтры стадии или заказчика срезали все строки. Это отбор экрана, а не пустота книги.`}
              action={{
                label: 'Сбросить фильтры',
                onClick: () => { setStageFilter(null); setCustomerFilter(''); },
              }}
            />
          ) : (
            <section
              aria-label="Реестр процедур"
              className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-x-auto"
            >
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-zinc-500 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-700/50">
                    <th className="px-3 py-2 font-medium">Код</th>
                    <th className="px-3 py-2 font-medium">Заказчик</th>
                    <th className="px-3 py-2 font-medium">Предмет</th>
                    <th className="px-3 py-2 font-medium text-right">НМЦК, руб.</th>
                    <th className="px-3 py-2 font-medium">Публикация</th>
                    <th className="px-3 py-2 font-medium">Торги</th>
                    <th className="px-3 py-2 font-medium text-right">Цена, руб.</th>
                    <th className="px-3 py-2 font-medium text-right">Снижение</th>
                    <th className="px-3 py-2 font-medium">Стадия</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => <ProcedureRow key={`${p.sheet}:${p.row}`} p={p} />)}
                </tbody>
              </table>
            </section>
          )}

          {/* Оговорки сервера (единица денег, неполнота, сигналы) — как есть. */}
          {data && data.notes.length > 0 && (
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 space-y-0.5">
              {data.notes.map((n) => <p key={n}>{n}</p>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Строка таблицы: адрес листа книги — в подсказке кода (карточка п.53). */
function ProcedureRow({ p }: { p: MonitoringProcedure }) {
  return (
    <tr className="border-b border-zinc-50 dark:border-zinc-700/30 align-top">
      <td
        className="px-3 py-2 whitespace-nowrap font-medium tabular-nums text-zinc-800 dark:text-zinc-100"
        title={`Лист «${p.sheet}», строка ${p.row}`}
      >
        {p.code ?? <span className="text-amber-600 dark:text-amber-400" title="Код не распознан — формат записи искажён; адрес строки в плашке над таблицей">без кода</span>}
      </td>
      <td className="px-3 py-2 max-w-[14rem] truncate text-zinc-600 dark:text-zinc-300" title={p.customer}>
        {p.customer}
      </td>
      <td className="px-3 py-2 max-w-[24rem] truncate text-zinc-600 dark:text-zinc-300" title={p.subject}>
        {p.subject}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-zinc-800 dark:text-zinc-100">
        {p.nmck !== null ? fmtRub(p.nmck) : '—'}
      </td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">
        {p.publicationDate ?? '—'}
      </td>
      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-zinc-500 dark:text-zinc-400">
        {p.auctionDate ?? '—'}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-zinc-800 dark:text-zinc-100">
        {p.auctionPrice !== null && p.auctionPrice > 0 ? fmtRub(p.auctionPrice) : '—'}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
        {p.reductionPct !== null ? (
          <span className={p.reductionPct > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'}>
            {p.reductionPct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %
          </span>
        ) : '—'}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] ${STAGE_BADGE[p.stage]}`}>
          {PROCEDURE_STAGE_LABELS[p.stage]}
        </span>
      </td>
    </tr>
  );
}
