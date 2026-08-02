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
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Building2, ClipboardCopy, ClipboardCheck, ExternalLink, FileDown, History } from 'lucide-react';
import clsx from 'clsx';
import {
  SEVERITY_COLORS,
  SVOD_SHEET_NAME,
  SVOD_SPREADSHEET_ID,
  dayNumberOf,
  getMetricByKey,
  productLabel,
  quarterLabel,
} from '@aemr/shared';
import { buildSheetUrl } from '../lib/recon/sheet-links';
import type { MetricDelta, PendingPosition, ReportSignal } from '@aemr/core';
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
  pendingBreakdownLine,
  type GrbsSectionVM,
} from '../lib/report/mappers';
import { ExpandableRows } from '../components/contract/ExpandableRows';
import { KbHover } from '../components/contract/KbHover';
import { generateReportText } from '../lib/report/text';
import { reportRequestParams, type ReportMode } from '../lib/report/request';
import { kpiDeltaFor } from '../lib/report/kpi-delta';
import { pickWeekSnapshots } from '../lib/report/week-delta';
import { DeltaBadge } from '../components/DeltaBadge';
import { ChangesSection } from '../components/report/ChangesSection';
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
  // Провенанс: адрес ячейки официального листа — куда смотреть в живой книге.
  { key: 'cell', label: 'Ячейка', align: 'right' },
];

/** Честная расшифровка ошибки загрузки (503 = снапшота ещё нет). */
function errorMessage(error: string): string {
  return error.includes('503')
    ? 'Данные не загружены: сервер ещё не получил снапшот книг. Обновите данные на Пульте и вернитесь.'
    : `Отчёт временно недоступен. ${error}`;
}

/** Слово критичности — текстовый дубль цветной точки (канон DESIGN.md). */
const SEVERITY_RU: Record<string, string> = {
  critical: 'критично',
  error: 'ошибка',
  significant: 'существенно',
  warning: 'внимание',
  info: 'справочно',
};

/**
 * Строка сигнала: полный текст (обрезка запрещена — закон «сигналы целиком»),
 * слово критичности рядом с точкой, описание и адрес первички
 * (лист · ячейка) — путь к таблице от каждого пункта.
 */
function SignalRow({ s }: { s: ReportSignal }) {
  return (
    <div className="text-[11px] leading-relaxed">
      <div className="flex items-baseline gap-2">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0 self-center"
          style={{ backgroundColor: SEVERITY_COLORS[s.severity].text }}
        />
        <span className="shrink-0 text-[10px] uppercase tracking-wide" style={{ color: SEVERITY_COLORS[s.severity].text }}>
          {SEVERITY_RU[s.severity] ?? s.severity}
        </span>
        <span className="text-zinc-700 dark:text-zinc-200">{s.title}</span>
      </div>
      {(s.description || s.sheet || s.cell) && (
        <div className="ml-3.5 text-zinc-500 dark:text-zinc-400">
          {s.description}
          {(s.sheet || s.cell) && (
            <span className="ml-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
              {' — '}{s.sheet ? `лист «${s.sheet}»` : ''}{s.sheet && s.cell ? ' · ' : ''}{s.cell ? `ячейка ${s.cell}` : ''}
            </span>
          )}
        </div>
      )}
      {s.recommendation && (
        <div className="ml-3.5 text-zinc-500 dark:text-zinc-400">Рекомендация: {s.recommendation}</div>
      )}
    </div>
  );
}

/**
 * Незаключённая позиция: предмет целиком (обрезка запрещена), способ,
 * плановые дата и деньги, адрес строки листа и пояснения исполнителя с
 * подписями источника. Отсутствие пояснений — честная строка: качество
 * заполнения листа — тоже информация для читателя.
 */
