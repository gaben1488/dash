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
    rowSeq: 94,
    sheetRow: 96,
    subject: 'Поставка оборудования',
    planNow: 12,
    factDate: '2026-03-30',
    method: 'ЭА',
    journalAvailable: true,
    journalRowKeyless: 0,
    events: [],
    summary: {
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
