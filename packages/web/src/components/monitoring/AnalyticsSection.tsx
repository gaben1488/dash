/**
 * Аналитика текущей выборки реестра и того же снимка данных.
 * Внешняя сверка ГРБС загружается отдельно; её отказ не скрывает реестр.
 * Без переданного снимка сохраняется самостоятельное чтение для старых маршрутов.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { SkeletonTable } from '../Skeleton';
import { humanizeRequestError } from '../../api';
import {
  fetchMonitoringAnalytics, fetchMonitoringMatchView,
  type AnalyticsPayload, type MatchViewPayload, type SeasonBasis,
} from '../../lib/monitoring/analytics-contract';
import type { RegistryProcedure } from '../../lib/monitoring/contract';
import { selectedAnalytics } from '../../lib/monitoring/selection-analytics';
import { funnelMoney, reductionByMethod } from '../../lib/monitoring/charts';
import {
  budgetSavings, carryOver, customerConcentration, jointComparison,
  rejoinedFates, zeroReduction,
} from '../../lib/monitoring/bi';
import { PROCEDURE_FATE_LABELS } from '@aemr/core';
import { fmtReadAt } from '../../lib/monitoring/format';
import { StageFunnel } from './StageFunnel';
import { DiscountHistogram } from './DiscountHistogram';
import { SupplierTop } from './SupplierTop';
import { SupplierPairs } from './SupplierPairs';
import { StageDurationBox } from './StageDurationBox';
import { SeasonChart } from './SeasonChart';
import { DeptCompare } from './DeptCompare';
import { AnomalyList } from './AnomalyList';
import { MatchPanel } from './MatchPanel';
import { CustomerWeight } from './CustomerWeight';
import { BudgetSavingsCard } from './BudgetSavings';
import { ZeroReductionCard } from './ZeroReduction';
import { CarryOverCard } from './CarryOver';
import { JointPurchasesCard } from './JointPurchases';
import { RejoinedFatesCard } from './RejoinedFates';
// Секция ставит СВОЙ провайдер периметра: аналитика едет отдельным запросом и
// своим моментом чтения книги, и подписать её числа моментом реестра значило
// бы соврать про свежесть (канон п.64г — момент есть ось периметра).
import { MonitoringPerimeterProvider } from './PerimeterProvider';
import { CONTROL } from './surfaces';

export interface MonitoringAnalyticsSectionProps {
  registryReadAt?: string;
  sharedMatch?: MatchViewPayload | null;
  sharedMatchError?: string | null;
  onReloadMatch?: () => void;
  /**
   * Строки реестра, которые читатель сейчас видит. Нужны для денег воронки и
   * разреза по способу закупки; без них эти два места честно молчат.
   */
  procedures?: RegistryProcedure[];
  /** Клик по корзине гистограммы — отбор реестра по величине снижения. */
  onPickDiscountBucket?: (bucketKey: string) => void;
  /**
   * Клик по поставщику в топе — отбор реестра по его ИНН (п.119: от числа к
   * строкам-основаниям). Имя идёт вторым: оно запасной ключ для побед, где ИНН
   * в книге не проставлен.
   */
  onPickSupplier?: (inn: string | null, name: string) => void;
  /** Клик по управлению в сравнении — изоляция периметра шапки (п.127). */
  onPickDept?: (dept: string) => void;

  // ── Разрезы витрины «где деньги · где риск · где затык» ──
  //
  // Шесть разрезов ниже считаются ПРЯМО ПО СТРОКАМ РЕЕСТРА, а не приезжают
  // разделом ответа: строки уже в памяти страницы, и второй поход на сервер
  // добавил бы им вторую судьбу отказа и второй момент чтения. Поэтому без
  // `procedures` они честно молчат — так же, как деньги воронки.

  /**
   * Строки переходящего реестра «25-26» — источник причин повторного круга.
   * `undefined` означает «лист сервер не отдал», пустой массив — «лист
   * прочитан, пометок нет». Это две разные новости, и разрез говорит их
   * разными словами.
   */
  journalRows?: readonly { fate: string | null; fateRaw: string | null }[];
  /** Клик по заказчику — отбор реестра тем же написанием колонки «Заказчик». */
  onPickCustomer?: (customer: string) => void;
  /** Клик по бесторговым — отбор реестра корзиной «снижения не было». */
  onPickZeroReduction?: () => void;
  /** Клик по способу закупки — отбор реестра тем же способом. */
  onPickMethod?: (method: string) => void;
  /** Клик по году нумерации — отбор реестра годом процедуры. */
  onPickYear?: (year: number) => void;
  /** Клик по совместным лотам — отбор реестра совместным аукционом. */
  onPickJoint?: () => void;
  /** Клик по написанию судьбы — переход на лист «25-26» с поиском по нему. */
  onPickFate?: (sample: string) => void;
}

