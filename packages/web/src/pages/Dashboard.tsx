import { useState, useMemo } from 'react';
import { useStore, type Page, type PeriodScope } from '../store';
import { useFilteredData } from '../hooks/useFilteredData';
import { useMultiDimMetrics } from '../hooks/useMultiDimMetrics';
import { HeroKPICard, DeptBreakdown, BudgetBreakdown, TrustComponents } from '../components/HeroKPICard';
import { SkeletonKPIRow, SkeletonChart } from '../components/Skeleton';
import { CriticalBannerV2 } from '../components/CriticalBannerV2';
import { RatingTableV2, type DeptRowV2 } from '../components/RatingTableV2';
import { DrillPieChart } from '../components/charts/DrillPieChart';
import { KBTooltip } from '../components/ui/kb-tooltip';
import { AlertTriangle, Info } from 'lucide-react';
import {
  Cell, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Line, CartesianGrid,
} from 'recharts';
import { useTheme } from '../components/ThemeProvider';
import { getTooltipStyle, getAxisColor, getGridColor, getExecutionBarColor } from '../lib/chart-colors';
import { getThresholdColor } from '../lib/metrics-registry';

// ────────────────────────────────────────────────────────────────
// Dashboard — Phase 4 Redesign
//
// Changes from v1:
//   ✓ Hero KPI: 5 cards (not 6), @number-flow, deltas, sparklines, KB tooltips
//   ✓ RatingTableV2: +ФБ%, +sparkline, +adaptive подведы, KB tooltips
//   ✓ CriticalBannerV2: expandable with dept-grouped issues
//   ✓ Trust: binary indicator (not gauge %)
//   ✗ DeptCards grid: REMOVED (duplicated RatingTable — confirmed by 3 personas)
//   ✗ CalendarHeatmap: REMOVED → moved to Analytics
//   ✗ TrustGauge: REMOVED → replaced by binary KPI
//
// Personas:
//   ★★★ Наталья (рейтинг, ФБ), ★★★ Виктор (дельты, контроль),
//   ★★ Алексей (подведы), ★ Сергей (красный/зелёный)
//
// Principle: Click = Expand inline. "Подробнее →" for navigation.
// ────────────────────────────────────────────────────────────────

function StatusLine({ data }: { data: any }) {
  const ts = data?.lastRefreshed
    ? new Date(data.lastRefreshed).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
  const snapshotId = (data?.snapshot?.id ?? data?.snapshotId ?? '—').toString().slice(0, 8);
  const cellsRead = (data?.snapshot?.metadata?.cellsRead ?? data?.rowCount)?.toLocaleString('ru-RU') ?? '—';

  return (
    <div className="flex items-center gap-3 text-xs bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl px-4 py-2.5 border border-zinc-200/60 dark:border-zinc-800/60">
      {/* Live pulse indicator */}
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-zinc-500 dark:text-zinc-400">
        Обновлено: <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">{ts}</strong>
      </span>
      <span className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700" />
      <span className="text-zinc-500 dark:text-zinc-400">
        <span className="font-mono text-zinc-400 dark:text-zinc-500 text-[10px]">#{snapshotId}</span>
      </span>
      <span className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700" />
      <span className="text-zinc-500 dark:text-zinc-400">
        <strong className="text-zinc-600 dark:text-zinc-300 font-semibold tabular-nums">{cellsRead}</strong> ячеек
      </span>
    </div>
  );
}

