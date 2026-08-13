import { useEffect, useRef, Component, Suspense, type ReactNode } from 'react';
import { useStore } from './store';
import { useThemeInit } from './components/ThemeProvider';
import { useUrlSync } from './hooks/useUrlSync';
import { Header } from './components/Header';
import { OrgStrip } from './components/OrgStrip';
import { Dashboard } from './pages/Dashboard';
// Разделы приезжают по требованию — см. pages/lazy-pages.tsx. Отчёт++ (бриф
// 2026-08-01): страница-документ, собранная из того же mainReportBlocks, что и
// .docx-выгрузка, — состав совпадает по построению. Старая вёрстка
// (pages/Report.tsx) сносится после аудита (шаг 7 брифа).
import {
  ReportPage, SvodView, DataBrowserPage, EconomyPage,
  Analytics, QualityPage, SettingsPage, PageSkeleton,
} from './pages/lazy-pages';
import { TooltipProvider } from './components/ui/tooltip';
import { setKBRegistry } from './components/ui/kb-tooltip';
import { STANDARD_METRICS } from './lib/metrics-registry';

// Initialize KB tooltip registry (once, at module load)
setKBRegistry(STANDARD_METRICS);

/* ── Error Boundary ────────────────────────────────────── */

interface ErrorBoundaryProps {
  /** Смена ключа сбрасывает рамку (используется при переходе между разделами) */
  resetKey?: string;
  /**
   * Что именно не открылось — попадает в заголовок аварийного экрана.
   * Читателю важно знать, потерян ли раздел или вся страница: во втором
   * случае «попробовать снова» бессмысленно, нужна перезагрузка.
   */
  scope?: 'раздел' | 'страница';
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const scope = this.props.scope ?? 'раздел';
      return (
        <div
          role="alert"
          className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-red-200 dark:border-red-500/30 max-w-lg mx-auto mt-12 text-center p-8"
        >
          {/* Заголовок — утверждение о том, что случилось с данными читателя,
              а не «произошла ошибка в модуле»: слово «модуль» ничего не
              сообщает тому, кто открыл сводку по закупкам. */}
          <p className="text-red-600 dark:text-red-400 font-medium mb-2">
            {scope === 'страница'
              ? 'Приложение не отрисовалось — числа на экране показать не удалось'
              : 'Этот раздел не открылся — числа в нём показать не удалось'}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">
            {scope === 'страница'
              ? 'Обновите страницу. Если повторится — сообщите разработчику текст в скобках ниже.'
              : 'Попробуйте открыть раздел заново. Данные не испорчены — сбой произошёл при показе, не при расчёте.'}
          </p>
          {/* Текст движка нужен разработчику, но он английский и непонятен читателю
              района. Поэтому он не заголовок аварийного экрана, а подпись мелким
              в скобках под русской рамкой. */}
          {this.state.error && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">
              Техническая подробность для разработчика
              {' ('}
              <span className="font-mono break-all">{this.state.error.message}</span>
              {')'}
            </p>
          )}
          <div className="flex items-center justify-center gap-2">
            {scope === 'раздел' && (
              <button
                type="button"
                onClick={this.resetError}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
              >
                Попробовать снова
              </button>
            )}
            {/* Раньше единственная кнопка называлась «Обновить», но лишь сбрасывала
                рамку — страница не перезагружалась. Подпись обещала не то, что
                делала кнопка; теперь перезагрузка названа своим именем. */}
            {/* Кольцо фокуса приходит из общего правила в index.css — локальные
                focus-visible:outline-* убраны, чтобы кольцо было одинаковым во
                всём продукте и не спорило с темой. */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-lg text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-600 transition"
            >
              Обновить страницу
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── App ───────────────────────────────────────────────── */

export function App() {
  const { page, year, fetchDashboard, fetchSubordinates } = useStore();
  useThemeInit();
  useUrlSync();

  // Initial load
  useEffect(() => {
    fetchDashboard();
    fetchSubordinates();
  }, [fetchDashboard, fetchSubordinates]);

  // Re-fetch when year filter changes
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    fetchDashboard(true);
  }, [year, fetchDashboard]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard />;
      // v4: документ-калька признана регрессией — основа снова старая
      // страница, улучшаемая до идеала (бриф Отчёт++, поворот v4).
      case 'report': return <ReportPage />;
      case 'svod': return <SvodView />;
      case 'data': return <DataBrowserPage />;
      case 'economy': return <EconomyPage />;
      case 'analytics': return <Analytics />;
      case 'quality': return <QualityPage />;
      case 'recon': return <QualityPage />;
      case 'trust': return <QualityPage />;
      case 'issues': return <QualityPage />;
      case 'recs': return <QualityPage />;
      case 'journal': return <QualityPage />;  // Now sub-tab of Контроль
      case 'settings': return <SettingsPage />;
      default: return <Dashboard />;
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      {/* Внешняя рамка ловит падения оболочки — шапки и полосы организаций.
          Без неё сбой в шапке давал белый экран без единого слова: внутренняя
          рамка живёт ниже по дереву и такое падение перехватить не может. */}
      <ErrorBoundary scope="страница">
        {/* Первая остановка табуляции: шапка и полоса организаций — это
            несколько десятков кнопок, и без этой ссылки клавиатурный читатель
            прощёлкивает весь хром, чтобы добраться до чисел. */}
        <a href="#main-content" className="skip-link">Перейти к содержимому</a>
        <div className="flex flex-col h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
          {/* Horizontal bar — FULL WIDTH, always on top */}
          <Header />
          {/* Below header: OrgStrip + main content side by side.
              report — фикс-документ 1:1 с .docx, орг-фильтр там не режет контент;
              навигация по ГРБС — шапка-оглавление внутри страницы (Report.tsx:703). */}
          <div className="flex flex-1 overflow-hidden">
            {page !== 'report' && <OrgStrip />}
            {/* min-w-0 — чтобы широкая таблица внутри прокручивалась сама, а не
                распирала строку и не выдавливала полосу организаций за край. */}
            <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 overflow-y-auto">
              <div className="max-w-[1400px] mx-auto p-6">
                <ErrorBoundary resetKey={page} scope="раздел">
                  {/* Пока файл раздела едет по сети, на его месте стоит скелет
                      той же формы — экран не прыгает, когда раздел появился. */}
                  <Suspense fallback={<PageSkeleton page={page} />}>
                    {renderPage()}
                  </Suspense>
                </ErrorBoundary>
              </div>
            </main>
          </div>
        </div>
      </ErrorBoundary>
    </TooltipProvider>
  );
}
