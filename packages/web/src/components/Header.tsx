import { useStore, MONTHS, QUARTER_MONTHS, AVAILABLE_YEARS, getActiveFilterCount, getMondayOfWeek } from '../store';
import type { BudgetType, Page } from '../store';
import {
  Sun, Moon, AlertTriangle, RotateCcw, Search, X,
  Gauge, TrendingUp, ShieldCheck, Settings, Table2, Coins, FileSpreadsheet, FileText, Gavel, ListChecks,
  CalendarX2, Repeat, Radar,
} from 'lucide-react';
import clsx from 'clsx';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from './ThemeProvider';
import { FilterBreadcrumb } from './FilterBreadcrumb';
import { ProvenanceHub } from './live/ProvenanceHub';
import { useLiveEvents } from '../hooks/useLiveEvents';

// Re-export for compatibility
export type FilterGroup =
  | 'period' | 'currency' | 'procurement' | 'activity'
  | 'budget' | 'department' | 'subordinate' | 'search';

const PAGE_FILTERS: Record<string, FilterGroup[]> = {
  dashboard:  ['period', 'currency', 'procurement', 'activity', 'budget'],
  report:     ['period'],
  svod:       ['currency', 'procurement', 'budget'],
  data:       ['period', 'currency', 'procurement', 'activity', 'budget', 'search'],
  // Корзины Реестра (п.73в): та же страница построчных данных, фильтр класса
  // зафиксирован. У «В течение года» способ всегда ЕП — кнопки КП/ЕП там
  // дезориентировали бы (класс определяется способом, фильтр не работает).
  unfunded:   ['period', 'currency', 'procurement', 'activity', 'budget', 'search'],
  yearlong:   ['period', 'currency', 'activity', 'budget', 'search'],
  // Мониторинг — другая книга (процедуры, деньги в рублях): глобальные фильтры
  // книг ГРБС (период/способ/бюджет) к ней не применяются — показывать их
  // значило бы обещать отбор, которого нет. Свои фильтры (стадия/заказчик) —
  // внутри страницы.
  monitoring: [],
  economy:    ['period', 'currency', 'procurement', 'activity', 'budget'],
  // Конкуренция — сравнение ЕП против конкурентных встроено в сами блоки:
  // фильтр способа закупки здесь дезориентировал бы (блоки его не применяют).
  competition: ['period', 'currency'],
  // Дисциплина — список дел за весь год: барабан нужен ради выбора года,
  // сужение до квартала/месяца страница честно оговаривает бейджем периода.
  discipline: ['period', 'currency'],
  analytics:  ['period', 'currency', 'procurement', 'activity', 'budget'],
  quality:    ['period', 'procurement', 'activity'],
  recon:      ['period', 'procurement', 'activity'],
  trust:      ['period', 'procurement', 'activity'],
  issues:     ['period', 'procurement', 'activity', 'search'],
  recs:       ['period', 'procurement', 'activity'],
  journal:    ['period', 'procurement', 'activity'],
  settings:   [],
};

/**
 * Ключи текущей деятельности. Канон п.30 (интервью 14.08.2026): среза «ТД-ПМ»
 * больше нет, но ключ current_program остаётся в сохранённых ссылках и старых
 * снимках — кнопка ТД обязана включать оба, иначе часть строк ТД пропадёт из
 * выборки молча.
 */
const TD_ACTIVITY_KEYS = ['current_program', 'current_non_program'] as const;

const QTR_KEYS = ['q1', 'q2', 'q3', 'q4'] as const;
const QTR_SHORT = ['1кв', '2кв', '3кв', '4кв'] as const;

/* ─── Nav items with BRAND COLORS ────────────────────────── */

