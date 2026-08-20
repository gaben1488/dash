// @vitest-environment jsdom
/**
 * Страж режима подведов на вкладке «Дисциплина» (приказ владельца 20.08.2026).
 *
 * Проверяется не оформление, а четыре обещания экрана:
 *   1. выбран ОДИН ГРБС «с подведомственными» — сводка дел раскладывается по
 *      организациям управления, а не остаётся одной строкой;
 *   2. подвед БЕЗ единой строки в выборке из разбивки не пропадает: «строк
 *      нет» и «учреждения нет» — разные новости, и первая сказана словами;
 *   3. режим «только ГРБС» разбивку не строит и говорит, чем она скрыта, —
 *      молчаливой пустоты вместо неё быть не может;
 *   4. районный срез (управление не выбрано) остаётся прежним: разбивки нет.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TooltipProvider } from '../components/ui/tooltip';
import { useStore } from '../store';
import { DisciplinePage } from './Discipline';

// jsdom не реализует ResizeObserver, а Radix меряет им стрелку подсказки.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

/** Строки книги УО: аппарат с делом и один подвед с делом; второй — молчит. */
const ROWS = [
  {
    dept: 'УО',
    subordinate: '',
    signals: ['planYearMissing'],
    planSum: 1200,
    factSum: 0,
  },
  {
    dept: 'УО',
    subordinate: 'МБОУ «Школа № 1»',
    signals: ['epJustificationMissing'],
    planSum: 400,
    factSum: 0,
  },
];

/**
 * Ответ по адресу: строки книги отдаём только роуту реестра, всем остальным
 * запросам страницы (сроки, нагрузка) отвечаем отказом — их собственные
 * честные плашки разбивке не мешают.
 */
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url);
    if (url.includes('/rows/')) {
      return Promise.resolve(new Response(
        JSON.stringify({ rows: ROWS, pagination: { totalPages: 1 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ));
    }
    return Promise.resolve(new Response(JSON.stringify({ error: 'нет данных' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }));
  }));
}

beforeEach(() => {
  stubFetch();
  useStore.setState({
    subordinatesMap: { 'УО': ['МБОУ «Школа № 1»', 'МБОУ «Школа № 2»'] },
    selectedDepartments: new Set(['УО']),
    deptOnlyMode: new Set<string>(),
    year: 2026,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useStore.setState({
    selectedDepartments: new Set<string>(),
    deptOnlyMode: new Set<string>(),
  });
});

function renderPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <DisciplinePage />
    </TooltipProvider>,
  );
}

const flat = (): string => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('Дисциплина: режим подведов', () => {
  it('один ГРБС «с подведомственными» — сводка раскладывается по организациям', async () => {
    renderPage();

    expect(await screen.findByText('Аппарат управления')).toBeTruthy();
    expect(screen.getByText('МБОУ «Школа № 1»')).toBeTruthy();
    expect(flat()).toContain('Дела по организациям управления');
  });

  it('подвед без строк из разбивки не пропадает — «строк нет» сказано словами', async () => {
    renderPage();

    await screen.findByText('Аппарат управления');
    const silent = screen.getByRole('row', { name: /Школа № 2/ });
    expect(silent.textContent).toContain('строк этой организации в выборке нет');
    // Ноль вместо причины означал бы «дел нет», а верно — «считать не из чего».
    expect(silent.textContent).not.toMatch(/(^|\s)0(\s|$)/);
  });

  it('режим «только ГРБС» разбивку не строит и называет причину', async () => {
    useStore.setState({ deptOnlyMode: new Set(['УО']) });
    renderPage();

    await screen.findByText(/Сводка дел/);
    expect(flat()).toContain('Выбран режим «только ГРБС»');
    expect(screen.queryByText('Аппарат управления')).toBeNull();
  });

  it('районный срез разбивки не заводит', async () => {
    useStore.setState({ selectedDepartments: new Set<string>() });
    renderPage();

    await screen.findByText(/Сводка дел/);
    expect(screen.queryByText('Аппарат управления')).toBeNull();
    expect(flat()).not.toContain('Дела по организациям управления');
  });
});
