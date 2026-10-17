// @vitest-environment jsdom
/**
 * Рендер секции «Откуда взялась плановая сумма» (канон п.102).
 *
 * Три стража на экране, а не в чистой функции:
 *   1) лента правок действительно печатает дату, автора, переход было→стало и
 *      вид события словами — ради этого секцию и открывают;
 *   2) при куцем журнале плашка «почти не ведётся, история неполна» стоит НАД
 *      лентой: без неё короткая лента читается как «правок почти не было»;
 *   3) пустая лента не молчит, а объясняет, ЧТО именно пусто.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { buildPlanProvenance } from '@aemr/core';
import type { PlanEvent, RowProvenanceResponse } from '../../lib/provenance/contract';
import { PlanProvenanceView } from './PlanProvenanceView';

afterEach(() => cleanup());

const retroCut: PlanEvent = {
  cell: 'J96',
  column: 'J',
  was: 1116.72,
  became: 12,
  delta: -1104.72,
  at: '2026-04-08T16:08:00',
  atDay: 20551,
  author: 'kultura@example.org',
  kind: 'retro-cut',
  wasKnown: true,
  becameKnown: true,
  factAtEdit: true,
};

const unitFix: PlanEvent = {
  cell: 'H28',
  column: 'H',
  was: 34975002.17,
  became: 34975,
  delta: -34940027.17,
  at: '2026-08-05T17:17:20',
  atDay: 20670,
  author: 'uo@example.org',
  kind: 'unit-fix',
  wasKnown: true,
  becameKnown: true,
  factAtEdit: false,
};

function response(patch: Partial<RowProvenanceResponse> = {}): RowProvenanceResponse {
  return {
    dept: 'УКСиМП',
    deptLatin: 'UKSIMP',
    deptName: 'Управление культуры, спорта и молодёжной политики',
    sheetName: 'ВСЕ',
    rowSeq: '94',
    sheetRow: 96,
    subject: 'Поставка оборудования',
    planNow: 12,
    factDate: '2026-03-30',
    method: 'ЭА',
    journalAvailable: true,
    journalRowKeyless: 0,
    events: [],
    summary: {
      witnessCount: 0, financialAmbiguityCount: 0,
      retroCutTotal: 0,
      retroCutCount: 0,
      retroCutAfterFactTotal: null,
      retroCutAfterFactCount: null,
      clearedTotal: 0,
      unitFixCount: 0,
      scaleShiftCount: 0,
      dateInMoneyCount: 0,
      invalidValueCount: 0,
      defectMassExcluded: 0,
      firstKnownPlan: null,
      firstKnownAt: null,
      lastKnownPlan: null,
      lastKnownAt: null,
      planColumnObserved: null,
      note: 'УКСиМП, строка № 94: сводка сервера.',
    },
    observability: {
      journalEntries: 4904,
      coversRow: true,
      planEntries: 2,
      unparsedRowKeys: 0,
      unparsedCells: 0,
      note: 'подпись сервера',
    },
    ambiguity: null,
    ...patch,
  };
}

/** Текст со схлопнутыми пробелами — неразрывный пробел разрядов мешает поиску. */
const flat = (node: HTMLElement | null): string =>
  (node?.textContent ?? '').replace(/\s+/g, ' ');

