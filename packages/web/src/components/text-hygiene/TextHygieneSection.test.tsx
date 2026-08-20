// @vitest-environment jsdom
/**
 * Стражи раздела «Гигиена текста» (канон п.122 + п.98д).
 *
 * Проверяется не оформление, а четыре обещания экрана:
 *   1. каждая находка — строка таблицы с адресом (лист · ячейка), родом,
 *      контекстом и готовым значением: структура вместо простыни (п.122);
 *   2. орфография — отдельной группой со словом, контекстом и предложением;
 *   3. пустота честная: «дефектов не найдено» называет знаменатель —
 *      сколько ячеек проверено, — а не просто показывает пустое место;
 *   4. «книги не прочитаны» не выдаётся за «дефектов нет»: другой тон,
 *      другие слова.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TooltipProvider } from '../ui/tooltip';
import { TextHygieneSection } from './TextHygieneSection';
import type { TextHygieneResponse } from './contract';

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

const fetchJSONMock = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({
  fetchJSON: fetchJSONMock,
  humanizeRequestError: (err: unknown) => String(err),
}));

afterEach(() => {
  cleanup();
  fetchJSONMock.mockReset();
});

/** Ответ с находками: живой кейс «Жар-Птица» + двойной пробел + опечатка. */
const WITH_FINDINGS: TextHygieneResponse = {
  asOf: '2026-08-20T09:30:00.000Z',
  rowsSource: 'live',
  booksChecked: ['УО', 'УЭР'],
  booksSilent: ['УД'],
  byDept: [
    {
      dept: 'УО',
      deptLatin: 'uo',
      deptName: 'Управление образования',
      sheet: 'ВСЕ',
      items: [
        {
          cell: 'C2309',
          row: 2309,
          rowSeq: '531',
          col: 'C',
          kind: 'registry_mismatch',
          label: 'имя подведа отступает от справочника',
          context: '«МБДОУ ДС №3 «Жар-Птица»»',
          fix: 'МБДОУ ДС № 3 «Жар-Птица»',
        },
        {
          cell: 'G12',
          row: 12,
          rowSeq: '9',
          col: 'G',
          kind: 'double_space',
          label: 'двойные пробелы',
          context: 'Поставка  бумаги',
          fix: 'Поставка бумаги',
        },
      ],
      countsByKind: { registry_mismatch: 1, double_space: 1 },
    },
  ],
  language: [
    {
      dept: 'УЭР',
      deptLatin: 'uer',
      sheet: 'ВСЕ',
      cell: 'M6',
      row: 6,
      rowSeq: '3',
      col: 'M',
      kind: 'spelling',
      word: 'катриджей',
      context: 'закупка катриджей у единственного',
      suggestion: 'картриджей',
      confidence: 'высокая',
      fix: 'закупка картриджей у единственного поставщика',
    },
  ],
  totals: {
    rowsChecked: 2700,
    cellsChecked: 8100,
    hygieneFindings: 2,
    languageFindings: 1,
    countsByKind: { registry_mismatch: 1, double_space: 1 },
  },
  notes: ['Не прочитаны строки книг: УД. По ним проверки не было — это не «дефектов нет».'],
};

/** Чистый ответ: всё проверено, дефектов нет. */
const CLEAN: TextHygieneResponse = {
  asOf: '2026-08-20T09:30:00.000Z',
  rowsSource: 'live',
  booksChecked: ['УО', 'УЭР'],
  booksSilent: [],
  byDept: [],
  language: [],
  totals: {
    rowsChecked: 2700,
    cellsChecked: 8100,
    hygieneFindings: 0,
    languageFindings: 0,
    countsByKind: {},
  },
  notes: [],
};

function renderSection() {
  return render(
    <TooltipProvider>
      <TextHygieneSection />
    </TooltipProvider>,
  );
}

describe('TextHygieneSection', () => {
  it('находка — строка таблицы: адрес, род, контекст, готовое значение (п.122)', async () => {
    fetchJSONMock.mockResolvedValueOnce(WITH_FINDINGS);
    renderSection();

    // Адрес двойной: лист · ячейка + стабильный «№ п/п» (п.98б).
    expect(await screen.findByText('ВСЕ · C2309')).toBeTruthy();
    expect(screen.getByText('№ п/п 531')).toBeTruthy();
    // Род и конкретный случай названы по-русски.
    expect(screen.getByText('имя подведа отступает от справочника')).toBeTruthy();
    // Готовое значение видно и копируется кнопкой.
    expect(screen.getByText('МБДОУ ДС № 3 «Жар-Птица»')).toBeTruthy();
    expect(screen.getAllByLabelText('Скопировать готовое значение ячейки').length).toBeGreaterThan(0);
    // Счётчик рода — чипом-фильтром.
    expect(screen.getByText('двойные пробелы · 1')).toBeTruthy();
  });

  it('орфография — отдельной группой: слово, контекст, предложение словаря', async () => {
    fetchJSONMock.mockResolvedValueOnce(WITH_FINDINGS);
    renderSection();

    expect(await screen.findByText('Орфография')).toBeTruthy();
    // Слово живёт и в колонке «Слово», и подсвеченным в контексте — минимум дважды.
    expect(screen.getAllByText('катриджей').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('картриджей')).toBeTruthy();
    expect(screen.getByText('высокая')).toBeTruthy();
  });

  it('пустота честная: «дефектов не найдено» называет, сколько ячеек проверено', async () => {
    fetchJSONMock.mockResolvedValueOnce(CLEAN);
    renderSection();

    expect(await screen.findByText('Дефектов не найдено')).toBeTruthy();
    // Знаменатель проверки — рядом с утверждением о чистоте.
    expect(screen.getByText(/Проверено 8\s*100/)).toBeTruthy();
  });

  it('«книги не прочитаны» не выдаётся за «дефектов нет»', async () => {
    fetchJSONMock.mockResolvedValueOnce({
      ...CLEAN,
      rowsSource: 'none',
      booksChecked: [],
      booksSilent: ['УО', 'УЭР'],
      totals: { ...CLEAN.totals, rowsChecked: 0, cellsChecked: 0 },
    } satisfies TextHygieneResponse);
    renderSection();

    expect(await screen.findByText('Строки книг не прочитаны — проверки не было')).toBeTruthy();
    expect(screen.queryByText('Дефектов не найдено')).toBeNull();
  });
});
