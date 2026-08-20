/**
 * cross-check.test.ts — сверка с книгами ГРБС построчно и внутренняя сверка
 * «лист управления ↔ 25-26» (спека §4).
 *
 * Проверяются два обещания. Первое: единицы переводятся один раз и в одном
 * месте — книги хранят тысячи, мониторинг рубли, и сравнение идёт в рублях.
 * Второе: продукт называет расхождение и его размер, но не выбирает правую
 * сторону — ни между книгой и мониторингом, ни между листом и журналом.
 */
import { describe, expect, it } from 'vitest';
import { DEPT_COLUMNS } from '@aemr/shared';
import { matchMonitoring } from '../pipeline/monitoring-match.js';
import {
  bookRowsForMatch,
  internalDiff,
  procedureRowsForMatch,
  summarizeMatch,
} from './cross-check.js';
import { parseMonitoringJournal } from './journal.js';
import { parseMonitoringProcedures } from './procedures.js';

/** Строка книги ГРБС: код процедуры в AG, план в K, факт в Y (тыс. руб.). */
function bookRow(code: string, planThousands: unknown, factThousands: unknown): unknown[] {
  const r: unknown[] = new Array(34).fill('');
  r[DEPT_COLUMNS.TOTAL_PLAN] = planThousands;
  r[DEPT_COLUMNS.TOTAL_FACT] = factThousands;
  r[DEPT_COLUMNS.COMMENT_UER] = code;
  return r;
}

/** Строка листа управления мониторинга. */
function procRow(subject: string, nmck: unknown, price: unknown): unknown[] {
  const r: unknown[] = new Array(16).fill('');
  r[1] = 'МКУ ЦЭР';
  r[2] = subject;
  r[3] = nmck;
  r[8] = price;
  return r;
}

const HEADERS: unknown[][] = [new Array(16).fill('ш'), new Array(16).fill('ш')];

describe('bookRowsForMatch — переходник к книгам ГРБС', () => {
  it('читает код из AG, план и факт из K и Y и даёт адрес строки листа', () => {
    const rows = bookRowsForMatch({ УЭР: [bookRow('ЭА1-26', 1000, 900)] });
    expect(rows).toEqual([{
      rowKey: 'УЭР:4', book: 'УЭР', ag: 'ЭА1-26',
      planTotalThousands: 1000, factTotalThousands: 900,
    }]);
  });

  it('строки без кода в связку не идут — их адресует отдельный сигнал', () => {
    expect(bookRowsForMatch({ УЭР: [bookRow('', 1000, 900)] })).toEqual([]);
  });
});

describe('сверка с книгами ГРБС', () => {
  const { procedures } = parseMonitoringProcedures({
    '1. УЭР': [
      ...HEADERS,
      procRow('ЭА1-26 Ремонт кровли', 1_000_000, 900_000),
      procRow('ЭА2-26 Поставка бумаги', 500_000, 480_000),
    ],
  });

  it('тысячи книги переводятся в рубли: согласие — не совпадение цифр, а согласие сумм', () => {
    const result = matchMonitoring(
      bookRowsForMatch({ УЭР: [bookRow('ЭА1-26', 1000, 900)] }),
      procedureRowsForMatch(procedures),
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].nmck).toMatchObject({
      bookRub: 1_000_000, monitoringRub: 1_000_000, agrees: true,
    });
    expect(result.matched[0].fact.agrees).toBe(true);
  });

  it('расхождение плана и начальной цены называется, а правая сторона не выбирается', () => {
    const result = matchMonitoring(
      // План 700 тыс. против начальной цены 1 000 000 руб. — тридцать процентов.
      bookRowsForMatch({ УЭР: [bookRow('ЭА1-26', 700, 900)] }),
      procedureRowsForMatch(procedures),
    );
    expect(result.matched[0].nmck.agrees).toBe(false);
    expect(result.matched[0].nmck.deltaRub).toBe(-300_000);
  });

  it('свод исходов считает покрытие и раскладывает согласие сумм', () => {
    const bookRows = bookRowsForMatch({
      УЭР: [bookRow('ЭА1-26', 1000, 900)],
      УО: [bookRow('ЭА999-26', 50, 50)],
    });
    const procRows = procedureRowsForMatch(procedures);
    const summary = summarizeMatch(matchMonitoring(bookRows, procRows), bookRows.length, procRows.length);
    expect(summary).toMatchObject({
      bookRowsWithCode: 2, proceduresWithCode: 2,
      matched: 1, bookOnly: 1, monitoringOnly: 1, nmckAgree: 1,
    });
    // Из двух кодов мониторинга пару нашёл один.
    expect(summary.coveragePct).toBeCloseTo(50, 6);
  });

  it('один код в разных книгах — совместная закупка, в одной книге — аномалия', () => {
    const across = matchMonitoring(
      bookRowsForMatch({ УЭР: [bookRow('ЭА1-26', 500, 450)], УО: [bookRow('ЭА1-26', 500, 450)] }),
      procedureRowsForMatch(procedures),
    );
    expect(across.ambiguous[0].sameBook).toBe(false);

    const inside = matchMonitoring(
      bookRowsForMatch({ УЭР: [bookRow('ЭА1-26', 500, 450), bookRow('ЭА1-26', 500, 450)] }),
      procedureRowsForMatch(procedures),
    );
    expect(inside.ambiguous[0].sameBook).toBe(true);
  });
});