describe('PlanProvenanceView — лента правок', () => {
  it('shows both authors and original log addresses instead of reporting an ambiguous history as no reduction', () => {
    const [provenance] = buildPlanProvenance(['A', 'B'].map((author, index) => ({
      sheet: 'ВСЕ', cell: 'K10', row: '8', was: 100, became: 90,
      at: '2026-10-16T10:00:00', author,
      source: { spreadsheetId: 'book-A', journalSheet: '_ChangeLog' as const, journalRow: index + 3, readAt: 1000 },
    })), [{ ordinal: '8', planNow: 90 }]);
    const { container } = render(<PlanProvenanceView provenance={response({ ...provenance, rowSeq: '8' })} />);
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
    expect(container.textContent).toContain('Запись журнала, строка 3');
    expect(container.textContent).toContain('Запись журнала, строка 4');
    expect(container.textContent).toContain('ВСЕ!K10');
    expect(container.textContent).toContain('не подтверждён');
    expect(container.textContent).not.toContain('Задним числом план не снижали');
    expect(container.textContent).not.toContain('20 тыс.');
    const origins = screen.getAllByRole('link', { name: /Запись журнала, строка/ });
    expect(origins.map(link => link.getAttribute('href'))).toEqual([3, 4].map(row =>
      `https://docs.google.com/spreadsheets/d/book-A/edit?range=${encodeURIComponent(`'_ChangeLog'!A${row}`)}`));
    expect(origins.every(link => link.getAttribute('title')?.includes('book-A'))).toBe(true);
    expect(container.textContent).not.toContain('book-A');
  });

  it('shows identical transitions from different log rows as incomplete even with the same author', () => {
    const [provenance] = buildPlanProvenance([3, 4].map(journalRow => ({
      sheet: 'ВСЕ', cell: 'K10', row: '8', was: 100, became: 90,
      at: '2026-10-16T10:00:00', author: 'A',
      source: { spreadsheetId: 'book-A', journalSheet: '_ChangeLog' as const, journalRow, readAt: 1000 },
    })), [{ ordinal: '8', planNow: 90 }]);
    const { container } = render(<PlanProvenanceView provenance={response({ ...provenance, rowSeq: '8' })} />);
    expect(container.textContent).toContain('не подтверждён');
    expect(container.textContent).toContain('Эквивалентных свидетельств: 2');
    expect(screen.getAllByRole('link', { name: /Запись журнала, строка/ })).toHaveLength(2);
    expect(container.textContent).not.toContain('Задним числом план не снижали');
    expect(container.textContent).not.toContain('10 тыс.');
  });

  it('shows one unknown-side witness as incomplete rather than saying the plan was never reduced', () => {
    const [provenance] = buildPlanProvenance([{
      sheet: 'ВСЕ', cell: 'K10', row: '8', was: '(до массовой правки не отслежено)', became: 90,
      at: '2026-10-16T10:00:00', author: '',
    }], [{ ordinal: '8', planNow: 90 }]);
    const { container } = render(<PlanProvenanceView provenance={response({ ...provenance, rowSeq: '8' })} />);
    expect(container.textContent).toContain('не подтверждён');
    expect(container.textContent).not.toContain('Задним числом план не снижали');
    expect(container.textContent).toContain('не отслежено');
  });

  it('keeps distinct original book origins and refuses malformed source URLs', () => {
    const source = { journalSheet: '_ChangeLog', journalRow: 3, readAt: 1000 };
    const { rerender } = render(<PlanProvenanceView provenance={response({ events: [{ ...retroCut,
      sources: [{ ...source, spreadsheetId: 'old-book-A' }, { ...source, spreadsheetId: 'old-book-B' }],
    }] })} />);
    const links = screen.getAllByRole('link', { name: /Запись журнала, строка 3/ });
    expect(links.map(link => new URL(link.getAttribute('href')!).pathname)).toEqual([
      '/spreadsheets/d/old-book-A/edit', '/spreadsheets/d/old-book-B/edit',
    ]);
    rerender(<PlanProvenanceView provenance={response({ events: [{ ...retroCut,
      sources: [{ ...source, spreadsheetId: 'bad/../../?evil=1' }],
    }] })} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps a long original book ID and exact reading clock in metadata while showing the project-calendar reading time', () => {
    const spreadsheetId = 'OriginalBook0123456789abcdefghijklmnopqrstuv';
    const iso = '2026-10-15T16:34:56.789Z';
    const original = { ...retroCut, sources: [{ spreadsheetId, journalSheet: '_ChangeLog',
      journalRow: 460, readAt: Date.parse(iso) }] };
    const before = JSON.stringify(original);
    const { container } = render(<PlanProvenanceView provenance={response({ events: [original] })} />);
    const link = screen.getByRole('link');
    expect(link.textContent).toContain('Запись журнала, строка 460');
    expect(link.textContent).toContain('прочитано 16.10.2026, 04:34 (Камчатка)');
    expect(container.textContent).not.toContain(spreadsheetId);
    expect(container.textContent).not.toContain(iso);
    expect(link.getAttribute('title')).toContain(spreadsheetId);
    expect(link.getAttribute('title')).toContain('_ChangeLog!460');
    expect(link.getAttribute('title')).toContain(iso);
    expect(link.getAttribute('href')).toBe(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?range=${encodeURIComponent("'_ChangeLog'!A460")}`);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('печатает дату, автора, переход было→стало и вид события словами', () => {
    render(<PlanProvenanceView provenance={response({
      events: [unitFix, retroCut],
      summary: {
        ...response().summary,
        retroCutTotal: 1104.72,
        retroCutCount: 1,
        retroCutAfterFactTotal: 1104.72,
        retroCutAfterFactCount: 1,
        unitFixCount: 1,
      },
    })} />);

    const ledger = flat(screen.getByRole('list', { name: 'Правки плановой суммы по времени' }));
    expect(ledger).toContain('08.04.2026');
    expect(ledger).toContain('16:08');
    expect(ledger).toContain('kultura@example.org');
    expect(ledger).toContain('1 116,72 → 12');
    expect(ledger).toContain('план снижен задним числом');
    expect(ledger).toContain('ячейка J96');
    expect(ledger).toContain('план, местный бюджет');
    // Правка после заключения — прямой признак изъятия экономии, её видно.
    expect(ledger).toContain('правка уже после заключения');
    // Исправление единиц названо своим именем и не выдаётся за снижение плана.
    expect(ledger).toContain('исправлена единица измерения');

    // Итог складывает ТОЛЬКО настоящее снижение; исправление единиц — припиской.
    const body = flat(document.body);
    expect(body).toContain('Снято с плана задним числом: 1 104,72 тыс. ₽');
    expect(body).toContain('исправлений единиц — 1');
    expect(body).toContain('растворяются в плане');
  });

  it('лента идёт от свежей правки к старой', () => {
    render(<PlanProvenanceView provenance={response({ events: [unitFix, retroCut] })} />);
    const items = screen.getByRole('list', { name: 'Правки плановой суммы по времени' })
      .querySelectorAll('li');
    expect(flat(items[0] as HTMLElement)).toContain('05.08.2026');
    expect(flat(items[1] as HTMLElement)).toContain('08.04.2026');
  });
});

describe('PlanProvenanceView — честная наблюдаемость', () => {
  it('куцый журнал книги даёт плашку «почти не ведётся, история неполна»', () => {
    render(<PlanProvenanceView provenance={response({
      dept: 'УДТХ',
      events: [retroCut],
      observability: { ...response().observability, journalEntries: 34, planEntries: 1 },
    })} />);

    const notice = flat(screen.getByRole('note'));
    expect(notice).toContain('почти не ведётся');
    expect(notice).toContain('история неполна');
    expect(notice).toContain('34 записей');
    expect(notice).toContain('следа нет, а не правки не было');
  });

  it('непрочитанная книга не выдаётся за книгу без правок', () => {
    render(<PlanProvenanceView provenance={response({
      journalAvailable: false,
      journalError: 'книга не отвечает',
      observability: {
        ...response().observability,
        journalEntries: 0,
        coversRow: false,
        planEntries: 0,
      },
    })} />);

    const notice = flat(screen.getByRole('note'));
    expect(notice).toContain('не прочитана');
    expect(notice).toContain('книга не отвечает');
    expect(notice).toContain('Это не «правок не было»');
  });

  it('полный журнал плашку не рисует', () => {
    render(<PlanProvenanceView provenance={response({ events: [retroCut] })} />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('PlanProvenanceView — пустое состояние', () => {
  it('без событий объясняет, что именно пусто, а не молчит', () => {
    render(<PlanProvenanceView provenance={response({
      observability: {
        ...response().observability,
        coversRow: false,
        planEntries: 0,
        unparsedRowKeys: 3,
      },
    })} />);

    expect(screen.queryByRole('list', { name: 'Правки плановой суммы по времени' })).toBeNull();
    const body = flat(document.body);
    expect(body).toContain('нет ни одной записи об этой строке');
    expect(body).toContain('У 3 записей журнала номер строки не читается');
    // Итог тоже честный: «не снижали», а не пустое место.
    expect(body).toContain('Задним числом план не снижали');
  });

  it('дубли «№ п/п» объявляются: историю близнецов не разделить', () => {
    render(<PlanProvenanceView provenance={response({
      ambiguity: { sheetRows: [96, 205], note: 'Номер стоит у двух строк книги — история общая.' },
    })} />);
    expect(flat(document.body)).toContain('история общая');
  });
});
