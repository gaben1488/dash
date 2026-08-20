/**
 * Стражи разрезов, сортировки и дефектов реестра «Мониторинг».
 *
 * Проверяется то, что легко сломать глазами и невозможно заметить на экране:
 *   · разрезы комбинируются, а не перебивают друг друга;
 *   · пустое значение при сортировке уезжает в конец в ОБЕ стороны — «нет
 *     цены» не является «самой маленькой ценой»;
 *   · ноль в цене аукциона не считается дефектом: это исход, а не ошибка;
 *   · дефекты ядра не пересказываются экраном второй раз;
 *   · разбор ответа переживает форму ядра (дата парой, победитель ячейкой) и
 *     не превращает ноль в пустоту.
 */
import { describe, expect, it } from 'vitest';
import { normalizeMonitoring, type RegistryProcedure } from './contract';
import {
  applySlices, emptySlices, hasAnySlice, nmckBucketId, procedureDefects, sortProcedures,
} from './slices';
import { portraitFrom } from './portrait';

function proc(over: Partial<RegistryProcedure> = {}): RegistryProcedure {
  return {
    sheet: '1. УЭР', row: 3, dept: 'УЭР', ppNum: '2', customer: 'МКУ ЦЭР',
    code: 'ЭА152-26', codeNote: null, method: 'ЭА', year: 2026, subject: 'Поставка шатров',
    nmck: 1_000_000,
    applicationDate: '01.02.2026', publicationDate: '10.02.2026',
    deadlineDate: '20.02.2026', auctionDate: '25.02.2026',
    auctionPrice: 900_000,
    savingsTotal: 100_000, savingsMb: 100_000, savingsKb: null, savingsFb: null,
    savingsManual: false, selfCheck: 'верно',
    winner: 'ООО «Ромашка»', winnerName: 'ООО «Ромашка»', winnerInn: '5040123456',
    outcome: null, stage: 'awarded', reductionRub: 100_000, reductionPct: 10,
    comment: null, customerNormalized: 'мку цэр', savingsSplitSum: 100_000,
    controlAgrees: true, controlGapRub: 0, joint: false, innRepeated: false,
    durations: { toPublication: 9, toDeadline: 10, toAuction: 5, total: 24 },
    defects: [],
    ...over,
  };
}

describe('разрезы реестра', () => {
  const rows = [
    proc(),
    proc({ sheet: '8. УО', row: 7, dept: 'УО', code: 'ЭЕП9-25', method: 'ЭЕП', year: 2025, nmck: 50_000 }),
    proc({ sheet: '8. УО', row: 9, dept: 'УО', code: 'ЭА4-26', stage: 'published', auctionPrice: null }),
  ];

  it('комбинируются, а не перебивают друг друга', () => {
    const only = applySlices(rows, { ...emptySlices(), dept: 'УО', stage: 'published' });
    expect(only.map((p) => p.code)).toEqual(['ЭА4-26']);
  });

  it('разрез по году процедуры читает суффикс кода, а не дату', () => {
    expect(applySlices(rows, { ...emptySlices(), procedureYear: 2025 }).map((p) => p.code))
      .toEqual(['ЭЕП9-25']);
  });

  it('разрез по размеру НМЦК раскладывает закупки по корзинам', () => {
    expect(nmckBucketId(50_000)).toBe('lt100k');
    expect(nmckBucketId(1_000_000)).toBe('600k-3m');
    // Сумма, не читаемая числом, ни в одну корзину не попадает и не
    // притворяется нулевой.
    expect(nmckBucketId(null)).toBeNull();
  });

  it('поиск ищет по коду, предмету, заказчику и ИНН победителя', () => {
    for (const q of ['ЭЕП9', 'шатр', 'ЦЭР', '5040123456']) {
      expect(applySlices(rows, { ...emptySlices(), query: q }).length).toBeGreaterThan(0);
    }
    expect(applySlices(rows, { ...emptySlices(), query: 'такого нет' })).toHaveLength(0);
  });

  it('пустой набор разрезов ничего не режет и знает, что он пуст', () => {
    expect(hasAnySlice(emptySlices())).toBe(false);
    expect(applySlices(rows, emptySlices())).toHaveLength(3);
  });

  it('отбор по периоду считает по выбранной дате-основанию', () => {
    const row = proc({ publicationDate: '10.02.2026', auctionDate: '05.04.2026' });
    const byPublication = { ...emptySlices(), periodBasis: 'publication' as const, periodQuarter: 2 };
    const byAuction = { ...emptySlices(), periodBasis: 'auction' as const, periodQuarter: 2 };
    expect(applySlices([row], byPublication)).toHaveLength(0);
    expect(applySlices([row], byAuction)).toHaveLength(1);
  });
});

