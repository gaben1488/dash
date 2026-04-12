import clsx from 'clsx';
import { ArrowUp, ArrowDown, Minus, Info, ExternalLink } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
interface KPICardProps {
  label: string;
  value: string;
  unit?: string;
  period?: string;
  status?: 'normal' | 'warning' | 'critical';
  origin?: string;
  sourceCell?: string;
  trend?: 'up' | 'down' | 'stable';
  sparkData?: number[];
  delta?: {
    calculatedValue: string;
    deltaPercent: string;
    withinTolerance: boolean;
  };
  onClick?: () => void;
}

import { SVOD_SPREADSHEET_ID } from '@aemr/shared';

function buildSheetUrl(spreadsheetId: string, cell?: string): string {
  let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  if (cell) url += `#gid=0&range=${cell}`;
  return url;
}

const UNIT_LABELS: Record<string, string> = {
  percent: '%', count: 'шт.', rubles: '₽', thousand_rubles: 'тыс. ₽',
  million_rubles: 'млн ₽', days: 'дн.', none: '',
};

const PERIOD_LABELS: Record<string, string> = {
  annual: 'Год', q1: '1 кв.', q2: '2 кв.', q3: '3 кв.', q4: '4 кв.',
  monthly: 'Мес.', cumulative: 'Нараст.',
};

export function KPICard({ label, value, unit, period, status = 'normal', origin, sourceCell, trend, sparkData, delta, onClick }: KPICardProps) {
  const unitLabel = unit ? UNIT_LABELS[unit] ?? '' : '';
  const periodLabel = period ? PERIOD_LABELS[period] ?? period : '';

  // Clean value: strip accidental unit text (e.g. "31.6% percent" → "31.6%")
  let cleanValue = value;
  if (unit && cleanValue) {
    // Remove raw unit name from value if accidentally included
    cleanValue = cleanValue.replace(/\s*(percent|count|rubles|thousand_rubles|million_rubles|days|none)\s*$/i, '').trim();
  }

  // Show unit label only if value doesn't already contain a unit symbol
  const UNIT_SYMBOLS = ['%', '₽', 'руб', 'шт', 'дн'];
  const valueHasUnit = UNIT_SYMBOLS.some(s => cleanValue?.includes(s));
  const showUnit = unitLabel && !valueHasUnit && cleanValue !== '—';

  return (
    <div
      onClick={onClick}
      className={clsx(
        'card relative group transition-all duration-200',
        status === 'critical' && 'border-red-500/30',
        status === 'warning' && 'border-amber-500/30',
        onClick
          ? 'cursor-pointer hover:shadow-lg hover:scale-[1.02] hover:border-blue-300 dark:hover:border-blue-600/60 active:scale-[0.98]'
          : 'hover:border-zinc-300 dark:hover:border-zinc-600/80',
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="card-header mb-0">{label}</p>
        <div className={clsx('badge', `badge-${status}`)}>
          {status === 'normal' ? 'OK' : status === 'warning' ? '!' : '!!'}
        </div>
      </div>

      <p className="card-value flex items-baseline gap-1.5">
        <span>
          {cleanValue}
          {showUnit && <span className="text-lg ml-1 text-zinc-400">{unitLabel}</span>}
        </span>
        {trend === 'up' && <ArrowUp size={18} className="text-emerald-500 shrink-0" />}
        {trend === 'down' && <ArrowDown size={18} className="text-red-500 shrink-0" />}
        {trend === 'stable' && <Minus size={18} className="text-zinc-400 shrink-0" />}
      </p>

      {sparkData && sparkData.length > 1 && (
        <div className="mt-2 h-6">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData.map((v, i) => ({ v, i }))}>
              <Line type="monotone" dataKey="v" stroke={trend === 'down' ? '#f87171' : '#34d399'} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {delta && !delta.withinTolerance && (
        <div className="mt-2 flex items-center gap-1 text-xs text-amber-400">
          <Info size={12} />
          <span>Расхождение: {delta.calculatedValue} ({delta.deltaPercent})</span>
        </div>
      )}

      {/* Provenance tooltip */}
      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono text-right flex items-center gap-1.5">
          <div>
            {sourceCell && <div>{sourceCell}</div>}
            {origin && <div>{origin === 'official' ? 'СВОД' : origin === 'calculated' ? 'Пересчёт' : origin}</div>}
          </div>
          {sourceCell && (
            <button
              title="Открыть в Google Sheets"
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                window.open(buildSheetUrl(SVOD_SPREADSHEET_ID, sourceCell), '_blank');
              }}
            >
              <ExternalLink size={11} className="text-blue-500" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
