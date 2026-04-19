import { useStore, MONTHS, QUARTER_MONTHS, AVAILABLE_YEARS, getMondayOfWeek, getMonthsForWeek } from '../store';
import type { MoneyUnit, BudgetType, Page } from '../store';
import {
  Sun, Moon, AlertTriangle, RotateCcw, Search, X,
  Wifi, WifiOff, Loader2,
  Gauge, TrendingUp, ShieldCheck, Settings, Table2, Coins,
} from 'lucide-react';
import clsx from 'clsx';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTheme } from './ThemeProvider';
import { FilterBreadcrumb } from './FilterBreadcrumb';

// Re-export for compatibility
export type FilterGroup =
  | 'period' | 'currency' | 'procurement' | 'activity'
  | 'budget' | 'department' | 'subordinate' | 'search';

const PAGE_FILTERS: Record<string, FilterGroup[]> = {
  dashboard:  ['period', 'currency', 'procurement', 'activity', 'budget'],
  data:       ['period', 'currency', 'procurement', 'activity', 'budget', 'search'],
  economy:    ['period', 'currency', 'procurement', 'activity', 'budget'],
  analytics:  ['period', 'currency', 'procurement', 'activity', 'budget'],
  quality:    ['period', 'procurement', 'activity'],
  recon:      ['period', 'procurement', 'activity'],
  trust:      ['period', 'procurement', 'activity'],
  issues:     ['period', 'procurement', 'activity', 'search'],
  recs:       ['period', 'procurement', 'activity'],
  journal:    ['period', 'procurement', 'activity'],
  settings:   [],
};

const QTR_KEYS = ['q1', 'q2', 'q3', 'q4'] as const;
const QTR_SHORT = ['1кв', '2кв', '3кв', '4кв'] as const;

/* ─── Nav items with BRAND COLORS ────────────────────────── */

const NAV_ITEMS: { id: Page; label: string; icon: typeof Gauge; color: string }[] = [
  { id: 'dashboard', label: 'Пульт',     icon: Gauge,       color: '#3b82f6' },  // Electric Blue
  { id: 'data',      label: 'Реестр',     icon: Table2,      color: '#0ea5e9' },  // Sky Teal
  { id: 'economy',   label: 'Экономия',   icon: Coins,       color: '#10b981' },  // Emerald
  { id: 'quality',   label: 'Контроль',   icon: ShieldCheck, color: '#ef4444' },  // Ruby Red
  { id: 'analytics', label: 'Аналитика',  icon: TrendingUp,  color: '#8b5cf6' },  // Violet
  { id: 'settings',  label: 'Система',    icon: Settings,    color: '#71717a' },  // Zinc
];

/** Get brand color for current page */
function getPageColor(page: string): string {
  switch (page) {
    case 'recon': case 'trust': case 'issues': case 'recs': case 'journal':
      return '#ef4444';
    default:
      return NAV_ITEMS.find(n => n.id === page)?.color ?? '#3b82f6';
  }
}

