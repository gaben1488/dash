// @vitest-environment jsdom
/**
 * Система → Источники данных: глубокая проверка — настоящее действие,
 * а не декоративная кнопка. Не требует наличия архивной контрольной недели.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../components/ui/tooltip';
import { SettingsPage } from './Settings';

const getSources = vi.fn();
const settingsStatus = vi.fn();
const checkSourceIntegrityDeep = vi.fn();

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSources: (...args: unknown[]) => getSources(...(args as [])),
      settingsStatus: (...args: unknown[]) => settingsStatus(...(args as [])),
      checkSourceIntegrityDeep: (...args: unknown[]) => checkSourceIntegrityDeep(...(args as [])),
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
  return {
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
  checkSourceIntegrityDeep.mockResolvedValue(result(true));
});

afterEach(() => {
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

describe('Кнопка глубокой проверки', () => {
  it('вручную запускает одно чтение, показывает охват и не требует исторической недели', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: 'Глубокая проверка книг' });
    fireEvent.click(button);
    await screen.findByText(/Чтение завершено/);
    expect(checkSourceIntegrityDeep).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('2 из 2 книг');
    expect(document.body.textContent).toContain('отсутствие первого недельного среза проверке не мешает');
    fireEvent.click(screen.getByText('Результат по каждой книге'));
    expect(document.body.textContent).toContain('УО:');
    expect(document.body.textContent).toContain('УИО:');
  });

  it('непрочитанная книга не объявляется здоровой с нулём дефектов', async () => {
    checkSourceIntegrityDeep.mockResolvedValueOnce(result(false));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Глубокая проверка книг' }));
    await screen.findByText(/Чтение неполное/);
    expect(document.body.textContent).toContain('1 из 2 книг');
    fireEvent.click(screen.getByText('Результат по каждой книге'));
    expect(document.body.textContent).toContain('формулы этого запуска не прочитаны');
  });

  it('не начинает второе чтение, пока первое не закончилось', async () => {
    let finish: (value: ReturnType<typeof result>) => void = () => undefined;
    checkSourceIntegrityDeep.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderPage();
    const button = await screen.findByRole('button', { name: 'Глубокая проверка книг' });
    fireEvent.click(button);
    expect(checkSourceIntegrityDeep).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Проверить данные во всех книгах' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Прочитать книги заново' }) as HTMLButtonElement).disabled).toBe(true);
    finish(result(true));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(checkSourceIntegrityDeep).toHaveBeenCalledTimes(1);
  });
});
