import { cn } from '@/lib/utils';

/** Shimmer animation overlay for skeleton cards */
function Shimmer({ className }: { className?: string }) {
  return (
    <div className={cn('absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite]', className)}>
      <div className="h-full w-1/2 bg-gradient-to-r from-transparent via-white/20 dark:via-white/5 to-transparent" />
    </div>
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900 p-5', className)}>
      <Shimmer />
      <div className="h-2.5 w-20 bg-zinc-200/80 dark:bg-zinc-700/60 rounded-md mb-4" />
      <div className="h-8 w-24 bg-zinc-200/80 dark:bg-zinc-700/60 rounded-lg mb-3" />
      <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800/60 rounded-full mb-2" />
      <div className="flex items-center gap-2 mt-3">
        <div className="h-2 w-14 bg-zinc-100 dark:bg-zinc-800/60 rounded-md" />
        <div className="h-6 w-16 bg-zinc-100 dark:bg-zinc-800/40 rounded-md" />
      </div>
    </div>
  );
}

export function SkeletonKPIRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900 p-5">
      <Shimmer />
      <div className="h-2.5 w-32 bg-zinc-200/80 dark:bg-zinc-700/60 rounded-md mb-5" />
      <div className="h-52 bg-zinc-50 dark:bg-zinc-800/30 rounded-xl flex items-end gap-2 p-4">
        {[40, 65, 50, 80, 55, 70, 45].map((h, i) => (
          <div
            key={i}
            className="flex-1 bg-zinc-200/60 dark:bg-zinc-700/40 rounded-t-md transition-all"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900 p-5">
      <Shimmer />
      <div className="h-2.5 w-36 bg-zinc-200/80 dark:bg-zinc-700/60 rounded-md mb-4" />
      {/* Header row */}
      <div className="flex gap-4 pb-3 border-b border-zinc-200/60 dark:border-zinc-700/40 mb-2">
        {[24, 80, 48, 48, 48, 64, 48, 40].map((w, i) => (
          <div key={i} className="h-2 bg-zinc-200/60 dark:bg-zinc-700/40 rounded" style={{ width: w }} />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-2.5 border-b border-zinc-100/50 dark:border-zinc-800/30">
          {[24, 80, 48, 48, 48, 64, 48, 40].map((w, j) => (
            <div
              key={j}
              className="h-2 bg-zinc-100 dark:bg-zinc-800/40 rounded"
              style={{ width: w, opacity: 1 - (i * 0.08) }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonDeptGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="relative overflow-hidden rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900 p-4">
          <Shimmer />
          <div className="flex items-center gap-2 mb-3">
            <div className="w-4 h-4 bg-zinc-200/80 dark:bg-zinc-700/60 rounded" />
            <div className="h-3 w-16 bg-zinc-200/80 dark:bg-zinc-700/60 rounded-md" />
          </div>
          <div className="h-8 w-16 bg-zinc-200/80 dark:bg-zinc-700/60 rounded-lg mb-3" />
          <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800/60 rounded-full mb-3" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-2.5 bg-zinc-100 dark:bg-zinc-800/40 rounded-md" />
            <div className="h-2.5 bg-zinc-100 dark:bg-zinc-800/40 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
