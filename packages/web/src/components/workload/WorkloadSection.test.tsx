// @vitest-environment jsdom
/**
 * Стражи секции «Нагрузка управлений» (канон п.103) и блока «События над
 * строками» (канон п.105).
 *
 * Проверяется не оформление, а четыре обещания экрана:
 *   1. нагрузка показана ОТНОШЕНИЯМИ, а не одними абсолютами: иначе книга с 44
 *      учреждениями и книга с одной организацией несравнимы;
 *   2. слепой журнал назван словом и объяснён — «правок мало» не выдаётся за
 *      «работы нет»;
 *   3. книга, чей журнал не прочитан, не получает нулей: вместо чисел стоит
 *      причина;
 *   4. ненаблюдаемость удалений объявлена вслух, а не спрятана за нулём.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TooltipProvider } from '../ui/tooltip';
import { WorkloadSection } from './WorkloadSection';
import type { WorkloadResponse } from './contract';

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Живой замер 18.08.2026: разброс журналов в тысячи раз при близких книгах. */
const RESPONSE: WorkloadResponse = {
  asOf: '2026-08-18T09:30:00.000Z',
  rowsSource: 'live',
  booksTotal: 3,
  booksMeasured: 2,
  booksSilent: ['УД'],
  books: [
    {
      dept: 'УО', deptLatin: 'uo', deptName: 'Управление образования', sheetName: 'ВСЕ',
      rowsAvailable: true, journalAvailable: true,
      rows: 2675, subordinates: 44, journalEntries: 33724,
      editsPerRow: 12.61, rowsPerSubordinate: 60.8, editsPerSubordinate: 766.5,
      observability: 'rich',
      events: { added: 120, cleared: 4, edits: 33000 },
      note: 'История правок ведётся: по каждой строке видно, что и когда меняли.',
    },
    {
      dept: 'УИО', deptLatin: 'uio', deptName: 'Управление имущественных отношений', sheetName: 'УИО',
      rowsAvailable: true, journalAvailable: true,
      rows: 70, subordinates: 1, journalEntries: 13,
      editsPerRow: 0.19, rowsPerSubordinate: 70, editsPerSubordinate: 13,
      observability: 'blind',
      events: { added: 1, cleared: 0, edits: 12 },
      note:
        'Журнал правок почти не ведётся: отсутствие записей здесь не означает отсутствие ' +
        'работы — историю по этой книге восстановить нечем.',
    },
    {
      dept: 'УД', deptLatin: 'ud', deptName: 'Управление делами', sheetName: 'ВСЕ',
      rowsAvailable: true, journalAvailable: false, journalError: 'книга не ответила',
      rows: 198, subordinates: 2, journalEntries: null,
      editsPerRow: null, rowsPerSubordinate: null, editsPerSubordinate: null,
      observability: null,
      events: null,
      note:
        'УД: строки книги прочитаны, а журнал правок — нет (книга не ответила). Это не ' +
        '«правок не было»: истории по книге сейчас нет вовсе.',
    },
  ],
  totals: { rows: 2745, subordinates: 45, journalEntries: 33737 },
  blindDepts: ['УИО'],
  rowsPerSubordinateSpread: 1.2,
  events: {
    added: 121, cleared: 4, edits: 33012,
    deletionsUnobservable: true, countedBooks: ['УО', 'УИО'],
    note: 'Журнал книги записывает правки ячеек.',
  },
  notes: [
    'Нагрузка — измерение трудоёмкости, а не рейтинг вины.',
    'Журнал не прочитан: УД. По этим книгам события не посчитаны — это не ноль событий.',
  ],
};

function stubFetch(body: unknown, ok = true) {
  const spy = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  })));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function renderSection() {
  return render(
    <TooltipProvider delayDuration={0}>
      <WorkloadSection />
    </TooltipProvider>,
  );
}

