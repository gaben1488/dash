import { useStore } from '../store';
import { RefreshCw, Sun, Moon, AlertTriangle, ChevronDown, Menu, Zap } from 'lucide-react';
import clsx from 'clsx';
import { useState, useRef, useEffect } from 'react';
import { useTheme } from './ThemeProvider';
import { FilterBar } from './FilterBar';
import type { FilterGroup } from './FilterBar';

/** Page-specific filter group configuration */
const PAGE_FILTERS: Record<string, FilterGroup[]> = {
  dashboard:  ['period', 'currency', 'procurement', 'activity', 'budget', 'department', 'subordinate'],
  data:       ['period', 'currency', 'procurement', 'activity', 'budget', 'department', 'subordinate', 'search'],
  economy:    ['period', 'currency', 'procurement', 'activity', 'budget', 'department', 'subordinate'],
  analytics:  ['period', 'currency', 'procurement', 'activity', 'budget', 'department', 'subordinate'],
  quality:    ['period', 'procurement', 'activity', 'department', 'subordinate'],
  recon:      ['period', 'procurement', 'activity', 'department', 'subordinate'],
  trust:      ['period', 'procurement', 'activity', 'department', 'subordinate'],
  issues:     ['period', 'procurement', 'activity', 'department', 'subordinate', 'search'],
  recs:       ['period', 'procurement', 'activity', 'department', 'subordinate'],
  journal:    ['department'],
  settings:   [],
};

/** Page display names */
const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Сводная панель',
  data: 'Построчные данные',
  economy: 'Экономика',
  analytics: 'Аналитика',
  quality: 'Качество данных',
  recon: 'Сверка',
  trust: 'Доверие',
  issues: 'Замечания',
  recs: 'Рекомендации',
  journal: 'Журнал',
  settings: 'Настройки',
};

export function Header() {
  const { loading, refresh, quickRefresh, refreshResult, dashboardData, error, isDemo, page, toggleSidebar } = useStore();
  const { theme, toggleTheme } = useTheme();
  const trust = dashboardData?.trust;
  const filterGroups = PAGE_FILTERS[page] ?? [];
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60">
      {/* Error banner */}
      {error && (
        <div className="px-5 py-2 bg-red-50 dark:bg-red-950/40 border-b border-red-200/60 dark:border-red-800/40 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="truncate">{error}</span>
          <button onClick={() => refresh()} className="ml-auto text-red-600 dark:text-red-400 font-medium hover:underline shrink-0">Повторить</button>
        </div>
      )}
      {/* Demo banner */}
      {isDemo && !error && (
        <div className="px-5 py-1.5 bg-amber-50/80 dark:bg-amber-950/20 border-b border-amber-200/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
          <AlertTriangle size={13} className="shrink-0" />
          <span>Демо-режим — Google Таблицы недоступны, отображаются демонстрационные данные</span>
        </div>
      )}

      {/* Main bar */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Sidebar toggle */}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all duration-150 active:scale-95"
          title="Свернуть/развернуть меню"
        >
          <Menu size={18} />
        </button>

        {/* Page title */}
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 shrink-0 hidden md:block">
          {PAGE_TITLES[page] ?? page}
        </h2>

        {/* Separator */}
        {filterGroups.length > 0 && (
          <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1 hidden md:block" />
        )}

        {/* FilterBar */}
        {filterGroups.length > 0 ? (
          <FilterBar groups={filterGroups} />
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex-1" />

        {/* Right side controls */}
        <div className="flex items-center gap-1.5">
          {/* Trust badge - compact */}
          {trust && (
            <div className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-colors',
              trust.grade === 'A' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
              trust.grade === 'B' && 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
              trust.grade === 'C' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
              trust.grade === 'D' && 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
              trust.grade === 'F' && 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
            )}>
              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
              {trust.grade} {trust.overall}%
            </div>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all duration-150 active:scale-95"
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Refresh button with dropdown */}
          <div className="relative" ref={menuRef}>
            <div className="flex">
              <button
                onClick={() => { refresh(); setShowMenu(false); }}
                disabled={loading}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-l-lg transition-all duration-200',
                  'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'shadow-sm shadow-blue-600/25 hover:shadow-md hover:shadow-blue-600/30',
                  'active:scale-[0.97]',
                )}
              >
                <RefreshCw size={13} className={clsx('transition-transform', loading && 'animate-spin')} />
                <span className="hidden sm:inline">Обновить</span>
              </button>
              <button
                onClick={() => setShowMenu(!showMenu)}
                disabled={loading}
                className={clsx(
                  'flex items-center px-1.5 py-1.5 text-white rounded-r-lg transition-all duration-200',
                  'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'border-l border-blue-400/30',
                )}
              >
                <ChevronDown size={12} className={clsx('transition-transform duration-200', showMenu && 'rotate-180')} />
              </button>
            </div>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-zinc-200/80 dark:border-zinc-700/80 py-1 z-50 min-w-[220px] animate-in fade-in-0 slide-in-from-top-2 duration-150">
                <button
                  onClick={() => { refresh(); setShowMenu(false); }}
                  className="w-full text-left px-3 py-2.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700/50 text-zinc-700 dark:text-zinc-200 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <RefreshCw size={13} className="text-blue-500 group-hover:rotate-45 transition-transform duration-300" />
                    <div>
                      <div className="font-semibold">Полное обновление</div>
                      <div className="text-zinc-400 dark:text-zinc-500 mt-0.5">СВОД + 8 управлений + ШДЮ</div>
                    </div>
                  </div>
                </button>
                <div className="mx-3 border-t border-zinc-100 dark:border-zinc-700/50" />
                <button
                  onClick={() => { quickRefresh(); setShowMenu(false); }}
                  className="w-full text-left px-3 py-2.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700/50 text-zinc-700 dark:text-zinc-200 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <Zap size={13} className="text-amber-500 group-hover:scale-110 transition-transform duration-200" />
                    <div>
                      <div className="font-semibold">Быстрая проверка</div>
                      <div className="text-zinc-400 dark:text-zinc-500 mt-0.5">Только СВОД (без перезагрузки)</div>
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
