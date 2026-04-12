import { AlertTriangle, ChevronRight } from 'lucide-react';

interface CriticalBannerProps {
  criticalCount: number;
  warningCount: number;
  onNavigate: () => void;
}

/**
 * Red/amber banner at top of Dashboard.
 * Shows critical issues count + click navigates to Quality > Issues (severity=critical).
 * Persona: Сергей (★), Виктор (★★★) — "Мы в нормативном коридоре?"
 */
export function CriticalBanner({ criticalCount, warningCount, onNavigate }: CriticalBannerProps) {
  if (criticalCount === 0 && warningCount === 0) return null;

  const isCritical = criticalCount > 0;
  const bgClass = isCritical
    ? 'bg-gradient-to-r from-red-600 to-red-500 dark:from-red-700 dark:to-red-600'
    : 'bg-gradient-to-r from-amber-500 to-amber-400 dark:from-amber-600 dark:to-amber-500';

  return (
    <button
      onClick={onNavigate}
      className={`${bgClass} w-full rounded-xl px-5 py-3 flex items-center justify-between text-white shadow-lg hover:opacity-95 transition-opacity group`}
    >
      <div className="flex items-center gap-3">
        <AlertTriangle size={20} className="flex-shrink-0" />
        <div className="text-left">
          <span className="font-semibold text-sm">
            {isCritical
              ? `${criticalCount} критических замечаний`
              : `${warningCount} предупреждений`
            }
          </span>
          {isCritical && warningCount > 0 && (
            <span className="text-xs opacity-80 ml-2">
              + {warningCount} предупреждений
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs opacity-80 group-hover:opacity-100 transition">
        <span>Подробнее</span>
        <ChevronRight size={14} />
      </div>
    </button>
  );
}
