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
import { ShieldCheck, GitCompare, AlertTriangle, Lightbulb, BookOpen, Gauge } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store';
import { TrustPage } from './Trust';
import { ReconPage } from './Recon';
import { IssuesPage } from './Issues';
import { RecsPage } from './Recs';
import { JournalPage } from './Journal';
import { CommentAnnotationsSection } from '../components/quality/CommentAnnotationsSection';
import { IntegritySection } from '../components/analytics-extra/IntegritySection';
import { ScorecardSection } from '../components/scorecard/ScorecardSection';
import { PageHeader } from '../components/ui/page-header';

type QualityTab = 'trust' | 'recon' | 'issues' | 'recs' | 'journal' | 'scorecard';

const TABS: { id: QualityTab; label: string; icon: typeof ShieldCheck; description: string }[] = [
  { id: 'recon', label: 'Сверка', icon: GitCompare, description: 'Официальные числа листа СВОД против независимого пересчёта по строкам' },
  { id: 'trust', label: 'Качество заполнения', icon: ShieldCheck, description: 'Насколько полно и аккуратно заполнены книги: индекс надёжности данных по компонентам' },
  { id: 'issues', label: 'Замечания', icon: AlertTriangle, description: 'Что именно не сходится в данных, построчно' },
  // Ярусом выше построчных замечаний: не «какая строка неверна», а «у какого
  // управления отклонение от ожидания больше прочих» (маяк продукта, Г-06/Г-09).
  { id: 'scorecard', label: 'Оценка управлений', icon: Gauge, description: 'Грейд за исполнение, индекс дисциплины и нарушения норм закона по каждому управлению' },
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
      {/* 18.08: у вкладки не было заголовка первого уровня вовсе — читатель
          с диктором попадал в раздел без имени и не мог понять, где он.
          Заголовок ставится общим примитивом, а не своей строкой классов. */}
      <PageHeader
        title="Контроль"
        lead={activeTab.description}
      />

      {/* Полоса вкладок */}
      <div
        role="tablist"
        aria-label="Разделы контроля данных"
        // Шесть вкладок на смартфоне в строку не помещаются: полоса едет вбок
        // сама, а не выталкивает вбок всю страницу (директива п.73а).
        className="flex items-center gap-1 overflow-x-auto rounded-[var(--radius-modal)] border border-[var(--line-card)] bg-[var(--surface-card)] p-1 shadow-[var(--elevation-1)]"
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
              // Краски вкладки названы ролями, а не тонами zinc/blue: раньше
              // активная вкладка была «bg-blue-600 text-white» — то есть
              // чистый белый на синем, оба под запретом палитры продукта, и
              // тёмная тема о ней не знала вовсе.
              className={clsx(
                'ds-text-sm flex flex-1 min-w-max items-center justify-center gap-2 whitespace-nowrap',
                'rounded-[var(--radius-card)] px-4 py-2.5 font-[var(--weight-medium)]',
                'transition-colors duration-[var(--dur-fast)] ease-[var(--ease-standard)]',
                isActive
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                  : 'text-[var(--ink-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--ink-strong)]',
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
            {/* Целостность книг (21.08.2026): нумерация «№ п/п», код даты
                текстом в графе срока и пропавшие между чтениями закупки. Тоже
                отдельная секция со своим источником: у неё другой жизненный
                цикл, чем у замечаний конвейера, и рисуется она независимо от
                того, есть ли замечания. */}
            <IntegritySection />
          </div>
        )}
        {qualityTab === 'scorecard' && <ScorecardSection />}
        {qualityTab === 'recs' && <RecsPage />}
        {qualityTab === 'journal' && <JournalPage />}
      </div>
    </div>
  );
}
