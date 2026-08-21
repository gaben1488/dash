// @vitest-environment jsdom
/**
 * Стражи «Реестра»: режим подведов и пресет-срезы (приказ владельца 20.08.2026).
 *
 * Реестр — единственное место, где разрез по учреждениям НАСТОЯЩИЙ: заказчик
 * записан в самой строке книги (колонка C), поэтому здесь проверяется не
 * оговорка о невозможности разбивки (как на «Своде»), а сама разбивка.
 *
 * Обещания, за которыми следит файл:
 *   1. выбран ОДИН ГРБС «с подведомственными» — под шапкой появляется разбивка
 *      по организациям: аппарат первой строкой, дальше учреждения;
 *   2. учреждение БЕЗ строк в выборке из разбивки не пропадает и говорит
 *      словами «строк нет» — «строк нет» и «организации нет» разные новости;
 *   3. режим «только управление» разбивку не строит и называет, чем она
 *      скрыта, — молчаливой пустоты вместо неё быть не может;
 *   4. районный срез (управление не выбрано) остаётся прежним: разбивки нет;
 *   5. срезы: словарь пресетов доезжает до экрана вместе со счётом, а срез
 *      без единой подходящей строки гаснет, а не притворяется доступным.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ECONOMY_FLAG_CANON } from '@aemr/shared';
import { TooltipProvider } from '../components/ui/tooltip';
import { useStore } from '../store';
import { DataBrowserPage } from './DataBrowser';

// jsdom не реализует ResizeObserver, а Radix меряет им стрелку подсказки.
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
 * Строки книги УО: закупка аппарата (плейсхолдер колонки C) и закупка первой
 * школы с непроставленной отметкой экономии. Вторая школа молчит — её и ждём
 * в разбивке пустой строкой.
 */
const ROWS = [
  {
    id: 1,
    dept: 'УО',
    subordinate: 'х',
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
    subordinate: 'МБОУ «Школа № 1»',
    subject: 'Поставка учебников',
    method: 'ЕП',
    planSum: 400,
    factSum: 380,
    // Графы экономии книги (Z/AA/AB) у класса пусты по построению: формула
    // листа заполняет их только после отметки «да» в графе «Статус», а её
    // тут и нет — ровно поэтому срез читает экономию как план минус факт.
    economy: 0,
    status: 'Просрочен',
    signals: [ECONOMY_FLAG_CANON.signal],
  },
];

