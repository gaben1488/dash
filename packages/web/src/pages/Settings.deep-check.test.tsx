// @vitest-environment jsdom
/** The System page consumes one server-owned source inspection run. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../components/ui/tooltip';
import { SettingsPage } from './Settings';

const getSources = vi.fn();
const settingsStatus = vi.fn();
const runSourceDiagnostics = vi.fn();
const oldDeepCheck = vi.fn();
const oldValidateAll = vi.fn();

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSources: (...args: unknown[]) => getSources(...(args as [])),
      settingsStatus: (...args: unknown[]) => settingsStatus(...(args as [])),
      runSourceDiagnostics: (...args: unknown[]) => runSourceDiagnostics(...(args as [])),
      checkSourceIntegrityDeep: (...args: unknown[]) => oldDeepCheck(...(args as [])),
      validateAllSources: (...args: unknown[]) => oldValidateAll(...(args as [])),
    },
  };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

const at = '2026-10-22T07:00:00.000Z';
function deepResult(complete: boolean) {
  return {
    complete, at, expectedBooks: 2, changedValueBooks: [],
    books: [
      { book: 'УО', metadataRead: true, metadataRemarks: 1, formulasRead: true,
        analyzed: true, formulaCells: 11, rowsJudged: 2, formulaDefects: 0, problems: [] },
      { book: 'УИО', metadataRead: complete, metadataRemarks: complete ? 0 : null,
        formulasRead: complete, analyzed: complete, formulaCells: complete ? 11 : null,
        rowsJudged: complete ? 3 : null, formulaDefects: complete ? 0 : null,
        problems: complete ? [] : ['формулы этого запуска не прочитаны'] },
    ],
  };
}
function row(name: string, total: number, mode: 'rows' | 'access_only' = 'rows') {
  return {
    name, success: true, validationMode: mode, resolvedSheetName: name,
    rowsChecked: 20, summary: { total, critical: 0, warning: total, info: 0 },
    issues: total ? [{ row: 4, severity: 'warning', type: 'signal', message: 'Проверить строку' }] : [],
  };
}
function runResult(complete: boolean) {
  return {
    schemaVersion: 'sources-diagnostics/v1',
    runId: 'run-12345678', startedAt: at, completedAt: at,
    status: complete ? 'complete' : 'partial',
    consistency: 'non_atomic',
    stages: {
      deep: { state: complete ? 'complete' : 'partial', startedAt: at, completedAt: at, error: null, result: deepResult(complete) },
      rows: { state: 'complete', startedAt: at, completedAt: at, error: null,
        expectedSources: 2, checkedBooks: 2, accessOnlyBooks: 0, failedSources: [],
        results: [row('УО', 1), row('УИО', 0)] },
      metrics: { state: 'not_run', reason: 'Не запускалось' },
      crossbook: { state: 'not_run', reason: 'Не запускалось' },
      text: { state: 'not_run', reason: 'Не запускалось' },
      history: { state: 'not_run', reason: 'Не запускалось' },
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
  runSourceDiagnostics.mockResolvedValue(runResult(true));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});
function renderPage() {
  return render(<TooltipProvider delayDuration={0}><SettingsPage /></TooltipProvider>);
}

describe('Система: единый запуск проверок источников', () => {
  it('одна кнопка вызывает один серверный маршрут, показывает охват без исторической недели', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить источники' }));
    await screen.findByText(/Диагностика источников завершена/);
    expect(runSourceDiagnostics).toHaveBeenCalledTimes(1);
    expect(oldDeepCheck).not.toHaveBeenCalled();
    expect(oldValidateAll).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('run-1234');
    expect(document.body.textContent).toContain('Замечаний: 1');
    expect(document.body.textContent).toContain('Метрики, межкнижная сверка, тексты');
    expect(document.body.textContent).toContain('2 из 2 книг');
    fireEvent.click(screen.getByText('Результат по каждой книге'));
    expect(document.body.textContent).toContain('УО:');
    expect(document.body.textContent).toContain('УИО:');
  });

  it('непрочитанная книга не объявляется здоровой с нулём дефектов', async () => {
    runSourceDiagnostics.mockResolvedValueOnce(runResult(false));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить источники' }));
    await screen.findByText(/Диагностика источников выполнена не полностью/);
    expect(document.body.textContent).toContain('Чтение неполное');
    expect(document.body.textContent).toContain('1 из 2 книг');
  });

  it('конкурирующий клик не запускает второй запрос пока предыдущий не завершился', async () => {
    let finish: (value: ReturnType<typeof runResult>) => void = () => undefined;
    runSourceDiagnostics.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage();
    const button = await screen.findByRole('button', { name: 'Проверить источники' });
    fireEvent.click(button);
    expect(runSourceDiagnostics).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Прочитать книги заново' }) as HTMLButtonElement).disabled).toBe(true);
    finish(runResult(true));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(runSourceDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('доступность агрегата не называется построчной проверкой', async () => {
    getSources.mockResolvedValue({
      sources: [
        { name: 'УО', status: 'ok', rowCount: 20 },
        { name: 'УИО', status: 'ok', rowCount: 30 },
        { name: 'СВОД ТД-ПМ', status: 'ok', rowCount: 40 },
      ],
    });
    const combined = runResult(true);
    combined.stages.rows.results.push(row('СВОД ТД-ПМ', 0, 'access_only'));
    combined.stages.rows.expectedSources = 3;
    combined.stages.rows.accessOnlyBooks = 1;
    runSourceDiagnostics.mockResolvedValueOnce(combined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить источники' }));
    await waitFor(() => expect(document.body.textContent).toContain('Агрегатных источников прочитано: 1'));
    expect(document.body.textContent).toContain('Построчные правила ГРБС к агрегированному листу не применяются');
  });

  it('показывает отдельный отказ глубокого этапа, даже если строки проверены', async () => {
    const combined = runResult(true);
    combined.status = 'partial';
    combined.stages.deep.state = 'failed';
    combined.stages.deep.result = null as never;
    combined.stages.deep.error = 'Google не отдал формулы';
    runSourceDiagnostics.mockResolvedValueOnce(combined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить источники' }));
    await screen.findByText(/Диагностика источников выполнена не полностью/);
    expect(document.body.textContent).toContain('Google не отдал формулы');
    expect(document.body.textContent).toContain('Замечаний: 1');
  });
});
