/**
 * Страница «Отчёт» — еженедельный отчёт по закупкам (дуга-3, волна 2B).
 *
 * Первая страница целиком на Page Contract: собрана ТОЛЬКО из контрактных
 * элементов components/contract/* (KpiTile, SectionCard, ReportTable,
 * DiffText, SourceBadge внутри них); каждый элемент получает FilterContext
 * (buildFilterContext) и source-бейдж. Данные — GET /api/report (проекция
 * buildReport из @aemr/core плюс обвязка ответа: methodology — подвал
 * «Методология», svodOnlineUrl — ссылка «СВОД онлайн» в шапке); загрузка по
 * образцу CentralizationCard (useEffect + useState, без TanStack). История
 * снимков грузится один раз на срез (asOfDay) и питает секцию «Что изменилось за
 * неделю» вместе с дельта-бейджами KPI-плиток. Кнопка «Копировать текстом»
 * отдаёт плоский текст generateReportText для вставки в письмо.
 */
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Building2, ClipboardCopy, ClipboardCheck, ExternalLink, History } from 'lucide-react';
import { SEVERITY_COLORS, dayNumberOf, getMetricByKey, productLabel } from '@aemr/shared';
import type { MetricDelta } from '@aemr/core';
import { api, type ReportResponse } from '../api';
import { useStore } from '../store';
import { buildFilterContext, type FilterContext } from '../lib/filter-context';
import { toCanonicalDeptId } from '../lib/dept-key';
import { KpiTile } from '../components/contract/KpiTile';
import { SectionCard } from '../components/contract/SectionCard';
import { ReportTable, type ReportTableColumn } from '../components/contract/ReportTable';
import { DiffText } from '../components/contract/DiffText';
import {
  buildGrbsSection,
  integralKpiRow,
  fmtAsOfDate,
  fmtCount,
  type GrbsSectionVM,
} from '../lib/report/mappers';
import { generateReportText } from '../lib/report/text';
import { reportRequestParams } from '../lib/report/request';
import { kpiDeltaFor } from '../lib/report/kpi-delta';
import { pickWeekSnapshots } from '../lib/report/week-delta';
import { DeltaBadge } from '../components/DeltaBadge';
import { fmtMetricValue } from '../lib/delta-format';

type Quarter = 1 | 2 | 3 | 4;
const QUARTERS: readonly Quarter[] = [1, 2, 3, 4];

const METHOD_COLUMNS: readonly ReportTableColumn[] = [
  { key: 'method', label: 'Способ' },
  { key: 'plan', label: 'План', align: 'right' },
  { key: 'fact', label: 'Заключено', align: 'right' },
  { key: 'pct', label: 'Исполнение', align: 'right' },
];

const SVOD_COLUMNS: readonly ReportTableColumn[] = [
  { key: 'metric', label: 'Показатель' },
  { key: 'calc', label: 'Расчёт', align: 'right' },
  { key: 'svod', label: 'СВОД', align: 'right' },
];

/** Честная расшифровка ошибки загрузки (503 = снапшота ещё нет). */
function errorMessage(error: string): string {
  return error.includes('503')
    ? 'Данные не загружены: сервер ещё не получил снапшот книг. Обновите данные на Пульте и вернитесь.'
    : `Отчёт временно недоступен. ${error}`;
}

