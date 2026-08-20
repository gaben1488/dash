/**
 * procedures.test.ts — фундамент вкладки «Мониторинг» (канон п.69в/п.101а,
 * спека docs/superpowers/specs/2026-08-14-daily-monitoring-tab.md).
 *
 * Фикстуры повторяют живые формы книги из полного дампа 17.08: числовая НМЦК,
 * сумма текстом с неразрывными пробелами, цена 0 (торги без результата),
 * цена = НМЦК (снижения нет), искажённый код «ЭЗК-120-26» (дефис — один из
 * пяти паттернов спеки §2, чинить молча запрещено).
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateMonitoring,
  monitoringNumber,
  parseMonitoringProcedures,
  procedureStage,
} from './procedures.js';

/** Строка листа управления: 16 колонок раскладки спеки §2. */
function row(over: {
  customer?: string; subject?: string; nmck?: unknown;
  application?: string; publication?: string; deadline?: string; auction?: string;
  price?: unknown; savings?: unknown; check?: string; winner?: string;
}): unknown[] {
  const r: unknown[] = new Array(16).fill('');
  r[0] = 1;
  r[1] = over.customer ?? 'МКУ ЦЭР';
  r[2] = over.subject ?? '';
  r[3] = over.nmck ?? '';
  r[4] = over.application ?? '';
  r[5] = over.publication ?? '';
  r[6] = over.deadline ?? '';
  r[7] = over.auction ?? '';
  r[8] = over.price ?? '';
  r[9] = over.savings ?? '';
  r[10] = over.check ?? '';
  r[14] = over.winner ?? '';
  return r;
}

const HEADERS: unknown[][] = [new Array(16).fill('ш'), new Array(16).fill('ш')];

describe('monitoringNumber — деньги книги в рублях', () => {
  it('число остаётся числом, текст с неразрывными пробелами и запятой разбирается', () => {
    expect(monitoringNumber(65_000)).toBe(65_000);
    expect(monitoringNumber('2 250 000,00')).toBe(2_250_000);
    expect(monitoringNumber('0,00')).toBe(0);
  });

  it('нечисло даёт null, а не ноль: ноль в цене — содержательное значение', () => {
    expect(monitoringNumber('')).toBeNull();
    expect(monitoringNumber('2 250 000,00(375,27 р.)')).toBeNull();
    expect(monitoringNumber(null)).toBeNull();
  });
});

describe('procedureStage — стадия по числовым предикатам (п.27)', () => {
  it.each([
    [12_345, null, 'awarded'],
    [0, '01.02.2026', 'no_result'],
    [null, '01.02.2026', 'published'],
    [null, null, 'application'],
  ] as const)('цена %s, публикация %s → %s', (price, pub, expected) => {
    expect(procedureStage(price, pub)).toBe(expected);
  });
});

