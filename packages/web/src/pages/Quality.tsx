// ── Страница «Контроль»: пять вкладок — сверка, качество заполнения,
//    замечания, рекомендации, журнал.
//
//    14.08.2026: термин «доверие» снят с экранов решением владельца (п.88/26б
//    интервью): скоринг с весами читался как абстракция. Вкладка называется
//    «Качество заполнения» — это то, что индекс на самом деле измеряет.
//
//    07.08.2026: полоса вкладок доведена до настоящих вкладок. Раньше это был
//    ряд кнопок: с клавиатуры по ним ходил Tab (пять остановок вместо одной),
//    экранный диктор не знал, что кнопка переключает содержимое, а связь
//    «вкладка → её панель» не объявлялась вовсе. Теперь роли и стрелки —
//    как ждёт читатель, работающий без мыши.

import { useRef } from 'react';
import { ShieldCheck, GitCompare, AlertTriangle, Lightbulb, BookOpen } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { TrustPage } from './Trust';
import { ReconPage } from './Recon';
import { IssuesPage } from './Issues';
import { RecsPage } from './Recs';
import { JournalPage } from './Journal';
import { CommentAnnotationsSection } from '../components/quality/CommentAnnotationsSection';

type QualityTab = 'trust' | 'recon' | 'issues' | 'recs' | 'journal';

const TABS: { id: QualityTab; label: string; icon: typeof ShieldCheck; description: string }[] = [
  { id: 'recon', label: 'Сверка', icon: GitCompare, description: 'Официальные числа листа СВОД против независимого пересчёта по строкам' },
  { id: 'trust', label: 'Качество заполнения', icon: ShieldCheck, description: 'Насколько полно и аккуратно заполнены книги: индекс надёжности данных по компонентам' },
  { id: 'issues', label: 'Замечания', icon: AlertTriangle, description: 'Что именно не сходится в данных, построчно' },
  { id: 'recs', label: 'Рекомендации', icon: Lightbulb, description: 'Что с этим делать: действия и решения' },
  { id: 'journal', label: 'Журнал', icon: BookOpen, description: 'История событий системы: чтения книг, изменения, сбои' },
];

export function QualityPage() {
  const { qualityTab, setQualityTab } = useStore();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const activeIndex = Math.max(0, TABS.findIndex((t) => t.id === qualityTab));

  /** Стрелки, Home и End водят по вкладкам — так их ждёт читатель без мыши. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const last = TABS.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = activeIndex === last ? 0 : activeIndex + 1;
    else if (event.key === 'ArrowLeft') next = activeIndex === 0 ? last : activeIndex - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    const target = TABS[next];
    setQualityTab(target.id);
    tabRefs.current[target.id]?.focus();
  };

  const activeTab = TABS[activeIndex];

  return (
    <div className="space-y-4">
      {/* Полоса вкладок */}
      <div
        role="tablist"
        aria-label="Разделы контроля данных"
        className="flex items-center gap-1 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-1 shadow-sm"
      >
        {TABS.map((tab) => {
          const isActive = qualityTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[tab.id] = el; }}
              id={`quality-tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`quality-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setQualityTab(tab.id)}
              onKeyDown={onKeyDown}
              title={tab.description}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex-1 justify-center',
                'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500',
                isActive
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
              )}
            >
              <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Панель активной вкладки */}
      <div
        role="tabpanel"
        id={`quality-panel-${activeTab.id}`}
        aria-labelledby={`quality-tab-${activeTab.id}`}
        tabIndex={-1}
      >
        {qualityTab === 'trust' && <TrustPage />}
        {qualityTab === 'recon' && <ReconPage />}
        {qualityTab === 'issues' && (
          <div className="space-y-4">
            <IssuesPage />
            {/* Слой аннотаций (пп. 72а/78/74б): ОТДЕЛЬНАЯ секция, не смешана
                с замечаниями конвейера — у них разные словари и жизненные
                циклы. Рисуется и при пустом списке замечаний: сверка
                комментариев со структурой живёт своим источником. */}
            <CommentAnnotationsSection />
          </div>
        )}
        {qualityTab === 'recs' && <RecsPage />}
        {qualityTab === 'journal' && <JournalPage />}
      </div>
    </div>
  );
}