export function Dashboard() {
  const { dashboardData, loading, error, navigateTo, formatMoney, procurementFilter, toggleDepartment, selectedDepartments } = useStore();
  const fd = useFilteredData();
  const mdm = useMultiDimMetrics();
  const isDark = useTheme(s => s.theme) === 'dark';
  const { contentStyle: tooltipStyle } = getTooltipStyle(isDark);
  const cursorStyle = { fill: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(0,0,0,0.06)', stroke: 'none' };

  const [expandedKpi, setExpandedKpi] = useState<string | null>(null);

  const { depts, barData, issues, periodKey } = fd;

  const planFactData = useMemo(() => {
    const sbp = fd.summaryByPeriod;
    return (['q1', 'q2', 'q3', 'q4'] as const).map(qk => {
      const q = sbp[qk];
      const kpPlan = q?.kpPlan ?? 0;
      const epPlan = q?.epPlan ?? 0;
      const kpFact = q?.kpFact ?? 0;
      const epFact = q?.epFact ?? 0;
      return {
        name: { q1: '1 кв.', q2: '2 кв.', q3: '3 кв.', q4: '4 кв.' }[qk],
        plan: kpPlan + epPlan,
        fact: kpFact + epFact,
        kpPlan, epPlan, kpFact, epFact,
      };
    });
  }, [fd.summaryByPeriod]);

  const showStacked = procurementFilter === 'all';

  // ── Build Hero KPI data ──
  const heroKpis = useMemo(() => buildHeroKPIs(fd, formatMoney), [fd, formatMoney]);

  // ── Build RatingTable data ──
  const ratingDepts = useMemo<DeptRowV2[]>(() => {
    return mdm.departments.map((dm) => {
      const d = dm.raw;
      // Quarterly sparkline from mdm
      const spark = dm.quarters.map(q => q.execPct);

      // ФБ execution %
      let fbExecPct: number | null = null;
      const q = d.quarters?.[periodKey];
      if (q) {
        const planFB = q.planFB ?? 0;
        const factFB = q.factFB ?? 0;
        fbExecPct = planFB > 0 ? +((factFB / planFB) * 100).toFixed(1) : null;
      }

      // Subordinates: _org_itself at top with dept name, then real subs
      const subs: Array<{ name: string; execAmountPct: number | null; execCountPct: number | null; issueCount: number }> = [];

      // Org-itself first (named as dept, not "_org_itself")
      if (dm.orgSelf) {
        subs.push({
          name: `${dm.dept} (само)`,
          execAmountPct: dm.orgSelf.metrics.executionPct || null,
          execCountPct: dm.orgSelf.metrics.execCountPct || null,
          issueCount: 0,
        });
      }

      // Real subordinates
      for (const s of dm.realSubs) {
        subs.push({
          name: s.displayName,
          execAmountPct: s.metrics.executionPct || null,
          execCountPct: s.metrics.execCountPct || null,
          issueCount: 0,
        });
      }

      return {
        id: dm.deptId,
        name: dm.deptName,
        nameShort: dm.dept,
        execAmountPct: dm.total.executionPct || null,
        execCountPct: dm.total.execCountPct || null,
        fbExecPct,
        trustScore: d.trustScore ?? null,
        issueCount: d.issueCount ?? 0,
        criticalIssueCount: d.criticalIssueCount ?? 0,
        sparkData: spark.some(v => v > 0) ? spark : undefined,
        deltaWeek: dm.delta ? +dm.delta.execPctChange.toFixed(1) : null,
        subordinates: subs.length > 0 ? subs : undefined,
      };
    });
  }, [mdm.departments, periodKey]);


  if (loading && !dashboardData) {
    return (
      <div className="space-y-4">
        <SkeletonKPIRow count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonChart />
          <SkeletonChart />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-red-200/60 dark:border-red-500/30 max-w-lg mx-auto mt-12 text-center p-8">
        <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="text-red-500" size={28} />
        </div>
        <p className="text-red-600 dark:text-red-400 font-bold mb-2 text-lg">Ошибка загрузки</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 leading-relaxed">{error}</p>
        <button
          onClick={() => useStore.getState().fetchDashboard(true)}
          className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-blue-500/25 transition-all active:scale-95"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (!dashboardData) return null;

  return (
    <div className="space-y-5">
      {/* 1. StatusLine + FilterBreadcrumb row */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatusLine data={dashboardData} />
      </div>

      {/* 3. CriticalBanner — expandable with dept grouping */}
      <CriticalBannerV2
        criticalCount={fd.criticalIssues.length}
        warningCount={fd.warningIssues.length}
        issues={fd.criticalIssues.concat(fd.warningIssues).slice(0, 30).map((iss: any) => ({
          id: iss.id,
          signal: iss.signal,
          severity: iss.severity,
          description: iss.description ?? iss.message,
          department: iss.department ?? iss.deptId,
        }))}
        onNavigate={() => navigateTo('quality', { qualityTab: 'issues' })}
      />

      {/* Year mismatch banner */}
      {fd.yearMismatch && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-sm text-amber-700 dark:text-amber-400">
          <Info size={16} />
          <span>Данные загружены за <strong>{fd.dataYear}</strong> год. Данные за <strong>{fd.year}</strong> год пока недоступны.</span>
        </div>
      )}

      {/* 4. Hero KPI Row — 5 cards max, @number-flow, deltas, sparklines, KB tooltips */}
      <section>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {heroKpis.map(kpi => (
            <HeroKPICard
              key={kpi.metricKey}
              {...kpi}
              expanded={expandedKpi === kpi.metricKey}
              onToggleExpand={() => setExpandedKpi(expandedKpi === kpi.metricKey ? null : kpi.metricKey)}
              expandContent={() => (
                <KPIExpandPanel
                  kpi={kpi}
                  depts={depts}
                  periodKey={periodKey}
                  trust={fd.trust}
                  formatMoney={formatMoney}
                  toggleDepartment={toggleDepartment}
                  navigateTo={navigateTo}
                />
              )}
            />
          ))}
        </div>
      </section>

      {/* 5. RatingTable — MAIN ELEMENT */}
      {depts.length > 0 && (
        <section className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200/60 dark:border-zinc-800/60 p-5 hover:shadow-lg transition-shadow duration-300">
          <div className="flex items-center justify-between mb-3">
            <KBTooltip metric="dept_rank">
              <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Рейтинг управлений
              </h3>
            </KBTooltip>
            <span className="text-[10px] text-zinc-400">{depts.length} ГРБС</span>
          </div>
          {/* Assertion header — anti-slop: insight, not description */}
          {(() => {
            const lagging = ratingDepts.filter((d) => (d.execCountPct ?? 0) < 50);
            if (lagging.length > 0) {
              return (
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-2">
                  {lagging.length} {lagging.length === 1 ? 'управление отстаёт' : 'управлений отстают'} от графика (&lt;50%)
                </p>
              );
            }
            return (
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-2">
                Все управления в графике
              </p>
            );
          })()}
          <RatingTableV2
            departments={ratingDepts}
            showSubordinates={selectedDepartments.size > 0}
            onDeptClick={(deptId) => {
              // Map slug id to Russian nameShort for store consistency
              const dept = depts.find((d: any) => d.department?.id === deptId);
              toggleDepartment(dept?.department?.nameShort ?? deptId);
            }}
            onDeptDetail={(deptId) => navigateTo('data', { department: deptId })}
          />
        </section>
      )}

      {/* 6. Plan/Fact Combo Chart */}
      {planFactData.some(d => d.plan > 0 || d.fact > 0) && (
        <section className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200/60 dark:border-zinc-800/60 p-5 hover:shadow-lg transition-shadow duration-300">
          <KBTooltip metric="plan_fact_quarterly">
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4">
              План / Факт по кварталам
              {showStacked && <span className="text-[10px] text-zinc-400 dark:text-zinc-500 ml-2 font-normal normal-case">(КП + ЕП)</span>}
            </h3>
          </KBTooltip>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={planFactData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke={getGridColor(isDark)} />
              <XAxis dataKey="name" fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
              <YAxis fontSize={10} tickFormatter={(v: number) => formatMoney(v)} tick={{ fill: getAxisColor(isDark) }} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={cursorStyle}
                content={showStacked ? ({ payload, label }) => {
                  if (!payload?.length) return null;
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div style={tooltipStyle} className="rounded-lg p-2.5 shadow-lg text-xs">
                      <p className="font-semibold mb-1">{label}</p>
                      <p>КП план: <strong>{formatMoney(d.kpPlan)}</strong></p>
                      <p>ЕП план: <strong>{formatMoney(d.epPlan)}</strong></p>
                      <p className="border-t border-zinc-200 dark:border-zinc-600 mt-1 pt-1">Итого план: <strong>{formatMoney(d.plan)}</strong></p>
                      <p className="mt-1">Факт: <strong>{formatMoney(d.fact)}</strong></p>
                    </div>
                  );
                } : undefined}
                formatter={showStacked ? undefined : (v: number, name: string) => [formatMoney(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {showStacked ? (
                <>
                  <Bar dataKey="kpPlan" name="КП план" stackId="plan" fill={isDark ? '#60a5fa' : '#3b82f6'} barSize={32} radius={[0, 0, 0, 0]} cursor="pointer"
                    onClick={(data: any) => { const qMap: Record<string, PeriodScope> = { '1 кв.': 'q1', '2 кв.': 'q2', '3 кв.': 'q3', '4 кв.': 'q4' }; const q = qMap[data?.name]; if (q) navigateTo('analytics', { period: q }); }}
                  />
                  <Bar dataKey="epPlan" name="ЕП план" stackId="plan" fill={isDark ? '#818cf8' : '#6366f1'} barSize={32} radius={[4, 4, 0, 0]} cursor="pointer"
                    onClick={(data: any) => { const qMap: Record<string, PeriodScope> = { '1 кв.': 'q1', '2 кв.': 'q2', '3 кв.': 'q3', '4 кв.': 'q4' }; const q = qMap[data?.name]; if (q) navigateTo('analytics', { period: q, procurement: 'single' }); }}
                  />
                </>
              ) : (
                <Bar
                  dataKey="plan" name="План"
                  fill={isDark ? '#60a5fa' : '#3b82f6'}
                  radius={[4, 4, 0, 0]} barSize={32} cursor="pointer"
                  onClick={(data: any) => {
                    const qMap: Record<string, PeriodScope> = { '1 кв.': 'q1', '2 кв.': 'q2', '3 кв.': 'q3', '4 кв.': 'q4' };
                    const q = qMap[data?.name];
                    if (q) navigateTo('analytics', { period: q });
                  }}
                />
              )}
              <Line type="monotone" dataKey="fact" name="Факт" stroke={isDark ? '#34d399' : '#10b981'} strokeWidth={2.5} dot={{ r: 4, fill: isDark ? '#34d399' : '#10b981' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* 7. Charts row — Execution Bar + Pie (compact, not hero) */}
      {/* Charts inherit responsive grid: 2/3 bar + 1/3 pie */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar: execution by department — takes 2/3 */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200/60 dark:border-zinc-800/60 p-5 hover:shadow-lg transition-shadow duration-300">
          <KBTooltip metric="execution_by_dept">
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4">
              Исполнение по управлениям
            </h3>
          </KBTooltip>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={barData} layout="vertical" margin={{ left: 0 }}>
              <XAxis type="number" domain={[0, (max: number) => Math.max(100, max + 5)]} fontSize={11} tickFormatter={(v) => `${v}%`} tick={{ fill: getAxisColor(isDark) }} />
              <YAxis type="category" dataKey="name" width={65} fontSize={11} tick={{ fill: getAxisColor(isDark) }} />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.[0]?.payload) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-semibold text-zinc-700 dark:text-zinc-200 mb-1">{d.name}</p>
                      <p>По сумме: <strong>{d.pct.toFixed(1)}%</strong>{d.pct > 100 && <span className="ml-1 text-purple-500">Факт {'>'} План</span>}</p>
                      {d.execCountPct != null && <p>По кол-ву: <strong>{d.execCountPct.toFixed(1)}%</strong></p>}
                      <p>План: {formatMoney(d.planTotal)}</p>
                      <p>Факт: {formatMoney(d.factTotal)}</p>
                      <p>КП: {d.kpCount} | ЕП: {d.epCount}</p>
                    </div>
                  );
                }}
                cursor={cursorStyle}
              />
              <Bar dataKey="pct" name="По сумме" radius={[0, 4, 4, 0]} maxBarSize={18}
                onClick={(data: any) => { if (data?.nameShort) toggleDepartment(data.nameShort); else if (data?.name) toggleDepartment(data.name); }}
                className="cursor-pointer"
              >
                {barData.map((d: any, i: number) => (
                  <Cell key={i} fill={getExecutionBarColor(d.pct, isDark)} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="execCountPct" name="По кол-ву"
                stroke={isDark ? '#f59e0b' : '#d97706'} strokeWidth={2}
                dot={{ r: 3, fill: isDark ? '#f59e0b' : '#d97706' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex gap-3 text-[10px] text-zinc-400 dark:text-zinc-500 mt-2 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> {'<'}50%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> 50-80%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {'>'}80%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" /> {'>'}100%</span>
            <span className="flex items-center gap-1 ml-2"><span className="w-3 h-0.5 bg-amber-500 rounded" /> по кол-ву</span>
          </div>
        </div>

        {/* DrillPieChart — interactive hierarchy drill (УО → подведы) */}
        <DrillPieChart
          mdm={mdm}
          procurementFilter={procurementFilter}
          formatMoney={formatMoney}
          onDeptToggle={toggleDepartment}
          onNavigate={navigateTo}
        />
      </section>

      {/* 8. Blind Spots — signal cards */}
      <BlindSpotsWidget
        issues={issues ?? []}
        signalCounts={fd.signalCounts}
        onNavigate={(category, search) => navigateTo('quality', { category, search })}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Hero KPI builder
// ────────────────────────────────────────────────────────────────

function buildHeroKPIs(fd: ReturnType<typeof useFilteredData>, formatMoney: (v: number) => string) {
  const kpis: Array<Omit<import('../components/HeroKPICard').HeroKPICardProps, 'expanded' | 'onToggleExpand' | 'expandContent'>> = [];

  // 1. ИСПОЛНЕНИЕ — dual metric: count (primary) + amount (secondary)
  //    Merged per user request: "обьединить в одну метрику которая будет показывать все"
  {
    const countPct = fd.overallExecCountPct ?? 0;
    const amountPct = fd.totalPlan > 0 ? +((fd.totalFact / fd.totalPlan) * 100).toFixed(1) : 0;

    // Quarterly sparklines for both dimensions
    const countSpark = (['q1', 'q2', 'q3', 'q4'] as const).map(qk => {
      let pc = 0, fc = 0;
      for (const d of fd.depts) {
        const q = d.quarters?.[qk];
        if (q) { pc += q.planCount ?? 0; fc += q.factCount ?? 0; }
      }
      return pc > 0 ? +((fc / pc) * 100).toFixed(1) : 0;
    });
    const amountSpark = (['q1', 'q2', 'q3', 'q4'] as const).map(qk => {
      let pt = 0, ft = 0;
      for (const d of fd.depts) {
        const q = d.quarters?.[qk];
        if (q) { pt += q.planTotal ?? 0; ft += q.factTotal ?? 0; }
      }
      return pt > 0 ? +((ft / pt) * 100).toFixed(1) : 0;
    });

    // Trend from sparkline
    const countTrend = countSpark.length >= 2
      ? countSpark[countSpark.length - 1] > countSpark[countSpark.length - 2] ? 'up' as const
        : countSpark[countSpark.length - 1] < countSpark[countSpark.length - 2] ? 'down' as const
        : 'stable' as const
      : undefined;
    const amountTrend = amountSpark.length >= 2
      ? amountSpark[amountSpark.length - 1] > amountSpark[amountSpark.length - 2] ? 'up' as const
        : amountSpark[amountSpark.length - 1] < amountSpark[amountSpark.length - 2] ? 'down' as const
        : 'stable' as const
      : undefined;

    // Status = worst of the two
    const worstPct = Math.min(countPct, amountPct);
    const execStatus = worstPct >= 80 ? 'normal' as const : worstPct >= 50 ? 'warning' as const : 'critical' as const;

    kpis.push({
      metricKey: 'exec_count_pct',
      label: 'Исполнение',
      value: countPct,
      unit: '%',
      status: execStatus,
      trend: countTrend,
      sparkData: countSpark.some(v => v > 0) ? countSpark : undefined,
      // Secondary: amount-based execution
      secondaryValue: amountPct,
      secondaryLabel: 'по сумме',
      secondaryUnit: '%',
      secondaryMetricKey: 'execution_pct',
      secondaryTrend: amountTrend,
      secondarySparkData: amountSpark.some(v => v > 0) ? amountSpark : undefined,
    });
  }

  // 2. critical_issues
  const critCount = fd.criticalIssues.length;
  kpis.push({
    metricKey: 'critical_issues',
    label: 'Критические',
    value: critCount,
    unit: 'шт.',
    status: critCount > 3 ? 'critical' : critCount > 0 ? 'warning' : 'normal',
    invertDelta: true,
  });

  // 3. economy_rate
  if (fd.totalPlan > 0) {
    const economyTotal = fd.totalPlan - fd.totalFact;
    const savingsPct = +((economyTotal / fd.totalPlan) * 100).toFixed(1);
    kpis.push({
      metricKey: 'economy_rate',
      label: 'Экономия',
      value: savingsPct,
      unit: '%',
      status: savingsPct > 25 ? 'warning' : 'normal',
    });
  }

  // 4. trust_binary
  const trustScore = fd.trust?.overall ?? fd.trust?.score ?? null;
  const trustOk = trustScore != null ? trustScore >= 75 : true;
  kpis.push({
    metricKey: 'trust_binary',
    label: 'Доверие к данным',
    value: trustScore ?? 0,
    isTrust: true,
    trustOk,
    status: trustOk ? 'normal' : 'warning',
  });

  return kpis;
}

// ────────────────────────────────────────────────────────────────
// KPI Expand Panel — inline detail (NOT modal, NOT navigate)
// ────────────────────────────────────────────────────────────────

function KPIExpandPanel({
  kpi,
  depts,
  periodKey,
  trust,
  formatMoney,
  toggleDepartment,
  navigateTo,
}: {
  kpi: any;
  depts: any[];
  periodKey: string;
  trust: any;
  formatMoney: (v: number) => string;
  toggleDepartment: (id: string) => void;
  navigateTo: (page: Page, params?: any) => void;
}) {
  // Per-department breakdown — dual values for merged execution metric
  const isDualExecution = kpi.metricKey === 'exec_count_pct' && kpi.secondaryValue != null;
  const deptBreakdown = depts.map((d: any) => {
    const q = d.quarters?.[periodKey];
    let value = 0;
    let secondaryValue: number | undefined;
    let colorClass: string | undefined;
    let secondaryColor: string | undefined;

    if (kpi.metricKey === 'exec_count_pct') {
      // Count-based execution (primary)
      const pc = q?.planCount ?? 0;
      const fc = q?.factCount ?? 0;
      value = pc > 0 ? +((fc / pc) * 100).toFixed(1) : 0;
      colorClass = getThresholdColor('dept_exec_count_pct', value);
      // Amount-based execution (secondary — for dual mode)
      if (isDualExecution) {
        const pt = q?.planTotal ?? d.planTotal ?? 0;
        const ft = q?.factTotal ?? d.factTotal ?? 0;
        secondaryValue = pt > 0 ? +((ft / pt) * 100).toFixed(1) : 0;
        secondaryColor = getThresholdColor('dept_exec_amount_pct', secondaryValue);
      }
    } else if (kpi.metricKey === 'critical_issues') {
      value = d.criticalIssueCount ?? 0;
    } else if (kpi.metricKey === 'economy_rate') {
      const pt = q?.planTotal ?? d.planTotal ?? 0;
      const ft = q?.factTotal ?? d.factTotal ?? 0;
      value = pt > 0 ? +(((pt - ft) / pt) * 100).toFixed(1) : 0;
    } else {
      value = d.trustScore ?? 0;
      colorClass = getThresholdColor('dept_trust', value);
    }

    return {
      id: d.department?.id ?? '',
      name: d.department?.nameShort ?? d.department?.id ?? '?',
      value,
      secondaryValue,
      color: colorClass,
      secondaryColor,
    };
  });

  // Budget breakdown for execution and economy KPIs
  const showBudget = ['exec_count_pct', 'economy_rate'].includes(kpi.metricKey);
  let fbTotal = 0, kbTotal = 0, mbTotal = 0;
  if (showBudget) {
    for (const d of depts) {
      const q = d.quarters?.[periodKey];
      fbTotal += q?.planFB ?? 0;
      kbTotal += q?.planKB ?? 0;
      mbTotal += q?.planMB ?? 0;
    }
  }

  // Trust components
  const showTrust = kpi.metricKey === 'trust_binary' && trust;

  return (
    <div className="space-y-4">
      {/* Dept breakdown */}
      <DeptBreakdown
        departments={deptBreakdown}
        unit={kpi.metricKey === 'critical_issues' ? '' : '%'}
        primaryLabel={isDualExecution ? 'Кол-во' : undefined}
        secondaryLabel={isDualExecution ? 'Сумма' : undefined}
        secondaryUnit="%"
        onDeptClick={(id) => {
          // DeptBreakdown passes dept.id (slug), convert to nameShort for store
          const dept = depts.find((d: any) => d.department?.id === id);
          toggleDepartment(dept?.department?.nameShort ?? id);
        }}
      />

      {/* Budget breakdown */}
      {showBudget && (fbTotal + kbTotal + mbTotal) > 0 && (
        <BudgetBreakdown fb={fbTotal} kb={kbTotal} mb={mbTotal} formatter={formatMoney} />
      )}

      {/* Trust components */}
      {showTrust && (
        <TrustComponents
          components={[
            { label: 'Качество данных', score: trust.dataQuality ?? trust.data_quality ?? 0, weight: '30%', metricKey: 'trust_data_quality' },
            { label: 'Целостность формул', score: trust.formulaIntegrity ?? trust.formula_integrity ?? 0, weight: '25%', metricKey: 'trust_formula_integrity' },
            { label: 'Соответствие правилам', score: trust.ruleCompliance ?? trust.rule_compliance ?? 0, weight: '20%', metricKey: 'trust_rule_compliance' },
            { label: 'Консистентность', score: trust.mappingConsistency ?? trust.mapping_consistency ?? 0, weight: '15%', metricKey: 'trust_mapping_consistency' },
            { label: 'Операционные риски', score: trust.operationalRisk ?? trust.operational_risk ?? 0, weight: '10%', metricKey: 'trust_operational_risk' },
          ]}
        />
      )}

      {/* Navigate link */}
      <div className="flex justify-end pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <button
          onClick={(e) => {
            e.stopPropagation();
            const targetMap: Record<string, [Page, any?]> = {
              exec_count_pct: ['analytics', {}],
              execution_pct: ['analytics', {}],
              critical_issues: ['quality', { qualityTab: 'issues' }],
              economy_rate: ['economy', {}],
              trust_binary: ['quality', { qualityTab: 'trust' }],
            };
            const [page, params] = targetMap[kpi.metricKey] ?? ['analytics' as Page, {}];
            navigateTo(page, params);
          }}
          className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium"
        >
          Подробнее →
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Pie chart data builder
// ────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────
// Blind Spots Widget
// ────────────────────────────────────────────────────────────────

function BlindSpotsWidget({ issues, signalCounts: apiSignalCounts, onNavigate }: {
  issues: any[];
  signalCounts?: Record<string, number>;
  onNavigate: (category: string, search?: string) => void;
}) {
  const signalCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const iss of issues) {
      const sig = iss.signal;
      if (sig) counts[sig] = (counts[sig] || 0) + 1;
    }
    return counts;
  }, [issues]);

  const spots = [
    { label: 'Просрочки', signal: 'overdue', search: 'просрочк', metricKey: 'signal_overdue', color: 'red', icon: '⏰' },
    { label: 'Флаг экономии', signal: 'economyConflict', search: 'флаг эконом', metricKey: 'signal_economy_conflict', color: 'rose', icon: '⚡' },
    { label: 'Высокая экономия', signal: 'highEconomy', search: 'высокая экономия', metricKey: 'signal_high_economy', color: 'orange', icon: '📊' },
    // Wave 3 TODO: add `signal_early_closure` to METRIC_KB; inline fallback until then.
    {
      label: 'Раннее закрытие',
      signal: 'earlyClosure',
      search: 'раннее закрытие',
      color: 'amber',
      icon: '🔒',
      kbFallback: {
        whatIs: 'Строки плана, где факт закрыт раньше плановой даты окончания. Может указывать на подгонку отчётности.',
        howCalc: 'COUNT(fact_date < plan_end_date AND plan_end_date NOT EMPTY).',
        thresholdsFull: '🟢 0 — чисто\n🟡 1–3 — проверь выборочно\n🔴 > 3 — системный признак',
      },
    },
    // Wave 3 TODO: add `signal_fact_without_date` to METRIC_KB; inline fallback until then.
    {
      label: 'Факт без даты',
      signal: 'factWithoutDate',
      search: 'факт без даты',
      color: 'purple',
      icon: '📅',
      kbFallback: {
        whatIs: 'Строки, где указана сумма факта, но пустая дата исполнения. Строка не пригодна к сверке и выпадает из отчёта.',
        howCalc: 'COUNT(fact_total > 0 AND fact_date IS EMPTY).',
        thresholdsFull: '🟢 0 — чисто\n🟡 1–5 — исправимо\n🔴 > 5 — нарушение дисциплины ввода',
      },
    },
    { label: 'Дата без сумм', signal: 'dateWithoutFact', search: 'факт дата без сумм', metricKey: 'signal_fact_date_before_plan', color: 'cyan', icon: '💰' },
    { label: 'Подвисшие', signal: 'stalledContract', search: 'подвис', metricKey: 'signal_stalled_contract', color: 'blue', icon: '⏸' },
    { label: 'Факт > план', signal: 'factExceedsPlan', search: 'факт превыш', metricKey: 'signal_fact_exceeds_plan', color: 'indigo', icon: '📈' },
    { label: 'Факт < план дата', signal: 'factDateBeforePlan', search: 'факт дата раньше', metricKey: 'signal_fact_date_before_plan', color: 'teal', icon: '📉' },
  ] as Array<{
    label: string;
    signal: string;
    search: string;
    metricKey?: string;
    color: string;
    icon: string;
    kbFallback?: { whatIs: string; howCalc: string; thresholdsFull: string };
  }>;

  const colorMap: Record<string, { bg: string; border: string; text: string; number: string; glow: string }> = {
    red:    { bg: 'bg-red-500/8', border: 'border-red-500/15 hover:border-red-500/30', text: 'text-red-500/80', number: 'text-red-500', glow: 'hover:shadow-red-500/10' },
    rose:   { bg: 'bg-rose-500/8', border: 'border-rose-500/15 hover:border-rose-500/30', text: 'text-rose-500/80', number: 'text-rose-500', glow: 'hover:shadow-rose-500/10' },
    orange: { bg: 'bg-orange-500/8', border: 'border-orange-500/15 hover:border-orange-500/30', text: 'text-orange-500/80', number: 'text-orange-500', glow: 'hover:shadow-orange-500/10' },
    amber:  { bg: 'bg-amber-500/8', border: 'border-amber-500/15 hover:border-amber-500/30', text: 'text-amber-500/80', number: 'text-amber-500', glow: 'hover:shadow-amber-500/10' },
    purple: { bg: 'bg-purple-500/8', border: 'border-purple-500/15 hover:border-purple-500/30', text: 'text-purple-500/80', number: 'text-purple-500', glow: 'hover:shadow-purple-500/10' },
    cyan:   { bg: 'bg-cyan-500/8', border: 'border-cyan-500/15 hover:border-cyan-500/30', text: 'text-cyan-500/80', number: 'text-cyan-500', glow: 'hover:shadow-cyan-500/10' },
    blue:   { bg: 'bg-blue-500/8', border: 'border-blue-500/15 hover:border-blue-500/30', text: 'text-blue-500/80', number: 'text-blue-500', glow: 'hover:shadow-blue-500/10' },
    indigo: { bg: 'bg-indigo-500/8', border: 'border-indigo-500/15 hover:border-indigo-500/30', text: 'text-indigo-500/80', number: 'text-indigo-500', glow: 'hover:shadow-indigo-500/10' },
    teal:   { bg: 'bg-teal-500/8', border: 'border-teal-500/15 hover:border-teal-500/30', text: 'text-teal-500/80', number: 'text-teal-500', glow: 'hover:shadow-teal-500/10' },
  };

  const totalSpots = spots.reduce((s, c) => s + (signalCounts[c.signal] || 0), 0);

  if (totalSpots === 0) return null;

  return (
    <section className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200/60 dark:border-zinc-800/60 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <KBTooltip
            whatIs="Сигналы — автоматически детектированные аномалии и отклонения в данных закупок: просрочки, флаги экономии, расхождения планов/фактов. Каждый сигнал формируется по отдельному правилу из каталога CHECK_REGISTRY."
            thresholdsFull={'🔴 overdue/economyConflict — критические\n🟡 stalled/factWithoutDate — варнинги\n🟢 ноль сигналов — чистые данные'}
            example="9 просрочек, 3 флага экономии, 1 факт > план"
            actions="Клик по карточке открывает вкладку Качество с фильтром по данному сигналу."
          >
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Сигналы и аномалии
            </h2>
          </KBTooltip>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold tabular-nums">
            {totalSpots}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {spots.map(spot => {
          const count = signalCounts[spot.signal] || 0;
          const colors = colorMap[spot.color] ?? colorMap.blue;
          const isActive = count > 0;
          return (
            <KBTooltip
              key={spot.signal}
              metric={spot.metricKey}
              whatIs={spot.kbFallback?.whatIs}
              howCalc={spot.kbFallback?.howCalc}
              thresholdsFull={spot.kbFallback?.thresholdsFull}
            >
              <button
                onClick={() => onNavigate(spot.signal, spot.search)}
                disabled={count === 0}
                aria-label={`${spot.label}: ${count}`}
                className={`
                  ${colors.bg} border ${colors.border} rounded-xl p-3 text-left
                  transition-all duration-200 cursor-pointer w-full
                  hover:scale-[1.03] active:scale-[0.98]
                  hover:shadow-lg ${colors.glow}
                  ${!isActive ? 'opacity-40 cursor-default hover:scale-100 hover:shadow-none' : ''}
                `}
              >
                <div className={`text-xl font-bold tabular-nums leading-none ${isActive ? colors.number : 'text-zinc-300 dark:text-zinc-700'}`}>
                  {count}
                </div>
                <div className={`text-[10px] font-medium mt-1.5 leading-tight ${isActive ? colors.text : 'text-zinc-300 dark:text-zinc-600'}`}>
                  {spot.label}
                </div>
              </button>
            </KBTooltip>
          );
        })}
      </div>
    </section>
  );
}
