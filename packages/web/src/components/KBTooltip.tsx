import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Info, ExternalLink } from 'lucide-react';
import { SVOD_SPREADSHEET_ID } from '@aemr/shared';

/* ─── Types ─── */

export interface KBEntry {
  /** Human-readable formula, e.g. "fact_count / plan_count × 100" */
  formula?: string;
  /** CalcEngine field / API source, e.g. "CalcEngine → byQuarter[q1].exec_count_pct" */
  source?: string;
  /** Spreadsheet cell reference, e.g. "СВОД ТД-ПМ!G14" */
  cell?: string;
  /** Threshold description, e.g. "≥80% зелёный, ≥50% жёлтый, <50% красный" */
  thresholds?: string;
  /** Legal reference, e.g. "44-ФЗ ст.72 — планирование закупок" */
  law?: string;
  /** Additional note */
  note?: string;
}

interface KBTooltipProps {
  /** Tooltip content — either a KBEntry object or a pre-built ReactNode */
  kb: KBEntry | string;
  /** The element to wrap with tooltip trigger */
  children: ReactNode;
  /** Position preference */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Show the (i) icon inline next to children */
  showIcon?: boolean;
  /** Custom class for wrapper */
  className?: string;
}

/* ─── Helpers ─── */

function buildSheetUrl(cell?: string): string {
  let url = `https://docs.google.com/spreadsheets/d/${SVOD_SPREADSHEET_ID}/edit`;
  if (cell) {
    const cleanCell = cell.replace(/^[^!]*!/, ''); // strip "СВОД ТД-ПМ!" prefix
    url += `#gid=0&range=${cleanCell}`;
  }
  return url;
}

/* ─── Component ─── */

/**
 * Universal KB tooltip.
 * Shows formula, source, cell reference, thresholds, and legal basis on hover.
 * Attach to ANY interactive UI element per design principle #6/#13.
 */
export function KBTooltip({ kb, children, position = 'top', showIcon = false, className }: KBTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), 200);
  };

  const hide = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 150);
  };

  // Position tooltip when visible
  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();
    const pad = 8;

    let top = 0;
    let left = 0;

    switch (position) {
      case 'bottom':
        top = trigger.bottom + pad;
        left = trigger.left + trigger.width / 2 - tooltip.width / 2;
        break;
      case 'left':
        top = trigger.top + trigger.height / 2 - tooltip.height / 2;
        left = trigger.left - tooltip.width - pad;
        break;
      case 'right':
        top = trigger.top + trigger.height / 2 - tooltip.height / 2;
        left = trigger.right + pad;
        break;
      default: // top
        top = trigger.top - tooltip.height - pad;
        left = trigger.left + trigger.width / 2 - tooltip.width / 2;
    }

    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - tooltip.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - tooltip.height - 8));

    setCoords({ top, left });
  }, [visible, position]);

  // Cleanup timer on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const entry: KBEntry = typeof kb === 'string' ? { note: kb } : kb;
  const hasContent = entry.formula || entry.source || entry.cell || entry.thresholds || entry.law || entry.note;

  if (!hasContent) return <>{children}</>;

  return (
    <div
      ref={triggerRef}
      className={`inline-flex items-center gap-0.5 ${className ?? ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {showIcon && (
        <Info size={11} className="text-zinc-400 dark:text-zinc-500 shrink-0 opacity-60 hover:opacity-100 transition-opacity" />
      )}

      {visible && (
        <div
          ref={tooltipRef}
          className="fixed z-[9999] pointer-events-auto"
          style={coords ? { top: coords.top, left: coords.left } : { opacity: 0 }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <div className="bg-zinc-900 dark:bg-zinc-800 text-zinc-100 rounded-lg shadow-xl border border-zinc-700/50 px-3 py-2.5 max-w-xs text-[11px] font-mono leading-relaxed space-y-1">
            {entry.formula && (
              <Row label="Формула" value={entry.formula} />
            )}
            {entry.source && (
              <Row label="Источник" value={entry.source} />
            )}
            {entry.cell && (
              <div className="flex items-start gap-1.5">
                <span className="text-zinc-400 shrink-0">Ячейка:</span>
                <span className="text-blue-300">{entry.cell}</span>
                <button
                  className="p-0.5 rounded hover:bg-zinc-700 transition-colors shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(buildSheetUrl(entry.cell), '_blank');
                  }}
                  title="Открыть в Google Sheets"
                >
                  <ExternalLink size={10} className="text-blue-400" />
                </button>
              </div>
            )}
            {entry.thresholds && (
              <Row label="Пороги" value={entry.thresholds} />
            )}
            {entry.law && (
              <Row label="Закон" value={entry.law} />
            )}
            {entry.note && (
              <Row label="Прим." value={entry.note} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-zinc-400 shrink-0">{label}:</span>
      <span className="text-zinc-200">{value}</span>
    </div>
  );
}

/* ─── Shorthand: wrap a column header with KB ─── */

export function KBHeader({ children, kb, className }: { children: ReactNode; kb: KBEntry | string; className?: string }) {
  return (
    <KBTooltip kb={kb} position="bottom" showIcon className={className}>
      {children}
    </KBTooltip>
  );
}
