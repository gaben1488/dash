/**
 * Стражи указателя «строка реестра → встречная сторона книги управления».
 *
 * Проверяется не форма разбора, а ОБЕЩАНИЯ карточки: четыре исхода не
 * подменяют друг друга, размер расхождения назван числом, а «сверять не с
 * чем» отличается от «строки не нашлось» и от «книги не прочитаны».
 */
import { describe, expect, it } from 'vitest';
import type { MatchViewPayload, MoneyComparison } from './analytics-contract';
import { buildMatchIndex } from './match-rows';

function money(p: Partial<MoneyComparison>): MoneyComparison {
  return {
    bookRub: null, monitoringRub: null, deltaRub: null, relDiff: null, agrees: null, ...p,
  };
}

function view(p: Partial<MatchViewPayload>): MatchViewPayload {
  return {
    source: {
      bookName: 'Ежедневный мониторинг',
      readAt: '2026-08-21T09:00:00Z',
      moneyUnit: 'руб',
      sheetsRead: [],
      sheetsFailed: {},
    },
    books: { read: ['УО'], rowsWithCode: 412 },
    summary: {
      bookRowsWithCode: 412, proceduresWithCode: 380, matched: 300, bookOnly: 100,
      monitoringOnly: 80, ambiguousAcrossBooks: 2, ambiguousSameBook: 1, listCells: 3,
      coveragePct: 72.8, nmckAgree: 280, nmckDisagree: 12, nmckNoComparison: 8,
      factAgree: 200, factDisagree: 40, factNoComparison: 60,
    },
    matched: [], bookOnly: [], monitoringOnly: [], ambiguous: [], listCells: [],
    internal: { codesOnSheets: 0, codesInJournal: 0, codesInBoth: 0, rows: [], counts: {} },
    notes: [],
    ...p,
  };
}

describe('указатель сверки по строке', () => {
  it('ответа нет вовсе — указателя тоже нет, а не пустой', () => {
    expect(buildMatchIndex(null)).toBeNull();
  });

  it('сошедшаяся пара несёт адрес книги и обе суммы', () => {
    const idx = buildMatchIndex(view({
      matched: [{
        code: 'ЭА152-26', book: 'УО', bookRowKey: 'УО:214',
        sheet: '8. УО', procKey: '8. УО:38',
        nmck: money({ bookRub: 1_000_000, monitoringRub: 1_000_000, deltaRub: 0, agrees: true }),
        fact: money({ bookRub: 900_000, monitoringRub: 880_000, deltaRub: 20_000, relDiff: 0.0222, agrees: false }),
      }],
    }));
    const row = idx?.byCode.get('ЭА152-26');
    expect(row?.kind).toBe('matched');
    expect(row?.bookRowKey).toBe('УО:214');
    expect(row?.sheetRowKey).toBe('8. УО:38');
    // Расхождение названо размером, а не словом «не сходится».
    expect(row?.verdicts[1]).toMatch(/разница 20\s000,00 руб\./u);
    expect(row?.verdicts[1]).toContain('2,2 %');
  });

  it('кода нет в книгах управлений — это состояние источника, не расхождение сумм', () => {
    const idx = buildMatchIndex(view({
      monitoringOnly: [{ code: 'ЭА777-26', addresses: ['8. УО:99'] }],
    }));
    const row = idx?.byCode.get('ЭА777-26');
    expect(row?.kind).toBe('monitoring-only');
    expect(row?.nmck).toBeNull();
    expect(row?.verdicts[0]).toContain('состояние источника');
  });

  it('один код в одной книге дважды и в разных книгах — две разные новости', () => {
    const idx = buildMatchIndex(view({
      ambiguous: [
        { code: 'ЭА1-26', bookAddresses: ['УО:10', 'УО:11'], procedureAddresses: ['8. УО:5'], sameBook: true },
        { code: 'ЭА2-26', bookAddresses: ['УО:10', 'УКС:7'], procedureAddresses: ['8. УО:6'], sameBook: false },
      ],
    }));
    expect(idx?.byCode.get('ЭА1-26')?.summary).toContain('ОДНОЙ книги');
    expect(idx?.byCode.get('ЭА2-26')?.verdicts[0]).toContain('совместной');
  });

  it('ячейка-список: сверка сумм невозможна, и это сказано, а не замолчано', () => {
    const idx = buildMatchIndex(view({
      listCells: [{ address: 'УО:301', codes: ['ЭА3-26', 'ЭА4-26'], missingInMonitoring: [] }],
    }));
    expect(idx?.byCode.get('ЭА4-26')?.kind).toBe('list-cell');
    expect(idx?.byCode.get('ЭА4-26')?.verdicts[0]).toContain('невозможна');
  });

  it('сошедшаяся пара сильнее неоднозначности того же кода не бывает наоборот', () => {
    const idx = buildMatchIndex(view({
      matched: [{
        code: 'ЭА5-26', book: 'УО', bookRowKey: 'УО:1', sheet: '8. УО', procKey: '8. УО:1',
        nmck: money({}), fact: money({}),
      }],
      monitoringOnly: [{ code: 'ЭА5-26', addresses: ['8. УО:1'] }],
    }));
    expect(idx?.byCode.get('ЭА5-26')?.kind).toBe('matched');
  });

  it('книги управлений не прочитаны — это отдельная новость, а не отсутствие пар', () => {
    const idx = buildMatchIndex(view({ books: { read: [], rowsWithCode: 0 } }));
    expect(idx?.booksRead).toEqual([]);
    expect(idx?.byCode.size).toBe(0);
  });

  it('сравнивать не с чем — названа сторона, где суммы нет', () => {
    const idx = buildMatchIndex(view({
      matched: [{
        code: 'ЭА6-26', book: 'УО', bookRowKey: 'УО:2', sheet: '8. УО', procKey: '8. УО:2',
        nmck: money({ monitoringRub: 500_000 }),
        fact: money({ bookRub: 400_000 }),
      }],
    }));
    const v = idx?.byCode.get('ЭА6-26')?.verdicts ?? [];
    expect(v[0]).toContain('в строке книги управления суммы нет');
    expect(v[1]).toContain('в строке мониторинга суммы нет');
  });
});