describe('внутренняя сверка: лист управления ↔ «25-26»', () => {
  const { procedures } = parseMonitoringProcedures({
    '1. УЭР': [
      ...HEADERS,
      procRow('ЭА391-25 Услуги связи', 2_510_975, 2_400_000),
      procRow('ЭА500-26 Только на листе', 100_000, 90_000),
    ],
  });

  function journalRow(subject: string, nmck: unknown, price: unknown): unknown[] {
    const r: unknown[] = new Array(14).fill('');
    r[1] = 'УД АЕМР';
    r[2] = subject;
    r[3] = nmck;
    r[8] = price;
    return r;
  }

  const journal = parseMonitoringJournal([
    new Array(14).fill('ш'),
    // Та же процедура, начальная цена отличается на 60 копеек.
    journalRow('ЭА391-25 Услуги связи', 2_510_975.6, 2_400_000),
    journalRow('ЭА600-26 Только в журнале', 300_000, 250_000),
  ]);

  it('находит расхождение сумм и показывает обе стороны с адресами', () => {
    const diff = internalDiff(procedures, journal.rows);
    const differing = diff.rows.find((r) => r.code === 'ЭА391-25');
    expect(differing?.kind).toBe('sums-differ');
    expect(differing?.nmckDeltaRub).toBeCloseTo(-0.6, 6);
    expect(differing?.sheetRows[0]).toMatchObject({ sheet: '1. УЭР', row: 3 });
    expect(differing?.journalRows[0]).toMatchObject({ sheet: '25-26', row: 2 });
    expect(differing?.note).toContain('решение человека');
  });

  it('коды, живущие только на одной стороне, разложены по своим классам', () => {
    const diff = internalDiff(procedures, journal.rows);
    expect(diff.counts).toEqual({ 'sums-differ': 1, 'sheets-only': 1, 'journal-only': 1 });
    expect(diff.codesOnSheets).toBe(2);
    expect(diff.codesInJournal).toBe(2);
    expect(diff.codesInBoth).toBe(1);
  });

  it('доли совместной закупки против целого в журнале — не тревога, а форма', () => {
    const { procedures: shares } = parseMonitoringProcedures({
      // Две доли из шести: их сумма меньше целого, записанного в журнале.
      '1. УЭР': [...HEADERS, procRow('ЭАС258-26 Продукты', 719_574.67, 700_000)],
      '8. УО': [...HEADERS, procRow('ЭАС258-26 Продукты', 1_000_000, 950_000)],
    });
    const whole = parseMonitoringJournal([
      new Array(14).fill('ш'),
      journalRow('ЭАС258-26 Продукты', 4_108_508.5, 4_000_000),
    ]);
    const diff = internalDiff(shares, whole.rows);
    const row = diff.rows.find((r) => r.code === 'ЭАС258-26');
    expect(row?.joint).toBe(true);
    expect(row?.note).toContain('по природе формы');
  });
});
