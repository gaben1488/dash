import { useEffect, useRef, Component, type ReactNode } from 'react';
import { useStore } from './store';
import { useThemeInit } from './components/ThemeProvider';
import { useUrlSync } from './hooks/useUrlSync';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './pages/Dashboard';
import { DataBrowserPage } from './pages/DataBrowser';
import { EconomyPage } from './pages/Economy';
import { Analytics } from './pages/Analytics';
import { QualityPage } from './pages/Quality';
import { JournalPage } from './pages/Journal';
import { SettingsPage } from './pages/Settings';
import { TooltipProvider } from './components/ui/tooltip';
import { setKBRegistry } from './components/ui/kb-tooltip';
import { STANDARD_METRICS } from './lib/metrics-registry';

// Initialize KB tooltip registry (once, at module load)
setKBRegistry(STANDARD_METRICS);

/* ── Error Boundary ────────────────────────────────────── */

interface ErrorBoundaryProps {
  /** Changing the key resets the boundary (used on page navigation) */
  resetKey?: string;
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
      return (
        <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-red-200 dark:border-red-500/30 max-w-lg mx-auto mt-12 text-center p-8">
          <p className="text-red-600 dark:text-red-400 font-medium mb-2">
            Произошла ошибка в модуле
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">
            Обновите страницу.
          </p>
          {this.state.error && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4 font-mono break-all">
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={this.resetError}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
          >
            Обновить
          </button>
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
      case 'data': return <DataBrowserPage />;
      case 'economy': return <EconomyPage />;
      case 'analytics': return <Analytics />;
      case 'quality': return <QualityPage />;
      case 'recon': return <QualityPage />;
      case 'trust': return <QualityPage />;
      case 'issues': return <QualityPage />;
      case 'recs': return <QualityPage />;
      case 'journal': return <JournalPage />;
      case 'settings': return <SettingsPage />;
      default: return <Dashboard />;
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-[1400px] mx-auto p-6">
              <ErrorBoundary resetKey={page}>
                {renderPage()}
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
