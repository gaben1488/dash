import { useState, useMemo, useEffect, useCallback, Fragment } from 'react';
import { productLabel, ORG_ITSELF_SENTINEL } from '@aemr/shared';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { useTheme } from '../components/ThemeProvider';
import { getChartColors, getTooltipStyle, getGridColor, getAxisColor, getSeverityColor, getExecutionHeatBg, getExecutionHeatText, getPositiveColor, getNegativeColor, getChartColor } from '../lib/chart-colors';
import { subordinateLabel, ORG_ITSELF_LABEL } from '../lib/subordinate-label';
import { PeriodBadge, usePeriodBadge } from '../components/PeriodBadge';
import { EmptyState } from '../components/EmptyState';
import { selectDatasetAudit, BENFORD_LABELS, type DatasetAuditRow } from '../lib/dataset-analyses';
import {
  selectSeasonalFindings,
  selectSplittingFindings,
  outlierRule,
  groupFindingsBySubordinate,
  type SeasonalFinding,
  type SplittingFinding,
} from '../lib/analytics/anomaly-addresses';
import { useOrgScope, type OrgScope } from '../lib/selectors/org-scope';
import { buildSubBreakdown, subBreakdownTotals, type SubordinateMetricsLike } from '../lib/analytics/sub-breakdown';
import { pluralRu } from '../lib/economy-copy';
import { KBTooltip } from '../components/ui/kb-tooltip';
import { kbCardProps } from './kb-additions';
import { CONTROL_ANALYTICS_KB_ADDITIONS } from './kb-additions-control';
import { bothDeptKeyForms, toCanonicalDeptId } from '../lib/dept-key';
import { Info, ChevronDown, ChevronRight, TrendingUp, Building2, Layers, BarChart3, LineChart as LineChartIcon, Microscope, MapPin } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, Cell, AreaChart, Area,
  ScatterChart, Scatter, ZAxis, ReferenceLine,
} from 'recharts';
import { api } from '../api';
import { AnomalySignsSection } from '../components/analytics-extra/AnomalySignsSection';

const PERIOD_LABELS: Record<string, string> = {
  year: 'Год', q1: '1 кв.', q2: '2 кв.', q3: '3 кв.', q4: '4 кв.',
};

/** Возможность централизации: одна категория закупок у нескольких ГРБС. */
interface CentralizationOpportunityDTO {
  category: string;
  departments: string[];
  totalAmount: number;
  contractCount: number;
  /** Объём и число строк без торгов (ЕП) внутри группы. */
  epAmount: number;
  epCount: number;
  recommendation: string;
  priority: 'high' | 'medium' | 'low';
}

const PRIORITY_BADGE: Record<string, { label: string; cls: string }> = {
  high: { label: 'Высокий', cls: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
  medium: { label: 'Средний', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' },
  low: { label: 'Низкий', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
};

const fmtTys = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} тыс. ₽`;

/**
 * Пустота карточки — через единственный дом «здесь ничего нет»
 * (components/EmptyState): заголовок называет ПРИЧИНУ, объяснение говорит,
 * отчего так вышло, действие даёт следующий шаг. Три рода пустоты (не
 * прочитано / пусто по правде / не считается) различаются словами и тоном,
 * а не одинаковой серой строкой «Нет данных».
 */
function CardEmpty({ title, description, tone, action, detail }: {
  title: string;
  description?: string;
  tone?: 'neutral' | 'problem';
  action?: { label: string; onClick: () => void };
  detail?: string;
}) {
  return (
    <EmptyState
      size="compact"
      tone={tone ?? 'neutral'}
      title={title}
      {...(description ? { description } : {})}
      {...(action ? { action } : {})}
      {...(detail ? { detail } : {})}
    />
  );
}

/**
 * Оговорка карточки о режиме организаций (приказ владельца 20.08).
 * Три режима фильтра — три разные новости, и каждая проговаривается вслух:
 * в районном срезе разбивки нет по построению, в режиме «только ГРБС» она
 * скрыта самим читателем, а у управления без подведов её не из чего строить.
 */
function OrgScopeNote({ scope, whatSplits }: { scope: OrgScope<unknown>; whatSplits: string }) {
  if (scope.mode === 'district') return null;
  const text = scope.mode === 'grbs'
    ? `Разбивка ${whatSplits} по учреждениям скрыта: включён режим «только ГРБС». Верните «с подведомственными» в фильтре организаций, чтобы её увидеть.`
    : scope.hasSubs
      ? null
      : 'У этого управления подведомственных учреждений нет: все закупки ведёт аппарат управления.';
  if (!text) return null;
  return (
    <p className="mb-2 flex items-start gap-1.5 text-[11px] text-[var(--ink-muted)]">
      <Building2 size={12} className="mt-px shrink-0 text-[var(--ink-faint)]" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

/** Card wrapper with optional expand/collapse */
function AnalyticsCard({ title, icon: Icon, children, defaultOpen = true, source, perimeter }: {
  title: string;
  icon?: typeof TrendingUp;
  children: React.ReactNode;
  defaultOpen?: boolean;
  source?: 'calculated' | 'official' | 'hybrid';
  /**
   * Собственная подпись периметра для карточек, чей расчёт НЕ подчиняется
   * периоду шапки (канон п.58б: бейдж, унаследованный от фильтра, которому
   * числа не подчиняются, — запрещён). Если задана — рисуется вместо общей
   * плашки периода.
   */
  perimeter?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sourceLabel = source === 'official' ? 'СВОД' : source === 'hybrid' ? 'Комби' : 'Расчёт';
  const sourceTitle = source === 'official'
    ? 'Число взято из официального листа СВОД без пересчёта'
    : source === 'hybrid'
      ? 'Часть чисел пересчитана из строк книг, часть взята из официального листа'
      : 'Число пересчитано из строк книг управлений';
  // Происхождение — роль, а не краска: СВОД несёт акцент темы, расчёт —
  // тихую поверхность. Обе темы получают один словарь (п.129).
  const sourceCls = source === 'official'
    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
    : source === 'hybrid'
      ? 'bg-[var(--surface-raised)] text-[var(--accent)]'
      : 'bg-[var(--surface-raised)] text-[var(--ink-muted)]';
  return (
    <div className="analytics-chart-card group">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-[var(--surface-raised)]"
      >
        {Icon && <Icon size={15} className="shrink-0 text-[var(--ink-faint)] transition-colors group-hover:text-[var(--accent)]" aria-hidden="true" />}
        <h3 className="text-[13px] font-semibold text-[var(--ink-strong)] flex-1">{title}</h3>
        {/* Канон п.58: каждая карточка объявляет период своих ДАННЫХ сама.
            Карточки, не подчиняющиеся периоду шапки, несут собственную подпись. */}
        {perimeter
          ? <span className="shrink-0 rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-muted)]">{perimeter}</span>
          : <PeriodBadge />}
        {source && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${sourceCls}`} title={sourceTitle}>
            {sourceLabel}
          </span>
        )}
        {open
          ? <ChevronDown size={14} className="shrink-0 text-[var(--ink-faint)]" aria-hidden="true" />
          : <ChevronRight size={14} className="shrink-0 text-[var(--ink-faint)]" aria-hidden="true" />}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

/** Progress bar for budget execution */
function BudgetProgress({ label, plan, fact, color, formatMoney }: {
  label: string; plan: number; fact: number; color: string; formatMoney: (v: number) => string;
}) {
  const pct = plan > 0 ? Math.min((fact / plan) * 100, 150) : 0;
  return (
    <div className="mb-2">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="text-zinc-400">{plan > 0 ? `${pct.toFixed(0)}%` : '—'}</span>
      </div>
      <div className="h-3 bg-zinc-100 dark:bg-zinc-700/50 rounded-full overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
        {pct > 100 && (
          <div className="absolute top-0 right-0 h-full w-[2px] bg-red-500" style={{ left: `${(100 / pct) * 100}%` }} />
        )}
      </div>
      <div className="flex justify-between text-[9px] mt-0.5 text-zinc-400">
        <span>Факт: {formatMoney(fact)}</span>
        <span>План: {formatMoney(plan)}</span>
      </div>
    </div>
  );
}

const MONTH_LABELS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const TREND_LABELS: Record<string, string> = {
  accelerating: 'Ускорение', decelerating: 'Замедление', stable: 'Стабильно', insufficient_data: 'Мало данных',
};
const TREND_COLORS: Record<string, string> = {
  accelerating: 'text-emerald-500', decelerating: 'text-red-500', stable: 'text-zinc-400', insufficient_data: 'text-zinc-400',
};

/**
 * Утверждение о прогнозе для заголовка карточки.
 *
 * Заголовок обязан говорить, что показал расчёт, а не как он называется.
 * Базовый сценарий — первый в списке (сервер отдаёт их от базового к
 * крайним). Нечисловое исполнение не превращаем в ноль: пишем честно, что
 * прогноз не построен.
 */
function forecastClaim(deptLabel: string, forecast: { scenarios?: unknown[] } | null): string {
  const base = (forecast?.scenarios?.[0] ?? null) as { label?: string; yearEndExecution?: unknown } | null;
  if (!base || !Number.isFinite(base.yearEndExecution)) return 'Прогноз исполнения';
  const pct = ((base.yearEndExecution as number) * 100).toFixed(0);
  return `${deptLabel}: к концу года ожидается ${pct} % годового плана (${base.label ?? 'базовый сценарий'})`;
}

