import clsx from 'clsx';
import { AlertTriangle, AlertCircle, Info, XCircle } from 'lucide-react';

interface Issue {
  id: string;
  severity: string;
  origin: string;
  category: string;
  title: string;
  description: string;
  sheet?: string;
  cell?: string;
  row?: number;
  signal?: string;
  departmentId?: string;
  recommendation?: string;
}

const SEVERITY_CONFIG = {
  critical: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Критично' },
  significant: { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'Значимо' },
  warning: { icon: AlertCircle, color: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Внимание' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Информация' },
} as const;

const ORIGIN_LABELS: Record<string, string> = {
  spreadsheet_rule: 'Правило таблицы',
  bi_heuristic: 'Аналитика',
  delta_mismatch: 'Расхождение',
  mapping_error: 'Привязка',
  runtime_error: 'Ошибка системы',
  language_defect: 'Язык',
};

export function IssueList({ issues, maxItems, onItemClick }: {
  issues: Issue[];
  maxItems?: number;
  onItemClick?: (issue: Issue) => void;
}) {
  const displayed = maxItems ? issues.slice(0, maxItems) : issues;

  if (displayed.length === 0) {
    return (
      <div className="card text-center py-8">
        <p className="text-zinc-500 dark:text-zinc-400">Замечаний не обнаружено</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {displayed.map(issue => {
        const config = SEVERITY_CONFIG[issue.severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.info;
        const Icon = config.icon;

        return (
          <div
            key={issue.id}
            className={clsx('card !p-3 flex items-start gap-3', config.bg, onItemClick && 'cursor-pointer hover:ring-1 hover:ring-blue-400/30 transition-all')}
            onClick={onItemClick ? () => onItemClick(issue) : undefined}
          >
            <Icon size={16} className={clsx('mt-0.5 flex-shrink-0', config.color)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={clsx('text-sm font-medium', config.color)}>{issue.title}</span>
                <span className="badge badge-info text-[10px]">{ORIGIN_LABELS[issue.origin] ?? issue.origin}</span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">{issue.description}</p>
              {issue.cell && (
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono mt-1 inline-block">
                  {issue.sheet}!{issue.cell}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {maxItems && issues.length > maxItems && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
          Ещё {issues.length - maxItems} замечаний...
        </p>
      )}
    </div>
  );
}