export function MonitoringAnalyticsSection({
  procedures, onPickDiscountBucket, onPickSupplier, onPickDept, registryReadAt, sharedMatch, sharedMatchError, onReloadMatch,
  journalRows, onPickCustomer, onPickZeroReduction, onPickMethod,
  onPickYear, onPickJoint, onPickFate,
}: MonitoringAnalyticsSectionProps) {
  const [remoteData, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basis, setBasis] = useState<SeasonBasis>('publication');

  const [match, setMatch] = useState<MatchViewPayload | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);

  const load = useCallback((nextBasis: SeasonBasis) => {
    setLoading(true);
    setError(null);
    fetchMonitoringAnalytics(nextBasis)
      .then(setData)
      .catch((e: unknown) => setError(humanizeRequestError(e)))
      .finally(() => setLoading(false));
  }, []);

  const loadMatch = useCallback(() => {
    if (onReloadMatch) { onReloadMatch(); return; }
    setMatchError(null);
    fetchMonitoringMatchView()
      .then((m) => setMatch(m))
      .catch((e: unknown) => {
        setMatch(null);
        setMatchError(humanizeRequestError(e));
      });
  }, [onReloadMatch]);

  useEffect(() => { if (procedures === undefined || registryReadAt === undefined) load(basis); }, [load, basis, registryReadAt, procedures]);
  const localData = useMemo(
    () =>
      procedures !== undefined && registryReadAt !== undefined
        ? selectedAnalytics(procedures, registryReadAt, basis)
        : null,
    [procedures, registryReadAt, basis],
  );
  const data = localData ?? remoteData;
  useEffect(() => { if (sharedMatch === undefined) loadMatch(); }, [loadMatch, sharedMatch]);

  const periodLabel = data === null
    ? 'аналитика ещё считается'
    : `данные книги на ${fmtReadAt(data.source.readAt)}`;

  if (loading && data === null) {
    return (
      <section className="space-y-3" role="status" aria-live="polite">
        <span className="sr-only">Считаем аналитику по книге «Ежедневный мониторинг»</span>
        <SkeletonTable rows={6} />
      </section>
    );
  }

  if (data === null) {
    return (
      <EmptyState
        tone="problem"
        title="Аналитика по книге не посчитана"
        description="Воронку, снижение, поставщиков и сроки собрать не из чего: сервер не отдал раздел аналитики. Реестр выше от этого не пострадал — числа не потеряны, их просто нечем сейчас посчитать."
        {...(error !== null ? { detail: error } : {})}
        action={{ label: 'Посчитать ещё раз', onClick: () => load(basis) }}
      />
    );
  }

  const a = data.analytics;
  const sameRead = registryReadAt === undefined || registryReadAt === data.source.readAt;
  const money = procedures === undefined || !sameRead ? null : funnelMoney(procedures);
  const byMethod = procedures === undefined || !sameRead ? null : reductionByMethod(procedures);

  // Шесть разрезов витрины считаются по строкам реестра прямо здесь. Счёт
  // дешёвый (один проход по нескольким сотням строк), а вот `useMemo` на
  // каждый разрез стоил бы шести зависимостей и шести поводов рассинхронить
  // их между собой — экономия не окупает риска.
  const bi = procedures === undefined || !sameRead ? null : {
    customers: customerConcentration(procedures),
    budget: budgetSavings(procedures),
    zero: zeroReduction(procedures),
    carry: carryOver(procedures),
    joint: jointComparison(procedures),
  };
  const fates = journalRows === undefined || !sameRead
    ? null
    : rejoinedFates(journalRows, PROCEDURE_FATE_LABELS);

  return (
    <MonitoringPerimeterProvider readAt={data.source.readAt}>
    <section className="space-y-3">
      <p className="text-sm text-zinc-500">{localData !== null
            ? `Аналитика выбранных процедур · ${procedures?.length ?? 0}. ${periodLabel}.`
            : `Районная аналитика · весь округ. Отдельное чтение: ${periodLabel}.`}</p>
      {!sameRead && <p role="status" className="text-sm text-amber-700">Время чтения аналитики отличается от реестра. Сочетание чисел из разных чтений не показывается; обновите книгу для общей сверки.</p>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Аналитика мониторинга
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            То, чего книга не считает сама. Витрина отвечает на три вопроса: <span className="font-medium">где
            деньги</span> — у каких заказчиков, в чьих бюджетах, в совместных или одиночных лотах;{' '}
            <span className="font-medium">где риск</span> — сколько прошло без торга, где цена не
            подвинулась, что нашли машинные проверки; <span className="font-medium">где затык</span> —
            сколько тянется с прошлого года, где стоят сроки, почему пошли на повторный круг.
            У каждого числа названы колонки книги, за каждым — дверь к самим строкам.
            Деньги здесь — рубли книги мониторинга.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { if (localData === null) load(basis); loadMatch(); }}
          className={`inline-flex items-center gap-1 ${CONTROL} px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/40`}
        >
          <RotateCcw size={12} aria-hidden="true" /> Пересчитать аналитику
        </button>
      </div>

      {error !== null && (
        <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          Последний пересчёт не удался ({error}); ниже — числа предыдущего успешного чтения книги.
        </p>
      )}

      <details open className="space-y-4"><summary className="cursor-pointer py-3 text-lg font-semibold">Итоги и деньги</summary>
      <StageFunnel funnel={a.funnel} money={money} periodLabel={periodLabel} />

      {/* ── Где деньги: у кого они и чей рубль сэкономлен ── */}
      {bi !== null && (
        <>
          <CustomerWeight
            concentration={bi.customers}
            periodLabel={periodLabel}
            {...(onPickCustomer !== undefined ? { onPickCustomer } : {})}
          />
          <BudgetSavingsCard
            budget={bi.budget}
            periodLabel={periodLabel}
            {...(onPickDept !== undefined ? { onPickDept } : {})}
          />
        </>
      )}

      <DiscountHistogram
        reduction={a.reduction}
        histogram={a.histogram}
        nmckBuckets={a.nmckBuckets}
        byMethod={byMethod}
        periodLabel={periodLabel}
        {...(onPickDiscountBucket !== undefined ? { onPickBucket: onPickDiscountBucket } : {})}
      />

      {/* ── Где риск: сколько денег прошло без единого шага торга ── */}
      {bi !== null && (
        <>
          <ZeroReductionCard
            zero={bi.zero}
            periodLabel={periodLabel}
            {...(onPickZeroReduction !== undefined ? { onPickZeroBucket: onPickZeroReduction } : {})}
            {...(onPickMethod !== undefined ? { onPickMethod } : {})}
            {...(onPickDept !== undefined ? { onPickDept } : {})}
          />
          <JointPurchasesCard
            comparison={bi.joint}
            canonicalSource={procedures?.some((p) => p.result !== undefined) ?? false}
            periodLabel={periodLabel}
            {...(onPickJoint !== undefined ? { onPickJoint } : {})}
            {...(onPickDept !== undefined ? { onPickDept } : {})}
          />
        </>
      )}

      </details>
      <details className="space-y-4"><summary className="cursor-pointer py-3 text-lg font-semibold">Поставщики</summary>
      <SupplierTop
        profile={a.suppliers}
        periodLabel={periodLabel}
        {...(onPickSupplier !== undefined ? { onPickSupplier } : {})}
      />
      <SupplierPairs pairs={a.pairs} periodLabel={periodLabel} />
      </details>
      <details className="space-y-4"><summary className="cursor-pointer py-3 text-lg font-semibold">Сроки и повторные процедуры</summary>
      <StageDurationBox durations={a.durations} periodLabel={periodLabel} />

      {/* ── Где затык: наследство прошлого года и причины повторного круга ── */}
      {bi !== null && (
        <CarryOverCard
          carry={bi.carry}
          periodLabel={periodLabel}
          {...(onPickYear !== undefined ? { onPickYear } : {})}
        />
      )}

      <SeasonChart
        seasonality={a.seasonality}
        periodLabel={periodLabel}
        basis={basis}
        onBasisChange={setBasis}
      />

      <RejoinedFatesCard
        fates={fates ?? { markedRows: 0, totalRows: 0, markedSharePct: null, rows: [] }}
        periodLabel={periodLabel}
        journalPending={fates === null}
        {...(onPickFate !== undefined ? { onPickFate } : {})}
      />

      </details>
      <details className="space-y-4"><summary className="cursor-pointer py-3 text-lg font-semibold">Сравнение управлений и проверки</summary>
      <DeptCompare
        depts={a.depts}
        periodLabel={periodLabel}
        {...(onPickDept !== undefined ? { onPickDept } : {})}
      />
      <AnomalyList anomalies={a.anomalies} unsuccessful={a.unsuccessful} periodLabel={periodLabel} />
      <MatchPanel match={sharedMatch === undefined ? match : sharedMatch} error={sharedMatch === undefined ? matchError : sharedMatchError ?? null} periodLabel={periodLabel} onReload={loadMatch} />

      </details>

      {data.notes.length > 0 && (
        <div className="space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {data.notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}
    </section>
    </MonitoringPerimeterProvider>
  );
}
