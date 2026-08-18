/**
 * Тесты построчного маппинга книг ГРБС ↔ «Ежедневный мониторинг»
 * (monitoring-match.ts, канон п.101а + п.102).
 *
 * Все фикстуры — РЕАЛЬНЫЕ пары из полных дампов 18.08.2026
 * (E:/aemr-dumps/book-dumps): значения ячеек скопированы дословно, адреса
 * строк настоящие. Регресс держит и механику классов исходов, и денежную
 * сверку тысячи↔рубли на живых числах.
 */

import { describe, it, expect } from 'vitest';
import {
  matchMonitoring,
  indexMonitoringProcedures,
  compareMoney,
  THOUSANDS_TO_RUB,
  NMCK_AGREEMENT_TOLERANCE,
  type MonitoringBookRow,
  type MonitoringProcedureRow,
} from './monitoring-match.js';

/** Строка книги УЭР r5 (лист «ВСЕ»): ЭЗК426-25, K=446,7 тыс., Y=413,36 тыс. */
const bookUER5: MonitoringBookRow = {
  rowKey: 'УЭР:5',
  book: 'УЭР',
  ag: 'ЭЗК426-25',
  planTotalThousands: 446.7,
  factTotalThousands: 413.36,
};

/** Мониторинг «1. УЭР» r5: та же процедура, НМЦК 446 700 руб., цена 413 364 руб. */
const procUER5: MonitoringProcedureRow = {
  procKey: '1. УЭР:5',
  sheet: '1. УЭР',
  nameCell: 'ЭЗК426-25 Поставка брендированных шатров и тентовых конструкций',
  nmckRub: 446700,
  winnerPriceRub: 413364,
};

/** Журнал «25-26» r55 штатно дублирует лист управления (та же процедура). */
const procJournal55: MonitoringProcedureRow = {
  ...procUER5,
  procKey: '25-26:55',
  sheet: '25-26',
};

describe('compareMoney (перевод тысячи↔рубли, порог 1 %)', () => {
  it('живая пара ЭЗК426-25: план сходится в ноль, факт — с копеечной разницей', () => {
    const nmck = compareMoney(446.7, 446700);
    expect(nmck).toEqual({
      bookRub: 446700,
      monitoringRub: 446700,
      deltaRub: 0,
      relDiff: 0,
      agrees: true,
    });
    // Y книги 413,36 тыс. = 413 360 руб. против цены 413 364 руб. — Δ 4 руб.
    const fact = compareMoney(413.36, 413364);
    expect(fact.deltaRub).toBeCloseTo(-4, 6);
    expect(fact.agrees).toBe(true);
  });

  it('живая пара УДТХ ЭА347-25 (лимитная/изъятая семантика): расхождение 40,5 % — не согласие', () => {
    // Книга УДТХ:4 K=1 210,59135 тыс.; мониторинг «5. УДТХиРКИ» НМЦК 2 034 608,40 руб.
    const cmp = compareMoney(1210.59135, 2034608.4);
    expect(cmp.agrees).toBe(false);
    expect(cmp.relDiff).toBeGreaterThan(0.4);
    // Δ ровно минус экономия процедуры (824 017,05) — след «K = НМЦК − изъятое».
    expect(cmp.deltaRub).toBeCloseTo(-824017.05, 2);
  });

  it('обе стороны нули — согласие; пустая сторона — сравнения нет (agrees=null)', () => {
    expect(compareMoney(0, 0)).toMatchObject({ relDiff: 0, agrees: true });
    expect(compareMoney(null, 446700).agrees).toBeNull();
    expect(compareMoney(446.7, null).agrees).toBeNull();
  });

  it('порог — константа 1 % (доля), перевод — ровно ×1000', () => {
    expect(NMCK_AGREEMENT_TOLERANCE).toBe(0.01);
    expect(THOUSANDS_TO_RUB).toBe(1000);
    // На границе: 1 % ровно — ещё согласие, чуть больше — уже нет.
    expect(compareMoney(99, 100000).agrees).toBe(true);
    expect(compareMoney(98.9, 100000).agrees).toBe(false);
  });
});

describe('indexMonitoringProcedures', () => {
  it('код тянется из колонки C, журнал «25-26» даёт второй адрес того же кода', () => {
    const idx = indexMonitoringProcedures([procUER5, procJournal55]);
    expect(idx.get('ЭЗК426-25')).toHaveLength(2);
  });

  it('строка без валидного кода в индекс не попадает (искажения не чинятся, канон п.74)', () => {
    // Живой пример класса «искажённый код» из спеки мониторинга: «А427-25».
    const broken: MonitoringProcedureRow = {
      procKey: '25-26:99',
      sheet: '25-26',
      nameCell: 'А427-25 Поставка автомобильного бензина',
      nmckRub: 1000000,
      winnerPriceRub: null,
    };
    expect(indexMonitoringProcedures([broken]).size).toBe(0);
  });
});