/** Get page icon component */
function getPageIcon(page: string): typeof Gauge {
  switch (page) {
    case 'recon': case 'trust': case 'issues': case 'recs': case 'journal':
      return ShieldCheck;
    default:
      return NAV_ITEMS.find(n => n.id === page)?.icon ?? Gauge;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SHIELD HUB — Animated logo that combines:
   1. Shield silhouette (no border/card — pure shape, ~38px)
   2. Active page icon inside the shield
   3. Brand color of current tab = shield fill + glow
   4. Loading = "ignition" flames animation
   5. WiFi status + countdown absorbed into this block
   ═══════════════════════════════════════════════════════════════════ */

function ShieldHub({ page, loading, isOnline, secondsLeft, onRefresh }: {
  page: string;
  loading: boolean;
  isOnline: boolean;
  secondsLeft: number;
  onRefresh: () => void;
}) {
  const color = getPageColor(page);
  const PageIcon = getPageIcon(page);
  const s = 34;
  const cx = s / 2;

  // Shield path — compact filled silhouette
  const shieldD = `
    M ${cx} ${s * 0.04}
    C ${cx + s * 0.36} ${s * 0.04} ${s * 0.92} ${s * 0.14} ${s * 0.92} ${s * 0.30}
    L ${s * 0.92} ${s * 0.48}
    C ${s * 0.92} ${s * 0.70} ${cx + s * 0.16} ${s * 0.86} ${cx} ${s * 0.96}
    C ${cx - s * 0.16} ${s * 0.86} ${s * 0.08} ${s * 0.70} ${s * 0.08} ${s * 0.48}
    L ${s * 0.08} ${s * 0.30}
    C ${s * 0.08} ${s * 0.14} ${cx - s * 0.36} ${s * 0.04} ${cx} ${s * 0.04}
    Z
  `;

  // WiFi at very bottom of shield (below icon area)
  const wifiY = s * 0.72;
  const wifiCx = cx;

  return (
    <button
      className={clsx('shield-hub', loading && 'shield-loading')}
      onClick={onRefresh}
      title={loading ? 'Загрузка...' : isOnline ? `Обновить (${secondsLeft}с)` : 'Нет связи — повторить'}
      style={{ '--shield-color': color } as React.CSSProperties}
    >
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shield-svg"
      >
        <defs>
          <linearGradient id="shield-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.9" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
          <radialGradient id="shield-inner-glow" cx="50%" cy="35%" r="55%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Shield filled silhouette */}
        <path d={shieldD} fill="url(#shield-fill)" className="shield-shape" />
        {/* Inner highlight */}
        <path d={shieldD} fill="url(#shield-inner-glow)" />
        {/* Subtle edge */}
        <path d={shieldD} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />

        {/* WiFi arcs — compact, lower shield */}
        {isOnline && !loading && (
          <g opacity="0.38">
            <path d={`M ${wifiCx - 5} ${wifiY + 1} A 5 5 0 0 1 ${wifiCx + 5} ${wifiY + 1}`}
              stroke="#fff" strokeWidth="0.9" strokeLinecap="round" fill="none" />
            <path d={`M ${wifiCx - 3} ${wifiY + 3} A 3 3 0 0 1 ${wifiCx + 3} ${wifiY + 3}`}
              stroke="#fff" strokeWidth="0.8" strokeLinecap="round" fill="none" />
            <circle cx={wifiCx} cy={wifiY + 5} r="0.7" fill="#fff" />
          </g>
        )}
        {!isOnline && !loading && (
          <g opacity="0.55">
            <line x1={wifiCx - 3} y1={wifiY + 1} x2={wifiCx + 3} y2={wifiY + 5.5}
              stroke="#ff6b6b" strokeWidth="1.2" strokeLinecap="round" />
            <line x1={wifiCx + 3} y1={wifiY + 1} x2={wifiCx - 3} y2={wifiY + 5.5}
              stroke="#ff6b6b" strokeWidth="1.2" strokeLinecap="round" />
          </g>
        )}
        {loading && (
          <g opacity="0.42">
            <circle cx={wifiCx} cy={wifiY + 3} r="2.5" fill="none"
              stroke="#fff" strokeWidth="1" strokeDasharray="3.5 1.5">
              <animateTransform attributeName="transform" type="rotate"
                from={`0 ${wifiCx} ${wifiY + 3}`} to={`360 ${wifiCx} ${wifiY + 3}`}
                dur="1s" repeatCount="indefinite" />
            </circle>
          </g>
        )}
      </svg>

      {/* Page icon — centered in upper 40% of shield, above wifi */}
      <div className="shield-icon">
        <PageIcon size={13} strokeWidth={2.2} />
      </div>

      {/* Countdown — tiny text below shield */}
      <span className="shield-timer">
        {loading ? '…' : isOnline ? secondsLeft : '!'}
      </span>
    </button>
  );
}

/* ─── Auto Refresh (reused logic) ──────────────────────────── */

function useAutoRefresh() {
  const [secondsLeft, setSecondsLeft] = useState(60);
  useEffect(() => {
    let rt: ReturnType<typeof setInterval>, ct: ReturnType<typeof setInterval>;
    const start = () => {
      setSecondsLeft(60);
      ct = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
      rt = setInterval(() => {
        if (!document.hidden && !useStore.getState().loading) {
          useStore.getState().quickRefresh();
          setSecondsLeft(60);
        }
      }, 60_000);
    };
    const onVis = () => { if (!document.hidden) start(); else { clearInterval(rt); clearInterval(ct); } };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(rt); clearInterval(ct); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  const { loading, error } = useStore();
  return { secondsLeft, loading, isOnline: !error };
}

/* ═══════════════════════════════════════════════════════════════════
   TIME DRUM — unchanged from original
   ═══════════════════════════════════════════════════════════════════ */

function TimeDrum() {
  const { year, setYear, monthsByYear, toggleMonthInYear, toggleQuarterInYear, toggleYearFull, clearAllPeriods, focusedWeekStart } = useStore();
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const drumRef = useRef<HTMLDivElement>(null);
  const focusedWMonth = focusedWeekStart.getMonth() + 1;
  const focusedWYear = focusedWeekStart.getFullYear();
  const hasAnySelection = Object.keys(monthsByYear).length > 0;

  useEffect(() => {
    const el = drumRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const yr = useStore.getState().year;
      const yearIdx = AVAILABLE_YEARS.indexOf(typeof yr === 'number' ? yr : currentYear);
      if (e.deltaY > 0 && yearIdx < AVAILABLE_YEARS.length - 1) setYear(AVAILABLE_YEARS[yearIdx + 1]);
      else if (e.deltaY < 0 && yearIdx > 0) setYear(AVAILABLE_YEARS[yearIdx - 1]);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [currentYear, setYear]);

  const isQFull = (yr: number, qKey: string) => {
    const ms = monthsByYear[yr];
    if (!ms) return false;
    return QUARTER_MONTHS[qKey]?.every((m) => ms.has(m)) ?? false;
  };
  const isQPartial = (yr: number, qKey: string) => {
    const ms = monthsByYear[yr];
    if (!ms) return false;
    const qms = QUARTER_MONTHS[qKey] ?? [];
    return qms.some((m) => ms.has(m)) && !isQFull(yr, qKey);
  };

  return (
    <div className="tg-drum select-none" ref={drumRef}>
      {hasAnySelection && (
        <button onClick={clearAllPeriods} className="tg-drum-reset" title="Сбросить период">
          <X size={7} strokeWidth={3} />
        </button>
      )}
      {AVAILABLE_YEARS.map((yr, idx) => {
        const isActiveYear = yr === year;
        const yearMonths = monthsByYear[yr];
        const hasYearSelection = yearMonths && yearMonths.size > 0;
        const isFullYear = yearMonths?.size === 12;
        const isFirst = idx === 0;
        const isLast = idx === AVAILABLE_YEARS.length - 1;
        return (
          <div key={yr} className={clsx('tg-row', isActiveYear && 'tg-row-active', isFirst && 'tg-row-first', isLast && 'tg-row-last')}>
            <button onClick={() => toggleYearFull(yr)} title={isFullYear ? `${yr} — снять` : `${yr} — весь год`}
              className={clsx('tg-year', isFullYear ? 'tg-year-full' : hasYearSelection ? 'tg-year-partial' : 'tg-year-idle')}>
              {yr}
            </button>
            {QTR_KEYS.map((qKey, qi) => {
              const qMonths = QUARTER_MONTHS[qKey] ?? [];
              const full = isQFull(yr, qKey);
              const partial = isQPartial(yr, qKey);
              return (
                <div key={qKey} className={clsx('tg-quarter', full && 'tg-quarter-full', partial && 'tg-quarter-partial', !full && !partial && 'tg-quarter-idle')}>
                  <button onClick={() => toggleQuarterInYear(yr, qKey)}
                    className={clsx('tg-quarter-tab', full && 'tg-quarter-tab-full', partial && 'tg-quarter-tab-partial', !full && !partial && 'tg-quarter-tab-idle')}>
                    {QTR_SHORT[qi]}
                  </button>
                  {qMonths.map((monthId) => {
                    const m = MONTHS[monthId - 1];
                    const isSelected = yearMonths?.has(monthId) ?? false;
                    const isCurrent = monthId === currentMonth && yr === currentYear;
                    const isFocusedByWeek = yr === focusedWYear && monthId === focusedWMonth;
                    return (
                      <button key={monthId} onClick={() => toggleMonthInYear(yr, monthId)} title={`${m.full} ${yr}`}
                        className={clsx('tg-month', isSelected ? 'tg-month-active' : 'tg-month-idle', isCurrent && 'tg-month-now', isFocusedByWeek && !isSelected && 'tg-month-focused')}>
                        {m.short}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   WEEK ROLLER — unchanged
   ═══════════════════════════════════════════════════════════════════ */

function getISOWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function WeekRoller() {
  const { focusedWeekStart, shiftFocusedWeek, monthsByYear, periodMode } = useStore();
  const wrRef = useRef<HTMLDivElement>(null);
  const isWeekMode = periodMode === 'week';
  const weeks: Date[] = [];
  for (let i = -1; i <= 1; i++) {
    weeks.push(new Date(focusedWeekStart.getTime() + i * 7 * 24 * 60 * 60 * 1000));
  }
  useEffect(() => {
    const el = wrRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      useStore.getState().shiftFocusedWeek(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);
  useEffect(() => {
    // Only sync week→month when in explicit mode (manual month selection syncs roller)
    if (isWeekMode) return;
    const entries = Object.entries(monthsByYear);
    if (entries.length === 1) {
      const [yrStr, months] = entries[0];
      if (months.size === 1) {
        const month = [...months][0];
        const firstDay = new Date(Number(yrStr), month - 1, 1);
        const monday = getMondayOfWeek(firstDay);
        if (monday.getTime() !== focusedWeekStart.getTime()) {
          useStore.setState({ focusedWeekStart: monday });
        }
      }
    }
  }, [monthsByYear, focusedWeekStart, isWeekMode]);

  /** Click on focused week → activate week mode (resets to current week's data) */
  const handleWeekClick = useCallback((monday: Date) => {
    useStore.setState({
      focusedWeekStart: monday,
      activeMonths: getMonthsForWeek(monday),
      periodMode: 'week',
      monthsByYear: {},
    });
  }, []);

  return (
    <div className={clsx('wr-drum', isWeekMode && 'wr-drum-active')} ref={wrRef} title={isWeekMode ? 'Режим недели (данные по текущей неделе)' : 'Нажмите для переключения на неделю'}>
      {weeks.map((monday, idx) => {
        const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
        const isFocused = idx === 1;
        const isEdge = idx === 0 || idx === 2;
        const mDay = monday.getDate();
        const sDay = sunday.getDate();
        const mMonthIdx = monday.getMonth();
        const sMonthIdx = sunday.getMonth();
        const weekNum = getISOWeekNumber(monday);
        let rangeLine: string;
        let monthLine: string;
        if (mMonthIdx === sMonthIdx) {
          rangeLine = `${mDay}\u2013${sDay}`;
          monthLine = MONTHS[mMonthIdx].short.toLowerCase();
        } else {
          rangeLine = `${mDay}\u2013${sDay}`;
          monthLine = `${MONTHS[mMonthIdx].short.toLowerCase()}\u2013${MONTHS[sMonthIdx].short.toLowerCase()}`;
        }
        return (
          <div
            key={monday.toISOString()}
            className={clsx('wr-row', isFocused && 'wr-row-active', isEdge && 'wr-row-edge', isFocused && isWeekMode && 'wr-row-driving')}
            onClick={isFocused ? () => handleWeekClick(monday) : undefined}
            style={isFocused ? { cursor: 'pointer' } : undefined}
          >
            <span className="wr-wnum">w{weekNum}</span>
            <span className="wr-label">
              <span className="wr-range">{rangeLine}</span>
              <span className="wr-month">{monthLine}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Currency drum — тыс/млн vertical */
function CurrencyDrum({ value, onChange }: { value: string; onChange: (v: any) => void }) {
  return (
    <div className="vf-drum vf-drum-thin" title="Единицы измерения">
      {(['тыс', 'млн'] as const).map((u) => (
        <button
          key={u}
          onClick={() => onChange(u)}
          className={clsx('vf-btn vf-btn-sm', value === u && 'vf-cur-active')}
          title={u === 'тыс' ? 'Тысячи ₽' : 'Миллионы ₽'}
        >{u}</button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   NAV PILLS — 6 horizontal buttons with brand colors
   Glass pill container, each tab has its own color
   Apple Intelligence effects: shimmer on active
   ═══════════════════════════════════════════════════════════════════ */

function NavPills({ activePage, setPage }: { activePage: string; setPage: (p: Page) => void }) {
  return (
    <nav className="nav-pills-wrap" aria-label="Навигация">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === activePage;
        return (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            className={clsx('np-btn', isActive && 'np-btn-active')}
            style={{ '--np-color': item.color } as React.CSSProperties}
            title={item.label}
          >
            {/* Apple Intelligence rotating glow — only on active */}
            {isActive && <span className="np-glow" />}
            <span className="np-content">
              <Icon size={10} strokeWidth={isActive ? 2.2 : 1.5} />
              <span>{item.label}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN HEADER — ONE CONTINUOUS HORIZONTAL BAR
   ShieldHub → NavPills → WeekRoller → TimeDrum → Filters → Tools
   ═══════════════════════════════════════════════════════════════════ */

export function Header() {
  const {
    loading, error, isDemo, page, setPage,
    moneyUnit, setMoneyUnit,
    selectedMethods, toggleMethod, clearMethods,
    selectedActivities, toggleActivity, clearActivities,
    selectedBudgets, toggleBudget, clearBudgets,
    searchQuery, setSearchQuery,
    resetAllFilters, selectedDepartments, selectedSubordinates, monthsByYear,
  } = useStore();
  const { theme, toggleTheme } = useTheme();
  const { secondsLeft, loading: autoLoading, isOnline } = useAutoRefresh();
  const fg = PAGE_FILTERS[page] ?? [];
  const has = (k: string) => fg.includes(k as FilterGroup);

  const activePage = (() => {
    switch (page) {
      case 'recon': case 'trust': case 'issues': case 'recs': case 'journal':
        return 'quality';
      default:
        return page;
    }
  })();

  const activeCount =
    (moneyUnit !== 'тыс' ? 1 : 0) +
    (selectedMethods.size > 0 ? 1 : 0) + (selectedActivities.size > 0 ? 1 : 0) +
    (selectedBudgets.size > 0 ? 1 : 0) + (Object.keys(monthsByYear).length > 0 ? 1 : 0) +
    (selectedDepartments.size > 0 ? 1 : 0) + (selectedSubordinates.size > 0 ? 1 : 0) +
    (searchQuery ? 1 : 0);

  const showTime = has('period');
  const showMethod = has('procurement');
  const showActivity = has('activity');
  const showBudget = has('budget');
  const showMoney = has('currency');
  const showSearch = has('search');

  const mAll = selectedMethods.size === 0;
  const aAll = selectedActivities.size === 0;
  const bAll = selectedBudgets.size === 0;

  return (
    <header className="sticky top-0 z-40 header-glass flex-shrink-0">
      {/* Error banner */}
      {error && (
        <div className="px-4 py-1.5 bg-red-50/90 dark:bg-red-950/40 border-b border-red-200/60 dark:border-red-800/40 text-red-700 dark:text-red-300 text-[11px] flex items-center gap-2">
          <AlertTriangle size={12} className="shrink-0" /><span className="truncate">{error}</span>
          <button onClick={() => useStore.getState().refresh()} className="ml-auto text-red-600 dark:text-red-400 font-semibold hover:underline shrink-0">Повторить</button>
        </div>
      )}
      {isDemo && !error && (
        <div className="px-4 py-1 bg-amber-50/80 dark:bg-amber-950/20 border-b border-amber-200/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 text-[10px] flex items-center gap-2">
          <AlertTriangle size={11} className="shrink-0" /><span>Демо — Google Таблицы недоступны</span>
        </div>
      )}

      {/* ══════ ONE CONTINUOUS HORIZONTAL BAR ══════ */}
      <div className="hbar">
        {/* 1. Shield Hub — animated logo with status */}
        <ShieldHub
          page={page}
          loading={loading}
          isOnline={isOnline}
          secondsLeft={secondsLeft}
          onRefresh={() => useStore.getState().refresh()}
        />

        {/* 2. Nav pills — 6 horizontal buttons */}
        <NavPills activePage={activePage} setPage={setPage} />

        {/* 3. Time drums */}
        {showTime && (
          <div className="time-machine">
            <WeekRoller />
            <TimeDrum />
          </div>
        )}

        {/* 4. Filter drums */}
        {showMethod && (
          <div className="vf-drum">
            <button onClick={() => mAll ? toggleMethod('competitive') : clearMethods()}
              className={clsx('vf-btn', !mAll && methods_has(selectedMethods, 'competitive') && 'vf-btn-active')}
              title="Конкурентные (44-ФЗ ст.24)">КП</button>
            <button onClick={() => mAll ? toggleMethod('single') : (selectedMethods.has('single') ? clearMethods() : (() => { clearMethods(); toggleMethod('single'); })())}
              className={clsx('vf-btn', !mAll && selectedMethods.has('single') && 'vf-btn-active')}
              title="Единственный поставщик (44-ФЗ ст.93)">ЕП</button>
            <button onClick={() => clearMethods()}
              className={clsx('vf-btn', mAll && 'vf-cur-active')}
              title="Все способы">ВСЕ</button>
          </div>
        )}

        {showActivity && (
          <div className="vf-drum">
            <button onClick={() => toggleActivity('program')}
              className={clsx('vf-btn', !aAll && selectedActivities.has('program') && 'vf-btn-active')}
              title="Программные мероприятия">ПМ</button>
            <button onClick={() => toggleActivity('current_program')}
              className={clsx('vf-btn', !aAll && selectedActivities.has('current_program') && 'vf-btn-active')}
              title="Текущая деятельность — программные">ТД-ПМ</button>
            <button onClick={() => toggleActivity('current_non_program')}
              className={clsx('vf-btn', !aAll && selectedActivities.has('current_non_program') && 'vf-btn-active')}
              title="Текущая деятельность">ТД</button>
          </div>
        )}

        {showBudget && (
          <div className="vf-drum">
            <button onClick={() => toggleBudget('fb' as BudgetType)}
              className={clsx('vf-btn vf-budget-fb', !bAll && selectedBudgets.has('fb') && 'vf-btn-active')}
              title="Федеральный бюджет">ФБ</button>
            <button onClick={() => toggleBudget('kb' as BudgetType)}
              className={clsx('vf-btn vf-budget-kb', !bAll && selectedBudgets.has('kb') && 'vf-btn-active')}
              title="Краевой бюджет">КБ</button>
            <button onClick={() => toggleBudget('mb' as BudgetType)}
              className={clsx('vf-btn vf-budget-mb', !bAll && selectedBudgets.has('mb') && 'vf-btn-active')}
              title="Муниципальный бюджет">МБ</button>
          </div>
        )}

        {showMoney && (
          <CurrencyDrum value={moneyUnit} onChange={setMoneyUnit} />
        )}

        {/* Search */}
        {showSearch && (
          <div className="relative w-[100px] flex-shrink-0">
            <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input type="text" placeholder="Поиск..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={clsx('w-full pl-5 pr-5 py-[3px] rounded-md text-[10px] border transition-all bg-transparent',
                searchQuery ? 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-blue-50/50 dark:bg-blue-950/20'
                : 'border-zinc-200/60 dark:border-zinc-700/60 text-zinc-600 dark:text-zinc-300 focus:border-blue-400')} />
            {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition"><X size={9} /></button>}
          </div>
        )}

        {/* Active filter chips — inline, pushes to the right */}
        <FilterBreadcrumb variant="inline" />

        {/* 5. Tools (right edge) — theme + reset only, LiveDot merged into ShieldHub */}
        <div className="nav-tools">
          <button onClick={toggleTheme} className="hf-icon-btn"
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
            {theme === 'dark' ? <Sun size={11} /> : <Moon size={11} />}
          </button>
          {activeCount > 0 && (
            <button onClick={resetAllFilters}
              className="hf-icon-btn group hover:text-red-500 hover:bg-red-50/80 dark:hover:bg-red-950/20"
              title="Сбросить все фильтры">
              <RotateCcw size={9} className="group-hover:rotate-[-180deg] transition-transform duration-300" />
              <span className="w-2.5 h-2.5 flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[6px] font-bold">{activeCount}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/** Helper — check if a method is selected */
function methods_has(methods: Set<string>, key: string): boolean {
  return methods.has(key);
}