/** Строки книги отдаём роуту реестра; остальным запросам — честный отказ. */
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
    // Затравка перехода живёт ровно один заход: каждый тест начинает с пустой.
    registrySignalSeed: [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useStore.setState({
    selectedDepartments: new Set<string>(),
    deptOnlyMode: new Set<string>(),
    registrySignalSeed: [],
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

describe('Реестр: режим подведов', () => {
  it('один ГРБС «с подведомственными» — выборка раскладывается по организациям', async () => {
    renderPage();

    expect(await screen.findByText('Аппарат управления')).toBeTruthy();
    expect(screen.getByText('МБОУ «Школа № 1»')).toBeTruthy();
    expect(flat()).toContain('Организации управления');
  });

  it('учреждение без строк из разбивки не пропадает — причина сказана словами', async () => {
    renderPage();

    await screen.findByText('Аппарат управления');
    const silent = screen.getByRole('row', { name: /Школа № 2/ });
    expect(silent.textContent).toContain('строк этой организации в выборке нет');
  });

  it('режим «только управление» разбивку не строит и называет причину', async () => {
    useStore.setState({ deptOnlyMode: new Set(['УО']) });
    renderPage();

    await screen.findByText(/Организации управления/);
    expect(flat()).toContain('Выбран режим «только управление»');
    expect(screen.queryByText('Аппарат управления')).toBeNull();
  });

  it('районный срез разбивки не заводит', async () => {
    useStore.setState({ selectedDepartments: new Set<string>() });
    renderPage();

    await screen.findByText(/Ремонт кровли/);
    expect(screen.queryByText('Аппарат управления')).toBeNull();
    expect(flat()).not.toContain('Организации управления');
  });
});

describe('Реестр: пресет-срезы', () => {
  it('словарь срезов доезжает до экрана со счётом по загруженным строкам', async () => {
    renderPage();

    await screen.findByText(/Ремонт кровли/);
    // Отбор по группе срезов, а не по всему экрану: с 21.08.2026 чип признака
    // в строке — тоже кнопка (щелчок добавляет признак в фильтр), и одно имя
    // носят два разных элемента.
    const slices = within(screen.getByRole('group', { name: 'Готовые срезы строк' }));
    const slice = slices.getByRole('button', { name: /Экономия без отметки/ });
    // Ровно одна загруженная строка несёт признак — счёт кнопки её и называет.
    expect(slice.textContent).toContain('1');
    expect(slice.getAttribute('aria-pressed')).toBe('false');
  });

  it('затравка перехода по ключу класса открывает именованный срез', async () => {
    // Кнопка-чип карточки «Пульта» или «Экономии» присылает ключ класса —
    // читатель должен попасть в срез с подписью и механизмом отбора, а не в
    // молча сузившуюся таблицу.
    useStore.setState({ registrySignalSeed: [ECONOMY_FLAG_CANON.signal] });
    renderPage();

    await screen.findByText(/Поставка учебников/);
    const slices = within(screen.getByRole('group', { name: 'Готовые срезы строк' }));
    const slice = slices.getByRole('button', { name: /Экономия без отметки/ });
    expect(slice.getAttribute('aria-pressed')).toBe('true');
    // В таблице осталась только строка класса — вторая ушла из выборки.
    expect(flat()).toContain('Поставка учебников');
    expect(flat()).not.toContain('Ремонт кровли');
    // Затравка живёт один переход: store очищен сразу после чтения.
    expect(useStore.getState().registrySignalSeed).toEqual([]);
  });

  it('в срезе столбец экономии читается по числам и называет долю от плана', async () => {
    useStore.setState({ registrySignalSeed: [ECONOMY_FLAG_CANON.signal] });
    renderPage();

    await screen.findByText(/Поставка учебников/);
    // Графы экономии книги у класса пусты по построению, поэтому столбец
    // показывает план минус факт (400 − 380 = 20) и долю 5 % от плана.
    expect(flat()).toContain('% плана');
    expect(flat()).toContain('по числам');
    expect(flat()).toContain('5,0');
  });

  it('срез без подходящих строк гаснет, а не притворяется доступным', async () => {
    renderPage();

    await screen.findByText(/Ремонт кровли/);
    // Критических замечаний в строках нет — кнопка выключена и объясняет себя.
    const critical = screen.getByRole('button', { name: /Требуют разбора/ });
    expect(critical.hasAttribute('disabled')).toBe(true);
    expect(critical.getAttribute('title') ?? '').toContain('Среди загруженных строк');
  });

  it('отбор по состоянию строки предлагает только встреченные состояния и сужает выборку', async () => {
    renderPage();

    await screen.findByText(/Ремонт кровли/);
    const select = screen.getByLabelText('Состояние') as HTMLSelectElement;
    // Варианты собраны по загруженным строкам, со счётом каждого.
    const options = [...select.options].map((o) => o.textContent);
    expect(options).toContain('Подписан (1)');
    expect(options).toContain('Просрочен (1)');
    // Состояния, которого в строках нет, в списке тоже нет: недостижимых
    // вариантов отбор не обещает.
    expect(options.some((o) => (o ?? '').startsWith('Отменён'))).toBe(false);

    await act(async () => {
      fireEvent.change(select, { target: { value: 'Просрочен' } });
    });
    expect(flat()).toContain('Поставка учебников');
    expect(flat()).not.toContain('Ремонт кровли');
    // Отбор назван в подписи счёта наравне с прочими фильтрами экрана.
    expect(flat()).toContain('состояние «Просрочен»');
  });

  it('сводка выборки несёт паспорт периметра, а не один бейдж периода', async () => {
    renderPage();

    await screen.findByText(/Ремонт кровли/);
    // Пять осей паспорта: год, период, органы, срез и момент чтения книг.
    // Момент сервер в тесте не называл — и паспорт говорит незнание, а не
    // выдаёт молчание за свежесть.
    expect(flat()).toContain('2026');
    expect(flat()).toContain('УО');
    expect(flat()).toContain('момент чтения неизвестен');
  });
});
