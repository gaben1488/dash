// @vitest-environment jsdom
/**
 * Стражи раздела «Целостность формул» вкладки «Контроль» (срез 4 волны
 * обмотки, 30.08.2026).
 *
 * Обещания под охраной:
 *   1. ЧЕСТНОЕ МОЛЧАНИЕ. Когда формулы книг не читались, раздел говорит
 *      «не читались» и НЕ произносит «дефектов нет»: пустой перечень при
 *      непрочитанных формулах — не результат проверки, а её отсутствие.
 *   2. ПЕРЕЧЕНЬ ПОЛОН. Строка перечня несёт книгу, адрес ячейки, номер
 *      закупки, класс дефекта, что стоит в ячейке и каков эталон графы —
 *      всё, чем чинят, не переспрашивая.
 *   3. ОТБОР РАБОТАЕТ по книге и по классу, и снятие отбора возвращает всё.
 *   4. ПОДПИСИ КЛАССОВ — из реестра проверок, а не свои.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getCheckById } from '@aemr/shared';
import { FormulaIntegritySection } from './FormulaIntegritySection';

/** Замечания формульной целостности — ровно в той форме, что рождает ядро. */
const ISSUES = [
  {
    id: 'formula|overwritten|УИО|K|34|0',
    checkId: 'formula_overwritten',
    sheet: 'УИО',
    departmentId: 'uio',
    cell: 'K34',
    row: 34,
    rowSeq: '34',
    description:
      'УИО, ячейка K34 (закупка № 34): вместо формулы стоит «6696,6075». '
      + 'Эталон графы: =SUM(H#:J#); целая формула — в строке 35.',
  },
  {
    id: 'formula|mutant|УО|Y|2431|0',
    checkId: 'formula_mutant',
    sheet: 'УО',
    departmentId: 'uo',
    cell: 'Y1894',
    row: 1894,
    rowSeq: '2431',
    description:
      'УО, ячейка Y1894 (закупка № 2431): формула «=SUM(V1894:W1894)» расходится с эталоном '
      + 'графы =SUM(V#:X#).',
  },
  {
    id: 'plan-year-1',
    checkId: 'plan_year_missing',
    sheet: 'УО',
    departmentId: 'uo',
    description: 'Не про формулы вовсе',
  },
];

/** Ответ маршрута целостности источников. */
function integrityResponse(formulas: unknown) {
  return {
    at: '2026-08-30T02:27:00.000Z',
    formulas,
    metadata: { canonSyncedAt: null, books: [], notWatched: [] },
  };
}

function stubIntegrity(formulas: unknown) {
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url);
    if (url.includes('/sources/integrity')) {
      return Promise.resolve(new Response(JSON.stringify(integrityResponse(formulas)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return Promise.resolve(new Response(JSON.stringify({ error: 'нет данных' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }));
  }));
}

const COLUMNS = ['K', 'O', 'P', 'R', 'S', 'T', 'Y', 'Z', 'AA', 'AB', 'AC'];

const READ_TWO_BOOKS = {
  columns: COLUMNS,
  sinkConnected: true,
  books: [
    { book: 'УО', at: '2026-08-30T02:00:00.000Z', cells: 900, handled: true },
    { book: 'УИО', at: '2026-08-30T02:00:00.000Z', cells: 400, handled: true },
  ],
  notRead: [],
};

const NOT_READ_AT_ALL = {
  columns: COLUMNS,
  sinkConnected: true,
  books: [],
  notRead: ['УО', 'УИО'],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flat = (): string => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('честное молчание: «не читались» вместо «дефектов нет»', () => {
  beforeEach(() => stubIntegrity(NOT_READ_AT_ALL));

  it('формулы не читались — сказано прямо, и «дефектов нет» не обещано', async () => {
    render(<FormulaIntegritySection issues={[]} />);
    await screen.findByText(/не читались/);
    const text = flat();
    expect(text).toContain('не читались');
    expect(text).toContain('не значит «дефектов нет»');
    // Пустой перечень объяснён строкой состояния, а не выдан за благополучие.
    expect(text).toContain('пустой перечень бывает и когда');
  });
});

describe('перечень ячеек полон и отбирается', () => {
  beforeEach(() => stubIntegrity(READ_TWO_BOOKS));

  it('строка перечня несёт книгу, ячейку, номер закупки, класс, что стоит и эталон', async () => {
    render(<FormulaIntegritySection issues={ISSUES} />);
    await screen.findByText(/Разобраны формулы/);
    const text = flat();
    expect(text).toContain('УИО');
    expect(text).toContain('K34');
    // Номер закупки — второй, устойчивый адрес строки.
    expect(text).toContain('2431');
    expect(text).toContain('6696,6075');
    expect(text).toContain('=SUM(H#:J#)');
    expect(text).toContain('=SUM(V1894:W1894)');
    expect(text).toContain('=SUM(V#:X#)');
    expect(text).toContain('строка 35');
  });

  it('подписи классов взяты из реестра проверок, а не выдуманы', async () => {
    render(<FormulaIntegritySection issues={ISSUES} />);
    await screen.findByText(/Разобраны формулы/);
    const text = flat();
    expect(text).toContain(getCheckById('formula_overwritten')!.name);
    expect(text).toContain(getCheckById('formula_mutant')!.name);
    expect(text).toContain(getCheckById('formula_hole')!.name);
  });

  it('чужие замечания в перечень не попадают', async () => {
    render(<FormulaIntegritySection issues={ISSUES} />);
    await screen.findByText(/Разобраны формулы/);
    expect(flat()).not.toContain('Не про формулы вовсе');
    expect(flat()).toContain('Показано 2 из 2');
  });

  it('отбор по книге сужает перечень, снятие возвращает всё', async () => {
    render(<FormulaIntegritySection issues={ISSUES} />);
    await screen.findByText(/Разобраны формулы/);
    fireEvent.click(screen.getByTitle('Показать только дефекты формул книги «УИО»'));
    expect(flat()).toContain('Показано 1 из 2');
    expect(flat()).toContain('K34');
    expect(flat()).not.toContain('Y1894');
    fireEvent.click(screen.getByText(/Снять отбор/));
    expect(flat()).toContain('Показано 2 из 2');
  });

  it('отбор по классу сужает перечень', async () => {
    render(<FormulaIntegritySection issues={ISSUES} />);
    await screen.findByText(/Разобраны формулы/);
    const mutantName = getCheckById('formula_mutant')!.name;
    // Кнопка класса несёт имя паспорта и счёт рядом.
    const button = screen.getAllByRole('button')
      .find((b) => b.textContent?.startsWith(mutantName));
    expect(button).toBeDefined();
    fireEvent.click(button as HTMLElement);
    expect(flat()).toContain('Показано 1 из 2');
    expect(flat()).toContain('Y1894');
    expect(flat()).not.toContain('K34');
  });

  it('дефектов нет, но книги разобраны — это ноль, и он назван нулём', async () => {
    render(<FormulaIntegritySection issues={[]} />);
    await screen.findByText(/Дефектов формул не найдено/);
    expect(flat()).toContain('Дефектов формул не найдено');
  });
});

describe('состояние чтения узнать не удалось', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ error: 'служба недоступна' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    ))));
  });

  it('сказано, что состояние неизвестно, и пустота не выдана за чистоту', async () => {
    render(<FormulaIntegritySection issues={[]} />);
    await screen.findByText(/Состояние чтения формул узнать не удалось/);
    expect(flat()).toContain('не значит «дефектов нет»');
  });
});
