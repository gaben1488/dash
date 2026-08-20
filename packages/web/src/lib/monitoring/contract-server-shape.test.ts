import { describe, it, expect } from 'vitest';
import { normalizeMonitoring } from './contract';

/**
 * Страж дрейфа контракта сервер↔веб (живой инцидент 20.08.2026): роут
 * /api/monitoring отдаёт свод ОБЁРТКОЙ { book, comparison }, а справочник —
 * полями entries/customersOutside. Маппер веба ждал плоские rows — и живые
 * данные превращались в null, плашка вкладки ложно говорила «„СВОДНЫЙ" и
 * „Перечень ГРБС" не доехали». Фикстура ниже повторяет ФОРМУ ответа сервера
 * (routes/monitoring.ts + core/monitoring/{svod,directory}.ts) — если сервер
 * или маппер снова разъедутся, тест падает.
 */
const SERVER_SHAPED = {
  source: {
    bookName: 'Ежедневный мониторинг',
    readAt: '2026-08-20T04:24:58.000Z',
    moneyUnit: 'руб',
    sheetsRead: ['1. УЭР', 'СВОДНЫЙ', '25-26', 'Перечень ГРБС'],
    sheetsFailed: {},
    sheetsExpected: 11,
  },
  procedures: [],
  aggregates: null,
  svod: {
    book: {
      rows: [
        {
          row: 4, svodName: 'УЭР АЕМР', dept: 'УЭР', isTotal: false,
          count: 42, nmck: 9_536_713.59, price: 6_947_694.34,
          savingsTotal: 2_589_019.25, savingsMb: 2_000_000, savingsKb: 589_019.25,
          savingsFb: 0, savingsSplitSum: 2_589_019.25, controlGapRub: 0, controlAgrees: true,
        },
      ],
      total: {
        row: 12, svodName: 'Итого:', dept: null, isTotal: true,
        count: 373, nmck: 1_299_693_085.85, price: 1_054_444_057.13,
        savingsTotal: 112_810_602.51, savingsMb: null, savingsKb: null,
        savingsFb: null, savingsSplitSum: null, controlGapRub: 4_115_635.9, controlAgrees: false,
      },
      authorNote: 'Ячейка считает количество непустых строк.',
    },
    comparison: {
      rows: [
        {
          dept: 'УЭР', svodName: 'УЭР АЕМР',
          book: { count: 42, nmck: 9_536_713.59, price: 6_947_694.34, savingsTotal: 2_589_019.25 },
          product: { count: 42, nmck: 9_536_713.59, price: 6_947_694.34, savingsTotal: 2_589_019.25 },
          nmckDeltaRub: 0, priceDeltaRub: 0, savingsDeltaRub: 0, countDelta: 0,
          explanation: null,
        },
      ],
      bookTotals: { nmck: 1_299_693_085.85, price: 1_054_444_057.13, savingsTotal: 112_810_602.51, count: 373 },
      productTotals: { nmck: 1_299_693_085.85, price: 1_054_444_057.13, savingsTotal: 112_810_602.51, count: 374 },
    },
  },
  journal: { rows: [], lineage: [], notes: [] },
  directory: {
    entries: [
      {
        sheet: 'Перечень ГРБС', row: 3, ordinal: 1, grbs: 'УО',
        fullName: 'муниципальное бюджетное общеобразовательное учреждение «Школа № 1»',
        shortName: 'МБОУ Школа № 1', shortIsFull: false, fullMissing: false, usageCount: 12,
      },
    ],
    customersOutside: [{ name: 'МБДОУ «Жар Птица»', normalized: 'жар птица', count: 3, depts: ['УО'] }],
    customersMatched: 7,
    withoutShortName: 4,
  },
  ancestors: { sheets: [], missingFields: [] },
  signals: [],
  unparsedCodes: [],
  notes: [],
};

describe('normalizeMonitoring — форма живого ответа сервера', () => {
  const p = normalizeMonitoring(SERVER_SHAPED);

  it('свод из обёртки { book, comparison } не превращается в null', () => {
    expect(p.svod).not.toBeNull();
    expect(p.svod!.rows).toHaveLength(1);
    const r = p.svod!.rows[0];
    expect(r.dept).toBe('УЭР');
    expect(r.bookLabel).toBe('УЭР АЕМР');
    // Цифры сторон — из сравнения, разбивка МБ/КБ/ФБ и контроль — из книги.
    expect(r.book.nmck).toBe(9_536_713.59);
    expect(r.book.mb).toBe(2_000_000);
    expect(r.budgetGap).toBe(0);
    expect(p.svod!.total.book.count).toBe(373);
    expect(p.svod!.total.product.count).toBe(374);
    expect(p.svod!.notes[0]).toContain('непустых строк');
  });

  it('справочник из entries/customersOutside не превращается в null', () => {
    expect(p.directory).not.toBeNull();
    expect(p.directory!.rows).toHaveLength(1);
    expect(p.directory!.rows[0].shortName).toBe('МБОУ Школа № 1');
    expect(p.directory!.rows[0].usedInBook).toBe(12);
    expect(p.directory!.unmatchedCustomers[0].name).toBe('МБДОУ «Жар Птица»');
  });
});