describe('matchMonitoring — классы исходов на реальных парах', () => {
  it('matched: УЭР:5 ↔ ЭЗК426-25, обе строки мониторинга в паре, сверки сходятся', () => {
    const res = matchMonitoring([bookUER5], [procUER5, procJournal55]);
    expect(res.matched).toHaveLength(1);
    const m = res.matched[0];
    expect(m.code).toBe('ЭЗК426-25');
    expect(m.procedures).toHaveLength(2);
    expect(m.primary.procKey).toBe('1. УЭР:5');
    expect(m.nmck.agrees).toBe(true);
    expect(m.fact.agrees).toBe(true);
    expect(res.bookOnly).toHaveLength(0);
    expect(res.monitoringOnly).toHaveLength(0);
  });

  it('code-in-book-not-in-monitoring: живая опечатка года «ЭЕП110-06» (УЭР:26)', () => {
    // В книге год набит «-06» вместо «-26» — формат валиден, но такой
    // процедуры мониторинг не знает. Код НЕ чинится молча — исход честный.
    const typoRow: MonitoringBookRow = {
      rowKey: 'УЭР:26',
      book: 'УЭР',
      ag: 'ЭЕП110-06',
      planTotalThousands: 33.26,
      factTotalThousands: 33.26,
    };
    const res = matchMonitoring([typoRow], [procUER5]);
    expect(res.bookOnly).toHaveLength(1);
    expect(res.bookOnly[0]).toMatchObject({
      outcome: 'code-in-book-not-in-monitoring',
      code: 'ЭЕП110-06',
    });
    expect(res.matched).toHaveLength(0);
  });

  it('monitoring-without-book-row: ЭАС16-25 (журнал «25-26» r2) без строки книги', () => {
    const school: MonitoringProcedureRow = {
      procKey: '25-26:2',
      sheet: '25-26',
      nameCell: 'ЭАС16-25 Оказание услуг по круглосуточной охране',
      nmckRub: 15799996.8,
      winnerPriceRub: 15799996.8,
    };
    const res = matchMonitoring([bookUER5], [procUER5, school]);
    expect(res.monitoringOnly).toHaveLength(1);
    expect(res.monitoringOnly[0]).toMatchObject({
      outcome: 'monitoring-without-book-row',
      code: 'ЭАС16-25',
    });
  });

  it('ambiguous внутри книги: ЭА138-26 дважды в УДТХ (строки 37 и 42) — аномалия', () => {
    const row37: MonitoringBookRow = {
      rowKey: 'УДТХ:37', book: 'УДТХ', ag: 'ЭА138-26',
      planTotalThousands: 100, factTotalThousands: null,
    };
    const row42: MonitoringBookRow = { ...row37, rowKey: 'УДТХ:42' };
    const res = matchMonitoring([row37, row42], []);
    expect(res.ambiguous).toHaveLength(1);
    expect(res.ambiguous[0].sameBook).toBe(true);
    expect(res.ambiguous[0].bookRows.map((r) => r.rowKey)).toEqual(['УДТХ:37', 'УДТХ:42']);
    // Дубль не расщепляется по остальным классам.
    expect(res.matched).toHaveLength(0);
    expect(res.bookOnly).toHaveLength(0);
  });

  it('ambiguous между книгами: ЭАС258-26 в четырёх ГРБС — совместный аукцион, sameBook=false', () => {
    // Живой расклад дампа: доли одного совместного аукциона у четырёх управлений.
    const share = (book: string, rowKey: string): MonitoringBookRow => ({
      rowKey, book, ag: 'ЭАС258-26', planTotalThousands: 500, factTotalThousands: null,
    });
    const res = matchMonitoring(
      [share('УЭР', 'УЭР:42'), share('УКСиМП', 'УКСиМП:678'), share('УАГЗО', 'УАГЗО:35'), share('УДТХ', 'УДТХ:54')],
      [],
    );
    expect(res.ambiguous).toHaveLength(1);
    expect(res.ambiguous[0].sameBook).toBe(false);
    expect(res.ambiguous[0].bookRows).toHaveLength(4);
  });

  it('список кодов в AG (УЭР:21, школьный ЕП-список) — listCells, коды закрывают мониторинг', () => {
    // Дословная ячейка из дампа: пробел внутри первого кода — терпимость входа.
    const listRow: MonitoringBookRow = {
      rowKey: 'УЭР:21', book: 'УЭР',
      ag: 'ЭЕП 103-26, ЭЕП104-26, ЭЕП106-26,ЭЕП107-26,ЭЕП108-26',
      planTotalThousands: 205.31, factTotalThousands: 205.31,
    };
    const table: MonitoringProcedureRow = {
      procKey: '1. УЭР:11', sheet: '1. УЭР',
      nameCell: 'ЭЕП103-26 Стол письменный', nmckRub: 52710, winnerPriceRub: 52710,
    };
    const res = matchMonitoring([listRow], [table]);
    expect(res.listCells).toHaveLength(1);
    expect(res.listCells[0].codes).toEqual([
      'ЭЕП103-26', 'ЭЕП104-26', 'ЭЕП106-26', 'ЭЕП107-26', 'ЭЕП108-26',
    ]);
    // ЭЕП103-26 есть в мониторинге, остальные четыре — нет.
    expect(res.listCells[0].missingInMonitoring).toEqual([
      'ЭЕП104-26', 'ЭЕП106-26', 'ЭЕП107-26', 'ЭЕП108-26',
    ]);
    // Код из списка закрывает процедуру от класса «без строки книги».
    expect(res.monitoringOnly).toHaveLength(0);
    // Строка-список НЕ идёт в парную сверку (K — сумма по списку).
    expect(res.matched).toHaveLength(0);
  });

  it('«код + приписка» в AG: заявка на процедуру держится, связка не теряется', () => {
    // Один валидный код с посторонним текстом рядом (манера школьных ячеек
    // УО): маппинг по п.101а держится, текст — забота detectForeignText.
    const dirty: MonitoringBookRow = {
      rowKey: 'УИО:4-приписка', book: 'УИО',
      ag: 'ЭА96-26 контракт заключен',
      planTotalThousands: 39.5, factTotalThousands: 37.13,
    };
    const proc: MonitoringProcedureRow = {
      procKey: '3. УИО:12', sheet: '3. УИО',
      nameCell: 'ЭА96-26 Услуги по оценке объектов муниципальной собственности',
      nmckRub: 39500, winnerPriceRub: 37130,
    };
    const res = matchMonitoring([dirty], [proc]);
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].code).toBe('ЭА96-26');
    expect(res.monitoringOnly).toHaveLength(0);
  });

  it('строки без кода в AG (пусто/плейсхолдер/текст) — вне связки, без ложных классов', () => {
    const rows: MonitoringBookRow[] = [
      { rowKey: 'УЭР:8', book: 'УЭР', ag: 'Не согласны, считаем экономией', planTotalThousands: 10, factTotalThousands: null },
      { rowKey: 'УЭР:9', book: 'УЭР', ag: null, planTotalThousands: 20, factTotalThousands: null },
      { rowKey: 'УЭР:10', book: 'УЭР', ag: 'Х', planTotalThousands: 30, factTotalThousands: null },
    ];
    const res = matchMonitoring(rows, [procUER5]);
    expect(res.matched).toHaveLength(0);
    expect(res.bookOnly).toHaveLength(0);
    expect(res.ambiguous).toHaveLength(0);
    expect(res.listCells).toHaveLength(0);
    // Процедура мониторинга при этом честно остаётся без строки книги.
    expect(res.monitoringOnly).toHaveLength(1);
  });

  it('факт-сверка ловит живое расхождение: ЭА262-26 (УКСиМП:439) Y=530,25 тыс. против цены 630 382,65 руб.', () => {
    const row: MonitoringBookRow = {
      rowKey: 'УКСиМП:439', book: 'УКСиМП', ag: 'ЭА262-26',
      planTotalThousands: 630.38265, factTotalThousands: 530.25,
    };
    const proc: MonitoringProcedureRow = {
      procKey: '2. УКСиМП:20', sheet: '2. УКСиМП',
      nameCell: 'ЭА262-26', nmckRub: 630382.65, winnerPriceRub: 630382.65,
    };
    const res = matchMonitoring([row], [proc]);
    expect(res.matched[0].nmck.agrees).toBe(true);
    expect(res.matched[0].fact.agrees).toBe(false);
    expect(res.matched[0].fact.deltaRub).toBeCloseTo(-100132.65, 2);
  });

  it('primary выбирается по минимальному |Δ НМЦК| среди дублей мониторинга', () => {
    // Синтетика на живом коде: журнальная строка с чужим НМЦК не должна
    // перебивать точную строку листа управления.
    const wrongJournal: MonitoringProcedureRow = {
      ...procJournal55,
      nmckRub: 500000,
    };
    const res = matchMonitoring([bookUER5], [wrongJournal, procUER5]);
    expect(res.matched[0].primary.procKey).toBe('1. УЭР:5');
    expect(res.matched[0].nmck.agrees).toBe(true);
    expect(res.matched[0].procedures).toHaveLength(2);
  });
});
