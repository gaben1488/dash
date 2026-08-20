/**
 * Стражи разбора ответа аналитики и сверки.
 *
 * Разбор оборонительный не из вежливости: ядро и сервер этой волны пишет
 * соседний агент, и форма ответа может приехать неполной. Проверяется, что
 *   1) отсутствующий раздел даёт ПУСТОТУ, а не выдуманные числа;
 *   2) «нет значения» остаётся null и не превращается в ноль;
 *   3) сверка читается из НАСТОЯЩЕЙ формы роута — с вложенными строками книги
 *      и мониторинга, откуда берутся адреса обеих сторон.
 */
import { describe, expect, it } from 'vitest';
import { normalizeAnalytics, normalizeMatchView } from './analytics-contract';

describe('разбор ответа аналитики', () => {
  it('пустой ответ даёт пустые разделы, а не нули под видом расчёта', () => {
    const p = normalizeAnalytics({});
    expect(p.analytics.funnel.steps).toEqual([]);
    expect(p.analytics.histogram).toEqual([]);
    expect(p.analytics.suppliers.suppliers).toEqual([]);
    expect(p.analytics.reduction.portfolioPct).toBeNull();
    expect(p.analytics.reduction.rowMedianPct).toBeNull();
    expect(p.analytics.seasonality.months).toEqual([]);
  });

  it('единица денег и момент чтения книги доезжают до плашки периода', () => {
    const p = normalizeAnalytics({
      source: {
        bookName: 'Ежедневный мониторинг',
        readAt: '2026-08-18T10:00:00Z',
        moneyUnit: 'руб',
        sheetsRead: ['1. УЭР', 'СВОДНЫЙ'],
        sheetsFailed: { '25-26': 'лист не ответил' },
      },
      analytics: {},
      notes: ['Деньги книги мониторинга — в рублях.'],
    });
    expect(p.source.moneyUnit).toBe('руб');
    expect(p.source.readAt).toBe('2026-08-18T10:00:00Z');
    expect(p.source.sheetsFailed['25-26']).toBe('лист не ответил');
    expect(p.notes).toHaveLength(1);
  });

  it('строка вместо числа не становится нулём — это отсутствие значения', () => {
    const p = normalizeAnalytics({
      analytics: {
        reduction: { portfolioPct: 'много', rowMeanPct: 15.84 },
        seasonality: { months: [{ period: '2026-03', count: 12, nmckRub: 'текстом', priceRub: 0 }] },
      },
    });
    expect(p.analytics.reduction.portfolioPct).toBeNull();
    expect(p.analytics.reduction.rowMeanPct).toBe(15.84);
    // Счётчик денег остаётся нулём осознанно: это сумма, а не показатель,
    // и её неполнота объявляется отдельно счётчиком пропусков.
    expect(p.analytics.seasonality.months[0]!.nmckRub).toBe(0);
  });

  it('ноль снижения сохраняется как ноль, а не превращается в пустоту', () => {
    const p = normalizeAnalytics({
      analytics: { nmckBuckets: [{ key: 'до100к', label: 'до 100 тыс.', count: 4, nmckRub: 100, reductionPct: 0 }] },
    });
    expect(p.analytics.nmckBuckets[0]!.reductionPct).toBe(0);
  });

  it('находки машинных проверок доезжают вместе с адресами', () => {
    const p = normalizeAnalytics({
      analytics: {
        anomalies: [{
          kind: 'deep-reduction',
          title: 'Снижение свыше 50 %',
          mechanism: 'механизм',
          action: 'действие',
          count: 1,
          refs: [{ sheet: '8. УО', row: 100, code: 'ЭА1-26', note: 'Снижение 62,0 %.' }],
        }],
      },
    });
    expect(p.analytics.anomalies[0]!.refs[0]!.row).toBe(100);
    expect(p.analytics.anomalies[0]!.refs[0]!.code).toBe('ЭА1-26');
  });

  it('раздел неизвестной формы не роняет разбор целиком', () => {
    const p = normalizeAnalytics({ analytics: { suppliers: 'нежданная строка', depts: 42 } });
    expect(p.analytics.suppliers.uniqueCount).toBe(0);
    expect(p.analytics.depts).toEqual([]);
  });
});

describe('разбор ответа сверки', () => {
  const raw = {
    source: { readAt: '2026-08-18T10:00:00Z' },
    books: { read: ['УО', 'УЭР'], rowsWithCode: 300 },
    summary: { matched: 1, bookOnly: 1, coveragePct: 87.4, factDisagree: 1 },
    matched: [{
      code: 'ЭА1-26',
      bookRow: { rowKey: 'УО:214', book: 'УО', planTotalThousands: 1000 },
      primary: { procKey: '8. УО:100', sheet: '8. УО' },
      nmck: { bookRub: 1_000_000, monitoringRub: 1_000_000, deltaRub: 0, relDiff: 0, agrees: true },
      fact: { bookRub: 900_000, monitoringRub: 800_000, deltaRub: 100_000, relDiff: 0.111, agrees: false },
    }],
    bookOnly: [{ code: 'ЭА9-26', bookRow: { rowKey: 'УО:301' } }],
    monitoringOnly: [{ code: 'ЭА8-26', procedures: [{ procKey: '1. УЭР:33' }] }],
    ambiguous: [{ code: 'ЭАС258-26', bookRows: [{ rowKey: 'УО:5' }, { rowKey: 'УЭР:7' }], procedures: [], sameBook: false }],
    listCells: [{ bookRow: { rowKey: 'УО:9' }, codes: ['ЭА1-26', 'ЭА2-26'], missingInMonitoring: ['ЭА2-26'] }],
    internal: { codesOnSheets: 380, codesInJournal: 53, codesInBoth: 50, rows: [], counts: { 'sums-differ': 0 } },
    notes: ['Единицы сторон разные.'],
  };

  it('адрес книги и адрес мониторинга вынимаются из вложенных строк', () => {
    const m = normalizeMatchView(raw);
    expect(m.matched[0]!.bookRowKey).toBe('УО:214');
    expect(m.matched[0]!.procKey).toBe('8. УО:100');
  });

  it('«сравнивать нечего» отличается от «совпало» и от «разошлось»', () => {
    const m = normalizeMatchView({
      ...raw,
      matched: [{
        ...raw.matched[0],
        fact: { bookRub: null, monitoringRub: 5, deltaRub: null, relDiff: null, agrees: null },
      }],
    });
    expect(m.matched[0]!.fact.agrees).toBeNull();
    expect(m.matched[0]!.nmck.agrees).toBe(true);
  });

  it('классы без пары читаются со своей стороны', () => {
    const m = normalizeMatchView(raw);
    expect(m.bookOnly[0]!.addresses).toEqual(['УО:301']);
    expect(m.monitoringOnly[0]!.addresses).toEqual(['1. УЭР:33']);
    expect(m.ambiguous[0]!.bookAddresses).toHaveLength(2);
    expect(m.listCells[0]!.codes).toHaveLength(2);
  });

  it('непришедший ответ даёт пустую сверку, а не выдуманное покрытие', () => {
    const m = normalizeMatchView({});
    expect(m.summary.coveragePct).toBeNull();
    expect(m.matched).toEqual([]);
    expect(m.books.read).toEqual([]);
  });
});