describe('parseMonitoringProcedures', () => {
  const sheets = {
    '1. УЭР': [
      ...HEADERS,
      // Состоялась: код + предмет одной строкой, снижение 33 336 из 446 700.
      row({
        subject: 'ЭЗК426-25 Поставка брендированных шатров', nmck: 446_700,
        application: '22.12.2025', publication: '24.12.2025',
        deadline: '13.01.2026', auction: '15.01.2026',
        price: 413_364, savings: 33_336, check: 'верно',
        winner: 'ИП ДОЙНЯК-НОВЫЙ ДМИТРИЙ ОЛЕГОВИЧ\nИНН 541003717453',
      }),
      // Без результата: цена 0 — торги прошли, победителя нет.
      row({ subject: 'ЭА10-26 Поставка бумаги', nmck: 100_000, publication: '01.02.2026', price: 0 }),
      // Объявлена: цены нет, публикация есть; НМЦК текстом.
      row({ subject: 'ЭА11-26 Ремонт кровли', nmck: '2 250 000,00', publication: '05.02.2026' }),
      // Заявка: ни цены, ни публикации.
      row({ subject: 'ЭА12-26 Поставка мебели', nmck: 50_000, application: '10.08.2026' }),
      // Хвост листа: пустая строка данных не выдумывается.
      new Array(16).fill(''),
    ],
    '8. УО': [
      ...HEADERS,
      // Цена = НМЦК: состоялась без снижения (спека §2: 158 строк из 372).
      row({ customer: 'МБОУ ЕСШ №1', subject: 'ЭА20-26 Учебники', nmck: 780_000, publication: '01.03.2026', price: 780_000 }),
      // Искажённый код (дефис после префикса) — сигнал, строка не выпадает.
      row({ customer: 'МБОУ ЕСШ №2', subject: 'ЭЗК-120-26 Стройматериалы', nmck: 10_000 }),
    ],
  };

  it('собирает строки листов с адресом, кодом, деньгами и стадией', () => {
    const { procedures, unparsedCodes } = parseMonitoringProcedures(sheets);
    expect(procedures).toHaveLength(6);

    const awarded = procedures[0];
    expect(awarded).toMatchObject({
      sheet: '1. УЭР', row: 3, dept: 'УЭР', code: 'ЭЗК426-25',
      subject: 'Поставка брендированных шатров',
      nmck: 446_700, auctionPrice: 413_364, stage: 'awarded',
      reductionRub: 33_336, selfCheck: 'верно',
    });
    expect(awarded.reductionPct).toBeCloseTo(7.4627, 3);

    expect(procedures[1].stage).toBe('no_result');
    expect(procedures[2]).toMatchObject({ stage: 'published', nmck: 2_250_000 });
    expect(procedures[3].stage).toBe('application');

    // Лист УО: маппинг имени листа на канонический ид ГРБС.
    expect(procedures[4]).toMatchObject({ sheet: '8. УО', dept: 'УО', reductionRub: 0 });

    // Искажённый код: строка в реестре без кода, адрес поднят сигналом,
    // диагноз с догадкой показан человеку (скриншот 20.08: «без кода» при
    // видимом коде — ложь; догадка показывается, мост по ней не строится).
    expect(procedures[5].code).toBeNull();
    expect(procedures[5].codeNote).toContain('похоже на ЭЗК120-26');
    expect(unparsedCodes).toEqual([
      {
        sheet: '8. УО',
        row: 4,
        text: 'ЭЗК-120-26 Стройматериалы',
        guess: 'ЭЗК120-26',
        note: 'лишний дефис после букв семейства',
      },
    ]);
  });

  it('непрочитанный лист отсутствует в реестре, а не подменяется пустотой с нулями', () => {
    const { procedures } = parseMonitoringProcedures({ '1. УЭР': sheets['1. УЭР'] });
    expect(procedures.every((p) => p.sheet === '1. УЭР')).toBe(true);
  });

  it('агрегаты: стадии, НМЦК, экономия на торгах и средний процент снижения', () => {
    const registry = parseMonitoringProcedures(sheets);
    const agg = aggregateMonitoring(registry);

    expect(agg.total).toBe(6);
    // Заявки две: мебель УЭР и строка УО с искажённым кодом (ни цены, ни публикации).
    // Пятая ступень «торги прошли, итог не внесён» на этой фикстуре пуста,
    // но существует: ноль здесь — измеренный ноль, а не отсутствие ступени.
    expect(agg.byStage).toEqual({
      application: 2, published: 1, bidding: 0, awarded: 2, no_result: 1,
    });
    // Все строки с числовой НМЦК: 446 700 + 100 000 + 2 250 000 + 50 000 + 780 000 + 10 000.
    expect(agg.nmckTotal).toBe(3_636_700);

    // Состоявшиеся: шатры (446 700 → 413 364) и учебники (780 000 → 780 000).
    expect(agg.awarded.count).toBe(2);
    expect(agg.awarded.nmckTotal).toBe(1_226_700);
    expect(agg.awarded.priceTotal).toBe(1_193_364);
    expect(agg.awarded.savingsTotal).toBe(33_336);
    // Среднее ПОСТРОЧНЫХ процентов (не отношение сумм): (7,4627 + 0) / 2.
    expect(agg.awarded.avgReductionPct).toBeCloseTo(3.7313, 3);
    expect(agg.awarded.noReductionCount).toBe(1);

    expect(agg.codesParsed).toBe(5);
    expect(agg.codesUnparsed).toBe(1);
  });

  it('победитель разбирается на имя, ИНН и исход, а сырая ячейка сохраняется', () => {
    const { procedures } = parseMonitoringProcedures(sheets);
    expect(procedures[0].winner).toMatchObject({
      name: 'ИП ДОЙНЯК-НОВЫЙ ДМИТРИЙ ОЛЕГОВИЧ',
      inn: '541003717453',
      outcome: 'supplier',
    });
    expect(procedures[0].winner.raw).toContain('ИНН 541003717453');
  });

  it('способ определения поставщика и год читаются из кода процедуры', () => {
    const { procedures } = parseMonitoringProcedures(sheets);
    expect(procedures[0]).toMatchObject({ method: 'ЭЗК', year: 25 });
    expect(procedures[1]).toMatchObject({ method: 'ЭА', year: 26 });
    // Код не разобран — способа и года нет, а не «ЭА по умолчанию».
    expect(procedures[5]).toMatchObject({ method: null, year: null });
  });
});

