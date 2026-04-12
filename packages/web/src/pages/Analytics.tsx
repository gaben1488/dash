import { useState, useMemo, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { useTheme } from '../components/ThemeProvider';
import { getChartColors, getTooltipStyle, getGridColor, getAxisColor, getSeverityColor, getExecutionHeatBg, getExecutionHeatText, getPositiveColor, getNegativeColor, getChartColor } from '../lib/chart-colors';
import { Info, ChevronDown, ChevronRight, TrendingUp, Building2, Layers, BarChart3, LineChart as LineChartIcon } from 'lucide-react';
import { FilterBreadcrumb } from '../components/FilterBreadcrumb';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, Cell, AreaChart, Area,
  ScatterChart, Scatter, ZAxis, ReferenceLine,
} from 'recharts';
import { api } from '../api';

const PERIOD_LABELS: Record<string, string> = {
  year: 'Год', q1: '1 кв.', q2: '2 кв.', q3: '3 кв.', q4: '4 кв.',
};

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-center">
      <div>
        <Info className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" size={28} />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
      </div>
    </div>
  );
}

/** Card wrapper with optional expand/collapse */
function AnalyticsCard({ title, icon: Icon, children, defaultOpen = true, source }: {
  title: string;
  icon?: typeof TrendingUp;
  children: React.ReactNode;
  defaultOpen?: boolean;
  source?: 'calculated' | 'official' | 'hybrid';
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sourceLabel = source === 'official' ? 'СВОД' : source === 'hybrid' ? 'Комби' : 'Расчёт';
  const sourceColor = source === 'official' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
    : source === 'hybrid' ? 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
    : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400';
  return (
    <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3.5 text-left hover:bg-zinc-50/50 dark:hover:bg-zinc-700/20 transition"
      >
        {Icon && <Icon size={15} className="text-zinc-400" />}
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 flex-1">{title}</h3>
        {source && <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${sourceColor}`}>{sourceLabel}</span>}
        {open ? <ChevronDown size={15} className="text-zinc-400" /> : <ChevronRight size={15} className="text-zinc-400" />}
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

function ForecastCard({ depts, isDark, formatMoney }: { depts: any[]; isDark: boolean; formatMoney: (v: number) => string }) {
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const tooltipStyle = getTooltipStyle(isDark).contentStyle;

  const deptOptions = useMemo(() =>
    depts.map((d: any) => ({ id: d.department?.id ?? '', label: d.department?.nameShort ?? '?' })),
  [depts]);

  const loadForecast = useCallback(async (deptId: string) => {
    if (!deptId) return;
    setLoading(true);
    try {
      const data = await api.getAnalyticsForecast(deptId);
      setForecast(data);
    } catch { setForecast(null); }
    setLoading(false);
  }, []);

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
          className="text-xs bg-zinc-100 dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-600 rounded-lg px-2 py-1.5 text-zinc-700 dark:text-zinc-200"
        >
          {deptOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        {forecast?.trend && (
          <span className={`text-[10px] font-semibold ${TREND_COLORS[forecast.trend] ?? 'text-zinc-400'}`}>
            {TREND_LABELS[forecast.trend] ?? forecast.trend}
          </span>
        )}
        {loading && <span className="text-[10px] text-zinc-400 animate-pulse">Загрузка...</span>}
      </div>
      {chartData.length > 0 && forecast?.scenarios?.length > 0 ? (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
            <XAxis dataKey="name" fontSize={10} tick={{ fill: getAxisColor(isDark) }} />
            <YAxis fontSize={10} tickFormatter={(v: number) => formatMoney(v)} tick={{ fill: getAxisColor(isDark) }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [formatMoney(v), name]} />
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
      ) : (
        !loading && <EmptyState message="Нет данных для прогноза" />
      )}
      {forecast?.scenarios?.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          {forecast.scenarios.map((sc: any, i: number) => (
            <div key={sc.label} className="text-[10px] rounded-lg bg-zinc-50 dark:bg-zinc-700/30 p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: scenarioColors[i % scenarioColors.length] }} />
                <span className="font-semibold text-zinc-600 dark:text-zinc-300">{sc.label}</span>
              </div>
              <div className="text-zinc-500 dark:text-zinc-400">
                Исполнение: <strong>{(sc.yearEndExecution * 100).toFixed(0)}%</strong>
              </div>
              <div className="text-zinc-400">
                Уверенность: {(sc.confidence * 100).toFixed(0)}%
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
  const isDark = useTheme(s => s.theme) === 'dark';
  const chartColors = getChartColors(isDark);
  const { contentStyle: tooltipStyle } = getTooltipStyle(isDark);
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

  // ── Execution bar chart ──
  const barData = fd.barData;

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
        program: ba.program?.planTotal ?? 0,
        current_program: ba.current_program?.planTotal ?? 0,
        current_non_program: ba.current_non_program?.planTotal ?? 0,
        programFact: ba.program?.factTotal ?? 0,
        cpFact: ba.current_program?.factTotal ?? 0,
        cnpFact: ba.current_non_program?.factTotal ?? 0,
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
      <FilterBreadcrumb />
      {/* Subordinate filter info banner */}
      {selectedSubordinates.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-700 dark:text-blue-300">
          <Info size={14} className="shrink-0" />
          <span>Аналитика отображается по полному управлению. Фильтр по подведомственным применяется на вкладках Дашборд и Экономия.</span>
        </div>
      )}
      {/* KPI row */}
      {fd.topKpis.length > 0 && (
        <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
          {fd.topKpis.map((card: any) => (
            <div
              key={card.metricKey}
              className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700/50 p-4 hover:shadow-lg hover:scale-[1.02] hover:border-blue-200 dark:hover:border-blue-600/60 active:scale-[0.98] transition-all duration-200 cursor-pointer"
              onClick={() => navigateTo('quality', {
                qualityTab: card.delta && !card.delta.withinTolerance ? 'recon' : 'trust',
                search: card.label,
              })}
            >
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase">{card.label}</span>
              <div className="text-xl font-bold text-zinc-800 dark:text-white mt-1">
                {card.value?.replace(/\s*(percent|count|rubles|thousand_rubles|million_rubles|days|none)\s*$/i, '').trim() ?? '—'}
              </div>
              {card.delta && !card.delta.withinTolerance && (
                <div className="text-[10px] mt-1 text-amber-500">Расхождение: {card.delta.deltaPercent}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Row 1: Quarterly procurement trend + Execution trend line */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsCard title="Динамика закупок по кварталам: КП vs ЕП" icon={BarChart3} source="calculated">
          {quarterlyTrend.some(q => q.kp > 0 || q.ep > 0) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={quarterlyTrend} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip contentStyle={tooltipStyle} cursor={cursorStyle} />
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
            <EmptyState message="Нет данных о закупках по кварталам" />
          )}
        </AnalyticsCard>

        <AnalyticsCard title="Тренд исполнения по кварталам, %" icon={LineChartIcon} source="calculated">
          {execTrend.length > 0 && deptNames.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={execTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis domain={[0, 'auto']} fontSize={11} tickFormatter={(v: number) => `${v}%`} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => v != null ? [`${Number(v).toFixed(1)}%`] : ['—']} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {deptNames.map((name, i) => (
                  <Line key={name} type="monotone" dataKey={name} stroke={chartColors[i % chartColors.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="Нет данных для тренда" />
          )}
        </AnalyticsCard>
      </div>

      {/* Row 2: Plan vs Fact comparison by department */}
      <AnalyticsCard title={`Сравнение План / Факт по управлениям (${periodLabel})`} icon={Layers} source="calculated">
        {budgetByDept.length > 0 ? (
          <div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={budgetByDept} barCategoryGap="15%">
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis fontSize={10} tickFormatter={(v: number) => formatMoney(v)} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip
                  contentStyle={tooltipStyle} cursor={cursorStyle}
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
                return (
                  <div key={dept.id} className="rounded-lg border border-zinc-100 dark:border-zinc-700/50 overflow-hidden">
                    <button
                      onClick={() => setExpandedDept(isExpanded ? null : (dept.id ?? null))}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition"
                    >
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dept.color }} />
                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex-1">{dept.name}</span>
                      {isExpanded ? <ChevronDown size={12} className="text-zinc-400" /> : <ChevronRight size={12} className="text-zinc-400" />}
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-1">
                        <BudgetProgress label="ФБ (федеральный)" plan={dept.planFB} fact={dept.factFB} color="#3b82f6" formatMoney={formatMoney} />
                        <BudgetProgress label="КБ (краевой)" plan={dept.planKB} fact={dept.factKB} color="#60a5fa" formatMoney={formatMoney} />
                        <BudgetProgress label="МБ (муниципальный)" plan={dept.planMB} fact={dept.factMB} color="#93c5fd" formatMoney={formatMoney} />
                        <div className="border-t border-zinc-100 dark:border-zinc-700/50 pt-2 mt-2">
                          <div className="flex justify-between text-[10px] text-zinc-500">
                            <span>Итого план:</span>
                            <span className="font-semibold">{formatMoney(dept.planTotal)}</span>
                          </div>
                          <div className="flex justify-between text-[10px] text-zinc-500">
                            <span>Итого факт:</span>
                            <span className="font-semibold">{formatMoney(dept.factTotal)}</span>
                          </div>
                        </div>
                        {subs.length > 0 && (
                          <div className="border-t border-zinc-100 dark:border-zinc-700/50 pt-2 mt-2">
                            <div className="text-[9px] font-bold text-zinc-400 uppercase mb-1">Подведомственные</div>
                            {subs.map(s => (
                              <div key={s} className="text-[10px] text-zinc-500 dark:text-zinc-400 py-0.5 flex items-center gap-1">
                                <Building2 size={9} className="text-zinc-300" />
                                <span
                                  className="hover:text-blue-500 cursor-pointer transition"
                                  onClick={() => navigateTo('data', { department: dept.id ?? '', subordinate: s })}
                                >{s}</span>
                              </div>
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
          <EmptyState message="Нет данных по бюджетам" />
        )}
      </AnalyticsCard>

      {/* Row 3: Department shares — 100% stacked horizontal bar */}
      <AnalyticsCard title={`Доли управлений в закупках (${periodLabel})`} icon={TrendingUp}>
        {deptShares.length > 0 ? (
          <div>
            {/* Plan shares */}
            <div className="mb-4">
              <div className="text-[10px] font-semibold text-zinc-400 uppercase mb-1.5">По плану</div>
              <div className="flex h-7 rounded-lg overflow-hidden">
                {deptShares.filter((d: any) => d.planShare > 0).map((d: any, i: number) => (
                  <div
                    key={d.id ?? i}
                    className="relative group cursor-pointer transition-opacity hover:opacity-80"
                    style={{ width: `${d.planShare}%`, backgroundColor: d.color }}
                    onClick={() => d.id && navigateTo('data', { department: d.id })}
                  >
                    {d.planShare > 6 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white/90">
                        {d.name} {d.planShare}%
                      </span>
                    )}
                    <div className="absolute bottom-full left-1/2 -tranzinc-x-1/2 mb-1 hidden group-hover:block z-10 bg-zinc-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                      {d.name}: {formatMoney(d.planTotal)} ({d.planShare}%)
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Fact shares */}
            <div>
              <div className="text-[10px] font-semibold text-zinc-400 uppercase mb-1.5">По факту</div>
              <div className="flex h-7 rounded-lg overflow-hidden">
                {deptShares.filter((d: any) => d.factShare > 0).map((d: any, i: number) => (
                  <div
                    key={d.id ?? i}
                    className="relative group cursor-pointer transition-opacity hover:opacity-80"
                    style={{ width: `${d.factShare}%`, backgroundColor: d.color, opacity: 0.85 }}
                    onClick={() => d.id && navigateTo('data', { department: d.id })}
                  >
                    {d.factShare > 6 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white/90">
                        {d.name} {d.factShare}%
                      </span>
                    )}
                    <div className="absolute bottom-full left-1/2 -tranzinc-x-1/2 mb-1 hidden group-hover:block z-10 bg-zinc-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                      {d.name}: {formatMoney(d.factTotal)} ({d.factShare}%)
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3">
              {deptShares.map((d: any, i: number) => (
                <span key={d.id ?? i} className="flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: d.color }} />
                  {d.name}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState message="Нет данных для отображения" />
        )}
      </AnalyticsCard>

      {/* Treemap: spend hierarchy */}
      {treemapData.length > 0 && (
        <AnalyticsCard title={`Структура расходов (${periodLabel})`} icon={Layers} source="calculated">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {treemapData.map((d: any) => {
              const totalSize = treemapData.reduce((s: number, item: any) => s + item.size, 0);
              const pct = totalSize > 0 ? ((d.size / totalSize) * 100).toFixed(1) : '0';
              return (
                <div
                  key={d.name}
                  className="rounded-xl p-3 relative overflow-hidden cursor-pointer hover:shadow-md hover:scale-[1.02] transition-all duration-200"
                  style={{ backgroundColor: d.fill + '22', borderLeft: `4px solid ${d.fill}` }}
                  onClick={() => { if (d.id) navigateTo('data', { department: d.id }); }}
                >
                  <div className="text-xs font-bold text-zinc-700 dark:text-zinc-200">{d.name}</div>
                  <div className="text-sm font-bold mt-1" style={{ color: d.fill }}>{formatMoney(d.size)}</div>
                  <div className="text-[10px] text-zinc-400">{pct}% от общего</div>
                </div>
              );
            })}
          </div>
        </AnalyticsCard>
      )}

      {/* Activity breakdown by department */}
      {activityData.some(d => d.program > 0 || d.current_program > 0 || d.current_non_program > 0) && (
        <AnalyticsCard title={`Разбивка по видам деятельности (${periodLabel})`} icon={Layers} source="calculated">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={activityData} barCategoryGap="15%">
              <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
              <XAxis dataKey="name" fontSize={10} tick={{ fill: getAxisColor(isDark) }} />
              <YAxis fontSize={10} tickFormatter={(v: number) => formatMoney(v)} tick={{ fill: getAxisColor(isDark) }} />
              <Tooltip contentStyle={tooltipStyle} cursor={cursorStyle} formatter={(v: number, name: string) => [formatMoney(v), name]} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="program" name="Программная" stackId="plan" fill="#8b5cf6" radius={[0, 0, 0, 0]} cursor="pointer"
                onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id, activity: 'program' }); }}
              />
              <Bar dataKey="current_program" name="Текущая (программы)" stackId="plan" fill="#3b82f6" radius={[0, 0, 0, 0]} cursor="pointer"
                onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id, activity: 'current_program' }); }}
              />
              <Bar dataKey="current_non_program" name="Текущая (вне программ)" stackId="plan" fill="#06b6d4" radius={[4, 4, 0, 0]} cursor="pointer"
                onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id, activity: 'current_non_program' }); }}
              />
              <Bar dataKey="programFact" name="Программная (факт)" stackId="fact" fill="#a78bfa" radius={[0, 0, 0, 0]} cursor="pointer"
                onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id, activity: 'program' }); }}
              />
              <Bar dataKey="cpFact" name="Текущая прогр. (факт)" stackId="fact" fill="#60a5fa" radius={[0, 0, 0, 0]} cursor="pointer"
                onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id, activity: 'current_program' }); }}
              />
              <Bar dataKey="cnpFact" name="Текущая вне прогр. (факт)" stackId="fact" fill="#22d3ee" radius={[4, 4, 0, 0]} cursor="pointer"
                onClick={(data: any) => { if (data?.id) navigateTo('data', { department: data.id, activity: 'current_non_program' }); }}
              />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsCard>
      )}

      {/* Execution velocity — cumulative fact as % of year plan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {velocityData.length > 0 && (
          <AnalyticsCard title="Скорость исполнения (кумулятивно, % годового плана)" icon={TrendingUp} source="calculated">
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
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => v != null ? [`${Number(v).toFixed(1)}%`] : ['—']} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {velocityData.map((d, i) => (
                  <Line key={d.name} type="monotone" dataKey={d.name} stroke={chartColors[i % chartColors.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </AnalyticsCard>
        )}

        {/* Subordinate rankings */}
        {topSubordinates.length > 0 && (
          <AnalyticsCard title="Рейтинг подведомственных (топ-15 по плану)" icon={Building2} source="calculated">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase">
                    <th className="py-2 text-left">#</th>
                    <th className="py-2 text-left">Организация</th>
                    <th className="py-2 text-left">Управление</th>
                    <th className="py-2 text-right w-20">План</th>
                    <th className="py-2 text-right w-20">Факт</th>
                    <th className="py-2 text-center w-14">Исп.</th>
                  </tr>
                </thead>
                <tbody>
                  {topSubordinates.map((sub, idx) => (
                    <tr
                      key={`${sub.name}-${idx}`}
                      className="border-t border-zinc-100 dark:border-zinc-700/50 cursor-pointer hover:bg-blue-50/40 dark:hover:bg-zinc-700/30 transition"
                      onClick={() => {
                        const dept = filteredDepts.find((d: any) => (d.department?.nameShort ?? '?') === sub.dept);
                        if (dept?.department?.id) navigateTo('data', { department: dept.department.id, subordinate: sub.name });
                      }}
                    >
                      <td className="py-1.5 text-[10px] text-zinc-400">{idx + 1}</td>
                      <td className="py-1.5 text-xs text-zinc-700 dark:text-zinc-200 max-w-[180px] truncate" title={sub.name}>{sub.name}</td>
                      <td className="py-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">{sub.dept}</td>
                      <td className="py-1.5 text-right text-[10px] text-zinc-600 dark:text-zinc-300 tabular-nums">{formatMoney(sub.planTotal)}</td>
                      <td className="py-1.5 text-right text-[10px] text-zinc-600 dark:text-zinc-300 tabular-nums">{formatMoney(sub.factTotal)}</td>
                      <td className="py-1.5 text-center">
                        <span
                          className="inline-block w-12 py-0.5 rounded text-[10px] font-bold"
                          style={{ backgroundColor: getExecutionHeatBg(sub.executionPct, isDark), color: getExecutionHeatText(sub.executionPct, isDark) }}
                        >
                          {sub.executionPct > 0 ? `${sub.executionPct.toFixed(0)}%` : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AnalyticsCard>
        )}
      </div>

      {/* Forecast */}
      {filteredDepts.length > 0 && (
        <AnalyticsCard title="Прогноз исполнения" icon={TrendingUp} source="calculated">
          <ForecastCard depts={filteredDepts} isDark={isDark} formatMoney={formatMoney} />
        </AnalyticsCard>
      )}

      {/* Economy Scatter: Limit vs Fact */}
      <AnalyticsCard title="Экономия: Лимит vs Факт по закупкам" icon={TrendingUp} source="calculated">
        {scatterLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-zinc-500 animate-pulse">Загрузка...</div>
        ) : scatterData.length === 0 ? (
          <EmptyState message="Нет данных по закупкам для scatter plot" />
        ) : (
          <>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-3">
              Каждая точка — одна закупка. Диагональ = нулевая экономия. Цвет по % снижения (44-ФЗ ст.37).
              <span className="ml-2 font-medium text-zinc-500">{scatterData.length} закупок</span>
            </p>
            <div style={{ width: '100%', height: 380 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                  <XAxis
                    type="number" dataKey="planTotal" name="Лимит программы"
                    tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)} млн` : v >= 1e3 ? `${(v / 1e3).toFixed(0)} тыс` : String(v)}
                    label={{ value: 'Лимит программы (тыс. руб.)', position: 'bottom', offset: 20, style: { fontSize: 11, fill: getAxisColor(isDark) } }}
                    className="text-xs"
                  />
                  <YAxis
                    type="number" dataKey="factTotal" name="Цена контракта"
                    tickFormatter={(v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)} млн` : v >= 1e3 ? `${(v / 1e3).toFixed(0)} тыс` : String(v)}
                    label={{ value: 'Цена контракта (руб.)', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: 11, fill: getAxisColor(isDark) } }}
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
                        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 p-3 max-w-xs text-xs">
                          <div className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">{d.subject}</div>
                          <div className="text-zinc-500">{d.department} · {d.procurementType}</div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                            <span className="text-zinc-400">Лимит:</span>
                            <span className="text-right font-medium">{d.planTotal?.toLocaleString('ru-RU')} ₽</span>
                            <span className="text-zinc-400">Цена:</span>
                            <span className="text-right font-medium">{d.factTotal?.toLocaleString('ru-RU')} ₽</span>
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
                  <Scatter name="Предрешённость (<5%)" data={scatterData.filter((d: any) => d.economyPercent >= 0 && d.economyPercent < 5)} fill={getChartColor(2, isDark)} fillOpacity={0.7} onClick={(d: any) => d && navigateTo('data', { department: d.department })} cursor="pointer" />
                  <Scatter name="Антидемпинг (>25%)" data={scatterData.filter((d: any) => d.economyPercent > 25)} fill={getNegativeColor(isDark)} fillOpacity={0.7} onClick={(d: any) => d && navigateTo('data', { department: d.department })} cursor="pointer" />
                  <Scatter name="Превышение (<0%)" data={scatterData.filter((d: any) => d.economyPercent < 0)} fill={getChartColor(4, isDark)} fillOpacity={0.7} onClick={(d: any) => d && navigateTo('data', { department: d.department })} cursor="pointer" />
                  <Scatter name="Высокая (15-25%)" data={scatterData.filter((d: any) => d.economyPercent > 15 && d.economyPercent <= 25)} fill={getChartColor(0, isDark)} fillOpacity={0.7} onClick={(d: any) => d && navigateTo('data', { department: d.department })} cursor="pointer" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 mt-3 text-[10px] flex-wrap">
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"><span className="w-3 h-3 rounded-full bg-emerald-500" /> 5-15% норма</span>
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"><span className="w-3 h-3 rounded-full bg-blue-500" /> 15-25% высокая</span>
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"><span className="w-3 h-3 rounded-full bg-amber-500" /> &lt;5% предрешённость</span>
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"><span className="w-3 h-3 rounded-full bg-red-500" /> &gt;25% антидемпинг</span>
              <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"><span className="w-3 h-3 rounded-full bg-violet-500" /> &lt;0% превышение</span>
            </div>
          </>
        )}
      </AnalyticsCard>

      {/* Row 4: Heatmap + Trust */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Heatmap */}
        <AnalyticsCard title="Сводка по управлениям" icon={Building2} defaultOpen={true} source="calculated">
          {heatmapData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase">
                    <th className="py-2 text-left">Упр.</th>
                    <th className="py-2 text-center w-14">Исп.</th>
                    <th className="py-2 text-right w-20">План</th>
                    <th className="py-2 text-right w-20">Факт</th>
                    <th className="py-2 text-center w-10">КП</th>
                    <th className="py-2 text-center w-10">ЕП</th>
                    <th className="py-2 text-center w-10">!</th>
                  </tr>
                </thead>
                <tbody>
                  {heatmapData.map((row: any) => (
                    <tr
                      key={row.dept}
                      className="border-t border-zinc-100 dark:border-zinc-700/50 cursor-pointer hover:bg-blue-50/30 dark:hover:bg-zinc-700/20 transition"
                      onClick={() => row.id && navigateTo('data', { department: row.id })}
                    >
                      <td className="py-1.5 font-medium text-zinc-700 dark:text-zinc-200 text-xs">{row.dept}</td>
                      <td className="py-1.5 text-center">
                        <span
                          className="inline-block w-12 py-0.5 rounded text-[10px] font-bold"
                          style={{ backgroundColor: getExecutionHeatBg(row.execPct, isDark), color: getExecutionHeatText(row.execPct, isDark) }}
                        >
                          {row.execPct > 0 ? `${typeof row.execPct === 'number' ? row.execPct.toFixed(0) : row.execPct}%` : '\u2014'}
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-[10px] text-zinc-600 dark:text-zinc-300 tabular-nums">
                        {row.planTotal != null ? formatMoney(row.planTotal) : '\u2014'}
                      </td>
                      <td className="py-1.5 text-right text-[10px] text-zinc-600 dark:text-zinc-300 tabular-nums">
                        {row.factTotal != null ? formatMoney(row.factTotal) : '\u2014'}
                      </td>
                      <td className="py-1.5 text-center text-[10px] text-blue-600 dark:text-blue-400 font-medium">{row.kpCount || '—'}</td>
                      <td className="py-1.5 text-center text-[10px] text-amber-600 dark:text-amber-400 font-medium">{row.epCount || '—'}</td>
                      <td className="py-1.5 text-center" onClick={(e) => { e.stopPropagation(); if (row.id && row.issues > 0) navigateTo('quality', { qualityTab: 'issues', department: row.id }); }}>
                        <span className={`text-[10px] font-bold ${row.issues > 0 ? 'text-red-500 cursor-pointer hover:underline' : 'text-zinc-300 dark:text-zinc-600'}`}>{row.issues}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="Нет данных" />
          )}
        </AnalyticsCard>

        {/* Trust by department */}
        <AnalyticsCard title="Индекс доверия" icon={TrendingUp} source="hybrid">
          {trustData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trustData} layout="vertical" margin={{ left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis type="number" domain={[0, 100]} fontSize={11} tickFormatter={(v: number) => `${v}`} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis type="category" dataKey="name" width={60} fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip formatter={(v: number) => [`${v}`, 'Trust Score']} contentStyle={tooltipStyle} cursor={cursorStyle} />
                <Bar dataKey="trust" name="Доверие" radius={[0, 4, 4, 0]} maxBarSize={18} cursor="pointer"
                  onClick={(data: any) => { if (data?.id) navigateTo('quality', { qualityTab: 'trust', department: data.id }); }}
                >
                  {trustData.map((d: any, i: number) => (
                    <Cell key={i} fill={d.trust >= 80 ? (isDark ? '#34d399' : '#10b981') : d.trust >= 60 ? (isDark ? '#fbbf24' : '#f59e0b') : (isDark ? '#f87171' : '#ef4444')} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="Нет данных" />
          )}
        </AnalyticsCard>
      </div>

      {/* Row 5: Issues by department */}
      <AnalyticsCard title="Замечания по управлениям" icon={Info} source="hybrid">
        {issuesByDept.length > 0 ? (
          <div>
            <ResponsiveContainer width="100%" height={Math.max(160, issuesByDept.length * 32)}>
              <BarChart data={issuesByDept} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
                <XAxis type="number" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <YAxis type="category" dataKey="dept" width={65} fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
                <Tooltip contentStyle={tooltipStyle} cursor={cursorStyle} />
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
          <EmptyState message="Замечания не обнаружены" />
        )}
      </AnalyticsCard>
    </div>
  );
}
