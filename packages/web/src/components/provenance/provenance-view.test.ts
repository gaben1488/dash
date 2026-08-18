/**
 * Регресс витрины провенанса плановой суммы (канон п.102).
 *
 * Стережём ровно то, ради чего секция и заведена:
 *   - два класса снижений различаются словами (исправление единиц против
 *     настоящего ретро-снижения) и не складываются в один итог;
 *   - куцый, пустой, непрочитанный и «безключевой» журналы дают РАЗНЫЕ плашки,
 *     а не общее молчание;
 *   - время правки берётся по часам книги буквально, без часового пояса
 *     читателя.
 *
 * Живые числа взяты из замера 18.08 по полным дампам книг: УО H28
 * (34 975 002,17 → 34 975,00 — рубли вместо тысяч) и УКСиМП J96
 * (1 116,72 → 12,00 — настоящее снятие плана задним числом).
 */
import { describe, expect, it } from 'vitest';
import type { PlanEvent, RowProvenanceResponse } from '../../lib/provenance/contract';
import {
  assessJournal,
  buildProvenanceEvents,
  buildRetroCutHeadline,
  emptyLedgerNote,
  formatBookTime,
  SCANT_JOURNAL_ENTRIES,
} from './provenance-view';

/**
 * Разряды чисел Intl отбивает НЕРАЗРЫВНЫМ пробелом (U+00A0) — глазами он не
 * отличим от обычного, и сравнение «как видно в редакторе» падало бы вечно.
 * Сверяем нормализованные строки, а не байты пробела.
 */
const plain = (s: string): string => s.replace(/\s+/g, ' ');

function event(patch: Partial<PlanEvent> = {}): PlanEvent {
  return {
    cell: 'K96',
    column: 'K',
    was: 1116.72,
    became: 12,
    delta: -1104.72,
    at: '2026-04-08T16:08:00',
    atDay: 20551,
    author: 'operator@example.org',
    kind: 'retro-cut',
    wasKnown: true,
    becameKnown: true,
    factAtEdit: null,
    ...patch,
  };
}

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
      note: 'сводка сервера',
    },
    observability: {
      journalEntries: 4904,
      coversRow: true,
      planEntries: 1,
      unparsedRowKeys: 0,
      unparsedCells: 0,
      note: 'подпись сервера',
    },
    ambiguity: null,
    ...patch,
  };
}

describe('лента правок — вид события словами', () => {
  it('настоящее снижение и исправление единиц названы по-разному', () => {
    const [fresh, old] = buildProvenanceEvents([
      event({ kind: 'unit-fix', cell: 'H28', column: 'H', was: 34975002.17, became: 34975, at: '2026-08-05T17:17:20' }),
      event({ kind: 'retro-cut', at: '2026-08-06T09:00:00' }),
    ]);
    // Порядок ленты — от свежего к старому: последняя правка важнее первой.
    expect(fresh.kindLabel).toBe('план снижен задним числом');
    expect(old.kindLabel).toBe('исправлена единица измерения');
    expect(plain(old.transition)).toBe('34 975 002,17 → 34 975');
    expect(old.columnLabel).toBe('план, федеральный бюджет');
  });

  it('пустота и незнание журнала не выдаются за ноль', () => {
    const [filled, unknown] = buildProvenanceEvents([
      event({ kind: 'unknown', was: null, wasKnown: false, became: 500, at: '2026-02-01T10:00:00' }),
      event({ kind: 'fill', was: null, wasKnown: true, became: 900, at: '2026-03-01T10:00:00' }),
    ]);
    expect(filled.kindLabel).toBe('план заполнен');
    expect(filled.transition).toBe('пусто → 900');
    expect(unknown.transition).toBe('не отслежено → 500');
  });

  it('правка после заключения помечается — это признак изъятия экономии', () => {
    const [item] = buildProvenanceEvents([event({ factAtEdit: true })]);
    expect(item.afterFact).toBe(true);
    expect(item.emphasis).toBe(true);
  });

  it('время правки читается по часам книги, без часового пояса читателя', () => {
    expect(formatBookTime('2026-04-08T16:08:00')).toBe('16:08');
    expect(formatBookTime('2026-04-08')).toBeNull();
  });
});

