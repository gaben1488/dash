import { ShieldCheck, GitCompare, AlertTriangle, Lightbulb } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { TrustPage } from './Trust';
import { ReconPage } from './Recon';
import { IssuesPage } from './Issues';
import { RecsPage } from './Recs';

type QualityTab = 'trust' | 'recon' | 'issues' | 'recs';

const TABS: { id: QualityTab; label: string; icon: typeof ShieldCheck; description: string }[] = [
  { id: 'trust', label: 'Надёжность', icon: ShieldCheck, description: 'Индекс надёжности данных' },
  { id: 'recon', label: 'Сверка', icon: GitCompare, description: 'СВОД vs расчёт' },
  { id: 'issues', label: 'Замечания', icon: AlertTriangle, description: 'Выявленные проблемы' },
  { id: 'recs', label: 'Рекомендации', icon: Lightbulb, description: 'Действия и решения' },
];

export function QualityPage() {
  const { qualityTab, setQualityTab } = useStore();

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-1 shadow-sm">
        {TABS.map(tab => {
          const isActive = qualityTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setQualityTab(tab.id)}
              title={tab.description}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex-1 justify-center',
                isActive
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
              )}
            >
              <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {qualityTab === 'trust' && <TrustPage />}
      {qualityTab === 'recon' && <ReconPage />}
      {qualityTab === 'issues' && <IssuesPage />}
      {qualityTab === 'recs' && <RecsPage />}
    </div>
  );
}