describe('пятая ступень и дефекты строки', () => {
  it('дата торгов без цены — «торги прошли, итог не внесён», не «объявлена»', () => {
    const { procedures } = parseMonitoringProcedures({
      '1. УЭР': [
        ...HEADERS,
        row({
          subject: 'ЭА30-26 Ремонт дороги', nmck: 500_000,
          publication: '01.03.2026', deadline: '10.03.2026', auction: '14.03.2026',
        }),
      ],
    });
    expect(procedures[0].stage).toBe('bidding');
    expect(procedures[0].durations).toMatchObject({ toDeadline: 9, toAuction: 4 });
  });

  it('сумма текстом остаётся в реестре числом, а её адрес уезжает сигналом', () => {
    const { procedures } = parseMonitoringProcedures({
      '5. УДТХиРКИ': [
        ...HEADERS,
        row({ subject: 'ЭА291-26 Капитальный ремонт', nmck: '73 970 897,35', publication: '05.03.2026' }),
      ],
    });
    expect(procedures[0].nmck).toBe(73_970_897.35);
    const defect = procedures[0].defects.find((d) => d.kind === 'text-number');
    expect(defect?.address).toBe('5. УДТХиРКИ!D3');
  });

  it('контроль книги «ошибка» переносится с разрывом в рублях, а не словом', () => {
    const r = row({
      subject: 'ЭА40-26 Поставка', nmck: 100_000, publication: '01.03.2026',
      price: 90_000, savings: 10_000, check: 'ошибка',
    });
    r[11] = 4_000; // МБ
    const { procedures } = parseMonitoringProcedures({ '8. УО': [...HEADERS, r] });
    expect(procedures[0]).toMatchObject({ controlAgrees: false, controlGapRub: 6_000 });
    expect(procedures[0].defects.some((d) => d.kind === 'control-error')).toBe(true);
  });

  it('дата, которую нельзя прочитать, не выбрасывает строку — она даёт адрес', () => {
    const { procedures } = parseMonitoringProcedures({
      '6. УД': [
        ...HEADERS,
        row({ subject: 'ЭА50-26 Услуги связи', nmck: 20_000, deadline: '23.062026' }),
      ],
    });
    expect(procedures).toHaveLength(1);
    expect(procedures[0].deadlineDate).toMatchObject({ raw: '23.062026', iso: null });
    expect(procedures[0].defects.some((d) => d.kind === 'broken-date')).toBe(true);
  });

  it('совместная закупка помечается по способу ЭАС и по признаку в заказчике', () => {
    const { procedures } = parseMonitoringProcedures({
      '1. УЭР': [
        ...HEADERS,
        row({ subject: 'ЭАС258-26 Поставка продуктов', nmck: 719_574.67 }),
        row({ customer: 'Совместный аукцион ШКОЛЫ', subject: 'ЭА60-26 Мебель', nmck: 100_000 }),
      ],
    });
    expect(procedures.map((p) => p.joint)).toEqual([true, true]);
  });
});