// Цвет вкладки — заливка активной кнопки. Значений ДВА, и это не дубль.
//
// Повод (регресс, замечен владельцем 19.08.2026): кнопка строится как
// «заливка цветом раздела плюс подпись поверх», и силуэт её держится на том,
// что заливка по светлоте отличается от фона страницы. Все тона ниже были
// подобраны под тёмную тему (фон #0b0a08) и потому светлые. На светлой теме
// (фон #faf8f3) светлая заливка даёт около 1,3:1 — силуэта нет вовсе, коническое
// свечение тем же тоном невидно, а подпись читается вялой.
//
// Решение: у каждого раздела два значения ОДНОГО тона — светлое для тёмной
// темы (`color`) и насыщенное тёмное для светлой (`colorLight`). Семейство цвета
// при этом НЕ меняется — меняется только светлота, поэтому исключения
// канона п.115 целы: «Реестр» остаётся бирюзовым в обеих темах.
//
// Подпись берётся ролью `--accent-ink` (белая на светлой теме, чернильная на
// тёмной), поэтому оба набора обязаны давать не меньше 4,5:1 к своей подписи
// и не меньше 3:1 к фону своей страницы. Замер держит страж `nav-contrast.test.ts`.
export const NAV_ITEMS: { id: Page; label: string; icon: typeof Gauge; color: string; colorLight: string; title?: string }[] = [
  { id: 'dashboard', label: 'Пульс',     icon: Gauge,           color: '#e5d3a9', colorLight: '#7a5f33' },  // Cream (чёрный дэш + кремовый хром, 07.08)
  { id: 'report',    label: 'Отчёт',      icon: FileText,        color: '#f59e0b', colorLight: '#a25a06' },  // Amber — еженедельный отчёт
  { id: 'svod',      label: 'Свод',       icon: FileSpreadsheet, color: '#0891b2', colorLight: '#0e6d85' },  // Cyan — источник истины
  { id: 'data',      label: 'Реестр',     icon: Table2,      color: '#0ea5e9', colorLight: '#0b6f96' },  // Sky Teal
  // Корзины Реестра (п.73в). Цвета НАМЕРЕННО светлые: заливка активной кнопки
  // несёт тёмную подпись #1b170f, и обе пары дают контраст сильно выше 4,5:1
  // (#fde68a ≈ 12,3:1, #c7d2fe ≈ 10,9:1).
  { id: 'unfunded',  label: 'Не обеспеченные', title: 'Закупки, не обеспеченные финансированием (год плана не проставлен)', icon: CalendarX2, color: '#fde68a', colorLight: '#8a6508' },  // Light Amber (п.23)
  { id: 'yearlong',  label: 'В течение года', title: 'Закупки, проводимые в течение года (серии договоров, выплаты, платежи)', icon: Repeat, color: '#c7d2fe', colorLight: '#4338ca' },  // Light Indigo (п.71)
  // Мониторинг (п.69в/п.101а): реестр процедур из книги «Ежедневный
  // мониторинг». Светлый тон ради тёмной подписи активной кнопки (#bae6fd ≈ 12:1).
  { id: 'monitoring', label: 'Мониторинг', title: 'Реестр процедур определения поставщика — книга «Ежедневный мониторинг»', icon: Radar, color: '#bae6fd', colorLight: '#0369a1' },  // Light Sky
  { id: 'economy',   label: 'Экономия',   icon: Coins,       color: '#10b981', colorLight: '#04704f' },  // Emerald
  { id: 'competition', label: 'Конкуренция', icon: Gavel,    color: '#5eead4', colorLight: '#0d6d63' },  // Light Teal (тёмная подпись ≥4,5:1)
  { id: 'discipline', label: 'Дисциплина', icon: ListChecks, color: '#fdba74', colorLight: '#9a3a0b' },  // Light Orange — рабочий список дел
  { id: 'quality',   label: 'Контроль',   icon: ShieldCheck, color: '#ef4444', colorLight: '#b3211d' },  // Ruby Red
  { id: 'analytics', label: 'Аналитика',  icon: TrendingUp,  color: '#a78bfa', colorLight: '#6431c4' },  // Violet
  { id: 'settings',  label: 'Система',    icon: Settings,    color: '#a1a1aa', colorLight: '#55555f' },  // Zinc
];