function PendingPositionRow({ p }: { p: PendingPosition }) {
  return (
    <div className="text-[11px] leading-relaxed">
      <div className="text-zinc-700 dark:text-zinc-200">
        {p.subject || 'Без наименования'}
        <span className="text-zinc-400 dark:text-zinc-500">
          {' — '}{p.method || 'способ не указан'}
          {p.planDate && ` · план ${p.planDate}`}
          {p.planTotal > 0 && ` · ${fmtCount(p.planTotal)} тыс. руб.`}
          <span className="ml-1 font-mono text-[10px]">строка {p.sheetRow}</span>
        </span>
      </div>
      {p.explanations.length > 0 ? (
        p.explanations.map((e) => (
          <div key={e.label} className="ml-3 text-zinc-500 dark:text-zinc-400">
            {e.label}: {e.text}
          </div>
        ))
      ) : (
        <div className="ml-3 text-[10px] text-amber-600 dark:text-amber-400">
          пояснений в листе нет
        </div>
      )}
    </div>
  );
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

        {/* Незаключённые позиции квартала с пояснениями из листа —
            «по ним же ещё и объяснения должны быть» (запрос коллеги) */}
        {vm.pendingPositions.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Не заключено в {quarterLabel(quarter)} · с пояснениями из листа
            </div>
            <ExpandableRows
              rows={vm.pendingPositions}
              top={3}
              noun="позиций"
              searchText={(p) => `${p.subject} ${p.method} ${p.planDate} ${p.explanations.map((e) => e.text).join(' ')}`}
            >
              {(p) => <PendingPositionRow key={p.sheetRow} p={p} />}
            </ExpandableRows>
          </div>
        )}

        {/* КП/ЕП квартала */}
        <ReportTable
          filterCtx={ctx}
          source="calc"
          caption={`Способы · ${quarterLabel(quarter)}`}
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
          <div className="space-y-1">
            <ReportTable
              filterCtx={ctx}
              source="mixed"
              caption="Сверка со СВОД · на текущий момент"
              columns={SVOD_COLUMNS}
              rows={vm.svodPairs.map((p) => ({
                metric: productLabel(p.metricKey),
                calc: fmtCount(p.calc),
                svod: <DiffText filterCtx={ctx} source="svod" value={p.svod} reference={p.calc} />,
                // Ссылка ведёт в ту самую ячейку живой книги — число проверяемо
                // за один клик, без пересказа «где-то в СВОДе».
                cell: p.svodCell
                  ? (
                    <a
                      href={buildSheetUrl(SVOD_SPREADSHEET_ID, p.svodCell)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] text-zinc-500 hover:text-blue-600 hover:underline dark:text-zinc-400 dark:hover:text-blue-400"
                      title={`Открыть ${SVOD_SHEET_NAME}!${p.svodCell} в Google Sheets`}
                    >
                      {p.svodCell}
                    </a>
                  )
                  : '—',
              }))}
            />
            {vm.svodNote && (
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{vm.svodNote}</div>
            )}
          </div>
        )}

        {/* Сигналы: полный текст без обрезаний, слово критичности (текстовый
            дубль цвета), адрес первички; свёрнут топ-3, раскрывается всё */}
        {vm.signals.length > 0 && (
          <ExpandableRows
            rows={vm.signals}
            top={3}
            noun="сигналов"
            searchText={(s) => `${s.title} ${s.description} ${s.sheet ?? ''} ${s.cell ?? ''}`}
          >
            {(s) => <SignalRow key={s.id} s={s} />}
          </ExpandableRows>
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

/**
 * Итоги недели в цифрах — верхний ярус единой ленты «Что изменилось»:
 * дельты официальных метрик между снимком среза и снимком неделей раньше.
 * Рендерится ВНУТРИ общей секции (единый провенанс, бритва Оккама):
 * читателю не важно, что цифры из снимков, а правки из журналов —
 * это одна система «что изменилось». Все деградации — тихие строки,
 * секция от снимков не зависит.
 */
function WeekDeltaBody({ state, ctx }: { state: WeekDeltaState; ctx: FilterContext }) {
  // ГРБС-фильтр контекста уважается и здесь: метрики дрейфа несут
  // departmentId в REPORT_MAP; без выбора ГРБС показываем всё.
  const grbsFilter = (d: MetricDelta): boolean => {
    if (ctx.grbs.length === 0) return true;
    const dept = getMetricByKey(d.metricKey)?.departmentId;
    return dept !== undefined && (ctx.grbs as readonly string[]).includes(dept);
  };

  if (state.kind === 'loading') return null;

  const note = state.kind === 'no-pair'
    ? 'Пары снимков для сравнения недели нет — итоги в цифрах появятся со следующим срезом.'
    : state.kind === 'error'
      ? 'История снимков недоступна — итоги недели в цифрах пропущены.'
      : null;

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        Итоги недели в цифрах · официальные метрики СВОДа
      </div>
      {note !== null ? (
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">— {note}</div>
      ) : state.kind === 'ready' && (() => {
        const significant = state.deltas
          .filter((d) => d.direction !== 'flat')
          .filter(grbsFilter)
          .sort((a, b) => weekDeltaRank(b) - weekDeltaRank(a))
          .slice(0, MAX_WEEK_DELTA_ROWS);
        return (
          <>
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
          </>
        );
      })()}
    </div>
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
  // Режим просмотра: эфир по умолчанию (канон 27.07). Переключатель в шапке —
  // единственный способ уйти в архив недели, поэтому состояние живёт здесь,
  // а не выводится из наличия недели в фильтрах (это и путало читателя).
  const [mode, setMode] = useState<ReportMode>('live');
  // Колесо недель и переключатель — одно управление, а не два несвязанных.
  // Крутанул неделю — это явное намерение смотреть архив, поэтому режим
  // переключается сам. Без этого колесо в эфире молча ни на что не влияло.
  const prevWeek = useRef<string | null>(ctx.weekStart);
  useEffect(() => {
    if (ctx.weekStart !== prevWeek.current) {
      prevWeek.current = ctx.weekStart;
      if (ctx.weekStart !== null) setMode('archive');
    }
  }, [ctx.weekStart]);
  const request = useMemo(
    () => reportRequestParams(ctx, dayNumberOf(new Date())!, localQuarter ?? undefined, mode),
    [ctx, localQuarter, mode],
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
  // Дата — из ответа сервера (period.asOfDay), не new Date(): у продукта свой
  // календарь (+12), браузер читателя может быть в другом поясе.
  const asOfDate = report ? fmtAsOfDate(report.period.asOfDay) : null;
  // Режим просмотра: эфир — числа на сейчас; архив — снимок недели.
  const isLive = report?.period.live ?? false;
  // Выгрузка в Word: какая из двух кнопок сейчас готовит файл (null — обе свободны).
  const [saving, setSaving] = useState<'main' | 'extra' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const onDownloadDocx = async (kind: 'main' | 'extra') => {
    if (!report || asOfDate === null) return;
    setSaving(kind);
    setDownloadError(null);
    try {
      // Библиотека грузится по требованию: 400 КБ не должны висеть на каждом
      // открытии страницы ради кнопки, которую жмут раз в неделю.
      const [{ buildDocument, downloadDocx, reportFilename }, { mainReportBlocks, additionalReportBlocks }] =
        await Promise.all([
          import('../lib/report/docx/build-docx'),
          import('../lib/report/docx/text-blocks'),
        ]);
      // Ручной отчёт печатает ВСЕ четыре квартала («Всего на 1…4 квартал»), а
      // проекция знает ровно один. Берём тот же срез четырьмя запросами —
      // иначе три четверти шапки пришлось бы выдумать или обнулить.
      const [q1, q2, q3, q4] = await Promise.all(
        QUARTERS.map((q) => api.getReport(request.year, q, request.asOf)),
      );
      const quarters = { 1: q1, 2: q2, 3: q3, 4: q4 };
      const isMain = kind === 'main';
      const blocks = isMain
        ? mainReportBlocks(report, quarters, asOfDate)
        : additionalReportBlocks(report, quarters, asOfDate);
      const title = isMain ? 'Отчёт по закупкам' : 'Дополнительно к отчету по закупкам';
      await downloadDocx(buildDocument(blocks, title), reportFilename(title, asOfDate));
    } catch (e: unknown) {
      setDownloadError(`Не удалось собрать документ: ${String(e)}`);
    } finally {
      setSaving(null);
    }
  };

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
          {asOfDate
            ? isLive
              ? `Отчёт по закупкам · ${asOfDate}`
              : `Отчёт по закупкам на ${asOfDate}`
            : 'Отчёт по закупкам'}
        </h2>
        {/* Переключатель режима — управление, а не подпись: читателю нужно
            уметь ВЕРНУТЬСЯ в эфир, а не только видеть, где он находится. */}
        <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <button
            onClick={() => setMode('live')}
            title="Числа на текущий момент — как считает официальный лист СВОД."
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium transition',
              mode === 'live'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700/40',
            )}
          >
            <span className={clsx(
              'inline-block w-1.5 h-1.5 rounded-full',
              mode === 'live' ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600',
            )} />
            В прямом эфире
          </button>
          <button
            onClick={() => setMode('archive')}
            title="Снимок недели: заключённое после даты среза в числа не входит."
            className={clsx(
              'px-2 py-0.5 text-[10px] font-medium border-l border-zinc-200 dark:border-zinc-700 transition',
              mode === 'archive'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                : 'bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-700/40',
            )}
          >
            Архив недели
          </button>
        </div>
        {/* Подтверждение от сервера: режим ответа мог разойтись с кнопкой
            (запрос в полёте, устаревший ответ) — тогда честнее показать факт. */}
        {report && isLive !== (mode === 'live') && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
            показан режим «{isLive ? 'в прямом эфире' : 'архив недели'}»
          </span>
        )}
        {/* В эфире выбранная неделя не участвует — говорим об этом прямо,
            иначе колесо выглядит работающим, а числа его игнорируют. */}
        {mode === 'live' && ctx.weekStart !== null && (
          <span
            className="text-[10px] text-zinc-500 dark:text-zinc-400"
            title="Переключитесь в «Архив недели», чтобы увидеть снимок выбранной недели."
          >
            неделя из фильтра не применена
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {request.year} год
        </span>
        {activeQuarter && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {quarterLabel(activeQuarter)}
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
          {/* Локальная выгрузка: документ собирается в браузере и падает в
              «Загрузки» — без роута и без записи на сервер, поэтому работает
              и на публичном стенде только для чтения. */}
          <button
            onClick={() => void onDownloadDocx('main')}
            disabled={!report || saving !== null}
            title="Основной отчёт в формате Word — вёрстка ручного отчёта по закупкам"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            <FileDown size={12} />
            {saving === 'main' ? 'Готовится…' : 'Отчёт в Word'}
          </button>
          <button
            onClick={() => void onDownloadDocx('extra')}
            disabled={!report || saving !== null}
            title="Дополнительно к отчету по закупкам — записка руководителю в формате Word"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            <FileDown size={12} />
            {saving === 'extra' ? 'Готовится…' : 'Допотчёт в Word'}
          </button>
        </div>
      </div>
      {downloadError && (
        <div className="text-[11px] text-red-600 dark:text-red-400">{downloadError}</div>
      )}

      {error ? (
        <div className="analytics-chart-card px-5 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
          {errorMessage(error)}
        </div>
      ) : !report ? (
        <div className="analytics-chart-card px-5 py-8 text-center text-xs text-zinc-400">Загрузка…</div>
      ) : (
        <>
          {/* Единый провенанс (бритва Оккама): одна лента «Что изменилось» —
              итоги недели в цифрах (снимки СВОДа) + правки книг с авторами
              (журналы _ChangeLog). Для читателя это одна система; источник —
              деталь реализации. Смена способа поставщика — наверху ленты. */}
          <SectionCard filterCtx={ctx} source="mixed" title="Что изменилось с последнего среза" icon={History}>
            <div className="space-y-5">
              <WeekDeltaBody state={weekDelta} ctx={ctx} />
              <ChangesSection />
            </div>
          </SectionCard>

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
            {/* Разбивка остатка по бюджетам — «…с разбивкой по бюджетам»
                из запроса коллег; плитка выше несёт итог, строка — состав */}
            {report && pendingBreakdownLine(report) && (
              <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                <KbHover metricKey="pending_total">
                  <span>{pendingBreakdownLine(report)}</span>
                </KbHover>
              </p>
            )}
          </SectionCard>

          {/* Шапка ГРБС отчёта: оглавление из управлений с исполнением
              квартала (состав шапки ручного отчёта); клик — к секции */}
          {visibleBlocks.length > 1 && (
            <nav
              aria-label="ГРБС отчёта"
              className="flex flex-wrap gap-1.5"
            >
              {visibleBlocks.map((vm) => (
                <button
                  key={vm.dept}
                  type="button"
                  onClick={() => document.getElementById(`grbs-${vm.dept}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
                >
                  {vm.dept}
                  <span className="ml-1.5 tabular-nums font-medium text-zinc-800 dark:text-zinc-100">
                    {vm.executionPct}
                  </span>
                </button>
              ))}
            </nav>
          )}

          {/* Блоки по ГРБС */}
          {visibleBlocks.length === 0 ? (
            <div className="analytics-chart-card px-5 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {ctx.grbs.length > 0
                ? 'По выбранным ГРБС блоков в отчёте нет — снимите фильтр управлений.'
                : 'В снапшоте нет данных по управлениям за выбранный период.'}
            </div>
          ) : (
            visibleBlocks.map((vm) => (
              <div key={vm.dept} id={`grbs-${vm.dept}`} className="scroll-mt-4">
                <GrbsSection vm={vm} quarter={report.period.quarter} ctx={ctx} />
              </div>
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
