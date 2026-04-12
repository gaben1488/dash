import clsx from 'clsx';

interface TrustGaugeProps {
  score: number;
  grade: string;
  components: Array<{
    name: string;
    label: string;
    score: number;
    weight: number;
    issues: number;
    criticalIssues: number;
    details: string;
  }>;
  onClick?: () => void;
}

export function TrustGauge({ score, grade, components, onClick }: TrustGaugeProps) {
  const color = score >= 90 ? 'emerald' : score >= 75 ? 'blue' : score >= 60 ? 'amber' : score >= 40 ? 'orange' : 'red';

  return (
    <div
      onClick={onClick}
      className={clsx('card', onClick && 'cursor-pointer hover:shadow-md hover:border-blue-200 dark:hover:border-blue-700 transition-all')}
    >
      <div className="flex items-center justify-between">
        <p className="card-header mb-0">Оценка достоверности данных</p>
        {onClick && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Подробнее →</span>}
      </div>

      <div className="flex items-center gap-6 mb-6">
        {/* Circular gauge */}
        <div className="relative w-24 h-24">
          <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" className="stroke-zinc-200 dark:stroke-zinc-700" />
            <circle
              cx="50" cy="50" r="42" fill="none" strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${score * 2.64} 264`}
              className={clsx(
                score >= 90 && 'stroke-emerald-400',
                score >= 75 && score < 90 && 'stroke-blue-400',
                score >= 60 && score < 75 && 'stroke-amber-400',
                score >= 40 && score < 60 && 'stroke-orange-400',
                score < 40 && 'stroke-red-400',
              )}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-zinc-800 dark:text-white">{score}</span>
            <span className={clsx(
              'text-xs font-bold',
              `text-${color}-400`,
            )}>{grade}</span>
          </div>
        </div>

        <div className="flex-1 space-y-3">
          {components.map(comp => (
            <div key={comp.name}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-700 dark:text-zinc-300">{comp.label}</span>
                <span className="text-zinc-500 dark:text-zinc-400">{comp.score}%</span>
              </div>
              <div className="progress-bar">
                <div
                  className={clsx('progress-fill', getProgressColor(comp.score))}
                  style={{ width: `${comp.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getProgressColor(score: number): string {
  if (score >= 90) return 'bg-emerald-500';
  if (score >= 75) return 'bg-blue-500';
  if (score >= 60) return 'bg-amber-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}
