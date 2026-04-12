import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';
import { Info } from 'lucide-react';

// ────────────────────────────────────────────────────────────────
// KBTooltip — Universal Knowledge-Base tooltip for АЕМР
//
// Every interactive element in the dashboard gets a tooltip showing:
//   • Формула (how it's calculated)
//   • Источник (CalcEngine field / API path)
//   • Ячейка (spreadsheet cell reference)
//   • Пороги (green/yellow/red thresholds)
//   • Закон (44-ФЗ article if applicable)
//
// Usage:
//   <KBTooltip metric="exec_count_pct">
//     <span>42.3%</span>
//   </KBTooltip>
//
//   <KBTooltip
//     formula="fact_count / plan_count × 100"
//     source="CalcEngine → byQuarter[q].exec_count_pct"
//     cell="СВОД ТД-ПМ!G14"
//     thresholds="≥80% зелёный, ≥50% жёлтый, <50% красный"
//     law="44-ФЗ ст.72"
//   >
//     <span>42.3%</span>
//   </KBTooltip>
// ────────────────────────────────────────────────────────────────

export interface KBEntry {
  formula?: string;
  source?: string;
  cell?: string;
  thresholds?: string;
  law?: string;
  description?: string;
}

interface KBTooltipProps {
  /** Lookup from STANDARD_METRICS registry by key */
  metric?: string;
  /** Or provide inline KB data */
  formula?: string;
  source?: string;
  cell?: string;
  thresholds?: string;
  law?: string;
  description?: string;
  /** Wrap children */
  children: React.ReactNode;
  /** Side of tooltip */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Show small info icon indicator */
  showIcon?: boolean;
  /** Additional className on trigger wrapper */
  className?: string;
}

/**
 * Registry lookup — imported lazily to avoid circular deps.
 * Falls back to inline props if metric key not found.
 */
let _registry: Record<string, KBEntry> | null = null;

export function setKBRegistry(registry: Record<string, KBEntry>) {
  _registry = registry;
}

function getKB(metric?: string): KBEntry | null {
  if (!metric || !_registry) return null;
  return _registry[metric] ?? null;
}

function KBTooltipContent({ entry }: { entry: KBEntry }) {
  const rows = [
    { label: 'Формула', value: entry.formula },
    { label: 'Источник', value: entry.source },
    { label: 'Ячейка', value: entry.cell },
    { label: 'Пороги', value: entry.thresholds },
    { label: 'Закон', value: entry.law },
  ].filter(r => r.value);

  if (rows.length === 0 && !entry.description) return null;

  return (
    <div className="space-y-1.5">
      {entry.description && (
        <p className="text-[11px] text-zinc-300 dark:text-zinc-300 leading-snug mb-2">
          {entry.description}
        </p>
      )}
      {rows.map(({ label, value }) => (
        <div key={label} className="flex gap-2 text-[10px] leading-tight">
          <span className="text-zinc-400 dark:text-zinc-500 shrink-0 w-16 font-medium">
            {label}:
          </span>
          <span className="text-zinc-200 dark:text-zinc-300 font-mono break-all">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function KBTooltip({
  metric,
  formula,
  source,
  cell,
  thresholds,
  law,
  description,
  children,
  side = 'top',
  showIcon = false,
  className,
}: KBTooltipProps) {
  // Merge registry entry with inline props (inline wins)
  const registryEntry = getKB(metric);
  const entry: KBEntry = {
    formula: formula ?? registryEntry?.formula,
    source: source ?? registryEntry?.source,
    cell: cell ?? registryEntry?.cell,
    thresholds: thresholds ?? registryEntry?.thresholds,
    law: law ?? registryEntry?.law,
    description: description ?? registryEntry?.description,
  };

  // If nothing to show, just render children
  const hasContent = Object.values(entry).some(Boolean);
  if (!hasContent) return <>{children}</>;

  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>
        <span className={cn('inline-flex items-center gap-1 cursor-help', className)}>
          {children}
          {showIcon && (
            <Info
              size={12}
              className="text-zinc-400 dark:text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            />
          )}
        </span>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-[100] max-w-xs rounded-xl px-4 py-3 shadow-2xl',
            'bg-zinc-900 dark:bg-zinc-800 border border-zinc-700/50',
            'animate-in fade-in-0 zoom-in-95 duration-150',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          <KBTooltipContent entry={entry} />
          <TooltipPrimitive.Arrow className="fill-zinc-900 dark:fill-zinc-800" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