describe('итог «снято с плана задним числом»', () => {
  it('складывает только настоящие снижения, дефекты выносит припиской', () => {
    const headline = buildRetroCutHeadline(response({
      summary: {
        ...response().summary,
        retroCutTotal: 1104.72,
        retroCutCount: 1,
        unitFixCount: 2,
        dateInMoneyCount: 1,
      },
    }));
    expect(headline.present).toBe(true);
    expect(plain(headline.title)).toContain('1 104,72 тыс. ₽');
    expect(headline.title).toContain('1 правка');
    expect(headline.excluded).toContain('исправлений единиц — 2');
    expect(headline.excluded).toContain('дат в денежной ячейке — 1');
    // Механизм назван прямо: почему экономия перестаёт быть видимой.
    expect(headline.mechanism).toContain('растворяются в плане');
  });

  it('без снижений говорит об этом прямо, а не молчит', () => {
    const headline = buildRetroCutHeadline(response());
    expect(headline.present).toBe(false);
    expect(headline.title).toBe('Задним числом план не снижали');
    expect(headline.excluded).toBeNull();
  });

  it('правки после заключения выделяются отдельной строкой', () => {
    const headline = buildRetroCutHeadline(response({
      summary: {
        ...response().summary,
        retroCutTotal: 1104.72,
        retroCutCount: 2,
        retroCutAfterFactTotal: 1104.72,
        retroCutAfterFactCount: 1,
      },
    }));
    expect(headline.title).toContain('2 правки');
    expect(headline.afterFact).toContain('ПОСЛЕ заключения');
  });
});

describe('наблюдаемость журнала — четыре разных исхода', () => {
  it('непрочитанная книга не выдаётся за книгу без правок', () => {
    const notice = assessJournal(response({
      journalAvailable: false,
      journalError: 'источник не ответил',
      observability: { ...response().observability, journalEntries: 0 },
    }));
    expect(notice?.level).toBe('unreadable');
    expect(notice?.detail).toContain('источник не ответил');
  });

  it('пустой журнал назван пустым, с причиной невидимости снижений', () => {
    const notice = assessJournal(response({
      observability: { ...response().observability, journalEntries: 0, coversRow: false, planEntries: 0 },
    }));
    expect(notice?.level).toBe('empty');
    expect(notice?.title).toContain('не ведётся');
  });

  it('журнал без номеров строк — история закупки не выделяется', () => {
    const notice = assessJournal(response({
      dept: 'УАГЗО',
      journalRowKeyless: 70,
      observability: {
        ...response().observability,
        journalEntries: 70,
        unparsedRowKeys: 70,
        coversRow: false,
        planEntries: 0,
      },
    }));
    expect(notice?.level).toBe('keyless');
    expect(notice?.detail).toContain('колонку «Строка»');
  });

  it('куцый журнал даёт плашку «почти не ведётся, история неполна»', () => {
    const notice = assessJournal(response({
      dept: 'УДТХ',
      observability: { ...response().observability, journalEntries: 34 },
    }));
    expect(notice?.level).toBe('scant');
    expect(notice?.title).toContain('почти не ведётся');
    expect(notice?.title).toContain('история неполна');
  });

  it('полный журнал плашки не рисует — предупреждать не о чем', () => {
    expect(assessJournal(response())).toBeNull();
    // Порог стоит в живом зазоре между УД (568) и УФБП (124).
    expect(SCANT_JOURNAL_ENTRIES).toBeGreaterThan(124);
    expect(SCANT_JOURNAL_ENTRIES).toBeLessThan(568);
  });
});

describe('пустая лента — три разных смысла', () => {
  it('записей о строке нет вовсе', () => {
    const note = emptyLedgerNote(response({
      observability: { ...response().observability, coversRow: false, planEntries: 0, unparsedRowKeys: 3 },
    }));
    expect(note).toContain('нет ни одной записи об этой строке');
    expect(note).toContain('У 3 записей журнала номер строки не читается');
  });

  it('строку правили, но не плановые ячейки', () => {
    const note = emptyLedgerNote(response({
      observability: { ...response().observability, coversRow: true, planEntries: 0 },
    }));
    expect(note).toContain('плановых ячеек');
  });
});
