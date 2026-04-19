import { useStore, type Page } from '../store';
import {
  Gauge, TrendingUp, ShieldCheck,
  Settings, Table2, Coins,
  ChevronLeft, ChevronRight,
  Wifi, WifiOff,
} from 'lucide-react';
import clsx from 'clsx';
import { useState, useRef, useEffect, useMemo } from 'react';

/* ─── Types ─────────────────────────────────────────────────────── */

interface NavItem {
  id: Page;
  label: string;
  icon: typeof Gauge;
  badge?: 'new' | number;
}

/* ─── Nav data (flat list, no sections — 6 items don't need grouping) ── */

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Пульт', icon: Gauge },
  { id: 'data', label: 'Реестр', icon: Table2 },
  { id: 'economy', label: 'Экономия', icon: Coins },
  { id: 'quality', label: 'Контроль', icon: ShieldCheck },
  { id: 'analytics', label: 'Аналитика', icon: TrendingUp },
  { id: 'settings', label: 'Система', icon: Settings },
];

/* ─── Easing constant ─────────────────────────────────────────── */

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/* ─── Tooltip (collapsed mode) ────────────────────────────────── */

function Tooltip({
  children,
  label,
  show,
}: {
  children: React.ReactNode;
  label: string;
  show: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0 });

  useEffect(() => {
    if (show && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.top + rect.height / 2 });
    }
  }, [show]);

  return (
    <div ref={ref} className="relative">
      {children}
      {show && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ top: pos.top, transform: 'translateY(-50%)' }}
        >
          <div className="ml-[60px] px-3 py-1.5 text-[11px] font-semibold text-white bg-zinc-800 dark:bg-zinc-700 rounded-lg shadow-xl whitespace-nowrap tracking-wide">
            {label}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Badge ─────────────────────────────────────────────────────── */

function NavBadge({ badge, collapsed }: { badge?: 'new' | number; collapsed: boolean }) {
  if (!badge) return null;

  if (badge === 'new') {
    return (
      <span
        className={clsx(
          'w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-900 flex-shrink-0',
          collapsed ? 'absolute top-1 right-1' : 'ml-auto',
        )}
      />
    );
  }

  return (
    <span
      className={clsx(
        'text-[10px] font-bold leading-none bg-blue-500 text-white rounded-full flex-shrink-0 flex items-center justify-center',
        collapsed
          ? 'absolute -top-0.5 -right-0.5 w-4 h-4'
          : 'ml-auto px-1.5 py-0.5 min-w-[18px]',
      )}
    >
      {badge}
    </span>
  );
}

/* ─── NavList (flat, no sections) ────────────────────────────────── */

function NavList({ collapsed }: { collapsed: boolean }) {
  const { page, setPage } = useStore();
  const [hoveredId, setHoveredId] = useState<Page | null>(null);

  // Map legacy page IDs to their parent for active state
  const activePage = (() => {
    switch (page) {
      case 'recon': case 'trust': case 'issues': case 'recs': case 'journal':
        return 'quality';
      default:
        return page;
    }
  })();

  return (
    <div className="space-y-0.5 px-2">
      {NAV_ITEMS.map((item) => {
        const isActive = activePage === item.id;
        const isHovered = hoveredId === item.id;
        const Icon = item.icon;

        const button = (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ transition: `all 0.25s ${EASE}` }}
            className={clsx(
              'group relative w-full flex items-center rounded-xl',
              collapsed
                ? 'justify-center p-2'
                : 'gap-2.5 px-2.5 py-2 text-[13px]',
              isActive && !collapsed &&
                'sidebar-active-bg text-white font-semibold',
              isActive && collapsed &&
                'sidebar-active-bg-collapsed text-blue-600 dark:text-blue-400',
              !isActive &&
                'text-zinc-500 dark:text-zinc-400',
              !isActive &&
                'hover:bg-zinc-100/70 dark:hover:bg-white/[0.04]',
            )}
          >
            <span
              className={clsx(
                'sidebar-icon-circle relative flex-shrink-0',
                isActive && !collapsed && 'sidebar-icon-circle-active',
                isActive && collapsed && 'sidebar-icon-circle-collapsed-active',
                !isActive && 'sidebar-icon-circle-inactive',
                !isActive && isHovered && '!bg-zinc-200/60 dark:!bg-zinc-700/40',
                isActive && 'sidebar-icon-pulse',
              )}
              style={{ transition: `all 0.25s ${EASE}` }}
            >
              {isActive && (
                <span className="absolute inset-0 rounded-full bg-blue-400/20 dark:bg-blue-400/10 blur-lg scale-[1.6]" />
              )}
              <Icon
                size={collapsed ? 19 : 16}
                strokeWidth={isActive ? 2.2 : 1.7}
                className="relative z-10"
              />
            </span>

            {!collapsed && (
              <span
                className={clsx(
                  'truncate',
                  !isActive && 'group-hover:translate-x-0.5 group-hover:text-zinc-800 dark:group-hover:text-zinc-100',
                )}
                style={{ transition: `all 0.2s ${EASE}` }}
              >
                {item.label}
              </span>
            )}

            <NavBadge badge={item.badge} collapsed={collapsed} />
          </button>
        );

        if (collapsed) {
          return (
            <Tooltip key={item.id} label={item.label} show={isHovered}>
              {button}
            </Tooltip>
          );
        }

        return <div key={item.id}>{button}</div>;
      })}
    </div>
  );
}