describe('сортировка реестра', () => {
  const rows = [
    proc({ row: 1, auctionPrice: 900_000 }),
    proc({ row: 2, auctionPrice: null }),
    proc({ row: 3, auctionPrice: 100_000 }),
  ];

  it('пустое значение уезжает в конец в обе стороны', () => {
    expect(sortProcedures(rows, 'auctionPrice', 'asc').map((p) => p.row)).toEqual([3, 1, 2]);
    expect(sortProcedures(rows, 'auctionPrice', 'desc').map((p) => p.row)).toEqual([1, 3, 2]);
  });

  it('ноль в цене остаётся числом и сортируется как число', () => {
    const withZero = [proc({ row: 1, auctionPrice: 0 }), proc({ row: 2, auctionPrice: 5 })];
    expect(sortProcedures(withZero, 'auctionPrice', 'asc').map((p) => p.row)).toEqual([1, 2]);
  });
});

describe('дефекты строки', () => {
  it('ноль в цене аукциона дефектом не считается — это исход, а не ошибка', () => {
    const row = proc({ auctionPrice: 0, stage: 'no_result', winnerInn: null, winnerName: null });
    expect(procedureDefects(row).map((d) => d.kind)).not.toContain('text-number');
  });

  it('дефект ядра берётся как есть, с адресом, и не пересказывается второй раз', () => {
    const row = proc({
      code: null,
      defects: [{ kind: 'broken-code', address: '1. УЭР!C3', note: 'Код записан с пробелом внутри.' }],
    });
    const defects = procedureDefects(row);
    expect(defects.filter((d) => d.kind === 'broken-code')).toHaveLength(1);
    expect(defects[0].address).toBe('1. УЭР!C3');
  });

  it('отрицательная длительность этапа называется, а не прячется', () => {
    const row = proc({ publicationDate: '10.02.2026', deadlineDate: '01.02.2026' });
    expect(procedureDefects(row).some((d) => d.kind === 'negative-duration')).toBe(true);
  });
});

describe('портрет реестра: три коэффициента снижения', () => {
  it('не подменяют друг друга, когда у половины строк снижения не было', () => {
    const rows = [
      proc({ nmck: 1_000_000, auctionPrice: 1_000_000 }),
      proc({ nmck: 1_000_000, auctionPrice: 600_000 }),
    ];
    const p = portraitFrom(rows);
    // Портфельный — по сумме денег: 400 тыс. из 2 млн.
    expect(p.portfolio.value).toBeCloseTo(20, 6);
    // Среднее построчных — включая нулевое снижение.
    expect(p.perRow.value).toBeCloseTo(20, 6);
    // Среднее там, где снижение было, — вдвое больше, и знаменатель другой.
    expect(p.whenReduced.value).toBeCloseTo(40, 6);
    expect(p.whenReduced.base).toBe(1);
    expect(p.noReductionCount).toBe(1);
  });

  it('процента снижения нет, когда состоявшихся торгов нет: ноль вместо него запрещён', () => {
    const p = portraitFrom([proc({ auctionPrice: null, stage: 'published' })]);
    expect(p.portfolio.value).toBeNull();
    expect(p.perRow.value).toBeNull();
  });
});

describe('чтение ответа сервера', () => {
  it('понимает форму ядра: дату парой и победителя разобранной ячейкой', () => {
    const payload = normalizeMonitoring({
      source: { readAt: '2026-08-18T02:00:00.000Z', sheetsRead: ['1. УЭР'] },
      procedures: [{
        sheet: '1. УЭР', row: 3, ordinal: 12, dept: 'УЭР', customer: 'МКУ ЦЭР',
        code: 'ЭА152-26', subject: 'Шатры', nmck: 10,
        publicationDate: { raw: '24.12.2025', iso: '2025-12-24' },
        auctionDate: { raw: '23.062026', iso: null },
        auctionPrice: 0,
        winner: {
          raw: 'Не состоялся (0 заявок)', name: null, inn: null,
          outcome: 'not_held', outcomeText: 'Не состоялся (0 заявок)', innRepeated: false,
        },
        stage: 'no_result',
        defects: [{ kind: 'broken-date', address: '1. УЭР!H3', note: 'Дата не читается.' }],
      }],
    });
    const p = payload.procedures[0];
    expect(p.publicationDate).toBe('24.12.2025');
    // Испорченный набор остаётся как есть: чинить его продукт не вправе.
    expect(p.auctionDate).toBe('23.062026');
    expect(p.ppNum).toBe('12');
    expect(p.outcome).toBe('Не состоялся (0 заявок)');
    expect(p.winnerName).toBeNull();
    // Ноль в цене — значение, а не пустота.
    expect(p.auctionPrice).toBe(0);
    expect(p.defects).toHaveLength(1);
  });

  it('раздела, которого в ответе нет, не выдумывает — возвращает null', () => {
    const payload = normalizeMonitoring({ source: {}, procedures: [] });
    expect(payload.svod).toBeNull();
    expect(payload.journal).toBeNull();
    expect(payload.directory).toBeNull();
    expect(payload.signals).toBeNull();
  });

  it('сокращение, дословно равное полному имени, помечается как отсутствующее', () => {
    const payload = normalizeMonitoring({
      source: {}, procedures: [],
      directory: { rows: [{ num: '9', fullName: 'МБОУ ЕСШ №1', shortName: 'МБОУ ЕСШ №1' }] },
    });
    expect(payload.directory?.rows[0].shortMissing).toBe(true);
  });
});