/** Секция одного ГРБС — целиком из контрактных элементов. */
function GrbsSection({ vm, quarter, ctx }: { vm: GrbsSectionVM; quarter: Quarter; ctx: FilterContext }) {
  return (
    <SectionCard filterCtx={ctx} source={vm.source} title={vm.deptLabel} icon={Building2}>
      <div className="space-y-3">
        {/* Исполнение квартала: жирный %, формула-подпись */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
            {vm.executionPct}
          </span>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {vm.executionCaption} — исполнение {quarter} квартала
          </span>
          <span
            className={
              vm.pendingCount > 0
                ? 'text-[11px] font-semibold text-amber-600 dark:text-amber-400'
                : 'text-[11px] text-zinc-400 dark:text-zinc-500'
            }
          >
            {vm.pendingLabel}
          </span>
        </div>

        {/* КП/ЕП квартала */}
        <ReportTable
          filterCtx={ctx}
          source="calc"
          caption={`Способы · Q${quarter}`}
          columns={METHOD_COLUMNS}
          rows={vm.methodRows.map((r) => ({
            method: productLabel(r.methodKey === 'КП' ? 'kp' : 'ep'),
            plan: fmtCount(r.plan),
            fact: fmtCount(r.fact),
            pct: r.pctText,
          }))}
        />

        {/* Год, деньги, экономия */}
        <div className="text-[11px] text-zinc-600 dark:text-zinc-300 space-y-0.5">
          <div>{vm.yearLine}</div>
          <div>
            {vm.moneyLine}
            {vm.economyLine && (
              <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-medium">{vm.economyLine}</span>
            )}
          </div>
        </div>

        {/* Сверка со СВОД: расчёт рядом с официалом, расхождение — DiffText */}
        {vm.svodPairs && (
          <ReportTable
            filterCtx={ctx}
            source="mixed"
            caption="Сверка со СВОД"
            columns={SVOD_COLUMNS}
            rows={vm.svodPairs.map((p) => ({
              metric: productLabel(p.metricKey),
              calc: fmtCount(p.calc),
              svod: <DiffText filterCtx={ctx} source="svod" value={p.svod} reference={p.calc} />,
            }))}
          />
        )}

        {/* Топ-сигналы человеческими словами */}
        {vm.signals.length > 0 && (
          <ul className="space-y-1">
            {vm.signals.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: SEVERITY_COLORS[s.severity].text }}
                />
                {s.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

// ── «Что изменилось за неделю»: дельта снимков вокруг четверга среза ──

const MAX_WEEK_DELTA_ROWS = 8;

/** Подпись метрики дрейфа: канон REPORT_MAP (dotted-ключи officialMetrics). */
function weekMetricLabel(key: string): string {
  return getMetricByKey(key)?.label ?? productLabel(key);
}

/**
 * Ранжирование дрейфа для топа: appeared/disappeared всегда наверху, дальше —
 * по |deltaPct|, не |deltaAbs|: единицы метрик разнородны, и абсолютная
 * сортировка diffMetrics всегда выталкивала бы деньги (тыс. руб.) поверх
 * долей в п.п. (ponytail-ревью R1 #3).
 */
function weekDeltaRank(d: MetricDelta): number {
  if (d.direction === 'appeared' || d.direction === 'disappeared') return Infinity;
  return d.deltaPct !== null ? Math.abs(d.deltaPct) : 0;
}

type WeekDeltaState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'no-pair' }
  | { kind: 'ready'; deltas: MetricDelta[]; fromDay: number; toDay: number };

/** Плашка-заглушка блока — стиль «Примечаний» страницы. */
function WeekDeltaNote({ text }: { text: string }) {
  return (
    <div className="analytics-chart-card px-5 py-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-1">
        Что изменилось за неделю
      </div>
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">— {text}</div>
    </div>
  );
}

/**
 * Дельта метрик между снимком четверга среза и снимком неделей раньше.
 * Данные приходят пропом со страницы: один fetch истории питает и эту
 * секцию, и дельта-бейджи KPI-плиток (запрос не дублируется). Все
 * деградации сохранены: любой сбой истории — плашка, страница отчёта
 * от этого блока не зависит.
 */
function WeekDeltaSection({ state, ctx }: { state: WeekDeltaState; ctx: FilterContext }) {
  // ГРБС-фильтр контекста уважается и здесь: метрики дрейфа несут
  // departmentId в REPORT_MAP; без выбора ГРБС показываем всё.
  const grbsFilter = (d: MetricDelta): boolean => {
    if (ctx.grbs.length === 0) return true;
    const dept = getMetricByKey(d.metricKey)?.departmentId;
    return dept !== undefined && (ctx.grbs as readonly string[]).includes(dept);
  };

  if (state.kind === 'loading') return null;
  if (state.kind === 'no-pair') return <WeekDeltaNote text="Нет доступных снимков для этой недели." />;
  if (state.kind === 'error') {
    return <WeekDeltaNote text="История снимков недоступна — сравнение недели пропущено." />;
  }

  const significant = state.deltas
    .filter((d) => d.direction !== 'flat')
    .filter(grbsFilter)
    .sort((a, b) => weekDeltaRank(b) - weekDeltaRank(a))
    .slice(0, MAX_WEEK_DELTA_ROWS);

  // metric_history хранит только officialMetrics (ячейки СВОД) — origin честно svod
  return (
    <SectionCard filterCtx={ctx} source="svod" title="Что изменилось за неделю" icon={History}>
      <div className="space-y-2">
        <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
          снимок {fmtAsOfDate(state.fromDay)} → {fmtAsOfDate(state.toDay)}
        </div>
        {significant.length === 0 ? (
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Значимых изменений метрик за неделю нет.
          </div>
        ) : (
          <ul className="space-y-1">
            {significant.map((d) => (
              <li key={d.metricKey} className="flex items-center gap-2 text-[11px]">
                <span className="flex-1 min-w-0 truncate text-zinc-600 dark:text-zinc-300">
                  {weekMetricLabel(d.metricKey)}
                </span>
                <span className="tabular-nums whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                  {fmtMetricValue(d.metricKey, d.from?.value ?? null)} → {fmtMetricValue(d.metricKey, d.to?.value ?? null)}
                </span>
                <DeltaBadge delta={d} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

export function ReportPage() {
  // FilterContext из store — единый объект для всех контрактных элементов
  const year = useStore((s) => s.year);
  const period = useStore((s) => s.period);
  const activeMonths = useStore((s) => s.activeMonths);
  const selectedDepartments = useStore((s) => s.selectedDepartments);
  const selectedSubordinates = useStore((s) => s.selectedSubordinates);
  const selectedActivities = useStore((s) => s.selectedActivities);
  const selectedMethods = useStore((s) => s.selectedMethods);
  const selectedBudgets = useStore((s) => s.selectedBudgets);
  const searchQuery = useStore((s) => s.searchQuery);
  const periodMode = useStore((s) => s.periodMode);
  const focusedWeekStart = useStore((s) => s.focusedWeekStart);
  const ctx = useMemo(
    () => buildFilterContext({
      year, period, activeMonths, selectedDepartments, selectedSubordinates,
      selectedActivities, selectedMethods, selectedBudgets, searchQuery,
      periodMode, focusedWeekStart,
    }),
    [year, period, activeMonths, selectedDepartments, selectedSubordinates,
      selectedActivities, selectedMethods, selectedBudgets, searchQuery,
      periodMode, focusedWeekStart],
  );

  // Параметры запроса — чистым хелпером: год из контекста ('all' → последний
  // доступный), квартал — кнопки страницы поверх ctx.period, asOf — четверг
  // выбранной недели колеса (кламп к последнему четвергу — внутри хелпера)
  const [localQuarter, setLocalQuarter] = useState<Quarter | null>(null);
  const request = useMemo(
    () => reportRequestParams(ctx, dayNumberOf(new Date())!, localQuarter ?? undefined),
    [ctx, localQuarter],
  );

  // Загрузка по образцу CentralizationCard: useEffect + useState, без TanStack
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    api.getReport(request.year, request.quarter, request.asOf)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e: unknown) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [request.year, request.quarter, request.asOf]);

  // История снимков вокруг четверга среза — ОДИН запрос на страницу:
  // питает и секцию «Что изменилось за неделю», и дельта-бейджи KPI-плиток
  // (/api/history/snapshots + /api/history/diff; сбой — честная плашка секции).
  const asOfDay = report?.period.asOfDay;
  const [weekDelta, setWeekDelta] = useState<WeekDeltaState>({ kind: 'loading' });
  useEffect(() => {
    setWeekDelta({ kind: 'loading' });
    if (asOfDay === undefined) return;
    let cancelled = false;
    api.getHistorySnapshots()
      .then(async (snaps) => {
        const pair = pickWeekSnapshots(snaps, asOfDay);
        if (pair === null) {
          if (!cancelled) setWeekDelta({ kind: 'no-pair' });
          return;
        }
        const deltas = await api.getHistoryDiff(pair.from.id, pair.to.id);
        if (cancelled) return;
        setWeekDelta({
          kind: 'ready',
          deltas,
          fromDay: dayNumberOf(pair.from.createdAt) ?? asOfDay - 7,
          toDay: dayNumberOf(pair.to.createdAt) ?? asOfDay,
        });
      })
      .catch(() => { if (!cancelled) setWeekDelta({ kind: 'error' }); });
    return () => { cancelled = true; };
  }, [asOfDay]);
  const weekDeltas = weekDelta.kind === 'ready' ? weekDelta.deltas : [];

  const [copied, setCopied] = useState(false);
  // Дата среза — из ответа сервера (period.asOfDay, дефолт — последний
  // четверг), не new Date(): «сегодня» врало бы в любой день, кроме четверга.
  const asOfDate = report ? fmtAsOfDate(report.period.asOfDay) : null;
  const onCopy = () => {
    if (!report || asOfDate === null) return;
    void navigator.clipboard.writeText(generateReportText(report, asOfDate)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ГРБС-фильтр контекста уважается: блоки режутся по ctx.grbs
  const visibleBlocks = useMemo(() => {
    if (!report) return [];
    const blocks = ctx.grbs.length > 0
      ? report.grbsBlocks.filter((b) => (ctx.grbs as readonly string[]).includes(toCanonicalDeptId(b.dept)))
      : report.grbsBlocks;
    return blocks.map(buildGrbsSection);
  }, [report, ctx.grbs]);

  const tiles = report ? integralKpiRow(report) : [];
  const heroTiles = tiles.filter((t) => t.tier === 'hero');
  const restTiles = tiles.filter((t) => t.tier !== 'hero');
  const activeQuarter: Quarter | null = report ? report.period.quarter : request.quarter ?? null;

  return (
    <div className="space-y-4">
      {/* Шапка: заголовок, периодные бейджи, селектор квартала, копирование */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {asOfDate ? `Отчёт по закупкам на ${asOfDate}` : 'Отчёт по закупкам'}
        </h2>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {request.year} год
        </span>
        {activeQuarter && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            Q{activeQuarter}
          </span>
        )}
        {/* Ссылка на официальную книгу СВОД; каноническая оговорка серии — тултипом */}
        {report?.svodOnlineUrl && (
          <a
            href={report.svodOnlineUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Показатели отчёта — на дату среза; СВОД онлайн живёт и может незначительно отличаться."
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
          >
            <ExternalLink size={11} />
            СВОД онлайн
          </a>
        )}
        <div className="flex items-center gap-1 ml-auto">
          {QUARTERS.map((q) => (
            <button
              key={q}
              onClick={() => setLocalQuarter(q)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                request.quarter === q
                  ? 'bg-amber-500 text-white'
                  : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
              }`}
            >
              {q} кв
            </button>
          ))}
          <button
            onClick={onCopy}
            disabled={!report}
            className="ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            {copied ? <ClipboardCheck size={12} /> : <ClipboardCopy size={12} />}
            {copied ? 'Скопировано' : 'Копировать текстом'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="analytics-chart-card px-5 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
          {errorMessage(error)}
        </div>
      ) : !report ? (
        <div className="analytics-chart-card px-5 py-8 text-center text-xs text-zinc-400">Загрузка…</div>
      ) : (
        <>
          {/* Что изменилось за неделю: дельта снимков вокруг четверга среза */}
          <WeekDeltaSection state={weekDelta} ctx={ctx} />

          {/* Интегральная сводка: KpiTile-ряд с source-бейджами из origin;
              дельта «к прошлому снимку» — только у плиток с официальным
              аналогом в снимках (kpiDeltaFor, честность источников) */}
          <SectionCard
            filterCtx={ctx}
            source={report.integralSummary.svodQuarter ? 'mixed' : 'calc'}
            title="Интегральная сводка"
            collapsible={false}
          >
            <div className="analytics-kpi-grid">
              <div className="analytics-kpi-hero-row">
                {heroTiles.map((t) => (
                  <KpiTile key={`${t.metricKey}-${t.periodBadge}`} filterCtx={ctx} {...t} delta={kpiDeltaFor(t, weekDeltas)} />
                ))}
              </div>
              <div className="analytics-kpi-secondary-row">
                {restTiles.map((t) => (
                  <KpiTile key={`${t.metricKey}-${t.periodBadge}`} filterCtx={ctx} {...t} delta={kpiDeltaFor(t, weekDeltas)} />
                ))}
              </div>
            </div>
          </SectionCard>

          {/* Блоки по ГРБС */}
          {visibleBlocks.length === 0 ? (
            <div className="analytics-chart-card px-5 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {ctx.grbs.length > 0
                ? 'По выбранным ГРБС блоков в отчёте нет — снимите фильтр управлений.'
                : 'В снапшоте нет данных по управлениям за выбранный период.'}
            </div>
          ) : (
            visibleBlocks.map((vm) => (
              <GrbsSection key={vm.dept} vm={vm} quarter={report.period.quarter} ctx={ctx} />
            ))
          )}

          {/* Честные плашки: чего в отчёте нет и почему */}
          {report.notes.length > 0 && (
            <div className="analytics-chart-card px-5 py-3">
              <div className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-1">
                Примечания
              </div>
              <ul className="space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {report.notes.map((note) => (
                  <li key={note}>— {note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Подвал доверия: методология счёта — текст сервера, свёрнут по умолчанию */}
          {report.methodology && (
            <SectionCard filterCtx={ctx} source="calc" title="Методология" icon={BookOpen} defaultOpen={false}>
              <div className="space-y-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                <p>
                  Каждое число отчёта либо пересчитано системой из строк книг ГРБС,
                  либо взято из официального СВОДа как есть. Ниже — точные правила счёта.
                </p>
                <p className="text-zinc-500 dark:text-zinc-400">{report.methodology}</p>
              </div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
