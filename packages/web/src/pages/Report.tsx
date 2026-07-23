/**
 * Страница «Отчёт» — еженедельный отчёт по закупкам (дуга-3, волна 2B).
 *
 * Первая страница целиком на Page Contract: собрана ТОЛЬКО из контрактных
 * элементов components/contract/* (KpiTile, SectionCard, ReportTable,
 * DiffText, SourceBadge внутри них); каждый элемент получает FilterContext
 * (buildFilterContext) и source-бейдж. Данные — GET /api/report (проекция
 * buildReport из @aemr/core); загрузка по образцу CentralizationCard
 * (useEffect + useState, без TanStack). Кнопка «Копировать текстом» отдаёт
 * плоский текст generateReportText для вставки в письмо.
 */
import { useEffect, useMemo, useState } from 'react';
import { Building2, ClipboardCopy, ClipboardCheck } from 'lucide-react';
import { SEVERITY_COLORS, productLabel } from '@aemr/shared';
import type { Report } from '@aemr/core';
import { api } from '../api';
import { AVAILABLE_YEARS, useStore } from '../store';
import { buildFilterContext, type FilterContext } from '../lib/filter-context';
import { toCanonicalDeptId } from '../lib/dept-key';
import { KpiTile } from '../components/contract/KpiTile';
import { SectionCard } from '../components/contract/SectionCard';
import { ReportTable, type ReportTableColumn } from '../components/contract/ReportTable';
import { DiffText } from '../components/contract/DiffText';
import {
  buildGrbsSection,
  integralKpiRow,
  fmtCount,
  type GrbsSectionVM,
} from '../lib/report/mappers';
import { generateReportText } from '../lib/report/text';

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
  const ctx = useMemo(
    () => buildFilterContext({
      year, period, activeMonths, selectedDepartments, selectedSubordinates,
      selectedActivities, selectedMethods, selectedBudgets, searchQuery,
    }),
    [year, period, activeMonths, selectedDepartments, selectedSubordinates,
      selectedActivities, selectedMethods, selectedBudgets, searchQuery],
  );

  // Год — из контекста ('all' → последний доступный); квартал — локальный
  // селектор поверх ctx.period (если там qN — он и берётся по умолчанию)
  const reportYear = typeof ctx.year === 'number' ? ctx.year : AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1];
  const ctxQuarter: Quarter | null = ctx.period.startsWith('q')
    ? (Number(ctx.period.slice(1)) as Quarter)
    : null;
  const [localQuarter, setLocalQuarter] = useState<Quarter | null>(null);
  const requestQuarter = localQuarter ?? ctxQuarter ?? undefined;

  // Загрузка по образцу CentralizationCard: useEffect + useState, без TanStack
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    api.getReport(reportYear, requestQuarter)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e: unknown) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [reportYear, requestQuarter]);

  const [copied, setCopied] = useState(false);
  const asOfDate = new Date().toLocaleDateString('ru-RU');
  const onCopy = () => {
    if (!report) return;
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
  const activeQuarter: Quarter | null = report ? report.period.quarter : requestQuarter ?? null;

  return (
    <div className="space-y-4">
      {/* Шапка: заголовок, периодные бейджи, селектор квартала, копирование */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          Отчёт по закупкам на {asOfDate}
        </h2>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {reportYear} год
        </span>
        {activeQuarter && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            Q{activeQuarter}
          </span>
        )}
        <div className="flex items-center gap-1 ml-auto">
          {QUARTERS.map((q) => (
            <button
              key={q}
              onClick={() => setLocalQuarter(q)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                (localQuarter ?? ctxQuarter) === q
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
          {/* Интегральная сводка: KpiTile-ряд с source-бейджами из origin */}
          <SectionCard
            filterCtx={ctx}
            source={report.integralSummary.svodQuarter ? 'mixed' : 'calc'}
            title="Интегральная сводка"
            collapsible={false}
          >
            <div className="analytics-kpi-grid">
              <div className="analytics-kpi-hero-row">
                {heroTiles.map((t) => (
                  <KpiTile key={`${t.metricKey}-${t.periodBadge}`} filterCtx={ctx} {...t} />
                ))}
              </div>
              <div className="analytics-kpi-secondary-row">
                {restTiles.map((t) => (
                  <KpiTile key={`${t.metricKey}-${t.periodBadge}`} filterCtx={ctx} {...t} />
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
        </>
      )}
    </div>
  );
}
