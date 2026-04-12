import { useStore, type Page } from '../store';
import {
  LayoutDashboard, BarChart3, ShieldCheck,
  Settings, Table2, Coins,
  BookOpen,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import { useState, useRef, useEffect, useCallback } from 'react';

/* ─── Types ─────────────────────────────────────────────────────── */

interface NavItem {
  id: Page;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: 'new' | number;
}

/* ─── Nav data ──────────────────────────────────────────────────── */

const NAV_MAIN: NavItem[] = [
  { id: 'dashboard', label: 'Сводная панель', icon: LayoutDashboard },
  { id: 'data', label: 'Построчные данные', icon: Table2 },
  { id: 'economy', label: 'Экономика', icon: Coins },
  { id: 'analytics', label: 'Аналитика', icon: BarChart3 },
];

const NAV_CONTROL: NavItem[] = [
  { id: 'quality', label: 'Качество данных', icon: ShieldCheck },
];

const NAV_SYSTEM: NavItem[] = [
  { id: 'journal', label: 'Журнал', icon: BookOpen },
  { id: 'settings', label: 'Настройки', icon: Settings },
];

/* ─── Tooltip (collapsed mode) ──────────────────────────────────── */

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
          <div className="ml-[62px] px-2.5 py-1.5 text-xs font-medium text-white bg-zinc-800 dark:bg-zinc-700 rounded-lg shadow-lg whitespace-nowrap">
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
          collapsed ? 'absolute top-1.5 right-1.5' : 'ml-auto',
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

/* ─── Gradient divider ──────────────────────────────────────────── */

function SectionDivider() {
  return (
    <div className="px-3 my-2.5">
      <div className="h-px bg-gradient-to-r from-transparent via-zinc-300 dark:via-zinc-700 to-transparent" />
    </div>
  );
}

/* ─── NavSection ────────────────────────────────────────────────── */

function NavSection({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  const { page, setPage } = useStore();
  const [hoveredId, setHoveredId] = useState<Page | null>(null);

  return (
    <div className="space-y-0.5">
      {items.map((item) => {
        const isActive = page === item.id;
        const isHovered = hoveredId === item.id;
        const Icon = item.icon;

        const button = (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId(null)}
            className={clsx(
              'group relative w-full flex items-center transition-all duration-200 rounded-xl',
              collapsed
                ? 'justify-center px-0 py-2.5 mx-auto'
                : 'gap-2.5 px-3 py-2 text-[13px]',
              /* Active state */
              isActive && !collapsed &&
                'bg-gradient-to-r from-blue-600 to-indigo-500 text-white font-semibold shadow-lg shadow-blue-600/20',
              isActive && collapsed &&
                'text-blue-500 dark:text-blue-400',
              /* Inactive state */
              !isActive &&
                'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100/60 dark:hover:bg-white/5',
            )}
          >
            {/* Active left accent bar */}
            {isActive && (
              <span
                className={clsx(
                  'absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-blue-500 transition-all duration-300',
                  collapsed ? 'h-5' : 'h-6',
                )}
              />
            )}

            {/* Icon with glow + scale */}
            <span
              className={clsx(
                'relative flex-shrink-0 flex items-center justify-center transition-transform duration-200',
                !isActive && 'group-hover:scale-105',
                isActive && 'sidebar-icon-pulse',
              )}
            >
              {/* Glow layer behind active icon */}
              {isActive && (
                <span className="absolute inset-0 rounded-full bg-blue-400/20 dark:bg-blue-400/15 blur-md scale-150" />
              )}
              <Icon
                size={collapsed ? 20 : 17}
                strokeWidth={isActive ? 2.2 : 1.7}
                className="relative z-10"
              />
            </span>

            {/* Label */}
            {!collapsed && (
              <span className="truncate">{item.label}</span>
            )}

            {/* Badge */}
            <NavBadge badge={item.badge} collapsed={collapsed} />
          </button>
        );

        /* Wrap in tooltip when collapsed */
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

/* ─── Main Sidebar ──────────────────────────────────────────────── */

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useStore();

  /* Inject keyframes once */
  useInjectStyles();

  return (
    <aside
      className={clsx(
        'flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden',
        /* Frosted glass */
        'backdrop-blur-xl bg-white/70 dark:bg-zinc-900/70',
        'border-r border-zinc-200/50 dark:border-zinc-800/50',
        sidebarCollapsed ? 'w-[60px]' : 'w-60',
      )}
    >
      {/* ── Logo / Header ──────────────────────────────────────── */}
      <div
        className={clsx(
          'border-b border-zinc-200/30 dark:border-zinc-800/30 transition-all duration-300 flex-shrink-0',
          sidebarCollapsed ? 'p-3 flex items-center justify-center' : 'px-4 py-4',
        )}
      >
        {sidebarCollapsed ? (
          <div
            className="sidebar-logo-badge w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/25"
            title="АЕМР"
          >
            <span className="text-sm font-bold text-white select-none">А</span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="sidebar-logo-badge w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/25 flex-shrink-0">
              <span className="text-sm font-bold text-white select-none">А</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-[13px] font-bold text-zinc-900 dark:text-white tracking-[0.08em] truncate leading-tight">
                АЕМР
              </h1>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate leading-tight mt-0.5">
                Мониторинг закупок
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Navigation ─────────────────────────────────────────── */}
      <nav
        className={clsx(
          'flex-1 overflow-y-auto transition-all duration-300',
          sidebarCollapsed ? 'px-1.5 py-3' : 'px-2 py-3',
        )}
      >
        <NavSection items={NAV_MAIN} collapsed={sidebarCollapsed} />
        <SectionDivider />
        <NavSection items={NAV_CONTROL} collapsed={sidebarCollapsed} />
        <SectionDivider />
        <NavSection items={NAV_SYSTEM} collapsed={sidebarCollapsed} />
      </nav>

      {/* ── Bottom area ────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-zinc-200/30 dark:border-zinc-800/30">
        {/* Version */}
        {!sidebarCollapsed && (
          <div className="px-4 pt-3">
            <span className="text-[10px] font-mono tracking-wider bg-gradient-to-r from-zinc-300 to-zinc-400 dark:from-zinc-500 dark:to-zinc-600 bg-clip-text text-transparent select-none">
              v2.0
            </span>
          </div>
        )}

        {/* Collapse toggle */}
        <div
          className={clsx(
            'flex py-2.5',
            sidebarCollapsed ? 'justify-center px-2' : 'justify-end px-3',
          )}
        >
          <button
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Развернуть' : 'Свернуть'}
            className={clsx(
              'p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300',
              'hover:bg-zinc-100/60 dark:hover:bg-white/5 transition-all duration-200',
            )}
          >
            <span
              className="block transition-transform duration-300"
              style={{
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

/* ─── Inject CSS keyframes (once) ───────────────────────────────── */

let stylesInjected = false;

function useInjectStyles() {
  const inject = useCallback(() => {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
      /* Animated gradient badge */
      .sidebar-logo-badge {
        background: linear-gradient(135deg, #2563eb, #6366f1, #2563eb);
        background-size: 200% 200%;
        animation: sidebar-gradient-shift 4s ease-in-out infinite;
      }

      @keyframes sidebar-gradient-shift {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }

      /* Subtle pulse on active icon */
      .sidebar-icon-pulse {
        animation: sidebar-pulse 2.5s ease-in-out infinite;
      }

      @keyframes sidebar-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.85; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    inject();
  }, [inject]);
}