/**
 * Системная настройка «уменьшить движение». Читается подпиской, а не разово:
 * пользователь может включить её в панели управления, не перезагружая вкладку.
 * CSS-анимации гасит правило в index.css; этот хук нужен там, где анимация
 * живёт в разметке SVG (SMIL), до которой CSS не дотягивается.
 */
function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Get brand color for current page */
function getPageColor(page: string): string {
  switch (page) {
    case 'recon': case 'trust': case 'issues': case 'recs': case 'journal':
      return '#ef4444';
    default:
      return NAV_ITEMS.find(n => n.id === page)?.color ?? '#d6bf85';
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
  const reducedMotion = usePrefersReducedMotion();
  const s = 34;
  const cx = s / 2;

  // Подпись для чтения с экрана: сама кнопка — только рисунок, поэтому
  // состояние связи и остаток до обновления проговариваются словами.
  const label = loading
    ? 'Идёт обновление данных'
    : isOnline
      ? `Обновить данные. Автообновление через ${secondsLeft} с`
      : 'Нет связи с источником. Повторить попытку';

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
      type="button"
      className={clsx('shield-hub', loading && 'shield-loading')}
      onClick={onRefresh}
      title={loading ? 'Загрузка...' : isOnline ? `Обновить (${secondsLeft}с)` : 'Нет связи — повторить'}
      aria-label={label}
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
              {/* Вращение живёт в разметке SVG, а не в CSS, поэтому системную
                  настройку «уменьшить движение» приходится учитывать здесь
                  вручную: без этого кольцо крутится вопреки настройке. */}
              {!reducedMotion && (
                <animateTransform attributeName="transform" type="rotate"
                  from={`0 ${wifiCx} ${wifiY + 3}`} to={`360 ${wifiCx} ${wifiY + 3}`}
                  dur="1s" repeatCount="indefinite" />
              )}
            </circle>
          </g>
        )}
      </svg>

      {/* Page icon — centered in upper 40% of shield, above wifi */}
      <div className="shield-icon" aria-hidden="true">
        <PageIcon size={13} strokeWidth={2.2} />
      </div>

      {/* Countdown — tiny text below shield. Число уже проговорено в aria-label
          кнопки, поэтому для чтения с экрана оно скрыто как дубль. */}
      <span className="shield-timer" aria-hidden="true">
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
    const onVis = () => {
      if (!document.hidden) {
        // П.98б: на скрытой вкладке автообновление гасится — вернувшийся
        // пользователь смотрел бы на данные возрастом до минуты (плюс TTL
        // снимка). Обновляемся сразу, не дожидаясь следующего тика.
        if (!useStore.getState().loading) useStore.getState().quickRefresh();
        start();
      } else { clearInterval(rt); clearInterval(ct); }
    };
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

  // Колесо мыши перелистывает годы — но мышь есть не у всех, и барабан без
  // клавиатурного дубля означает функцию, недостижимую с клавиатуры. Стрелки
  // вверх/вниз на любой кнопке года делают ровно то же самое.
  const handleYearKey = useCallback((e: React.KeyboardEvent, yr: number) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const idx = AVAILABLE_YEARS.indexOf(yr);
    const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
    if (idx >= 0 && next >= 0 && next < AVAILABLE_YEARS.length) setYear(AVAILABLE_YEARS[next]);
  }, [setYear]);

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
        <button type="button" onClick={clearAllPeriods} className="tg-drum-reset"
          title="Сбросить период" aria-label="Сбросить выбранный период">
          <X size={7} strokeWidth={3} aria-hidden="true" />
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
            <button type="button" onClick={() => toggleYearFull(yr)}
              onKeyDown={(e) => handleYearKey(e, yr)}
              title={isFullYear ? `${yr} — снять` : `${yr} — весь год`}
              aria-pressed={isFullYear}
              aria-label={`${yr} год целиком${isActiveYear ? ', год в фокусе' : ''}`}
              className={clsx('tg-year', isFullYear ? 'tg-year-full' : hasYearSelection ? 'tg-year-partial' : 'tg-year-idle')}>
              {yr}
            </button>
            {QTR_KEYS.map((qKey, qi) => {
              const qMonths = QUARTER_MONTHS[qKey] ?? [];
              const full = isQFull(yr, qKey);
              const partial = isQPartial(yr, qKey);
              return (
                <div key={qKey} className={clsx('tg-quarter', full && 'tg-quarter-full', partial && 'tg-quarter-partial', !full && !partial && 'tg-quarter-idle')}>
                  <button type="button" onClick={() => toggleQuarterInYear(yr, qKey)}
                    aria-pressed={full}
                    aria-label={`${qi + 1} квартал ${yr} года`}
                    title={`${qi + 1} квартал ${yr}`}
                    className={clsx('tg-quarter-tab', full && 'tg-quarter-tab-full', partial && 'tg-quarter-tab-partial', !full && !partial && 'tg-quarter-tab-idle')}>
                    {QTR_SHORT[qi]}
                  </button>
                  {qMonths.map((monthId) => {
                    const m = MONTHS[monthId - 1];
                    const isSelected = yearMonths?.has(monthId) ?? false;
                    const isCurrent = monthId === currentMonth && yr === currentYear;
                    const isFocusedByWeek = yr === focusedWYear && monthId === focusedWMonth;
                    return (
                      <button key={monthId} type="button" onClick={() => toggleMonthInYear(yr, monthId)}
                        title={`${m.full} ${yr}`}
                        aria-pressed={isSelected}
                        aria-label={`${m.full} ${yr}${isCurrent ? ', текущий месяц' : ''}`}
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
      shiftFocusedWeek(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [shiftFocusedWeek]);
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

  /** Click on focused week → week-режим (сброс явного выбора периода). */
  const handleWeekClick = useCallback((monday: Date) => {
    // Баг #5 (реестр охоты 08.08): последний писатель месяцев недели в
    // activeMonths. Week-режим — не фильтр: месяцы недели были невидимы для
    // чипов/URL и молча резали экран до месяца. Сброс — пустое множество,
    // как во всех точках «период очищен» store (clearAllPeriods и др.).
    useStore.setState({
      focusedWeekStart: monday,
      activeMonths: new Set<number>(),
      periodMode: 'week',
      monthsByYear: {},
    });
  }, []);

  // Клавиатурный дубль колеса мыши: стрелки листают недели, пока фокус стоит
  // на центральной строке барабана.
  const handleWeekKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    shiftFocusedWeek(e.key === 'ArrowDown' ? 1 : -1);
  }, [shiftFocusedWeek]);

  return (
    <div className={clsx('wr-drum', isWeekMode && 'wr-drum-active')} ref={wrRef} title={isWeekMode ? 'Режим недели (период не выбран — данные за год)' : 'Нажмите для сброса выбранного периода'}>
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
        // Кириллическая «н» вместо латинской «w»: колонка шириной 18px
        // (.wr-wnum в index.css) держит ровно три знака, поэтому полное
        // слово сюда не влезает — оно вынесено в подсказку при наведении.
        const body = (
          <>
            <span className="wr-wnum" title={`${weekNum}-я неделя года`}>н{weekNum}</span>
            <span className="wr-label">
              <span className="wr-range">{rangeLine}</span>
              <span className="wr-month">{monthLine}</span>
            </span>
          </>
        );

        // Нажимается только центральная строка — она и есть кнопка. Соседние
        // недели показаны для контекста и остаются обычным текстом: раньше вся
        // строка была <div> с onClick, то есть с клавиатуры недостижима.
        if (isFocused) {
          return (
            <button
              key={monday.toISOString()}
              type="button"
              className={clsx('wr-row', 'wr-row-active', isWeekMode && 'wr-row-driving')}
              onClick={() => handleWeekClick(monday)}
              onKeyDown={handleWeekKey}
              aria-pressed={isWeekMode}
              aria-label={`Неделя ${weekNum}, ${rangeLine} ${monthLine}. ${isWeekMode ? 'Данные считаются по этой неделе' : 'Считать данные по этой неделе'}`}
            >
              {body}
            </button>
          );
        }
        return (
          <div
            key={monday.toISOString()}
            className={clsx('wr-row', isEdge && 'wr-row-edge')}
          >
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Currency drum — тыс/млн vertical */
function CurrencyDrum({ value, onChange }: { value: string; onChange: (v: any) => void }) {
  return (
    <div className="vf-drum vf-drum-thin" title="Единицы измерения" role="group" aria-label="Единицы измерения сумм">
      {(['тыс', 'млн'] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          className={clsx('vf-btn vf-btn-sm', value === u && 'vf-cur-active')}
          title={u === 'тыс' ? 'Тысячи ₽' : 'Миллионы ₽'}
          aria-pressed={value === u}
          aria-label={u === 'тыс' ? 'Показывать суммы в тысячах рублей' : 'Показывать суммы в миллионах рублей'}
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
  // Честные счётчики корзин (п.73в): числа считает сервер теми же предикатами,
  // что страницы-фильтры; null (нет ответа) — кнопка живёт БЕЗ числа, ноль
  // не выдумывается.
  const bucketCounts = useStore((s) => s.bucketCounts);
  // Новые замечания, о которых сказал прямой эфир, но которых читатель ещё не
  // видел. Это НЕ счётчик всех замечаний (их сотни и на кнопке они бесполезны),
  // а прирост с последнего обновления данных: «пришло ещё три».
  const newIssues = useLiveEvents().newIssues;
  const countOf = (id: Page): number | null => {
    if (bucketCounts === null) return null;
    if (id === 'unfunded') return bucketCounts.unfunded;
    if (id === 'yearlong') return bucketCounts.yearlong;
    return null;
  };
  return (
    <nav className="nav-pills-wrap" aria-label="Навигация">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === activePage;
        const count = countOf(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setPage(item.id)}
            className={clsx('np-btn', isActive && 'np-btn-active')}
            style={{ '--np-color': item.color, '--np-color-light': item.colorLight } as React.CSSProperties}
            title={count !== null
              ? `${item.title ?? item.label} — ${count} строк во всех книгах на сейчас`
              : (item.title ?? item.label)}
            aria-current={isActive ? 'page' : undefined}
          >
            {/* Apple Intelligence rotating glow — only on active */}
            {isActive && <span className="np-glow" aria-hidden="true" />}
            <span className="np-content">
              <Icon size={10} strokeWidth={isActive ? 2.2 : 1.5} aria-hidden="true" />
              <span>{item.label}</span>
              {/* Прирост замечаний из прямого эфира — только на Контроле и
                  только пока он не отработан. Точка спокойная, без мигания. */}
              {item.id === 'quality' && newIssues > 0 && (
                <span
                  className="np-count tabular-nums"
                  aria-label={`новых замечаний: ${newIssues}`}
                  title={`С последнего обновления данных замечаний стало больше на ${newIssues}`}
                >
                  +{newIssues}
                </span>
              )}
              {count !== null && (
                <span
                  className="np-count tabular-nums"
                  aria-label={`${count} строк`}
                >
                  {count}
                </span>
              )}
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
    year,
    moneyUnit, setMoneyUnit,
    selectedMethods, toggleMethod, clearMethods,
    selectedActivities, toggleActivity,
    selectedBudgets, toggleBudget,
    searchQuery, setSearchQuery,
    resetAllFilters, selectedDepartments, selectedSubordinates,
    activeMonths, monthsByYear, periodMode,
  } = useStore();
  const { theme, toggleTheme } = useTheme();
  const { secondsLeft, isOnline } = useAutoRefresh();
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

  const activeCount = getActiveFilterCount({
    yearChanged: year !== new Date().getFullYear(),
    moneyUnitChanged: moneyUnit !== 'тыс',
    selectedMethods,
    selectedActivities,
    selectedBudgets,
    selectedDepartments,
    selectedSubordinates,
    activeMonths,
    monthsByYear,
    periodMode,
    searchQuery,
  });

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
        <div role="alert"
          className="px-4 py-1.5 bg-red-50/90 dark:bg-red-950/40 border-b border-red-200/60 dark:border-red-800/40 text-red-700 dark:text-red-300 text-[11px] flex items-center gap-2">
          <AlertTriangle size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{error}</span>
          <button type="button" onClick={() => useStore.getState().refresh()} className="ml-auto text-red-600 dark:text-red-400 font-semibold hover:underline shrink-0">Повторить</button>
        </div>
      )}
      {isDemo && !error && (
        <div role="status"
          className="px-4 py-1 bg-amber-50/80 dark:bg-amber-950/20 border-b border-amber-200/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 text-[10px] flex items-center gap-2">
          <AlertTriangle size={11} className="shrink-0" aria-hidden="true" /><span>Демо — Google Таблицы недоступны</span>
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
          <div className="time-machine" role="group" aria-label="Период">
            <WeekRoller />
            <TimeDrum />
          </div>
        )}

        {/* 4. Filter drums */}
        {showMethod && (
          <div className="vf-drum" role="group" aria-label="Способ закупки">
            {/* Симметрично кнопке ЕП: активный КП снимается, чужой выбор
                заменяется. Раньше клик по КП при активном ЕП ронял фильтр
                в «ВСЕ» вместо переключения. */}
            <button type="button" onClick={() => mAll ? toggleMethod('competitive') : (methods_has(selectedMethods, 'competitive') ? clearMethods() : (() => { clearMethods(); toggleMethod('competitive'); })())}
              className={clsx('vf-btn', !mAll && methods_has(selectedMethods, 'competitive') && 'vf-btn-active')}
              aria-pressed={!mAll && methods_has(selectedMethods, 'competitive')}
              aria-label="Конкурентные способы, статья 24 44-ФЗ"
              title="Конкурентные (44-ФЗ ст.24)">КП</button>
            <button type="button" onClick={() => mAll ? toggleMethod('single') : (selectedMethods.has('single') ? clearMethods() : (() => { clearMethods(); toggleMethod('single'); })())}
              className={clsx('vf-btn', !mAll && selectedMethods.has('single') && 'vf-btn-active')}
              aria-pressed={!mAll && selectedMethods.has('single')}
              aria-label="Единственный поставщик, статья 93 44-ФЗ"
              title="Единственный поставщик (44-ФЗ ст.93)">ЕП</button>
            <button type="button" onClick={() => clearMethods()}
              className={clsx('vf-btn', mAll && 'vf-cur-active')}
              aria-pressed={mAll}
              aria-label="Все способы закупки"
              title="Все способы">ВСЕ</button>
          </div>
        )}

        {showActivity && (() => {
          // Канон п.30 (интервью 14.08.2026): срез «ТД-ПМ» упразднён. Кнопки две —
          // ПМ и ТД; строки бывшего ТД-ПМ входят в ТД, поэтому кнопка ТД включает
          // и легаси-ключ current_program (он ещё живёт в сохранённых ссылках и
          // старых снимках) вместе с current_non_program — одним движением.
          const tdActive = !aAll && TD_ACTIVITY_KEYS.some((k) => selectedActivities.has(k));
          return (
            <div className="vf-drum" role="group" aria-label="Вид деятельности">
              <button type="button" onClick={() => toggleActivity('program')}
                className={clsx('vf-btn', !aAll && selectedActivities.has('program') && 'vf-btn-active')}
                aria-pressed={!aAll && selectedActivities.has('program')}
                aria-label="Программные мероприятия"
                title="Программные мероприятия">ПМ</button>
              <button type="button"
                onClick={() => TD_ACTIVITY_KEYS.forEach((k) => {
                  const on = selectedActivities.has(k);
                  if (tdActive ? on : !on) toggleActivity(k);
                })}
                className={clsx('vf-btn', tdActive && 'vf-btn-active')}
                aria-pressed={tdActive}
                aria-label="Текущая деятельность"
                title="Текущая деятельность (включая строки с заполненной графой программы)">ТД</button>
            </div>
          );
        })()}

        {showBudget && (
          <div className="vf-drum" role="group" aria-label="Источник финансирования">
            <button type="button" onClick={() => toggleBudget('fb' as BudgetType)}
              className={clsx('vf-btn vf-budget-fb', !bAll && selectedBudgets.has('fb') && 'vf-btn-active')}
              aria-pressed={!bAll && selectedBudgets.has('fb')}
              aria-label="Федеральный бюджет"
              title="Федеральный бюджет">ФБ</button>
            <button type="button" onClick={() => toggleBudget('kb' as BudgetType)}
              className={clsx('vf-btn vf-budget-kb', !bAll && selectedBudgets.has('kb') && 'vf-btn-active')}
              aria-pressed={!bAll && selectedBudgets.has('kb')}
              aria-label="Краевой бюджет"
              title="Краевой бюджет">КБ</button>
            <button type="button" onClick={() => toggleBudget('mb' as BudgetType)}
              className={clsx('vf-btn vf-budget-mb', !bAll && selectedBudgets.has('mb') && 'vf-btn-active')}
              aria-pressed={!bAll && selectedBudgets.has('mb')}
              aria-label="Муниципальный бюджет"
              title="Муниципальный бюджет">МБ</button>
          </div>
        )}

        {showMoney && (
          <CurrencyDrum value={moneyUnit} onChange={setMoneyUnit} />
        )}

        {/* Search */}
        {showSearch && (
          <div className="relative w-[100px] flex-shrink-0">
            <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
            <input type="text" placeholder="Поиск..." value={searchQuery}
              aria-label="Поиск по реестру закупок"
              onChange={(e) => setSearchQuery(e.target.value)}
              // Escape очищает поле, не уводя фокус: привычный жест поиска,
              // иначе строку приходится вычищать по символу.
              onKeyDown={(e) => { if (e.key === 'Escape' && searchQuery) { e.preventDefault(); setSearchQuery(''); } }}
              className={clsx('w-full pl-5 pr-5 py-[3px] rounded-md text-[10px] border transition-all bg-transparent',
                searchQuery ? 'border-blue-300 dark:border-transparent text-blue-700 dark:text-blue-300 bg-blue-50/50 dark:bg-blue-950/20'
                : 'border-zinc-200/60 dark:border-transparent text-zinc-600 dark:text-zinc-300 focus:border-blue-400')} />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')}
                aria-label="Очистить строку поиска"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition">
                <X size={9} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {/* Active filter chips — inline, pushes to the right */}
        <FilterBreadcrumb variant="inline" />

        {/* 5. Tools (right edge) — тема, сброс фильтров, узел провенанса */}
        <div className="nav-tools">
          <button type="button" onClick={toggleTheme} className="hf-icon-btn"
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}>
            {theme === 'dark' ? <Sun size={11} aria-hidden="true" /> : <Moon size={11} aria-hidden="true" />}
          </button>
          {activeCount > 0 && (
            <button type="button" onClick={resetAllFilters}
              className="hf-icon-btn group hover:text-red-500 hover:bg-red-50/80 dark:hover:bg-red-950/20"
              title="Сбросить все фильтры"
              aria-label={`Сбросить все фильтры (включено: ${activeCount})`}>
              <RotateCcw size={9} className="group-hover:rotate-[-180deg] transition-transform duration-300" aria-hidden="true" />
              <span aria-hidden="true" className="w-2.5 h-2.5 flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[6px] font-bold">{activeCount}</span>
            </button>
          )}
          {/* Провенанс и изменения — крайний правый угол линейки, справа от
              смены темы и снятия фильтров (канон п.133). Свёрнутый вид —
              одна тихая строка «обновлено …»; раскрытый отвечает разом на
              «откуда числа», «как они обновляются» и «что изменилось». */}
          <ProvenanceHub className="ml-1" />
        </div>
      </div>
    </header>
  );
}

/** Helper — check if a method is selected */
function methods_has(methods: Set<string>, key: string): boolean {
  return methods.has(key);
}
