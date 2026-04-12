/**
 * Theme-aware color palettes for Recharts.
 * Returns colors that work in both light and dark modes.
 */

/** Main categorical palette — 8 colors */
const LIGHT_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

const DARK_PALETTE = [
  '#60a5fa', '#34d399', '#fbbf24', '#f87171',
  '#a78bfa', '#f472b6', '#22d3ee', '#fb923c',
];

export function getChartColors(isDark: boolean): string[] {
  return isDark ? DARK_PALETTE : LIGHT_PALETTE;
}

export function getChartColor(index: number, isDark: boolean): string {
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
  return palette[index % palette.length];
}

/** Severity colors */
export function getSeverityColor(severity: string, isDark: boolean): string {
  const map: Record<string, [string, string]> = {
    critical: ['#ef4444', '#f87171'],
    significant: ['#f97316', '#fb923c'],
    warning: ['#f59e0b', '#fbbf24'],
    info: ['#94a3b8', '#64748b'],
  };
  const pair = map[severity] ?? map.info!;
  return isDark ? pair[1] : pair[0];
}

/** Positive/negative colors for economy, execution bars */
export function getPositiveColor(isDark: boolean): string {
  return isDark ? '#34d399' : '#10b981';
}

export function getNegativeColor(isDark: boolean): string {
  return isDark ? '#f87171' : '#ef4444';
}

/** Tooltip/grid styling */
export function getTooltipStyle(isDark: boolean) {
  return {
    contentStyle: {
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      borderRadius: '8px',
      fontSize: '12px',
      color: isDark ? '#e2e8f0' : '#334155',
    },
  };
}

export function getGridColor(isDark: boolean): string {
  return isDark ? '#334155' : '#e2e8f0';
}

export function getAxisColor(isDark: boolean): string {
  return isDark ? '#94a3b8' : '#64748b';
}

// ── Centralized execution % color functions ──

/** Bar fill color for execution charts (4-tier: red / amber / green / purple) */
export function getExecutionBarColor(pct: number, isDark: boolean): string {
  if (pct > 100) return isDark ? '#a78bfa' : '#8b5cf6';
  if (pct < 50) return getNegativeColor(isDark);
  if (pct < 80) return isDark ? '#fbbf24' : '#f59e0b';
  return getPositiveColor(isDark);
}

/** Tailwind text color class for execution % (3-tier) */
export function getExecutionTextClass(pct: number | null): string {
  if (pct === null) return 'text-zinc-500';
  if (pct >= 90) return 'text-emerald-400';
  if (pct >= 70) return 'text-amber-400';
  return 'text-red-400';
}

/** Tailwind bg class for execution progress bars */
export function getExecutionBarClass(pct: number): string {
  if (pct >= 90) return 'bg-emerald-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-red-500';
}

/** Heatmap background color for execution % */
export function getExecutionHeatBg(v: number | null, isDark: boolean): string {
  if (v === null || v === 0) return isDark ? '#1e293b' : '#f1f5f9';
  if (v < 50) return isDark ? '#450a0a' : '#fecaca';
  if (v < 80) return isDark ? '#422006' : '#fef08a';
  return isDark ? '#052e16' : '#bbf7d0';
}

/** Heatmap text color for execution % */
export function getExecutionHeatText(v: number | null, isDark: boolean): string {
  if (v === null || v === 0) return isDark ? '#64748b' : '#94a3b8';
  if (v < 50) return isDark ? '#fca5a5' : '#991b1b';
  if (v < 80) return isDark ? '#fde047' : '#854d0e';
  return isDark ? '#86efac' : '#166534';
}
