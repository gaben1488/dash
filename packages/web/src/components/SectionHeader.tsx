import { type ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  count?: number;
}

export function SectionHeader({ title, subtitle, action, count }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          {title}
          {count != null && <span className="ml-2 text-zinc-300 dark:text-zinc-600 normal-case">{count}</span>}
        </h2>
        {subtitle && <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
