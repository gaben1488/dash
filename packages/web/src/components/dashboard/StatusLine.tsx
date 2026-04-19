import { cn } from '@/lib/utils';
import { Wifi, WifiOff } from 'lucide-react';

interface StatusLineProps {
  lastRefreshed?: string;
  snapshotId?: string;
  cellsRead?: number;
  className?: string;
}

/**
 * Compact status indicator showing data freshness.
 * Replaces the old full-width status bar with a minimal, elegant chip.
 */
export function StatusLine({ lastRefreshed, snapshotId, cellsRead, className }: StatusLineProps) {
  const ts = lastRefreshed
    ? new Date(lastRefreshed).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : null;

  const sid = snapshotId?.slice(0, 8) ?? null;
  const cells = cellsRead?.toLocaleString('ru-RU') ?? null;
  const isConnected = !!ts;

  return (
    <div className={cn(
      'inline-flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500',
      className,
    )}>
      {/* Connection indicator */}
      <span className="relative flex items-center gap-1.5">
        {isConnected ? (
          <>
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <Wifi size={10} className="text-emerald-500/60" />
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
            <WifiOff size={10} className="text-zinc-400/60" />
          </>
        )}
      </span>

      {/* Timestamp */}
      {ts && (
        <span className="font-medium text-zinc-500 dark:text-zinc-400">{ts}</span>
      )}

      {/* Snapshot ID */}
      {sid && (
        <>
          <span className="text-zinc-300 dark:text-zinc-700">|</span>
          <span className="font-mono text-[10px] text-zinc-400/70 dark:text-zinc-600">
            #{sid}
          </span>
        </>
      )}

      {/* Cell count */}
      {cells && (
        <>
          <span className="text-zinc-300 dark:text-zinc-700">|</span>
          <span className="tabular-nums">{cells} ячеек</span>
        </>
      )}
    </div>
  );
}
