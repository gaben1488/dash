// @vitest-environment jsdom
/**
 * Система → Источники данных: глубокая проверка — настоящее действие,
 * а не декоративная кнопка. Не требует наличия архивной контрольной недели.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../components/ui/tooltip';
import { SettingsPage } from './Settings';
import { useStore } from '../store';

const getSources = vi.fn();
const settingsStatus = vi.fn();
const runSourceDiagnostics = vi.fn();
const refreshSources = vi.fn();
const refreshDashboard = vi.fn();
const originalFetchDashboard = useStore.getState().fetchDashboard;

vi.mock('../components/RuleReference', () => ({ RuleReference: () => null }));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSources: (...args: unknown[]) => getSources(...(args as [])),
      settingsStatus: (...args: unknown[]) => settingsStatus(...(args as [])),
      runSourceDiagnostics: (...args: unknown[]) => runSourceDiagnostics(...(args as [])),
      refresh: (...args: unknown[]) => refreshSources(...(args as [])),
    },
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

function result(complete: boolean) {
  const deep = {
    complete, at: new Date().toISOString(), expectedBooks: 2, changedValueBooks: [],
    books: [
      { book: 'УО', metadataRead: true, metadataRemarks: 1, formulasRead: true,
        analyzed: true, formulaCells: 11, rowsJudged: 2, formulaDefects: 0, problems: [] },
      { book: 'УИО', metadataRead: complete, metadataRemarks: complete ? 0 : null,
        formulasRead: complete, analyzed: complete, formulaCells: complete ? 11 : null,
        rowsJudged: complete ? 3 : null, formulaDefects: complete ? 0 : null,
        problems: complete ? [] : ['формулы этого запуска не прочитаны'] },
    ],
  };
  return {
    schemaVersion: 'dash-source-diagnostics/v1' as const,
    runId: 'test-run-1', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    status: complete ? 'complete' : 'partial', consistency: 'non_atomic' as const,
    stages: {
      deep: {
        status: complete ? 'complete' : 'partial',
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        result: deep, error: null,
      },
      rows: {
        status: 'complete', startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(), expectedSources: 2,
        validatedBooks: 2, accessOnlyBooks: 0, failedSources: [],
        results: [
          { name: 'УО', success: true, validationPerformed: true, rowsChecked: 2,
            summary: { total: 1, critical: 0, warning: 1, info: 0 }, issues: [] },
          { name: 'УИО', success: true, validationPerformed: true, rowsChecked: 3,
            summary: { total: 0, critical: 0, warning: 0, info: 0 }, issues: [] },
        ], error: null,
      },
      metrics: { status: 'not_run', reason: 'not checked' },
      text: { status: 'not_run', reason: 'not checked' },
      crossbook: { status: 'not_run', reason: 'not checked' },
      history: { status: 'not_run', reason: 'not checked' },
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  getSources.mockResolvedValue({
    sources: [
      { name: 'УО', status: 'ok', rowCount: 20 },
      { name: 'УИО', status: 'ok', rowCount: 30 },
    ],
  });
  settingsStatus.mockResolvedValue({ configured: true });
  runSourceDiagnostics.mockResolvedValue(result(true));
  refreshSources.mockResolvedValue({ success: true, issueCount: 0, formulaBooks: ['УО', 'УИО'] });
  refreshDashboard.mockResolvedValue(true);
  useStore.setState({ fetchDashboard: refreshDashboard });
});

afterEach(() => {
  useStore.setState({ fetchDashboard: originalFetchDashboard });
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

function renderPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <SettingsPage />
    </TooltipProvider>,
  );
}

describe('Единый источник диагностики на новой базе', () => {
  it('объединяет диагностику отдельной книги под одной раскрываемой группой', async () => {
    renderPage();
    const items = await screen.findAllByText('Диагностика отдельной книги');
    expect(items).toHaveLength(2);
    fireEvent.click(items[0]);
    expect(screen.getAllByRole('button', { name: 'Проверить связь' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Проверить данные' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Проверить источники' })).toBeTruthy();
  });

  it('вручную запускает одно чтение, показывает охват и не требует исторической недели', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: 'Проверить источники' });
    fireEvent.click(button);
    await screen.findByText(/Этапы проверки источников завершены/);
    expect(document.body.textContent).toContain('Метрики, межкнижные сверки, текст и история этим запуском не проверялись.');
    expect(runSourceDiagnostics).toHaveBeenCalledTimes(1);
    expect(refreshDashboard).toHaveBeenCalledWith(true);
    expect(document.body.textContent).toContain('2 из 2 книг');
    expect(document.body.textContent).toContain('отсутствие первого недельного среза проверке не мешает');
    fireEvent.click(screen.getByText('Результат по каждой книге'));
    expect(document.body.textContent).toContain('УО:');
    expect(document.body.textContent).toContain('УИО:');
  });

  it('непрочитанная книга не объявляется здоровой с нулём дефектов', async () => {
    runSourceDiagnostics.mockResolvedValueOnce(result(false));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить источники' }));
    await screen.findByText(/Проверка источников неполная/);
    expect(document.body.textContent).toContain('1 из 2 книг');
    fireEvent.click(screen.getByText('Результат по каждой книге'));
    expect(document.body.textContent).toContain('формулы этого запуска не прочитаны');
  });

  it('не начинает второе чтение, пока первое не закончилось', async () => {
    let finish: (value: ReturnType<typeof result>) => void = () => undefined;
    runSourceDiagnostics.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage();
    const button = await screen.findByRole('button', { name: 'Проверить источники' });
    fireEvent.click(button);
    expect(runSourceDiagnostics).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Проверить данные во всех книгах' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Прочитать книги и формулы' }) as HTMLButtonElement).disabled).toBe(true);
    finish(result(true));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(runSourceDiagnostics).toHaveBeenCalledTimes(1);
  });
});

it('ручное чтение книг получает формулы и обновляет текущую оценку, а не только источники', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Прочитать книги и формулы' }));
  await waitFor(() => expect(refreshSources).toHaveBeenCalledWith(false, true));
  await waitFor(() => expect(refreshDashboard).toHaveBeenCalledWith(true));
  await screen.findByText(/Формулы получены: 2 из 8 книг/);
});

it('не выдаёт старый балл за новый, если обновить аналитический экран не получилось', async () => {
  refreshDashboard.mockResolvedValueOnce(false);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Прочитать книги и формулы' }));
  await screen.findByText(/Оценка на экране не обновлена/);
  expect(refreshSources).toHaveBeenCalledWith(false, true);
});

