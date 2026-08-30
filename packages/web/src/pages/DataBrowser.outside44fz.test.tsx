// @vitest-environment jsdom
/**
 * Стражи «Реестра»: класс «вне периметра 44-ФЗ» и жетон дефекта формулы
 * (срез 4 волны обмотки, 30.08.2026).
 *
 * Обещания под охраной:
 *   1. строка, у которой в обосновании (M) или примечании ГРБС (AF) назван
 *      другой закон, несёт ЖЕТОН — и по умолчанию показана ВМЕСТЕ со всеми:
 *      класс заводился, чтобы такие строки было видно, а не чтобы они пропали;
 *   2. переключатель «отдельно» оставляет в таблице только их;
 *   3. подпись честна: пока счёты исполнения такие строки включают, она об
 *      этом говорит — обещать исключение, которого в расчёте нет, нельзя;
 *   4. строка с дефектом формулы книги несёт свой признак с адресом ячейки,
 *      и колонка замечаний у неё НЕ говорит «замечаний нет».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getCheckById } from '@aemr/shared';
import { TooltipProvider } from '../components/ui/tooltip';
import { useStore } from '../store';
import { DataBrowserPage } from './DataBrowser';
import { OUTSIDE_44FZ_BADGE } from '../lib/rows/outside-44fz';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

class EventSourceStub {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as Record<string, unknown>).EventSource ??= EventSourceStub;

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

/**
 * Три строки книги УО: обычная закупка, закупка по положению 223-ФЗ (назван в
 * обосновании) и строка, у которой другой закон назван в примечании ГРБС.
 */
const ROWS = [
  {
    id: 1,
    dept: 'УО',
    subject: 'Ремонт кровли',
    method: 'ЭА',
    planSum: 1200,
    factSum: 900,
    economy: 300,
    status: 'Подписан',
    signals: [],
  },
  {
    id: 2,
    dept: 'УО',
    subject: 'Поставка тепловой энергии',
    method: 'ЕП',
    epReason: 'Закупка с ЕП по положению -223ФЗ',
    planSum: 400,
    factSum: 380,
    economy: 0,
    status: 'Подписан',
    signals: [],
  },
  {
    id: 3,
    dept: 'УО',
    subject: 'Услуги связи',
    method: 'ЕП',
    commentGRBS: 'Проводится по положению о закупках',
    planSum: 200,
    factSum: 0,
    economy: 0,
    status: 'Планируется',
    signals: [],
  },
];

/** Замечание формульной целостности на первой строке — как его рождает ядро. */
const FORMULA_ISSUE = {
  id: 'formula|overwritten|УО|K|1|0',
  checkId: 'formula_overwritten',
  sheet: 'УО',
  departmentId: 'uo',
  cell: 'K1',
  row: 1,
  rowSeq: '1',
  description:
    'УО, ячейка K1 (закупка № 1): вместо формулы стоит «229,4». '
    + 'Эталон графы: =SUM(H#:J#); целая формула — в строке 2.',
};

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
    subordinatesMap: { 'УО': [] },
    selectedDepartments: new Set(['УО']),
    deptOnlyMode: new Set<string>(),
    year: 2026,
    registrySignalSeed: [],
    dashboardData: { snapshot: { issues: [FORMULA_ISSUE] } } as never,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useStore.setState({
    selectedDepartments: new Set<string>(),
    deptOnlyMode: new Set<string>(),
    registrySignalSeed: [],
    dashboardData: null,
  });
});

function renderPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <DataBrowserPage />
    </TooltipProvider>,
  );
}

const flat = (): string => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('класс «вне периметра 44-ФЗ» в Реестре', () => {
  it('по умолчанию строки показаны ВМЕСТЕ и помечены жетоном', async () => {
    renderPage();
    await screen.findByText('Ремонт кровли');
    // Все три строки на месте: класс не сужает перечень по умолчанию.
    expect(screen.getByText('Поставка тепловой энергии')).toBeTruthy();
    expect(screen.getByText('Услуги связи')).toBeTruthy();
    // Жетон стоит ровно на двух — по обоснованию и по примечанию.
    expect(screen.getAllByText(OUTSIDE_44FZ_BADGE)).toHaveLength(2);
  });

  it('подпись говорит число и то, что счёты исполнения такие строки включают', async () => {
    renderPage();
    await screen.findByText('Ремонт кровли');
    const text = flat();
    expect(text).toContain('Вне периметра 44-ФЗ — 2 строки');
    expect(text).toContain('Счёты исполнения эти строки пока включают');
  });

  it('переключатель «Отдельно» оставляет только строки вне периметра', async () => {
    renderPage();
    await screen.findByText('Ремонт кровли');
    fireEvent.click(screen.getByText('Отдельно'));
    expect(screen.queryByText('Ремонт кровли')).toBeNull();
    expect(screen.getByText('Поставка тепловой энергии')).toBeTruthy();
    expect(screen.getByText('Услуги связи')).toBeTruthy();
    expect(flat()).toContain('в таблице сейчас только они');
  });

  it('возврат к «Вместе» возвращает весь перечень', async () => {
    renderPage();
    await screen.findByText('Ремонт кровли');
    fireEvent.click(screen.getByText('Отдельно'));
    expect(screen.queryByText('Ремонт кровли')).toBeNull();
    fireEvent.click(screen.getByText('Вместе'));
    expect(screen.getByText('Ремонт кровли')).toBeTruthy();
  });
});

describe('жетон дефекта формулы на строке Реестра', () => {
  it('строка с дефектом несёт признак с адресом ячейки', async () => {
    renderPage();
    await screen.findByText('Ремонт кровли');
    expect(screen.getByText('формула: K1')).toBeTruthy();
  });

  it('подсказка жетона называет класс из реестра проверок, что стоит и эталон', async () => {
    renderPage();
    await screen.findByText('Ремонт кровли');
    const hint = screen.getByText('формула: K1').getAttribute('title') ?? '';
    expect(hint).toContain(getCheckById('formula_overwritten')!.name);
    expect(hint).toContain('229,4');
    expect(hint).toContain('=SUM(H#:J#)');
  });

  it('у строки с дефектом формулы колонка замечаний не говорит «замечаний нет»', async () => {
    renderPage();
    await screen.findByText('Ремонт кровли');
    // Две строки без дефекта — две надписи; третьей быть не должно.
    expect(screen.getAllByText('замечаний нет')).toHaveLength(2);
  });
});