const flat = (): string => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('Нагрузка управлений', () => {
  it('показывает меры отношениями, а не одними абсолютами', async () => {
    stubFetch(RESPONSE);
    renderSection();

    // Дожидаемся первой книги — до ответа таблицы нет вовсе.
    expect(await screen.findByText('УО')).toBeTruthy();

    const table = screen.getByRole('table');
    const uoRow = screen.getByRole('row', { name: /УО/ });
    // Разряды русских чисел разделяет неразрывный пробел — приводим к обычному.
    const cells = [...uoRow.querySelectorAll('td')].map(
      (c) => c.textContent?.replace(/\s/g, ' ').trim(),
    );
    // Строк · учреждений · правок · правок на строку · строк на учреждение.
    expect(cells).toEqual(expect.arrayContaining(['2 675', '44', '33 724', '12,6', '60,8']));
    expect(table.textContent).toContain('журнал живой');
  });

  it('слепой журнал назван словом и объяснён — это не «работы нет»', async () => {
    stubFetch(RESPONSE);
    renderSection();
    await screen.findByText('УО');

    const blind = screen.getByText('журнал слепой');
    expect(blind.getAttribute('title')).toContain('не означает отсутствие');
  });

  it('книга с непрочитанным журналом получает причину, а не нули', async () => {
    stubFetch(RESPONSE);
    renderSection();
    await screen.findByText('УО');

    const udRow = screen.getByRole('row', { name: /УД/ });
    expect(udRow.textContent).toContain('не «правок не было»');
    // Ни одной цифры на месте мер: ноль здесь читался бы как «работы нет».
    expect(udRow.querySelectorAll('td')).toHaveLength(1);
    expect(udRow.textContent).not.toMatch(/(^|\s)0(\s|$)/);
  });

  it('называет момент чтения и оговаривает, что период в шапке числа не сужает', async () => {
    stubFetch(RESPONSE);
    renderSection();
    await screen.findByText('УО');

    expect(flat()).toContain('прочитано');
    expect(flat()).toContain('период в шапке их не сужает');
  });

  it('тон — измерение трудоёмкости, а не рейтинг вины', async () => {
    stubFetch(RESPONSE);
    renderSection();
    await screen.findByText('УО');

    expect(flat()).toContain('не рейтинг вины');
  });
});

describe('События над строками', () => {
  it('показывает три рода событий и объявляет удаления ненаблюдаемыми', async () => {
    stubFetch(RESPONSE);
    renderSection();
    await screen.findByText('УО');

    const panel = screen.getByRole('region', { name: 'События над строками' });
    expect(panel.textContent).toContain('добавлено закупок');
    expect(panel.textContent).toContain('строк очищено');
    expect(panel.textContent?.replace(/\s+/g, ' ')).toContain(
      'Удаления строк журналом не фиксируются',
    );
    expect(panel.textContent).toContain('№ п/п');
    // Четвёртого числа нет: «удалено: 0» было бы враньём.
    expect(panel.textContent).not.toContain('удалено закупок');
  });

  it('называет книги, чьи события в суммы не вошли', async () => {
    stubFetch(RESPONSE);
    renderSection();
    await screen.findByText('УО');

    const panel = screen.getByRole('region', { name: 'События над строками' });
    expect(panel.textContent?.replace(/\s+/g, ' ')).toContain('Журнал не прочитан у книг: УД');
    expect(panel.textContent).toContain('не ноль событий');
  });
});

describe('честная пустота', () => {
  it('ни одной измеренной книги — причина вместо нулей', async () => {
    stubFetch({
      ...RESPONSE,
      booksMeasured: 0,
      books: [RESPONSE.books[2]],
      events: { ...RESPONSE.events, added: 0, cleared: 0, edits: 0, countedBooks: [] },
    });
    renderSection();

    expect(await screen.findByText('Ни по одной книге меры не посчитаны')).toBeTruthy();
    expect(flat()).toContain('нужны обе половины');
    // Таблица остаётся: она показывает, по какой книге чего не хватило.
    expect(screen.getByRole('row', { name: /УД/ }).textContent).toContain('не «правок не было»');
  });

  it('отказ сервера объясняется словами и даёт повтор', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Failed to fetch'))));
    renderSection();

    expect(await screen.findByText(/Нагрузка не прочитана/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Прочитать ещё раз/ })).toBeTruthy();
  });
});