/* ─── Status indicator ────────────────────────────────────────── */

function StatusIndicator({ collapsed }: { collapsed: boolean }) {
  const { lastRefreshed, loading, error } = useStore();

  const formattedTime = useMemo(() => {
    if (!lastRefreshed) return null;
    try {
      const d = new Date(lastRefreshed);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return null;
    }
  }, [lastRefreshed]);

  const isOnline = !error;

  if (collapsed) {
    return (
      <div className="flex justify-center py-2">
        <div
          className={clsx(
            'sidebar-status-dot',
            isOnline ? 'bg-emerald-500' : 'bg-red-400',
          )}
          title={isOnline ? 'Подключено' : 'Ошибка связи'}
        />
      </div>
    );
  }

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <div
          className={clsx(
            'sidebar-status-dot flex-shrink-0',
            loading ? 'bg-amber-400' : isOnline ? 'bg-emerald-500' : 'bg-red-400',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isOnline ? (
              <Wifi size={11} className="text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
            ) : (
              <WifiOff size={11} className="text-red-400 flex-shrink-0" />
            )}
            <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 truncate">
              {loading ? 'Обновление...' : isOnline ? 'Подключено' : 'Нет связи'}
            </span>
          </div>
          {formattedTime && !loading && (
            <span className="text-[9px] text-zinc-400/70 dark:text-zinc-600 font-mono tabular-nums">
              {formattedTime}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Shield Logo Mark (SVG) ───────────────────────────────────── */

/**
 * SVOD verification shield — 3 data-node constellation inside shield outline.
 * Nodes connected by lines = verified data network. Shield = trust & authority.
 * NOT a letter-in-square. Unique geometric mark that works at any size.
 */
function ShieldMark({ size = 36 }: { size?: number }) {
  const s = size;
  const p = s * 0.18; // padding inside mark
  const cx = s / 2;
  const cy = s / 2;

  // Shield path (rounded, tapered bottom)
  const shieldD = `
    M ${cx} ${p * 0.6}
    C ${cx + s * 0.32} ${p * 0.6} ${s - p * 0.8} ${s * 0.18} ${s - p * 0.8} ${s * 0.32}
    L ${s - p * 0.8} ${s * 0.52}
    C ${s - p * 0.8} ${s * 0.7} ${cx + s * 0.12} ${s * 0.85} ${cx} ${s - p * 0.5}
    C ${cx - s * 0.12} ${s * 0.85} ${p * 0.8} ${s * 0.7} ${p * 0.8} ${s * 0.52}
    L ${p * 0.8} ${s * 0.32}
    C ${p * 0.8} ${s * 0.18} ${cx - s * 0.32} ${p * 0.6} ${cx} ${p * 0.6}
    Z
  `;

  // Three constellation nodes (triangle formation)
  const nodes = [
    { x: cx, y: s * 0.26 },         // top — "source"
    { x: s * 0.28, y: s * 0.58 },   // bottom-left — "verified"
    { x: s * 0.72, y: s * 0.58 },   // bottom-right — "output"
  ];

  // Center convergence point (smaller, where lines meet)
  const center = { x: cx, y: s * 0.47 };

  const nodeR = s * 0.065;
  const centerR = s * 0.038;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Shield outline — subtle, not heavy */}
      <path
        d={shieldD}
        stroke="rgba(255,255,255,0.55)"
        strokeWidth={s * 0.035}
        strokeLinejoin="round"
        fill="none"
      />

      {/* Connection lines — node→center (data flow) */}
      {nodes.map((n, i) => (
        <line
          key={i}
          x1={n.x} y1={n.y}
          x2={center.x} y2={center.y}
          stroke="rgba(59,130,246,0.5)"
          strokeWidth={s * 0.025}
          strokeLinecap="round"
        />
      ))}

      {/* Outer ring on nodes — glow effect */}
      {nodes.map((n, i) => (
        <circle
          key={`glow-${i}`}
          cx={n.x} cy={n.y}
          r={nodeR * 2.5}
          fill="rgba(59,130,246,0.15)"
        />
      ))}

      {/* Data nodes */}
      {nodes.map((n, i) => (
        <circle
          key={`node-${i}`}
          cx={n.x} cy={n.y}
          r={nodeR}
          fill="rgba(255,255,255,0.9)"
        />
      ))}

      {/* Center convergence */}
      <circle
        cx={center.x} cy={center.y}
        r={centerR}
        fill="rgba(59,130,246,0.85)"
      />

      {/* Checkmark inside shield bottom — verification complete */}
      <polyline
        points={`${cx - s * 0.08},${s * 0.68} ${cx - s * 0.02},${s * 0.74} ${cx + s * 0.1},${s * 0.62}`}
        stroke="rgba(16,185,129,0.9)"
        strokeWidth={s * 0.04}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/* ─── Main Sidebar ──────────────────────────────────────────────── */

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useStore();

  return (
    <aside
      style={{ transition: `width 0.3s ${EASE}` }}
      className={clsx(
        'flex flex-col flex-shrink-0 overflow-hidden',
        'backdrop-blur-xl bg-white/75 dark:bg-zinc-900/75',
        'border-r border-zinc-200/40 dark:border-zinc-800/40',
        sidebarCollapsed ? 'w-[56px]' : 'w-[200px]',
      )}
    >
      {/* ── Logo / Header ──────────────────────────────────────── */}
      <div
        style={{ transition: `all 0.3s ${EASE}` }}
        className={clsx(
          'border-b border-zinc-200/20 dark:border-zinc-800/20 flex-shrink-0',
          sidebarCollapsed ? 'p-3 flex items-center justify-center' : 'px-4 py-4',
        )}
      >
        {sidebarCollapsed ? (
          <div
            className="sidebar-logo-mark w-9 h-9 flex items-center justify-center cursor-pointer"
            title="СВОД — Система верификации и отчётности данных"
          >
            <ShieldMark size={32} />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="sidebar-logo-mark w-9 h-9 flex items-center justify-center flex-shrink-0 cursor-pointer">
              <ShieldMark size={32} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[13px] font-bold text-zinc-900 dark:text-white tracking-[0.12em] truncate leading-tight uppercase">
                СВОД
              </h1>
              <p className="text-[9.5px] text-zinc-400 dark:text-zinc-500 truncate leading-tight mt-0.5 tracking-wide">
                Верификация данных
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Navigation ─────────────────────────────────────────── */}
      <nav
        style={{ transition: `padding 0.3s ${EASE}` }}
        className={clsx(
          'flex-1 overflow-y-auto',
          sidebarCollapsed ? 'py-3' : 'py-2',
        )}
      >
        <NavList collapsed={sidebarCollapsed} />
      </nav>

      {/* ── Bottom area ────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-zinc-200/20 dark:border-zinc-800/20">
        {/* Status indicator */}
        <StatusIndicator collapsed={sidebarCollapsed} />

        {/* Version + toggle row */}
        <div
          className={clsx(
            'flex items-center py-2',
            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3',
          )}
        >
          {!sidebarCollapsed && (
            <span className="text-[10px] font-mono tracking-wider bg-gradient-to-r from-zinc-300 to-zinc-400 dark:from-zinc-600 dark:to-zinc-500 bg-clip-text text-transparent select-none">
              v3.0
            </span>
          )}

          <button
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Развернуть' : 'Свернуть'}
            style={{ transition: `all 0.2s ${EASE}` }}
            className={clsx(
              'p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300',
              'hover:bg-zinc-100/60 dark:hover:bg-white/5',
            )}
          >
            <span
              className="block"
              style={{
                transition: `transform 0.3s ${EASE}`,
                transform: sidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
              }}
            >
              <ChevronRight size={15} />
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