function ForecastCard({ depts, isDark, formatMoney, onClaim }: {
  depts: any[];
  isDark: boolean;
  formatMoney: (v: number) => string;
  /** Поднимает утверждение в заголовок: прогноз живёт здесь, а заголовок — выше. */
  onClaim?: (claim: string) => void;
}) {
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  // Отказ сервера и «прогноз не из чего строить» — разные новости
  // (честная пустота): одинаковая серая строка на оба случая врёт читателю.
  const [error, setError] = useState<string | null>(null);
  const { contentStyle: tooltipStyle, itemStyle: tooltipItemStyle, labelStyle: tooltipLabelStyle } = getTooltipStyle(isDark);

  const deptOptions = useMemo(() =>
    depts.map((d: any) => ({ id: d.department?.id ?? '', label: d.department?.nameShort ?? '?' })),
  [depts]);

  const loadForecast = useCallback(async (deptId: string) => {
    if (!deptId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAnalyticsForecast(deptId);
      setForecast(data);
      const label = depts.find((d: any) => d.department?.id === deptId)?.department?.nameShort ?? 'Управление';
      onClaim?.(forecastClaim(label, data));
    } catch {
      setForecast(null);
      setError('Сервер не отдал сценарии прогноза по выбранному управлению.');
      onClaim?.('Прогноз исполнения');
    }
    setLoading(false);
  }, [depts, onClaim]);

  useEffect(() => {
    if (deptOptions.length > 0 && !selectedDept) {
      setSelectedDept(deptOptions[0].id);
      loadForecast(deptOptions[0].id);
    }
  }, [deptOptions, selectedDept, loadForecast]);

  const chartData = useMemo(() => {
    if (!forecast?.scenarios?.length) return [];
    return MONTH_LABELS.map((name, i) => {
      const point: Record<string, any> = { name };
      for (const sc of forecast.scenarios) {
        point[sc.label] = sc.monthlyProjection?.[i] ?? 0;
      }
      return point;
    });
  }, [forecast]);

  const scenarioColors = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444'];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <select
          value={selectedDept}
          onChange={(e) => { setSelectedDept(e.target.value); loadForecast(e.target.value); }}
          aria-label="Управление, по которому строится прогноз"
          className="rounded-lg bg-[var(--surface-raised)] px-2 py-1.5 text-xs text-[var(--ink)]"
        >
          {deptOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        {forecast?.trend && (
          <span className={`text-[10px] font-semibold ${TREND_COLORS[forecast.trend] ?? 'text-zinc-400'}`}>
            {TREND_LABELS[forecast.trend] ?? forecast.trend}
          </span>
        )}
        {loading && (
          <span className="animate-pulse text-[10px] text-[var(--ink-faint)]" role="status" aria-live="polite">
            Считаем сценарии…
          </span>
        )}
        <KBTooltip metric="analytics_forecast" {...kbCardProps(CONTROL_ANALYTICS_KB_ADDITIONS.analytics_forecast)}>
          <span className="text-[10px] text-zinc-400 underline decoration-dotted cursor-help">как строится прогноз</span>
        </KBTooltip>
      </div>
      {chartData.length > 0 && forecast?.scenarios?.length > 0 ? (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
            <XAxis dataKey="name" fontSize={10} tick={{ fill: getAxisColor(isDark) }} />
            <YAxis fontSize={10} tickFormatter={(v: number) => formatMoney(v)} tick={{ fill: getAxisColor(isDark) }} />
            <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} formatter={(v: number, name: string) => [formatMoney(v), name]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {forecast.scenarios.map((sc: any, i: number) => (
              <Area
                key={sc.label}
                type="monotone"
                dataKey={sc.label}
                stroke={scenarioColors[i % scenarioColors.length]}
                fill={scenarioColors[i % scenarioColors.length]}
                fillOpacity={i === 0 ? 0.15 : 0.05}
                strokeWidth={i === 0 ? 2 : 1}
                strokeDasharray={i >= 2 ? '4 2' : undefined}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      ) : loading ? (
        <div role="status" aria-live="polite" className="py-12 text-center text-sm text-[var(--ink-faint)] animate-pulse">
          Считаем сценарии прогноза…
        </div>
      ) : error ? (
        <CardEmpty
          tone="problem"
          title="Прогноз не получен"
          description="Без ответа сервера сценарии не строятся — это отказ чтения, а не отсутствие закупок."
          detail={error}
          action={{ label: 'Запросить ещё раз', onClick: () => loadForecast(selectedDept) }}
        />
      ) : (
        <CardEmpty
          title="Прогноз по этому управлению не построен"
          description="Сценарии считаются от заключённых закупок текущего года: пока их слишком мало, продолжать линию не от чего."
        />
      )}
      {forecast?.scenarios?.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          {forecast.scenarios.map((sc: any, i: number) => (
            <div key={sc.label} className="rounded-lg bg-[var(--surface-raised)] p-2 text-[10px]">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: scenarioColors[i % scenarioColors.length] }} />
                <span className="font-semibold text-zinc-600 dark:text-zinc-300">{sc.label}</span>
              </div>
              {/* Прогноз приходит с сервера как any: без проверки на число
                  карточка показывала «NaN%» вместо честного прочерка. */}
              <div className="text-zinc-500 dark:text-zinc-400">
                Исполнение: <strong>{Number.isFinite(sc.yearEndExecution) ? `${(sc.yearEndExecution * 100).toFixed(0)}%` : '—'}</strong>
              </div>
              <div className="text-zinc-400">
                Уверенность: {Number.isFinite(sc.confidence) ? `${(sc.confidence * 100).toFixed(0)}%` : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Analytics() {
  const { formatMoney, navigateTo, subordinatesMap, selectedSubordinates, selectedDepartments, procurementFilter, activityFilter, period, activeMonths } = useStore();
  const fd = useFilteredData();
  // Режим организаций (приказ владельца 20.08): «с подведомственными» —
  // карточки, где это осмысленно, переходят из строки ГРБС в разбивку по
  // учреждениям; «только ГРБС» — разбивки нет, и об этом сказано словами.
  const orgScope = useOrgScope();
  const { periodLabel: dataPeriodLabel } = usePeriodBadge();
  const isDark = useTheme(s => s.theme) === 'dark';
  const chartColors = getChartColors(isDark);
  const { contentStyle: tooltipStyle, itemStyle: tooltipItemStyle, labelStyle: tooltipLabelStyle } = getTooltipStyle(isDark);
  const cursorStyle = { fill: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.06)', stroke: 'none' };
  const periodKey = fd.periodKey;
  const periodLabel = PERIOD_LABELS[periodKey] ?? periodKey;

  // Drill-down state
  const [expandedDept, setExpandedDept] = useState<string | null>(null);

  // Scatter plot data (economy: limit vs fact per procurement)
  const [scatterData, setScatterData] = useState<any[]>([]);
  const [scatterLoading, setScatterLoading] = useState(false);

  useEffect(() => {
    setScatterLoading(true);
    const params: Record<string, string> = {};
    if (procurementFilter !== 'all') params.type = procurementFilter === 'competitive' ? 'competitive' : 'single';
    if (activityFilter !== 'all') params.activity = activityFilter;
    if (selectedDepartments.size > 0) params.dept = [...selectedDepartments].join(',');
    if (selectedSubordinates.size > 0) params.subordinate = [...selectedSubordinates].join(',');
    if (period !== 'year') params.period = period;
    if (activeMonths.size > 0) params.months = [...activeMonths].join(',');
    api.getScatterData(params).then((res: any) => {
      setScatterData(res.points ?? []);
    }).catch(() => setScatterData([])).finally(() => setScatterLoading(false));
  }, [procurementFilter, activityFilter, selectedDepartments, selectedSubordinates, period, activeMonths]);

  const filteredDepts = fd.depts;
  const hasDeptData = filteredDepts.length > 0;

  // ── Quarterly trend: КП vs ЕП by quarter ──
  const quarterlyTrend = useMemo(() => {
    const quarters = ['q1', 'q2', 'q3', 'q4'] as const;
    return quarters.map(qk => {
      let kp = 0, ep = 0, plan = 0, fact = 0;
      for (const d of filteredDepts) {
        const q = d.quarters?.[qk];
        kp += q?.kpCount ?? 0;
        ep += q?.epCount ?? 0;
        plan += q?.planTotal ?? 0;
        fact += q?.factTotal ?? 0;
      }
      return { name: PERIOD_LABELS[qk], kp, ep, plan, fact };
    });
  }, [filteredDepts]);

  // ── Execution trend by quarter per department (line chart) ──
  const execTrend = useMemo(() => {
    const quarters = ['q1', 'q2', 'q3', 'q4'] as const;
    return quarters.map(qk => {
      const point: Record<string, any> = { name: PERIOD_LABELS[qk] };
      for (const d of filteredDepts) {
        const q = d.quarters?.[qk];
        const name = d.department?.nameShort ?? d.department?.id ?? '?';
        point[name] = q?.executionPct ?? null;
      }
      return point;
    });
  }, [filteredDepts]);

  const deptNames = useMemo(() => filteredDepts.map((d: any) => d.department?.nameShort ?? d.department?.id ?? '?'), [filteredDepts]);

  // Заголовок карточки прогноза приходит снизу: сам прогноз грузится
  // внутри карточки по выбранному управлению, а утверждение о нём должно
  // стоять в шапке. Значение по умолчанию — нейтральное название.
  const [forecastTitle, setForecastTitle] = useState('Прогноз исполнения');

  /**
   * Заголовок-утверждение для тренда: карточка обязана говорить, ЧТО
   * показал график, а не как он называется («Отчёт++»: числа-утверждения
   * вместо витрин). Считаем счётно — сколько управлений идёт вверх, а
   * сколько вниз от первого непустого квартала к последнему. Средний
   * процент здесь недопустим: усреднять проценты по управлениям с разным
   * числом процедур значит выдать взвешенную величину за простую.
   */
  const execTrendClaim = useMemo(() => {
    let rising = 0, falling = 0, flat = 0;
    for (const name of deptNames) {
      const series = execTrend
        .map((p: Record<string, unknown>) => p[name])
        .filter((v): v is number => typeof v === 'number');
      if (series.length < 2) continue;
      const delta = series[series.length - 1] - series[0];
      if (delta > 1) rising += 1;
      else if (delta < -1) falling += 1;
      else flat += 1;
    }
    const total = rising + falling + flat;
    if (total === 0) return 'Тренд исполнения по кварталам, %';
    if (rising === total) return `Исполнение растёт у всех ${total} управлений (по кварталам)`;
    if (falling === total) return `Исполнение падает у всех ${total} управлений (по кварталам)`;
    if (rising > 0 && falling > 0) {
      return `Исполнение растёт у ${rising} из ${total} управлений, снижается у ${falling}`;
    }
    if (rising > 0) return `Исполнение растёт у ${rising} из ${total} управлений, у остальных без движения`;
    if (falling > 0) return `Исполнение снижается у ${falling} из ${total} управлений, у остальных без движения`;
    return `Исполнение у всех ${total} управлений держится на одном уровне`;
  }, [deptNames, execTrend]);

  // ── Budget by department (stacked ФБ/КБ/МБ) ──
  const budgetByDept = useMemo(() => {
    if (!hasDeptData) return [];
    return filteredDepts.map((d: any, i: number) => {
      const q = d.quarters?.[periodKey] ?? {};
      return {
        name: d.department?.nameShort ?? d.department?.id ?? '?',
        id: d.department?.id,
        planFB: q.planFB ?? 0, planKB: q.planKB ?? 0, planMB: q.planMB ?? 0,
        factFB: q.factFB ?? 0, factKB: q.factKB ?? 0, factMB: q.factMB ?? 0,
        planTotal: q.planTotal ?? d.planTotal ?? 0,
        factTotal: q.factTotal ?? d.factTotal ?? 0,
        color: chartColors[i % chartColors.length],
      };
    });
  }, [filteredDepts, periodKey, hasDeptData]);

  // ── Department shares (% of total) ──
  const deptShares = useMemo(() => {
    if (!hasDeptData) return [];
    const totalPlan = budgetByDept.reduce((s: number, d: typeof budgetByDept[0]) => s + d.planTotal, 0);
    const totalFact = budgetByDept.reduce((s: number, d: typeof budgetByDept[0]) => s + d.factTotal, 0);
    return budgetByDept.map((d: typeof budgetByDept[0]) => ({
      ...d,
      planShare: totalPlan > 0 ? +((d.planTotal / totalPlan) * 100).toFixed(1) : 0,
      factShare: totalFact > 0 ? +((d.factTotal / totalFact) * 100).toFixed(1) : 0,
    }));
  }, [budgetByDept, hasDeptData]);

  // ── Issues by department ──
  const issuesByDept = useMemo(() => {
    const byDept: Record<string, Record<string, number>> = {};
    for (const iss of fd.issues) {
      const dept = iss.departmentId ?? 'Общие';
      if (!byDept[dept]) byDept[dept] = { critical: 0, significant: 0, warning: 0, info: 0 };
      const sev = iss.severity as string;
      if (sev in byDept[dept]) byDept[dept][sev]++;
    }
    return Object.entries(byDept).map(([dept, counts]) => ({ dept, ...counts }));
  }, [fd.issues]);

  // ── Trust by department ──
  const trustData = useMemo(() => {
    if (!hasDeptData) return [];
    return filteredDepts.map((d: any) => ({
      name: d.department?.nameShort ?? d.department?.id ?? '?',
      id: d.department?.id,
      trust: d.trustScore ?? 0,
    }));
  }, [filteredDepts, hasDeptData]);

  // ── Heatmap ──
  const heatmapData = useMemo(() => {
    if (!hasDeptData) return [];
    return filteredDepts.map((d: any) => {
      const q = d.quarters?.[periodKey] ?? {};
      return {
        dept: d.department?.nameShort ?? d.department?.id ?? '?',
        id: d.department?.id,
        execPct: q.executionPct ?? d.executionPercent ?? 0,
        planTotal: q.planTotal ?? d.planTotal,
        factTotal: q.factTotal ?? d.factTotal,
        issues: d.issueCount ?? 0,
        kpCount: q.kpCount ?? d.competitiveCount ?? 0,
        epCount: q.epCount ?? d.soleCount ?? 0,
      };
    });
  }, [filteredDepts, hasDeptData, periodKey]);

  // ── Activity breakdown by department ──
  const activityData = useMemo(() => {
    if (!hasDeptData) return [];
    return filteredDepts.map((d: any) => {
      const ba = d.byActivity?.[periodKey] ?? {};
      return {
        name: d.department?.nameShort ?? '?',
        id: d.department?.id,
        // Канон п.30: видов деятельности два — ПМ и ТД. Строки бывшего среза
        // «ТД-ПМ» (ключ current_program) складываются в ТД, а не живут третьим
        // рядом: иначе на графике разложение не сходится с фильтром на экране.
        program: ba.program?.planTotal ?? 0,
        current: (ba.current_program?.planTotal ?? 0) + (ba.current_non_program?.planTotal ?? 0),
        programFact: ba.program?.factTotal ?? 0,
        currentFact: (ba.current_program?.factTotal ?? 0) + (ba.current_non_program?.factTotal ?? 0),
      };
    });
  }, [filteredDepts, hasDeptData, periodKey]);

  // ── Execution velocity (fact growth rate Q-over-Q) ──
  const velocityData = useMemo(() => {
    if (!hasDeptData) return [];
    return filteredDepts.map((d: any) => {
      const q1f = d.quarters?.q1?.factTotal ?? 0;
      const q2f = d.quarters?.q2?.factTotal ?? 0;
      const q3f = d.quarters?.q3?.factTotal ?? 0;
      const q4f = d.quarters?.q4?.factTotal ?? 0;
      const cumulative = [q1f, q1f + q2f, q1f + q2f + q3f, q1f + q2f + q3f + q4f];
      const yearPlan = d.quarters?.year?.planTotal ?? 1;
      return {
        name: d.department?.nameShort ?? '?',
        q1: yearPlan > 0 ? +((cumulative[0] / yearPlan) * 100).toFixed(1) : 0,
        q2: yearPlan > 0 ? +((cumulative[1] / yearPlan) * 100).toFixed(1) : 0,
        q3: yearPlan > 0 ? +((cumulative[2] / yearPlan) * 100).toFixed(1) : 0,
        q4: yearPlan > 0 ? +((cumulative[3] / yearPlan) * 100).toFixed(1) : 0,
      };
    });
  }, [filteredDepts, hasDeptData]);

  // ── Subordinate rankings ──
  const topSubordinates = useMemo(() => {
    if (!hasDeptData) return [];
    const all: { name: string; dept: string; executionPct: number; planTotal: number; factTotal: number }[] = [];
    for (const d of filteredDepts) {
      for (const sub of (d.subordinates ?? [])) {
        all.push({
          name: sub.name,
          dept: d.department?.nameShort ?? '?',
          executionPct: sub.executionPct ?? 0,
          planTotal: sub.planTotal ?? 0,
          factTotal: sub.factTotal ?? 0,
        });
      }
    }
    return all.sort((a, b) => b.planTotal - a.planTotal).slice(0, 15);
  }, [filteredDepts, hasDeptData]);

  /**
   * Разбивка выбранного управления по учреждениям — общее сырьё карточек,
   * переходящих в режим подведов (доли, сводка, рейтинг).
   *
   * Присутствие организации задаёт КАНОН фильтра (orgScope.subordinates), а
   * числа приходят из снимка управления. Организация канона без чисел из
   * списка не исчезает: «строк в выборке нет» и «организации нет» — разные
   * новости, и различать их обязан экран, а не читатель.
   */
  const subBreakdown = useMemo(() => {
    if (orgScope.mode !== 'withSubs' || !orgScope.dept) return [];
    const dept = filteredDepts.find((d: any) =>
      toCanonicalDeptId(d.department?.id ?? d.department?.nameShort ?? '') === orgScope.dept);
    return buildSubBreakdown({
      groups: orgScope.subordinates,
      subordinates: (dept?.subordinates ?? []) as SubordinateMetricsLike[],
      periodKey,
    });
  }, [orgScope, filteredDepts, periodKey]);

  const subTotals = useMemo(() => subBreakdownTotals(subBreakdown), [subBreakdown]);

  const orgDeptLabel = orgScope.dept ? productLabel(orgScope.dept) : '';

  /** Переход к строкам-основаниям организации: управление плюс само учреждение. */
  const openOrgRows = useCallback((key: string) => {
    navigateTo('data', {
      department: orgScope.dept ?? '',
      ...(key === ORG_ITSELF_SENTINEL ? {} : { subordinate: key }),
    });
  }, [navigateTo, orgScope.dept]);

  /**
   * Строки карточки долей. Районный срез делит закупки между управлениями,
   * режим «с подведомственными» — между организациями одного управления.
   * Считается один и тот же вопрос «чья это доля», меняется только уровень.
   */
  const shareRows = useMemo(() => {
    if (orgScope.mode === 'withSubs' && subBreakdown.length > 0) {
      const { plan, fact } = subTotals;
      return subBreakdown.map((r, i) => ({
        key: r.key,
        name: r.label,
        color: chartColors[i % chartColors.length],
        planTotal: r.planTotal ?? 0,
        factTotal: r.factTotal ?? 0,
        planShare: plan > 0 ? +(((r.planTotal ?? 0) / plan) * 100).toFixed(1) : 0,
        factShare: fact > 0 ? +(((r.factTotal ?? 0) / fact) * 100).toFixed(1) : 0,
        open: () => openOrgRows(r.key),
      }));
    }
    return deptShares.map((d: any, i: number) => ({
      key: String(d.id ?? i),
      name: d.name as string,
      color: d.color as string,
      planTotal: d.planTotal as number,
      factTotal: d.factTotal as number,
      planShare: d.planShare as number,
      factShare: d.factShare as number,
      open: () => { if (d.id) navigateTo('data', { department: d.id }); },
    }));
  }, [orgScope.mode, subBreakdown, subTotals, deptShares, chartColors, navigateTo, openOrgRows]);

  const topShare = shareRows.length > 0
    ? shareRows.reduce((max, r) => (r.planShare > max.planShare ? r : max), shareRows[0])
    : null;

  // ── Assertion-driven title data ──
  const epTotal = quarterlyTrend.reduce((s, q) => s + q.ep, 0);
  const kpTotal = quarterlyTrend.reduce((s, q) => s + q.kp, 0);
  const epSharePct = (epTotal + kpTotal) > 0 ? (epTotal / (epTotal + kpTotal)) * 100 : 0;

  const totalPlan = budgetByDept.reduce((s, d) => s + d.planTotal, 0);
  const totalFact = budgetByDept.reduce((s, d) => s + d.factTotal, 0);
  const overallExecPct = totalPlan > 0 ? (totalFact / totalPlan) * 100 : 0;

  const avgEconomy = scatterData.length > 0
    ? scatterData.reduce((s: number, d: any) => s + (d.economyPercent ?? 0), 0) / scatterData.length
    : 0;
  const suspiciousCount = scatterData.filter((d: any) => d.economyPercent < 2 || d.economyPercent > 25).length;

  const avgExecHeatmap = heatmapData.length > 0
    ? heatmapData.reduce((s: number, d: any) => s + (d.execPct ?? 0), 0) / heatmapData.length
    : 0;

  const avgTrust = trustData.length > 0
    ? trustData.reduce((s, d) => s + d.trust, 0) / trustData.length
    : 0;
  const lowTrustCount = trustData.filter(d => d.trust < 60).length;

  const totalIssues = issuesByDept.reduce((s, d) => s + ((d as any).critical ?? 0) + ((d as any).significant ?? 0) + ((d as any).warning ?? 0) + ((d as any).info ?? 0), 0);
  const criticalIssues = issuesByDept.reduce((s, d) => s + ((d as any).critical ?? 0), 0);

  // ── Treemap: spend hierarchy by department ──
  const treemapData = useMemo(() => {
    if (!hasDeptData) return [];
    return filteredDepts
      .map((d: any, i: number) => {
        const q = d.quarters?.[periodKey] ?? {};
        const fact = q.factTotal ?? d.factTotal ?? 0;
        return {
          name: d.department?.nameShort ?? '?',
          id: d.department?.id,
          size: Math.max(fact, 0),
          fill: chartColors[i % chartColors.length],
        };
      })
      .filter(d => d.size > 0);
  }, [filteredDepts, hasDeptData, periodKey, chartColors]);

  return (
    <div className="space-y-4">
      {/* Что делает выбор организаций с этой страницей — сказано до чисел,
          а не после (канон п.53: механизм, адрес, действие). */}
      {selectedSubordinates.size > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-[var(--surface-sunken)] px-4 py-2.5 text-xs text-[var(--ink-muted)]">
          <Info size={14} className="mt-px shrink-0 text-[var(--ink-faint)]" aria-hidden="true" />
          <span>
            Графики этой страницы считаются по управлению целиком: выбранные учреждения их не сужают.
            Разбивку по учреждениям дают карточки «Доли», «Сводка» и «Рейтинг» — для этого выберите
            в фильтре одно управление «с подведомственными».
          </span>
        </p>
      )}
      {orgScope.mode === 'withSubs' && orgScope.hasSubs && (
        <p className="flex items-start gap-2 rounded-xl bg-[var(--surface-sunken)] px-4 py-2.5 text-xs text-[var(--ink-muted)]">
          <Building2 size={14} className="mt-px shrink-0 text-[var(--ink-faint)]" aria-hidden="true" />
          <span>
            Выбрано управление <strong className="text-[var(--ink)]">{orgDeptLabel}</strong> с подведомственными:
            карточки «Доли», «Сводка» и «Рейтинг» показывают разбивку по его учреждениям
            ({subBreakdown.length} {pluralRu(subBreakdown.length, 'организация', 'организации', 'организаций')}),
            остальные — управление целиком.
          </span>
        </p>
      )}
      {/* KPI row — Anti-Slop Rule #3: size = importance (2 large + 2 medium + 2 compact) */}
      {fd.topKpis.length > 0 && (() => {
        const cards = fd.topKpis;
        // Split into tiers: first 2 = hero (large), next 2 = medium, rest = compact
        const heroCards = cards.slice(0, 2);
        const medCards = cards.slice(2, 4);
        const compactCards = cards.slice(4);

        const renderCard = (card: any, tier: 'hero' | 'med' | 'compact') => {
          const cleanValue = card.value?.replace(/\s*(percent|count|rubles|thousand_rubles|million_rubles|days|none)\s*$/i, '').trim() ?? '—';
          const hasWarning = card.delta && !card.delta.withinTolerance;
          // Происхождение числа стоит У ЧИСЛА (PRODUCT.md, «провенанс до
          // ячейки»): плитка называет, пересчитана величина из строк или
          // взята из официального листа, и за какой период она посчитана.
          const fromSvod = card.origin === 'svod' || card.source === 'official';
          const originWord = fromSvod ? 'СВОД' : 'Расчёт';
          const originTitle = fromSvod
            ? 'Взято из официального листа СВОД без пересчёта'
            : 'Пересчитано из строк книг управлений';
          return (
            <button
              type="button"
              key={card.metricKey}
              className={`analytics-kpi analytics-kpi-${tier} cursor-pointer text-left`}
              title={hasWarning
                ? 'Открыть сверку: расчёт по строкам разошёлся с официальным листом'
                : 'Открыть разбор показателя: как считается и из чего сложен'}
              onClick={() => navigateTo('quality', {
                qualityTab: hasWarning ? 'recon' : 'trust',
                search: card.label,
              })}
            >
              <span className={`analytics-kpi-label ${tier === 'hero' ? 'text-[11px]' : 'text-[10px]'}`}>{card.label}</span>
              <div className={`analytics-kpi-value ${tier === 'hero' ? 'text-2xl' : tier === 'med' ? 'text-lg' : 'text-base'}`}>
                {cleanValue}
              </div>
              {/* Скоуп и происхождение — у каждого числа, без исключений (пп.53, 58). */}
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px] text-[var(--ink-faint)]">
                <span className="tabular-nums">{dataPeriodLabel}</span>
                <span aria-hidden="true">·</span>
                <span title={originTitle}>{originWord}</span>
                {orgScope.dept && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{orgDeptLabel}{orgScope.mode === 'withSubs' ? ' с подведами' : ' без подведов'}</span>
                  </>
                )}
              </div>
              {hasWarning && (
                <div className="mt-1 text-[10px] font-medium text-[var(--data-warn)]">
                  расходится с официальным листом на {card.delta.deltaPercent}
                </div>
              )}
            </button>
          );
        };

        return (
          <div className="analytics-kpi-grid">
            {/* Hero tier (2 large) */}
            <div className="analytics-kpi-hero-row">
              {heroCards.map(c => renderCard(c, 'hero'))}
            </div>
            {/* Medium tier (2 medium) + Compact tier (rest) */}
            <div className="analytics-kpi-secondary-row">
              {medCards.map(c => renderCard(c, 'med'))}
              {compactCards.map(c => renderCard(c, 'compact'))}
            </div>
          </div>
        );
      })()}

      {/* Row 1: Quarterly procurement trend + Execution trend line */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsCard title={epSharePct > 30 ? `ЕП занимает ${epSharePct.toFixed(0)}% закупок — превышает норму` : epSharePct > 0 ? `ЕП доля: ${epSharePct.toFixed(0)}% (${epTotal} из ${epTotal + kpTotal})` : 'Динамика закупок по кварталам: конкурентные и единственный поставщик'} icon={BarChart3} source="calculated" perimeter="2026 · все кварталы">
          {quarterlyTrend.some(q => q.kp > 0 || q.ep > 0) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={quarterlyTrend} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} cursor={cursorStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="kp" name="Конкурсные (КП)" fill="#3b82f6" radius={[4, 4, 0, 0]} cursor="pointer"
                  onClick={() => navigateTo('data', { procurement: 'competitive' })}
                />
                <Bar dataKey="ep" name="Единственный (ЕП)" fill="#f59e0b" radius={[4, 4, 0, 0]} cursor="pointer"
                  onClick={() => navigateTo('data', { procurement: 'single' })}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <CardEmpty
              title="Закупок по кварталам не нашлось"
              description="В книгах выбранных управлений нет ни одной строки с распознанным кварталом за этот год: сравнивать конкурентные и единственного поставщика не по чему."
              action={{ label: 'Открыть Реестр', onClick: () => navigateTo('data') }}
            />
          )}
        </AnalyticsCard>

        <AnalyticsCard title={execTrendClaim} icon={LineChartIcon} source="calculated" perimeter="2026 · по кварталам">
          {execTrend.length > 0 && deptNames.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={execTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis domain={[0, 'auto']} fontSize={11} tickFormatter={(v: number) => `${v}%`} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} formatter={(v: any) => v != null ? [`${Number(v).toFixed(1)}%`] : ['—']} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {deptNames.map((name, i) => (
                  <Line key={name} type="monotone" dataKey={name} stroke={chartColors[i % chartColors.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <CardEmpty
              title="Тренд исполнения не построен"
              description="Исполнение по кварталам считается от плановых сумм: у выбранных управлений плана за год нет, а линия по пустым кварталам была бы выдумкой."
            />
          )}
        </AnalyticsCard>
      </div>

      {/* Row 2: Plan vs Fact comparison by department */}
      <AnalyticsCard title={overallExecPct > 0 ? `Исполнение ${overallExecPct.toFixed(0)}% — ${overallExecPct < 25 ? 'отставание от графика' : overallExecPct > 90 ? 'на уровне плана' : 'в работе'} (${periodLabel})` : `Сравнение План / Факт по управлениям (${periodLabel})`} icon={Layers} source="calculated">
        {budgetByDept.length > 0 ? (
          <div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={budgetByDept} barCategoryGap="15%">
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis fontSize={10} tickFormatter={(v: number) => formatMoney(v)} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip
                  contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} cursor={cursorStyle}
                  formatter={(v: number, name: string) => [formatMoney(v), name]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="planFB" name="ФБ план" stackId="plan" fill="#3b82f6" cursor="pointer"
                  onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id }); }}
                />
                <Bar dataKey="planKB" name="КБ план" stackId="plan" fill="#60a5fa" cursor="pointer"
                  onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id }); }}
                />
                <Bar dataKey="planMB" name="МБ план" stackId="plan" fill="#93c5fd" radius={[4, 4, 0, 0]} cursor="pointer"
                  onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id }); }}
                />
                <Bar dataKey="factFB" name="ФБ факт" stackId="fact" fill="#10b981" cursor="pointer"
                  onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id }); }}
                />
                <Bar dataKey="factKB" name="КБ факт" stackId="fact" fill="#34d399" cursor="pointer"
                  onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id }); }}
                />
                <Bar dataKey="factMB" name="МБ факт" stackId="fact" fill="#6ee7b7" radius={[4, 4, 0, 0]} cursor="pointer"
                  onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id }); }}
                />
              </BarChart>
            </ResponsiveContainer>

            {/* Drill-down: click a dept to see its budget detail */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {budgetByDept.map((dept: typeof budgetByDept[0]) => {
                const isExpanded = expandedDept === dept.id;
                const subs = subordinatesMap[dept.id ?? ''] ?? [];
                // Поверхность разделяет карточки, а не обводка у каждого атома (п.129).
                return (
                  <div key={dept.id} className="overflow-hidden rounded-lg bg-[var(--surface-sunken)]">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedDept(isExpanded ? null : (dept.id ?? null))}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-[var(--surface-raised)]"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dept.color }} aria-hidden="true" />
                      <span className="flex-1 text-xs font-semibold text-[var(--ink-strong)]">{dept.name}</span>
                      {isExpanded
                        ? <ChevronDown size={12} className="text-[var(--ink-faint)]" aria-hidden="true" />
                        : <ChevronRight size={12} className="text-[var(--ink-faint)]" aria-hidden="true" />}
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-1">
                        <BudgetProgress label="ФБ (федеральный)" plan={dept.planFB} fact={dept.factFB} color="#3b82f6" formatMoney={formatMoney} />
                        <BudgetProgress label="КБ (краевой)" plan={dept.planKB} fact={dept.factKB} color="#60a5fa" formatMoney={formatMoney} />
                        <BudgetProgress label="МБ (муниципальный)" plan={dept.planMB} fact={dept.factMB} color="#93c5fd" formatMoney={formatMoney} />
                        <div className="mt-2 border-t border-[var(--line-soft)] pt-2">
                          <div className="flex justify-between text-[10px] text-[var(--ink-muted)]">
                            <span>Итого план:</span>
                            <span className="font-semibold tabular-nums">{formatMoney(dept.planTotal)}</span>
                          </div>
                          <div className="flex justify-between text-[10px] text-[var(--ink-muted)]">
                            <span>Итого факт:</span>
                            <span className="font-semibold tabular-nums">{formatMoney(dept.factTotal)}</span>
                          </div>
                        </div>
                        {subs.length > 0 && (
                          <div className="mt-2 border-t border-[var(--line-soft)] pt-2">
                            <div className="mb-1 text-[9px] font-semibold uppercase text-[var(--ink-faint)]">
                              Подведомственные учреждения ({subs.length})
                            </div>
                            {subs.map(s => (
                              <button
                                type="button"
                                key={s}
                                className="flex w-full items-center gap-1 py-0.5 text-left text-[10px] text-[var(--ink-muted)] transition hover:text-[var(--accent)]"
                                onClick={() => navigateTo('data', { department: dept.id ?? '', subordinate: s })}
                                title="Открыть строки этого учреждения в Реестре"
                              >
                                <Building2 size={9} className="shrink-0 text-[var(--ink-faint)]" aria-hidden="true" />
                                <span className="truncate">{subordinateLabel(s)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <CardEmpty
              title="Плановых сумм по бюджетам нет"
              description="Ни у одного выбранного управления не заполнены федеральный, краевой и муниципальный планы за этот период — столбцы складывать не из чего."
              action={{ label: 'Открыть Реестр', onClick: () => navigateTo('data') }}
            />
        )}
      </AnalyticsCard>

      {/* Доли: район — между управлениями, «с подведомственными» — между
          организациями выбранного управления (режим подведов, 20.08). */}
      <AnalyticsCard
        icon={TrendingUp}
        source="calculated"
        title={topShare
          ? `${topShare.name} ведёт ${topShare.planShare} % плана ${orgScope.mode === 'withSubs' ? `управления ${orgDeptLabel}` : 'района'} (${periodLabel})`
          : `Доли в закупках (${periodLabel})`}
      >
        <OrgScopeNote scope={orgScope} whatSplits="долей" />
        {shareRows.length > 0 ? (
          <div>
            <p className="mb-2 text-[11px] text-[var(--ink-muted)]">
              {orgScope.mode === 'withSubs'
                ? `Доля организации в плане управления ${orgDeptLabel} за ${dataPeriodLabel}. Клик по полосе открывает строки этой организации в Реестре.`
                : `Доля управления в плане района за ${dataPeriodLabel}. Клик по полосе открывает строки управления в Реестре.`}
            </p>
            {/* План */}
            <div className="mb-4">
              <div className="mb-1.5 text-[10px] font-semibold uppercase text-[var(--ink-faint)]">По плану</div>
              <div className="flex h-7 overflow-hidden rounded-lg bg-[var(--surface-sunken)]">
                {shareRows.filter((d) => d.planShare > 0).map((d) => (
                  <button
                    type="button"
                    key={`plan-${d.key}`}
                    className="relative cursor-pointer transition-opacity hover:opacity-80"
                    style={{ width: `${d.planShare}%`, backgroundColor: d.color }}
                    onClick={d.open}
                    title={`${d.name}: ${formatMoney(d.planTotal)} — ${d.planShare} % плана`}
                  >
                    {d.planShare > 6 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white/90">
                        {d.name} {d.planShare}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            {/* Факт */}
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase text-[var(--ink-faint)]">По факту</div>
              <div className="flex h-7 overflow-hidden rounded-lg bg-[var(--surface-sunken)]">
                {shareRows.filter((d) => d.factShare > 0).map((d) => (
                  <button
                    type="button"
                    key={`fact-${d.key}`}
                    className="relative cursor-pointer transition-opacity hover:opacity-80"
                    style={{ width: `${d.factShare}%`, backgroundColor: d.color, opacity: 0.85 }}
                    onClick={d.open}
                    title={`${d.name}: ${formatMoney(d.factTotal)} — ${d.factShare} % факта`}
                  >
                    {d.factShare > 6 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white/90">
                        {d.name} {d.factShare}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            {/* Текстовый дубль визуального (канон 01.08): цвет полосы — не
                единственный носитель смысла, рядом стоят имя и проценты. */}
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {shareRows.map((d) => (
                <li key={`legend-${d.key}`} className="flex items-center gap-1 text-[10px] text-[var(--ink-muted)]">
                  <span className="h-2.5 w-2.5 rounded" style={{ backgroundColor: d.color }} aria-hidden="true" />
                  <span>{d.name}</span>
                  <span className="tabular-nums text-[var(--ink-faint)]">
                    {d.planShare > 0 ? `${d.planShare} % плана` : 'плана нет'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : orgScope.mode === 'withSubs' ? (
          <CardEmpty
            title={`У управления ${orgDeptLabel} нет сумм для разбивки`}
            description="Ни у аппарата, ни у учреждений за выбранный период не заполнены план и факт — доли считать не от чего."
            action={{ label: 'Открыть строки управления', onClick: () => openOrgRows(ORG_ITSELF_SENTINEL) }}
          />
        ) : (
          <CardEmpty
            title="Долей нет: план и факт по управлениям пусты"
            description="Доля считается от суммы по всем показанным управлениям; пока сумма равна нулю, любая доля была бы делением на ноль."
          />
        )}
      </AnalyticsCard>

      {/* Структура расходов: сколько заплатило каждое управление за период. */}
      {(
        <AnalyticsCard
          icon={Layers}
          source="calculated"
          title={`Структура расходов по управлениям (${periodLabel})`}
        >
          <p className="mb-2 text-[11px] text-[var(--ink-muted)]">
            Доля управления в фактических платежах района за {dataPeriodLabel}. Клик открывает его строки в Реестре.
          </p>
          {treemapData.length === 0 ? (
            <CardEmpty
              title="Платежей за период нет"
              description="Ни одно управление не показало факта за выбранный период: структуру расходов складывать не из чего."
              action={{ label: 'Открыть Реестр', onClick: () => navigateTo('data') }}
            />
          ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {treemapData.map((d: any) => {
              const totalSize = treemapData.reduce((s: number, item: any) => s + item.size, 0);
              const pct = totalSize > 0 ? ((d.size / totalSize) * 100).toFixed(1) : '0';
              return (
                <button
                  type="button"
                  key={d.name}
                  className="relative overflow-hidden rounded-xl p-3 text-left transition-all duration-200 hover:shadow-md"
                  // Боковая цветная полоса запрещена (DESIGN.md): цвет управления
                  // несут точка и число, поверхность остаётся спокойной.
                  style={{ backgroundColor: `${d.fill}1f` }}
                  onClick={() => { if (d.id) navigateTo('data', { department: d.id }); }}
                  title={`${d.name}: ${formatMoney(d.size)} — ${pct} % факта района`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-strong)]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: d.fill }} aria-hidden="true" />
                    {d.name}
                  </span>
                  <span className="mt-1 block text-sm font-semibold tabular-nums text-[var(--ink-strong)]">{formatMoney(d.size)}</span>
                  <span className="block text-[10px] tabular-nums text-[var(--ink-faint)]">{pct} % факта района</span>
                </button>
              );
            })}
          </div>
          )}
        </AnalyticsCard>
      )}

      {/* Виды деятельности: программная против текущей */}
      {(
        <AnalyticsCard title={`Разбивка по видам деятельности (${periodLabel})`} icon={Layers} source="calculated">
          {!activityData.some(d => d.program > 0 || d.current > 0) ? (
            <CardEmpty
              title="Вид деятельности в строках не проставлен"
              description="Разбивка строится по колонке вида деятельности книги: за выбранный период ни программных, ни текущих сумм в ней нет."
              action={{ label: 'Открыть Реестр', onClick: () => navigateTo('data') }}
            />
          ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={activityData} barCategoryGap="15%">
              <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
              <XAxis dataKey="name" fontSize={10} tick={{ fill: getAxisColor(isDark) }} />
              <YAxis fontSize={10} tickFormatter={(v: number) => formatMoney(v)} tick={{ fill: getAxisColor(isDark) }} />
              <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} cursor={cursorStyle} formatter={(v: number, name: string) => [formatMoney(v), name]} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="program" name="Программная" stackId="plan" fill="#8b5cf6" radius={[0, 0, 0, 0]} cursor="pointer"
                onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id, activity: 'program' }); }}
              />
              <Bar dataKey="current" name="Текущая деятельность" stackId="plan" fill="#06b6d4" radius={[4, 4, 0, 0]} cursor="pointer"
                onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id, activity: 'current_non_program' }); }}
              />
              <Bar dataKey="programFact" name="Программная (факт)" stackId="fact" fill="#a78bfa" radius={[0, 0, 0, 0]} cursor="pointer"
                onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id, activity: 'program' }); }}
              />
              <Bar dataKey="currentFact" name="Текущая деятельность (факт)" stackId="fact" fill="#22d3ee" radius={[4, 4, 0, 0]} cursor="pointer"
                onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id, activity: 'current_non_program' }); }}
              />
            </BarChart>
          </ResponsiveContainer>
          )}
        </AnalyticsCard>
      )}

      {/* Execution velocity — cumulative fact as % of year plan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(
          <AnalyticsCard title="Скорость исполнения (кумулятивно, % годового плана)" icon={TrendingUp} source="calculated" perimeter="2026 · нарастающим итогом">
            {velocityData.length === 0 ? (
              <CardEmpty
                title="Скорость исполнения не построена"
                description="Кумулятивная линия считается от годового плана управления: пока плана нет, накопленный процент был бы делением на ноль."
              />
            ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={[
                { name: '1 кв.', ...Object.fromEntries(velocityData.map(d => [d.name, d.q1])) },
                { name: '2 кв.', ...Object.fromEntries(velocityData.map(d => [d.name, d.q2])) },
                { name: '3 кв.', ...Object.fromEntries(velocityData.map(d => [d.name, d.q3])) },
                { name: '4 кв.', ...Object.fromEntries(velocityData.map(d => [d.name, d.q4])) },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis domain={[0, 'auto']} fontSize={11} tickFormatter={(v: number) => `${v}%`} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} formatter={(v: any) => v != null ? [`${Number(v).toFixed(1)}%`] : ['—']} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {velocityData.map((d, i) => (
                  <Line key={d.name} type="monotone" dataKey={d.name} stroke={chartColors[i % chartColors.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
            )}
          </AnalyticsCard>
        )}

        {/* Организации: район — топ-15 по плану, «с подведомственными» —
            ПОЛНЫЙ список учреждений выбранного управления, включая те, у
            которых строк в выборке нет (режим подведов, 20.08). */}
        {(orgScope.mode === 'withSubs' || topSubordinates.length > 0) && (
          <AnalyticsCard
            icon={Building2}
            source="calculated"
            perimeter={orgScope.mode === 'withSubs' ? `${dataPeriodLabel} · все организации` : '2026 · весь год'}
            title={orgScope.mode === 'withSubs'
              ? `Организации управления ${orgDeptLabel}: ${subTotals.withRows} из ${subBreakdown.length} ведут закупки`
              : 'Организации района: пятнадцать крупнейших по плану'}
          >
            <OrgScopeNote scope={orgScope} whatSplits="списка организаций" />
            {orgScope.mode === 'withSubs' ? (
              subBreakdown.length === 0 ? (
                <CardEmpty
                  title={`Разбивка управления ${orgDeptLabel} не построена`}
                  description="Фильтр организаций не знает ни одного учреждения этого управления, а в выборке нет ни одной строки с колонкой учреждения."
                  action={{ label: 'Открыть строки управления', onClick: () => openOrgRows(ORG_ITSELF_SENTINEL) }}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      Организации управления {orgDeptLabel}: план, факт и исполнение за {dataPeriodLabel}
                    </caption>
                    <thead>
                      <tr className="text-[10px] font-medium uppercase text-[var(--ink-faint)]">
                        <th scope="col" className="py-2 text-left">Организация</th>
                        <th scope="col" className="w-20 py-2 text-right">План</th>
                        <th scope="col" className="w-20 py-2 text-right">Факт</th>
                        <th scope="col" className="w-14 py-2 text-center">Исп.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subBreakdown.map((row) => (
                        <tr
                          key={row.key}
                          className="cursor-pointer border-t border-[var(--line-soft)] transition hover:bg-[var(--surface-raised)]"
                          onClick={() => openOrgRows(row.key)}
                          title="Открыть строки этой организации в Реестре"
                        >
                          <td className="max-w-[220px] truncate py-1.5 text-xs text-[var(--ink)]">
                            {row.label}
                            {!row.hasRows && (
                              <span className="ml-1.5 text-[10px] text-[var(--ink-faint)]">строк в выборке нет</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right text-[10px] tabular-nums text-[var(--ink-muted)]">
                            {row.planTotal != null ? formatMoney(row.planTotal) : '—'}
                          </td>
                          <td className="py-1.5 text-right text-[10px] tabular-nums text-[var(--ink-muted)]">
                            {row.factTotal != null ? formatMoney(row.factTotal) : '—'}
                          </td>
                          <td className="py-1.5 text-center">
                            {/* Пустота нулём запрещена: нет плана — нет процента. */}
                            {row.executionPct != null ? (
                              <span
                                className="inline-block w-12 rounded py-0.5 text-[10px] font-bold tabular-nums"
                                style={{ backgroundColor: getExecutionHeatBg(row.executionPct, isDark), color: getExecutionHeatText(row.executionPct, isDark) }}
                              >
                                {row.executionPct.toFixed(0)}%
                              </span>
                            ) : (
                              <span className="text-[10px] text-[var(--ink-faint)]" title="Плана за период нет — исполнять нечего">
                                нет базы
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Пятнадцать организаций района с наибольшим планом за 2026 год
                  </caption>
                  <thead>
                    <tr className="text-[10px] font-medium uppercase text-[var(--ink-faint)]">
                      <th scope="col" className="py-2 text-left">#</th>
                      <th scope="col" className="py-2 text-left">Организация</th>
                      <th scope="col" className="py-2 text-left">Управление</th>
                      <th scope="col" className="w-20 py-2 text-right">План</th>
                      <th scope="col" className="w-20 py-2 text-right">Факт</th>
                      <th scope="col" className="w-14 py-2 text-center">Исп.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSubordinates.map((sub, idx) => (
                      <tr
                        key={`${sub.name}-${idx}`}
                        className="cursor-pointer border-t border-[var(--line-soft)] transition hover:bg-[var(--surface-raised)]"
                        onClick={() => {
                          const dept = filteredDepts.find((d: any) => (d.department?.nameShort ?? '?') === sub.dept);
                          if (dept?.department?.id) navigateTo('data', { department: dept.department.id, subordinate: sub.name });
                        }}
                        title="Открыть строки этой организации в Реестре"
                      >
                        <td className="py-1.5 text-[10px] tabular-nums text-[var(--ink-faint)]">{idx + 1}</td>
                        <td className="max-w-[180px] truncate py-1.5 text-xs text-[var(--ink)]" title={subordinateLabel(sub.name)}>{subordinateLabel(sub.name)}</td>
                        <td className="py-1.5 text-[10px] text-[var(--ink-muted)]">{sub.dept}</td>
                        <td className="py-1.5 text-right text-[10px] tabular-nums text-[var(--ink-muted)]">{formatMoney(sub.planTotal)}</td>
                        <td className="py-1.5 text-right text-[10px] tabular-nums text-[var(--ink-muted)]">{formatMoney(sub.factTotal)}</td>
                        <td className="py-1.5 text-center">
                          {sub.executionPct > 0 ? (
                            <span
                              className="inline-block w-12 rounded py-0.5 text-[10px] font-bold tabular-nums"
                              style={{ backgroundColor: getExecutionHeatBg(sub.executionPct, isDark), color: getExecutionHeatText(sub.executionPct, isDark) }}
                            >
                              {sub.executionPct.toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-[10px] text-[var(--ink-faint)]" title="Плана за период нет — исполнять нечего">
                              нет базы
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AnalyticsCard>
        )}
      </div>

      {/* Forecast */}
      {filteredDepts.length > 0 && (
        <AnalyticsCard title={forecastTitle} icon={TrendingUp} source="calculated" perimeter="2026 · прогноз до конца года">
          <ForecastCard depts={filteredDepts} isDark={isDark} formatMoney={formatMoney} onClaim={setForecastTitle} />
        </AnalyticsCard>
      )}

      {/* Economy Scatter: Limit vs Fact */}
      <AnalyticsCard title={scatterData.length > 0 ? `Средняя экономия ${avgEconomy.toFixed(1)}%${suspiciousCount > 0 ? ` — у ${suspiciousCount} закупок экономия вне коридора 2–25 %` : ''}` : 'Экономия: лимит против цены по заключённым закупкам'} icon={TrendingUp} source="calculated">
        {scatterLoading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex animate-pulse items-center justify-center py-12 text-sm text-[var(--ink-faint)]"
          >
            Собираем заключённые закупки: лимит строки против цены контракта…
          </div>
        ) : scatterData.length === 0 ? (
          <CardEmpty
              title="Заключённых закупок под текущий отбор нет"
              description="На диаграмму попадают только строки с датой заключения и ценой контракта. Снимите фильтры шапки или обновите данные."
              action={{ label: 'Открыть Реестр', onClick: () => navigateTo('data') }}
            />
        ) : (
          <>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-3">
              Каждая точка — одна ЗАКЛЮЧЁННАЯ закупка (есть дата заключения и цена).
              Обе оси — в тысячах рублей, как в книгах. Диагональ = нулевая экономия. Цвет по % снижения (44-ФЗ ст.37).
              <span className="ml-2 font-medium text-zinc-500">{scatterData.length} закупок</span>
            </p>
            <div style={{ width: '100%', height: 380 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                  {/* Обе величины в книгах ведутся в ТЫСЯЧАХ рублей — оси и деления
                      подписаны одной единицей (скрин-разбор №5: «руб.» против
                      «тыс. руб.» на осях одного графика — запрещено). */}
                  <XAxis
                    type="number" dataKey="planTotal" name="Лимит строки плана"
                    tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)} млрд` : v >= 1e3 ? `${(v / 1e3).toFixed(0)} млн` : `${v} тыс`}
                    label={{ value: 'Лимит строки плана (тыс. руб.)', position: 'bottom', offset: 20, style: { fontSize: 11, fill: getAxisColor(isDark) } }}
                    className="text-xs"
                  />
                  <YAxis
                    type="number" dataKey="factTotal" name="Цена контракта"
                    tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)} млрд` : v >= 1e3 ? `${(v / 1e3).toFixed(0)} млн` : `${v} тыс`}
                    label={{ value: 'Цена контракта (тыс. руб.)', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: 11, fill: getAxisColor(isDark) } }}
                    className="text-xs"
                  />
                  <ZAxis range={[30, 80]} />
                  <ReferenceLine
                    segment={[{ x: 0, y: 0 }, { x: Math.max(...scatterData.map((d: any) => d.planTotal)), y: Math.max(...scatterData.map((d: any) => d.planTotal)) }]}
                    stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={1}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="max-w-xs rounded-lg border border-[var(--line-soft)] bg-[var(--surface-overlay)] p-3 text-xs shadow-lg">
                          <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">{d.subject}</div>
                          <div className="text-zinc-500">{d.department} · {d.procurementType}</div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                            {/* Единица — та же, что в книге: тысячи рублей. «7 000 ₽»
                                на деле было 7 млн руб. (скрин-разбор №5). */}
                            <span className="text-zinc-400">Лимит:</span>
                            <span className="text-right font-medium">{d.planTotal?.toLocaleString('ru-RU')} тыс. руб.</span>
                            <span className="text-zinc-400">Цена:</span>
                            <span className="text-right font-medium">{d.factTotal?.toLocaleString('ru-RU')} тыс. руб.</span>
                            <span className="text-zinc-400">Экономия:</span>
                            <span className={`text-right font-bold ${d.economyPercent > 25 ? 'text-red-500' : d.economyPercent < 2 ? 'text-amber-500' : 'text-emerald-500'}`}>
                              {d.economyPercent?.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Scatter name="Норма (5-15%)" data={scatterData.filter((d: any) => d.economyPercent >= 5 && d.economyPercent <= 15)} fill={getPositiveColor(isDark)} fillOpacity={0.7} onClick={(d: any) => d && navigateTo('data', { department: d.department })} cursor="pointer" />
                  {/* Термин «предрешённость» снят владельцем (п.69д интервью 14.08.2026): самодельный жаргон, подпись — фактом. */}
                  <Scatter name="Снижение менее 5%" data={scatterData.filter((d: any) => d.economyPercent >= 0 && d.economyPercent < 5)} fill={getChartColor(2, isDark)} fillOpacity={0.7} onClick={(d: any) => d && navigateTo('data', { department: d.department })} cursor="pointer" />
                  {/* Лейбл-канон п.32: «на него повлиять нельзя, указывает лишь на
                      высокую экономию» — из тона претензии в информационный. */}
                  <Scatter name="Высокая экономия (свыше 25%)" data={scatterData.filter((d: any) => d.economyPercent > 25)} fill={getNegativeColor(isDark)} fillOpacity={0.7} onClick={(d: any) => d && navigateTo('data', { department: d.department })} cursor="pointer" />
                  <Scatter name="Цена выше лимита (меньше 0%)" data={scatterData.filter((d: any) => d.economyPercent < 0)} fill={getChartColor(4, isDark)} fillOpacity={0.7} onClick={(d: any) => d && navigateTo('data', { department: d.department })} cursor="pointer" />
                  <Scatter name="Заметная (15-25%)" data={scatterData.filter((d: any) => d.economyPercent > 15 && d.economyPercent <= 25)} fill={getChartColor(0, isDark)} fillOpacity={0.7} onClick={(d: any) => d && navigateTo('data', { department: d.department })} cursor="pointer" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 mt-3 text-[10px] flex-wrap">
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"><span className="w-3 h-3 rounded-full bg-emerald-500" /> 5–15 % — норма</span>
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"><span className="w-3 h-3 rounded-full bg-blue-500" /> 15–25 % — заметная</span>
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"><span className="w-3 h-3 rounded-full bg-amber-500" /> менее 5 % — низкое снижение</span>
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"><span className="w-3 h-3 rounded-full bg-red-500" /> свыше 25 % — высокая экономия по закупке (информационно)</span>
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"><span className="w-3 h-3 rounded-full bg-violet-500" /> меньше 0 % — цена выше лимита</span>
            </div>
          </>
        )}
      </AnalyticsCard>

      {/* Row 4: Heatmap + Качество заполнения */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Сводка: район — строка на управление, «с подведомственными» —
            строка на организацию выбранного управления (режим подведов). */}
        <AnalyticsCard
          icon={Building2}
          defaultOpen={true}
          source="calculated"
          title={orgScope.mode === 'withSubs'
            ? `Сводка управления ${orgDeptLabel} по организациям (${periodLabel})`
            : avgExecHeatmap > 0
              ? `Среднее исполнение ${avgExecHeatmap.toFixed(0)} % по ${heatmapData.length} управлениям (${periodLabel})`
              : `Сводка по управлениям (${periodLabel})`}
        >
          <OrgScopeNote scope={orgScope} whatSplits="сводки" />
          {orgScope.mode === 'withSubs' && subBreakdown.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Организации управления {orgDeptLabel}: исполнение, план, факт и число процедур за {dataPeriodLabel}
                </caption>
                <thead>
                  <tr className="text-[10px] font-medium uppercase text-[var(--ink-faint)]">
                    <th scope="col" className="py-2 text-left">Организация</th>
                    <th scope="col" className="w-14 py-2 text-center">Исп.</th>
                    <th scope="col" className="w-20 py-2 text-right">План</th>
                    <th scope="col" className="w-20 py-2 text-right">Факт</th>
                    <th scope="col" className="w-10 py-2 text-center" title="Конкурентные процедуры">КП</th>
                    <th scope="col" className="w-10 py-2 text-center" title="Закупки у единственного поставщика">ЕП</th>
                  </tr>
                </thead>
                <tbody>
                  {subBreakdown.map((row) => (
                    <tr
                      key={row.key}
                      className="cursor-pointer border-t border-[var(--line-soft)] transition hover:bg-[var(--surface-raised)]"
                      onClick={() => openOrgRows(row.key)}
                      title="Открыть строки этой организации в Реестре"
                    >
                      <td className="max-w-[200px] truncate py-1.5 text-xs font-medium text-[var(--ink)]">
                        {row.label}
                        {!row.hasRows && (
                          <span className="ml-1.5 font-normal text-[10px] text-[var(--ink-faint)]">строк в выборке нет</span>
                        )}
                      </td>
                      <td className="py-1.5 text-center">
                        {row.executionPct != null ? (
                          <span
                            className="inline-block w-12 rounded py-0.5 text-[10px] font-bold tabular-nums"
                            style={{ backgroundColor: getExecutionHeatBg(row.executionPct, isDark), color: getExecutionHeatText(row.executionPct, isDark) }}
                          >
                            {row.executionPct.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-[10px] text-[var(--ink-faint)]" title="Плана за период нет — исполнять нечего">нет базы</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right text-[10px] tabular-nums text-[var(--ink-muted)]">
                        {row.planTotal != null ? formatMoney(row.planTotal) : '—'}
                      </td>
                      <td className="py-1.5 text-right text-[10px] tabular-nums text-[var(--ink-muted)]">
                        {row.factTotal != null ? formatMoney(row.factTotal) : '—'}
                      </td>
                      <td className="py-1.5 text-center text-[10px] font-medium tabular-nums text-[var(--ink-muted)]">{row.kpCount || '—'}</td>
                      <td className="py-1.5 text-center text-[10px] font-medium tabular-nums text-[var(--data-warn)]">{row.epCount || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : heatmapData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Управления района: исполнение, план, факт, число процедур и замечаний за {dataPeriodLabel}
                </caption>
                <thead>
                  <tr className="text-[10px] font-medium uppercase text-[var(--ink-faint)]">
                    <th scope="col" className="py-2 text-left">Упр.</th>
                    <th scope="col" className="w-14 py-2 text-center">Исп.</th>
                    <th scope="col" className="w-20 py-2 text-right">План</th>
                    <th scope="col" className="w-20 py-2 text-right">Факт</th>
                    <th scope="col" className="w-10 py-2 text-center" title="Конкурентные процедуры">КП</th>
                    <th scope="col" className="w-10 py-2 text-center" title="Закупки у единственного поставщика">ЕП</th>
                    <th scope="col" className="w-12 py-2 text-center" title="Замечания к книге управления">Замеч.</th>
                  </tr>
                </thead>
                <tbody>
                  {heatmapData.map((row: any) => (
                    <tr
                      key={row.dept}
                      className="cursor-pointer border-t border-[var(--line-soft)] transition hover:bg-[var(--surface-raised)]"
                      onClick={() => row.id && navigateTo('data', { department: row.id })}
                      title="Открыть строки управления в Реестре"
                    >
                      <td className="py-1.5 text-xs font-medium text-[var(--ink)]">{row.dept}</td>
                      <td className="py-1.5 text-center">
                        <span
                          className="inline-block w-12 rounded py-0.5 text-[10px] font-bold tabular-nums"
                          style={{ backgroundColor: getExecutionHeatBg(row.execPct, isDark), color: getExecutionHeatText(row.execPct, isDark) }}
                        >
                          {row.execPct > 0 ? `${typeof row.execPct === 'number' ? row.execPct.toFixed(0) : row.execPct}%` : '—'}
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-[10px] tabular-nums text-[var(--ink-muted)]">
                        {row.planTotal != null ? formatMoney(row.planTotal) : '—'}
                      </td>
                      <td className="py-1.5 text-right text-[10px] tabular-nums text-[var(--ink-muted)]">
                        {row.factTotal != null ? formatMoney(row.factTotal) : '—'}
                      </td>
                      <td className="py-1.5 text-center text-[10px] font-medium tabular-nums text-[var(--ink-muted)]">{row.kpCount || '—'}</td>
                      <td className="py-1.5 text-center text-[10px] font-medium tabular-nums text-[var(--data-warn)]">{row.epCount || '—'}</td>
                      <td className="py-1.5 text-center" onClick={(e) => { e.stopPropagation(); if (row.id && row.issues > 0) navigateTo('quality', { qualityTab: 'issues', department: row.id }); }}>
                        <span
                          className={`text-[10px] font-bold tabular-nums ${row.issues > 0 ? 'cursor-pointer text-[var(--data-bad)] hover:underline' : 'text-[var(--ink-faint)]'}`}
                          title={row.issues > 0 ? 'Открыть замечания этого управления' : 'Замечаний к книге нет'}
                        >
                          {row.issues}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <CardEmpty
              title="Сводка пуста: строк под текущий отбор нет"
              description="Ни одно управление не дало строк за выбранный период и фильтры шапки — складывать нечего."
              action={{ label: 'Открыть Реестр', onClick: () => navigateTo('data') }}
            />
          )}
        </AnalyticsCard>

        {/* Качество заполнения книг по управлениям (термин «доверие» снят — п.88/26б) */}
        <AnalyticsCard title={avgTrust > 0 ? `Качество заполнения: ${avgTrust.toFixed(0)} из 100${lowTrustCount > 0 ? ` — ${lowTrustCount} управл. ниже 60` : ''}` : 'Качество заполнения книг'} icon={TrendingUp} source="hybrid" perimeter="2026 · вся книга">
          {trustData.length > 0 ? (
            <>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-2">
              <KBTooltip metric="analytics_fill_quality" {...kbCardProps(CONTROL_ANALYTICS_KB_ADDITIONS.analytics_fill_quality)}>
                <span className="underline decoration-dotted cursor-help">Как считается этот балл</span>
              </KBTooltip>
              {' '}— разбор по компонентам открывается кликом по столбцу.
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trustData} layout="vertical" margin={{ left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis type="number" domain={[0, 100]} fontSize={11} tickFormatter={(v: number) => `${v}`} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis type="category" dataKey="name" width={60} fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip formatter={(v: number) => [`${v} из 100`, 'Качество заполнения']} contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} cursor={cursorStyle} />
                <Bar dataKey="trust" name="Качество заполнения" radius={[0, 4, 4, 0]} maxBarSize={18} cursor="pointer"
                  onClick={(data: any) => { if (data?.id) navigateTo('quality', { qualityTab: 'trust', department: data.id }); }}
                >
                  {trustData.map((d: any, i: number) => (
                    <Cell key={i} fill={d.trust >= 80 ? (isDark ? '#34d399' : '#10b981') : d.trust >= 60 ? (isDark ? '#fbbf24' : '#f59e0b') : (isDark ? '#f87171' : '#ef4444')} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </>
          ) : (
            <CardEmpty
              title="Балл заполнения не посчитан"
              description="Оценка складывается из полноты колонок книги: у выбранных управлений в снимке нет ни одной прочитанной книги, а балл без книги был бы выдуманным."
            />
          )}
        </AnalyticsCard>
      </div>

      {/* Row 5: Issues by department */}
      <AnalyticsCard title={totalIssues > 0 ? `${totalIssues} замечаний${criticalIssues > 0 ? `, ${criticalIssues} критических` : ''} по управлениям` : 'Замечания по управлениям'} icon={Info} source="hybrid" perimeter="2026 · вся книга">
        {issuesByDept.length > 0 ? (
          <div>
            <ResponsiveContainer width="100%" height={Math.max(160, issuesByDept.length * 32)}>
              <BarChart data={issuesByDept} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis type="number" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis type="category" dataKey="dept" width={65} fontSize={11} tick={{ fill: getAxisColor(isDark) }} tickFormatter={(v: string) => productLabel(String(v))} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} cursor={cursorStyle} labelFormatter={(label: unknown) => productLabel(String(label))} />
                <Bar dataKey="critical" name="Критические" stackId="a" fill={getSeverityColor('critical', isDark)} cursor="pointer"
                  onClick={(data: any) => { if (data?.dept) navigateTo('quality', { qualityTab: 'issues', department: data.dept }); }}
                />
                <Bar dataKey="significant" name="Значительные" stackId="a" fill={getSeverityColor('significant', isDark)} cursor="pointer"
                  onClick={(data: any) => { if (data?.dept) navigateTo('quality', { qualityTab: 'issues', department: data.dept }); }}
                />
                <Bar dataKey="warning" name="Предупреждения" stackId="a" fill={getSeverityColor('warning', isDark)} cursor="pointer"
                  onClick={(data: any) => { if (data?.dept) navigateTo('quality', { qualityTab: 'issues', department: data.dept }); }}
                />
                <Bar dataKey="info" name="Информация" stackId="a" fill={getSeverityColor('info', isDark)} radius={[0, 4, 4, 0]} cursor="pointer"
                  onClick={(data: any) => { if (data?.dept) navigateTo('quality', { qualityTab: 'issues', department: data.dept }); }}
                />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2 text-[10px] text-zinc-400">
              {(['critical', 'significant', 'warning', 'info'] as const).map(key => (
                <span key={key} className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: getSeverityColor(key, isDark) }} />
                  {{ critical: 'Критические', significant: 'Значительные', warning: 'Предупреждения', info: 'Информация' }[key]}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <CardEmpty
            title="Замечаний к книгам нет"
            description="Проверки прошли по всем строкам выбранного периметра и ни одного признака не подняли — это настоящая пустота, а не молчание сервера."
          />
        )}
      </AnalyticsCard>

      {/* Централизация закупок — кросс-ГРБС объединение похожих закупок (ядро:
          core/analytics/centralization; было построено и не выведено на экран — трек F) */}
      <CentralizationCard />

      {/* Аномалии данных по управлениям — datasetAnalyses уже приезжает в
          snapshot /api/dashboard, серверного кода ноль (E4 волна-1, W1-A) */}
      <DatasetAuditCard />

      {/* Признаки странностей в строках (21.08.2026): двенадцать адресных
          признаков детектора и пятнадцать видов аномалий датасета, которые до
          сих пор считались и не выводились никуда (инвентаризация сигналов
          20.08, §4). Секция живёт своим источником /api/anomalies и своими
          компонентами — страница только даёт ей место. */}
      <AnomalySignsSection />
    </div>
  );
}

/** Бейдж композит-грейда: шкала GS-порта, МЕНЬШЕ = лучше (A — чисто, F — худшее). */
const COMPOSITE_GRADE_BADGE: Record<string, string> = {
  A: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  B: 'bg-lime-50 text-lime-600 dark:bg-lime-900/30 dark:text-lime-400',
  C: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  D: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  F: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
};

const EP_RISK_BADGE: Record<string, string> = {
  'НИЗКИЙ': 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  'УМЕРЕННЫЙ': 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400',
  'ПОВЫШЕННЫЙ': 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  'ВЫСОКИЙ': 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  'КРИТИЧЕСКИЙ': 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
};

const BENFORD_TONE_CLS: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
};

/**
 * Развёртка теста Бенфорда для одного управления: ожидаемое против
 * фактического распределение первых цифр графиком (канон п.88/24 — тесты
 * остаются, но подаются образовательно: «погрузиться, понять, найти косяк»).
 */
function BenfordBreakdown({ row, isDark }: { row: DatasetAuditRow; isDark: boolean }) {
  const { contentStyle, itemStyle, labelStyle } = getTooltipStyle(isDark);
  const chartData = useMemo(() => {
    if (!row.benfordObserved || !row.benfordExpected) return [];
    return row.benfordObserved.map((obs, i) => ({
      digit: String(i + 1),
      fact: +(obs * 100).toFixed(1),
      expected: +((row.benfordExpected?.[i] ?? 0) * 100).toFixed(1),
    }));
  }, [row]);

  // Цифра с самым большим перекосом — прямой указатель, где искать косяк.
  const worstDigit = useMemo(() => {
    if (chartData.length === 0) return null;
    return chartData.reduce((max, d) =>
      Math.abs(d.fact - d.expected) > Math.abs(max.fact - max.expected) ? d : max, chartData[0]);
  }, [chartData]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
      <div>
        <p className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
          Первые цифры сумм: ожидаемые доли против фактических
        </p>
        {chartData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis dataKey="digit" fontSize={10} tick={{ fill: getAxisColor(isDark) }} label={{ value: 'Первая цифра суммы', position: 'bottom', offset: -4, style: { fontSize: 9, fill: getAxisColor(isDark) } }} />
                <YAxis fontSize={10} tickFormatter={(v: number) => `${v}%`} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip contentStyle={contentStyle} itemStyle={itemStyle} labelStyle={labelStyle} formatter={(v: number, name: string) => [`${v}%`, name]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="expected" name="Ожидается по закону Бенфорда" fill={isDark ? '#64748b' : '#94a3b8'} radius={[3, 3, 0, 0]} />
                <Bar dataKey="fact" name="Фактически в книге" fill={isDark ? '#60a5fa' : '#3b82f6'} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {worstDigit && (
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
                Сильнее всего выбивается цифра «{worstDigit.digit}»: фактически {worstDigit.fact} % сумм
                против ожидаемых {worstDigit.expected} %. Чтобы найти косяк — открыть строки управления
                и посмотреть суммы, начинающиеся с этой цифры.
              </p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Снимок не сохранил распределение цифр — доступен только итог теста. Обновите данные.
          </p>
        )}
      </div>
      <div className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-relaxed space-y-2">
        <p>
          <strong>Как читать.</strong> В естественных финансовых данных суммы чаще начинаются
          с маленьких цифр: с «1» — около 30 %, с «9» — меньше 5 %. Серые столбики — эта норма,
          синие — ваша книга. Небольшие расхождения законны.
        </p>
        <p>
          <strong>Почему пик у лимитов — не криминал.</strong> Круглые лимиты (100, 500, 600 тыс. руб.)
          назначаются правилами закупок, поэтому их первая цифра даёт законный пик — тест это видит
          как отклонение, а не как манипуляцию.
        </p>
        <p>
          <strong>Что тянет z-оценку.</strong>{' '}
          {row.outlierCount > 0 && row.outlierMean !== null && row.outlierStdDev !== null ? (
            <>
              Типичная сумма этой книги — около {Math.round(row.outlierMean).toLocaleString('ru-RU')} тыс. руб.
              при разбросе {Math.round(row.outlierStdDev).toLocaleString('ru-RU')} тыс. Выбросами считаются
              строки дальше {row.outlierThreshold ?? 3} разбросов от типичной — таких {row.outlierCount}:
              это самые крупные суммы книги, их и стоит проверить глазами первыми.
            </>
          ) : (
            'Выбросов нет: все суммы книги лежат в типичном коридоре, z-оценку не тянет ни одна строка.'
          )}
        </p>
      </div>
    </div>
  );
}

/** Один адрес находки: номер строки книги плюс сама строка словами. */
function FindingAddress({ sheetRow }: { sheetRow: number | null }) {
  return sheetRow === null ? (
    <span
      className="shrink-0 rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ink-faint)]"
      title="Признак посчитан по всей книге целиком — отдельной строки-виновницы у него нет"
    >
      вся книга
    </span>
  ) : (
    <span className="shrink-0 rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--ink)]">
      строка {sheetRow}
    </span>
  );
}

/**
 * Адресный разбор счётчиков аномалий (канон п.119: какая строка, что в ней,
 * почему). Счётчик сам по себе — упрёк; ниже он превращён в перечень строк,
 * по которому можно пойти в книгу и проверить.
 */
function AnomalyFindings({ row, seasonal, splitting, byOrg, onOpenRows }: {
  row: DatasetAuditRow;
  seasonal: SeasonalFinding[];
  splitting: SplittingFinding[];
  /** Режим «с подведомственными»: находки раскладываются по учреждениям. */
  byOrg: boolean;
  onOpenRows: (subject: string) => void;
}) {
  const rule = outlierRule(row);
  const seasonalGroups = byOrg
    ? groupFindingsBySubordinate(seasonal)
    : [{ label: '', items: seasonal }];

  const renderSeasonal = (item: SeasonalFinding) => (
    <li key={item.key}>
      <button
        type="button"
        onClick={() => onOpenRows(item.subject)}
        title={item.subject
          ? 'Открыть Реестр с поиском по предмету этой закупки'
          : 'Предмет в строке не заполнен — Реестр откроется на книге управления'}
        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--surface-raised)]"
      >
        <FindingAddress sheetRow={item.sheetRow} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-[var(--ink)]">
            {item.typeLabel}
            <span className="ml-1.5 font-normal text-[10px] text-[var(--ink-faint)]">{item.urgency}</span>
          </span>
          <span className="block text-[10px] text-[var(--ink-muted)]">{item.why}</span>
          <span className="block truncate text-[10px] text-[var(--ink-faint)]">
            {item.subject || 'предмет в строке не заполнен'}
            {!byOrg && item.subordinate !== ORG_ITSELF_LABEL && <> · {item.subordinate}</>}
          </span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="space-y-3 py-3">
      {/* Сезонные признаки */}
      <section>
        <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ink-strong)]">
          <MapPin size={12} className="text-[var(--ink-faint)]" aria-hidden="true" />
          Сезонные признаки: {row.seasonalCount === 0 ? 'ни одного' : `${row.seasonalCount} ${pluralRu(row.seasonalCount, 'находка', 'находки', 'находок')}`}
        </h4>
        {seasonal.length === 0 ? (
          <p className="text-[11px] text-[var(--ink-muted)]">
            {row.seasonalCount > 0
              ? 'Снимок сохранил только счётчик, без самих находок — адреса строк назвать не по чему. Обновите данные: адреса приходят вместе с разбором книг.'
              : 'Календарных признаков в книге не нашлось: ремонты, топливо и питание законтрактованы в свои сезоны.'}
          </p>
        ) : (
          <div className="space-y-2">
            {seasonalGroups.map((group) => (
              <div key={group.label || 'all'}>
                {group.label && (
                  <p className="px-2 text-[10px] font-semibold uppercase text-[var(--ink-faint)]">{group.label}</p>
                )}
                <ul>{group.items.map(renderSeasonal)}</ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Признаки дробления */}
      <section>
        <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ink-strong)]">
          <Layers size={12} className="text-[var(--ink-faint)]" aria-hidden="true" />
          Однородные закупки ниже порога: {splitting.length === 0 ? 'групп нет' : `${splitting.length} ${pluralRu(splitting.length, 'группа', 'группы', 'групп')}`}
        </h4>
        {splitting.length === 0 ? (
          <p className="text-[11px] text-[var(--ink-muted)]">
            {row.splittingCount > 0
              ? 'Снимок сохранил только счётчик групп, без номеров строк. Обновите данные, чтобы увидеть адреса.'
              : 'Групп из трёх и более однородных закупок у единственного поставщика ниже порога малой закупки в книге нет.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {splitting.map((group) => (
              <li key={group.key}>
                <button
                  type="button"
                  onClick={() => onOpenRows(group.commonSubject)}
                  title="Открыть Реестр с поиском по общему предмету группы"
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--surface-raised)]"
                >
                  <span className="shrink-0 rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--ink)]">
                    строки {group.sheetRows.join(', ')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-medium text-[var(--ink)]">
                      {group.commonSubject || 'общий предмет не распознан'}
                    </span>
                    <span className="block text-[10px] text-[var(--ink-muted)]">
                      {group.subordinate} · {group.count} {pluralRu(group.count, 'закупка', 'закупки', 'закупок')} на {fmtTys(group.totalAmount)} — каждая ниже порога малой закупки (п.4 ч.1 ст.93 44-ФЗ), вместе выше.
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Выбросы: адреса снимок не хранит — вместо них правило с порогом */}
      <section>
        <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ink-strong)]">
          <TrendingUp size={12} className="text-[var(--ink-faint)]" aria-hidden="true" />
          Выбросы сумм: {row.outlierCount === 0 ? 'ни одного' : `${row.outlierCount} ${pluralRu(row.outlierCount, 'строка', 'строки', 'строк')}`}
        </h4>
        <p className="text-[11px] text-[var(--ink-muted)]">{rule.text}</p>
      </section>
    </div>
  );
}

/** Аудит качества данных по ГРБС: Бенфорд, композит, выбросы, сезонность, ЕП-риск. */
function DatasetAuditCard() {
  const { dashboardData, navigateTo, selectedDepartments } = useStore();
  const isDark = useTheme(s => s.theme) === 'dark';
  const orgScope = useOrgScope();
  const [expandedDept, setExpandedDept] = useState<string | null>(null);

  const analyses = dashboardData?.snapshot?.datasetAnalyses;
  const rows = useMemo(() => selectDatasetAudit(analyses), [analyses]);

  // Глобальный фильтр ГРБС: selectedDepartments — кириллический канон,
  // ключи datasetAnalyses — латиница; сравниваем через обе формы.
  const visibleRows = useMemo(() => {
    if (selectedDepartments.size === 0) return rows;
    const keys = bothDeptKeyForms(selectedDepartments);
    return rows.filter(r => keys.has(r.deptId));
  }, [rows, selectedDepartments]);

  const nonconforming = visibleRows.filter(r => r.benfordConformity === 'nonconforming').length;
  const addressableTotal = visibleRows.reduce((s, r) => s + r.seasonalCount + r.splittingCount, 0);

  return (
    <AnalyticsCard
      icon={Microscope}
      source="calculated"
      perimeter="2026 · вся книга"
      title={addressableTotal > 0
        ? `Аномалии данных: ${addressableTotal} ${pluralRu(addressableTotal, 'находка', 'находки', 'находок')} с адресами строк по ${visibleRows.length} ${pluralRu(visibleRows.length, 'управлению', 'управлениям', 'управлениям')}`
        : 'Аномалии данных по управлениям'}
    >
      {visibleRows.length === 0 ? (
        <CardEmpty
          title={rows.length === 0 ? 'Проверки качества данных ещё не считались' : 'По выбранным управлениям проверок в снимке нет'}
          description={rows.length === 0
            ? 'Анализ строится при разборе книг: в текущем снимке его результатов нет, поэтому показывать нечего — это не «аномалий ноль».'
            : 'Снимок содержит проверки других управлений, а по выбранным — нет. Снимите фильтр по управлениям в шапке или обновите данные.'}
          action={{ label: 'Открыть Реестр', onClick: () => navigateTo('data') }}
        />
      ) : (
        <div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-3">
            Аудиторский вердикт по каждому управлению: закон Бенфорда не проходят суммы
            у <strong className="text-zinc-700 dark:text-zinc-200">{nonconforming} из {visibleRows.length}</strong> управлений.
            Композитная оценка 0–100 по шкале аудита: <strong>меньше = лучше</strong> (A — чисто, F — худшее).
            Клик по строке — и каждый счётчик раскрывается перечнем строк-виновниц: какая строка,
            что в ней, почему сработало.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[var(--line-soft)] text-left text-[10px] uppercase text-[var(--ink-faint)]">
                  <th className="py-1.5 pr-3">Управление</th>
                  <th className="py-1.5 pr-3">
                    <KBTooltip metric="analytics_composite" {...kbCardProps(CONTROL_ANALYTICS_KB_ADDITIONS.analytics_composite)}>
                      <span className="underline decoration-dotted cursor-help">Композитная оценка</span>
                    </KBTooltip>
                  </th>
                  <th className="py-1.5 pr-3">
                    <KBTooltip metric="analytics_benford" {...kbCardProps(CONTROL_ANALYTICS_KB_ADDITIONS.analytics_benford)}>
                      <span className="underline decoration-dotted cursor-help">Закон Бенфорда</span>
                    </KBTooltip>
                  </th>
                  <th className="py-1.5 pr-3 text-right">Сезонные признаки</th>
                  <th className="py-1.5 pr-3 text-right" title="Группы однородных закупок у единственного поставщика ниже порога малой закупки">
                    Однородные ниже порога
                  </th>
                  <th className="py-1.5 pr-3 text-right">
                    <KBTooltip metric="analytics_zscore" {...kbCardProps(CONTROL_ANALYTICS_KB_ADDITIONS.analytics_zscore)}>
                      <span className="underline decoration-dotted cursor-help">Выбросы</span>
                    </KBTooltip>
                  </th>
                  <th className="py-1.5">
                    <KBTooltip metric="analytics_ep_risk" {...kbCardProps(CONTROL_ANALYTICS_KB_ADDITIONS.analytics_ep_risk)}>
                      <span className="underline decoration-dotted cursor-help">Риск без торгов</span>
                    </KBTooltip>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(r => {
                  const benford = r.benfordConformity ? BENFORD_LABELS[r.benfordConformity] : null;
                  const isExpanded = expandedDept === r.deptId;
                  const seasonal = selectSeasonalFindings(analyses, r.deptId);
                  const splitting = selectSplittingFindings(analyses, r.deptId);
                  return (
                    <Fragment key={r.deptId}>
                    <tr
                      className="cursor-pointer border-b border-[var(--line-soft)] transition-colors hover:bg-[var(--surface-raised)]"
                      onClick={() => setExpandedDept(isExpanded ? null : r.deptId)}
                      aria-expanded={isExpanded}
                      title={isExpanded ? 'Свернуть разбор' : 'Раскрыть разбор: строки-виновницы каждого счётчика'}
                    >
                      <td className="py-2 pr-3 font-medium text-[var(--ink)]">
                        <span className="inline-flex items-center gap-1">
                          {isExpanded
                            ? <ChevronDown size={12} className="text-[var(--ink-faint)]" aria-hidden="true" />
                            : <ChevronRight size={12} className="text-[var(--ink-faint)]" aria-hidden="true" />}
                          {productLabel(r.deptId)}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        {r.compositeGrade !== null && r.compositeScore !== null ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums ${COMPOSITE_GRADE_BADGE[r.compositeGrade] ?? COMPOSITE_GRADE_BADGE.C}`}>
                            {r.compositeGrade} · {r.compositeScore.toFixed(1)}
                          </span>
                        ) : <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="py-2 pr-3">
                        {benford ? (
                          <span className={`font-medium ${BENFORD_TONE_CLS[benford.tone]}`} title={benford.hint}>
                            {benford.label}
                            <span className="font-normal text-[10px] text-zinc-400 ml-1.5">
                              отклонение {r.benfordMad?.toFixed(4)} · сумм: {r.benfordSampleSize}
                            </span>
                          </span>
                        ) : <span className="text-zinc-400">—</span>}
                      </td>
                      {/* Счётчики адресуемы: каждое число раскрывается перечнем строк (п.119). */}
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.seasonalCount > 0
                          ? <span className="font-medium text-[var(--data-warn)]" title={`Раскрыть ${r.seasonalCount} находок с номерами строк`}>{r.seasonalCount}</span>
                          : <span className="text-[var(--ink-faint)]" title="Календарных признаков в книге не нашлось">0</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.splittingCount > 0
                          ? <span className="font-medium text-[var(--data-warn)]" title={`Раскрыть ${r.splittingCount} групп с номерами строк`}>{r.splittingCount}</span>
                          : <span className="text-[var(--ink-faint)]" title="Групп однородных закупок ниже порога нет">0</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.outlierCount > 0
                          ? <span className="font-medium text-[var(--ink)]" title="Раскрыть правило: с какой суммы строка считается выбросом">{r.outlierCount}</span>
                          : <span className="text-[var(--ink-faint)]" title="Все суммы книги лежат в типичном коридоре">0</span>}
                      </td>
                      <td className="py-2">
                        {r.epRiskLevel ? (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${EP_RISK_BADGE[r.epRiskLevel] ?? EP_RISK_BADGE['НИЗКИЙ']}`}
                            title={r.epSharePct !== null ? `Доля закупок без торгов: ${r.epSharePct.toFixed(1)}%` : undefined}
                          >
                            {r.epRiskLevel}
                          </span>
                        ) : <span className="text-zinc-400">—</span>}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-[var(--line-soft)] bg-[var(--surface-sunken)]">
                        <td colSpan={7} className="px-3">
                          {/* Сначала адреса строк, потом объяснение тестов:
                              читателю нужен ответ «куда идти», а не лекция. */}
                          <AnomalyFindings
                            row={r}
                            seasonal={seasonal}
                            splitting={splitting}
                            byOrg={orgScope.mode === 'withSubs' && toCanonicalDeptId(r.deptId) === orgScope.dept}
                            onOpenRows={(subject) => navigateTo('data', {
                              department: r.deptId,
                              ...(subject ? { search: subject } : {}),
                            })}
                          />
                          <BenfordBreakdown row={r} isDark={isDark} />
                          <div className="pb-3">
                            <button
                              type="button"
                              onClick={() => navigateTo('data', { department: r.deptId })}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-raised)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
                            >
                              Открыть строки управления {productLabel(r.deptId)} →
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AnalyticsCard>
  );
}

function CentralizationCard() {
  const { navigateTo, selectedDepartments } = useStore();
  const [data, setData] = useState<{
    opportunities: CentralizationOpportunityDTO[];
    totalOpportunities: number;
    totalAmount: number;
    totalEpAmount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    api.getAnalyticsCentralization()
      .then((res) => { if (alive) setData(res); })
      .catch((e: unknown) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [reloadKey]);

  /**
   * Изоляция управлений (канон п.127): при выбранном управлении на экране
   * остаются ТОЛЬКО группы с его участием. Партнёры по группе названы —
   * в этом весь смысл совместной закупки, — но чужая группа, к которой
   * выбранное управление отношения не имеет, не показывается вовсе.
   */
  const visible = useMemo(() => {
    const all = data?.opportunities ?? [];
    if (selectedDepartments.size === 0) return all;
    const keys = bothDeptKeyForms(selectedDepartments);
    return all.filter((o) => o.departments.some((d) => keys.has(d) || keys.has(toCanonicalDeptId(d))));
  }, [data, selectedDepartments]);

  const deptScopeLabel = selectedDepartments.size === 0
    ? 'все управления района'
    : [...selectedDepartments].map((d) => productLabel(toCanonicalDeptId(d))).join(', ');

  const visibleAmount = visible.reduce((s, o) => s + o.totalAmount, 0);
  const visibleEpAmount = visible.reduce((s, o) => s + o.epAmount, 0);

  return (
    <AnalyticsCard
      icon={Building2}
      source="calculated"
      perimeter="2026 · весь год"
      title={visible.length > 0
        ? `Кандидаты на совместную закупку: ${visible.length} ${pluralRu(visible.length, 'группа', 'группы', 'групп')} на ${fmtTys(visibleAmount)}`
        : 'Централизация закупок: что можно объединить между управлениями'}
    >
      {error ? (
        <CardEmpty
          tone="problem"
          title="Список возможностей централизации не получен"
          description="Сервер не ответил на запрос групп однородных закупок — это отказ чтения, а не отсутствие кандидатов."
          detail={error}
          action={{ label: 'Запросить ещё раз', onClick: () => setReloadKey((k) => k + 1) }}
        />
      ) : !data ? (
        <div role="status" aria-live="polite" className="py-8 text-center text-xs text-[var(--ink-faint)]">
          Ищем однородные категории по книгам управлений…
        </div>
      ) : visible.length === 0 ? (
        <CardEmpty
          title={selectedDepartments.size > 0
            ? `У выбранного периметра (${deptScopeLabel}) общих категорий с другими управлениями нет`
            : 'Пересечений категорий закупок между управлениями не найдено'}
          description="Группа собирается, когда одинаковую категорию закупают разные управления по отдельности. Пока таких совпадений в книгах нет — объединять нечего."
        />
      ) : (
        <div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-3">
            <KBTooltip metric="analytics_centralization" {...kbCardProps(CONTROL_ANALYTICS_KB_ADDITIONS.analytics_centralization)}>
              <span className="underline decoration-dotted cursor-help">Как строится этот список</span>
            </KBTooltip>
            {': '}одинаковые категории закупают несколько управлений по отдельности — кандидаты
            на совместную закупку (ст. 25 44-ФЗ), включая закупки у единственного поставщика.
            Периметр: <strong className="text-[var(--ink)]">{deptScopeLabel}</strong>. Показано групп:{' '}
            <strong className="text-[var(--ink)]">{visible.length}</strong>
            {selectedDepartments.size > 0 && <> из {data.totalOpportunities} по району</>},
            их объём: <strong className="text-[var(--ink)]">{fmtTys(visibleAmount)}</strong>,
            из них без торгов: <strong className="text-[var(--data-warn)]">{fmtTys(visibleEpAmount)}</strong>.
            Экономию числом продукт не обещает — методики оценки эффекта объединения нет.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <caption className="sr-only">
                Группы однородных закупок разных управлений: категория, участники, объём и приоритет
              </caption>
              <thead>
                <tr className="border-b border-[var(--line-soft)] text-left text-[10px] uppercase text-[var(--ink-faint)]">
                  <th scope="col" className="py-1.5 pr-3">Категория</th>
                  <th scope="col" className="py-1.5 pr-3">Управления</th>
                  <th scope="col" className="py-1.5 pr-3 text-right">Закупок</th>
                  <th scope="col" className="py-1.5 pr-3 text-right">Объём</th>
                  <th scope="col" className="py-1.5 pr-3 text-right">Из них ЕП</th>
                  <th scope="col" className="py-1.5">Приоритет</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o, i) => (
                  <tr key={i} className="border-b border-[var(--line-soft)] align-top">
                    <td className="py-2 pr-3 font-medium text-[var(--ink)]">
                      <button
                        type="button"
                        className="text-left transition hover:text-[var(--accent)]"
                        title="Открыть строки этой категории в Реестре"
                        onClick={() => navigateTo('data', { search: o.category })}
                      >
                        {o.category}
                      </button>
                      <span className="mt-0.5 block max-w-[360px] text-[10px] font-normal text-[var(--ink-faint)]">{o.recommendation}</span>
                    </td>
                    <td className="py-2 pr-3 text-[var(--ink-muted)]">
                      {o.departments.map(d => productLabel(d)).join(', ')}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--ink-muted)]">{o.contractCount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--ink-muted)]">{fmtTys(o.totalAmount)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--data-warn)]">
                      {o.epCount > 0 ? fmtTys(o.epAmount) : 'без торгов нет'}
                    </td>
                    <td className="py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_BADGE[o.priority]?.cls ?? PRIORITY_BADGE.low.cls}`}>
                        {PRIORITY_BADGE[o.priority]?.label ?? o.priority}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AnalyticsCard>
  );
}
