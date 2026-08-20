/**
 * Тесты детектора подозрительных закупок.
 *
 * Все числа ниже — ЖИВЫЕ: сняты 18.08.2026 из полных выгрузок восьми книг
 * ГРБС (E:/aemr-dumps/book-dumps). Адреса строк и ячеек в фикстурах — те же,
 * что в книгах, поэтому падение теста означает либо сломанный признак, либо
 * изменившийся источник; и то и другое надо смотреть глазами.
 */

import { describe, it, expect } from 'vitest';
import {
  detectAnomalies,
  detectMagnitudeOutliers,
  detectRoundAmongFractional,
  detectYearOffByOne,
  detectDecimalShift,
  detectRepeatOfNeighbour,
  detectThousandfoldEdits,
  detectBenfordDeviation,
  detectThresholdHugging,
  detectSplittingWindow,
  detectFactEqualsPlan,
  detectRetroEdits,
  detectZeroEconomyMass,
  median,
  hasKopecks,
  hasFractionalThousands,
  isRoundAmount,
  digitSignature,
  normalizeSubject,
  columnOfCell,
  editMoment,
  formatMoment,
  journalNumber,
  subordinateKey,
  indexRowsByAddress,
  ANOMALY_LIMITS,
  type AnomalyRow,
  type AnomalyJournalEntry,
} from './anomaly-detection.js';

// ────────────────────────────────────────────────────────────
// Помощники сборки строк
// ────────────────────────────────────────────────────────────

const row = (over: Partial<AnomalyRow> & { sheetRow: number }): AnomalyRow => ({
  book: 'УАГЗО',
  sheet: 'ВСЕ',
  rowSeq: String(over.sheetRow),
  subordinate: 'МКУ «Елизовское РУС»',
  subject: 'Прочее',
  method: 'ЕП',
  planTotal: null,
  factTotal: null,
  economy: null,
  planDate: null,
  factDate: null,
  ...over,
});

/** Порядковый номер Google-даты из «дд.мм.гггг» — так даты лежат в книгах. */
const serial = (iso: string): number => Date.parse(iso) / 86400000 + 25569;

// ────────────────────────────────────────────────────────────
// Мелкие помощники
// ────────────────────────────────────────────────────────────

describe('мелкие помощники', () => {
  it('медиана: нечётная и чётная длина, пустой список', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('копейки — это нецелые рубли, а дробность — нецелые тысячи', () => {
    // живая строка УДТХ 4: 1 210,59135 тыс. ₽ = 1 210 591,35 ₽ — копейки есть
    expect(hasKopecks(1210.59135)).toBe(true);
    expect(hasFractionalThousands(1210.59135)).toBe(true);
    // живая строка УО: 220,3 тыс. ₽ = 220 300 ₽ — копеек нет, но тысячи дробные
    expect(hasKopecks(220.3)).toBe(false);
    expect(hasFractionalThousands(220.3)).toBe(true);
    expect(hasFractionalThousands(400)).toBe(false);
  });

  it('ровная сумма — кратная 100 тыс. ₽', () => {
    expect(ANOMALY_LIMITS.roundStepThousandRub).toBe(100);
    expect(isRoundAmount(400)).toBe(true);
    expect(isRoundAmount(350)).toBe(false);
    expect(isRoundAmount(0)).toBe(false);
  });

  it('подпись цифр совпадает у сумм, отличающихся порядком', () => {
    expect(digitSignature(12430.5)).toBe('124305');
    expect(digitSignature(124305)).toBe('124305');
    expect(digitSignature(0)).toBe('');
  });

  it('нормализация предмета убирает регистр, знаки и лишние пробелы', () => {
    expect(normalizeSubject('Услуги  по передаче, тепловой энергии'))
      .toBe('услуги по передаче тепловой энергии');
  });

  it('колонка ячейки читается из адреса', () => {
    expect(columnOfCell('AC96')).toBe('AC');
    expect(columnOfCell('K4')).toBe('K');
    expect(columnOfCell('мусор')).toBe('');
  });

  it('момент правки понимает обе живые формы журнала', () => {
    // живая запись журнала УО: время записано порядковым номером Google
    expect(editMoment(46184.53623398148)).toBe(editMoment(46184.53623398148));
    expect(formatMoment(46184.53623398148)).toBe('11.06.2026 12:52');
    expect(formatMoment('06.08.2026 17:17:20')).toBe('06.08.2026 17:17');
    expect(editMoment('не дата')).toBeNull();
    expect(formatMoment('не дата')).toBe('момент неизвестен');
  });

  it('значение журнала читается числом, текстом и в показательной записи', () => {
    // все три формы встречаются в живом журнале УО подряд по одной ячейке
    expect(journalNumber(20197183)).toBe(20197183);
    expect(journalNumber('201971.83')).toBe(201971.83);
    expect(journalNumber('2.0197183E7')).toBe(20197183);
    expect(journalNumber('1 234,50')).toBe(1234.5);
    expect(journalNumber('(пусто)')).toBeNull();
    expect(journalNumber('')).toBeNull();
  });

  it('буква «Х» в колонке учреждения означает само управление', () => {
    expect(subordinateKey(row({ sheetRow: 4, book: 'УДТХ', subordinate: 'Х' })))
      .toBe('УДТХ (само управление)');
    expect(subordinateKey(row({ sheetRow: 4, subordinate: 'МКУ «ЕДДС»' })))
      .toBe('МКУ «ЕДДС»');
  });

  it('указатель строк собирается по тройке «книга, лист, строка»', () => {
    const index = indexRowsByAddress([row({ sheetRow: 12, rowSeq: '57' })]);
    expect(index.get('УАГЗО|ВСЕ|12')?.rowSeq).toBe('57');
    expect(index.get('УАГЗО|ВСЕ|13')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// Шкала «похоже на опечатку»
// ────────────────────────────────────────────────────────────

describe('признак: сумма на порядки выше обычной для учреждения', () => {
  /**
   * Живые плановые суммы МКУ «Елизовское РУС» (книга УАГЗО, лист ВСЕ,
   * строки 4-15). Медиана этих сумм — 400 тыс. ₽ в выборке ниже, в полной
   * книге по 69 строкам — 88 тыс. ₽; строка 12 несёт 60 000 тыс. ₽.
   */
  const rus: AnomalyRow[] = [
    [4, 28, '1'], [5, 88, '2'], [6, 63.03332, '3'], [7, 132.57332, '4'],
    [8, 400, '5'], [9, 3078.96, '42'], [10, 11500.94952, '7'], [11, 359.49322, '8'],
    [12, 60000, '57'], [13, 350, '10'], [14, 1399.72773, '11'], [15, 635.99326, '12'],
  ].map(([sheetRow, plan, seq]) => row({
    sheetRow: sheetRow as number,
    planTotal: plan as number,
    rowSeq: seq as string,
    subject: sheetRow === 12 ? 'Демонтажные работы' : 'Прочее',
  }));

  it('находит строку 12 с 60 000 тыс. ₽ и даёт полный адрес', () => {
    const found = detectMagnitudeOutliers(rus);
    expect(found).toHaveLength(1);
    const f = found[0];
    expect(f.sign).toBe('magnitude-outlier');
    expect(f.scale).toBe('typo');
    expect(f.address).toMatchObject({
      book: 'УАГЗО', sheet: 'ВСЕ', sheetRow: 12, rowSeq: '57', cell: 'K12',
    });
    expect(f.amountAtRisk).toBe(60000);
    expect(f.subject).toBe('Демонтажные работы');
  });

  it('на группе меньше восьми строк молчит — медиана там ничего не значит', () => {
    expect(detectMagnitudeOutliers(rus.slice(0, 7))).toHaveLength(0);
  });

  it('ровная по величине группа не даёт находок', () => {
    const flat = Array.from({ length: 12 }, (_, i) =>
      row({ sheetRow: i + 4, planTotal: 100 + i }));
    expect(detectMagnitudeOutliers(flat)).toHaveLength(0);
  });
});

describe('признак: ровная сумма среди дробных', () => {
  /** Девять дробных фактических сумм и одна ровная — 400 тыс. ₽. */
  const group: AnomalyRow[] = [
    1210.59135, 1540.36774, 642.09499, 1599.79974, 1878.5448,
    220.3, 31.5, 10.5, 91.5, 400,
  ].map((fact, i) => row({ sheetRow: i + 4, planTotal: fact, factTotal: fact }));

  it('находит ровную сумму и называет долю дробных соседей', () => {
    const found = detectRoundAmongFractional(group);
    expect(found).toHaveLength(1);
    expect(found[0].amountAtRisk).toBe(400);
    expect(found[0].address.cell).toBe('K13'.replace('K', 'Y'));
    expect(found[0].explanation).toContain('90 %');
  });

  it('если дробных соседей меньше 60 %, признак молчит', () => {
    const mostlyRound = group.map((r, i) =>
      i < 7 ? { ...r, factTotal: 100 * (i + 1) } : r);
    expect(detectRoundAmongFractional(mostlyRound)).toHaveLength(0);
  });
});

describe('признак: год отличается на единицу', () => {
  /** Живая строка УО 2587 (№ п/п 2919): план 27.07.2026, факт 27.07.2025. */
  const paratunka = row({
    book: 'УО',
    sheetRow: 2587,
    rowSeq: '2919',
    subordinate: 'МБОУ «Паратунская средняя школа»',
    planTotal: 71.15,
    factTotal: 71.15,
    planDate: serial('2026-07-27'),
    factDate: serial('2025-07-27'),
  });

  it('находит расхождение в год при том же дне и месяце', () => {
    const found = detectYearOffByOne([paratunka]);
    expect(found).toHaveLength(1);
    expect(found[0].address).toMatchObject({ sheetRow: 2587, rowSeq: '2919', cell: 'Q2587' });
    expect(found[0].amountAtRisk).toBe(71.15);
    expect(found[0].explanation).toContain('27.7.2026');
    expect(found[0].explanation).toContain('27.7.2025');
  });

  it('совпадающие даты и разница в два года признака не дают', () => {
    expect(detectYearOffByOne([
      { ...paratunka, factDate: serial('2026-07-27') },
      { ...paratunka, factDate: serial('2024-07-27') },
      { ...paratunka, factDate: serial('2025-07-28') },
    ])).toHaveLength(0);
  });
});

describe('признак: те же цифры, другой порядок величины', () => {
  it('ловит пару 12 430,50 и 124 305,00 у одного учреждения', () => {
    const found = detectDecimalShift([
      row({ sheetRow: 10, planTotal: 12430.5, rowSeq: '10' }),
      row({ sheetRow: 11, planTotal: 124305, rowSeq: '11' }),
      row({ sheetRow: 12, planTotal: 777.7, rowSeq: '12' }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].sign).toBe('decimal-shift');
    expect(found[0].address.sheetRow).toBe(10);
    expect(found[0].amountAtRisk).toBeCloseTo(124305 - 12430.5, 5);
    expect(found[0].members?.map(m => m.cell)).toEqual(['K10', 'K11']);
  });

  it('подпись короче трёх цифр не рассматривается', () => {
    expect(detectDecimalShift([
      row({ sheetRow: 10, planTotal: 12 }),
      row({ sheetRow: 11, planTotal: 120 }),
    ])).toHaveLength(0);
  });
});

describe('признак: сумма повторяет соседнюю строку', () => {
  /** Живые строки УКСиМП 373 и 374 (МБУ ДО «НДШИ»), обе 31,5 тыс. ₽. */
  const ndshi: AnomalyRow[] = [
    row({
      book: 'УКСиМП', sheetRow: 373, rowSeq: '366', subordinate: 'МБУ ДО «НДШИ»',
      planTotal: 31.5, subject: 'Обслуживание охранной сигнализации',
    }),
    row({
      book: 'УКСиМП', sheetRow: 374, rowSeq: '367', subordinate: 'МБУ ДО «НДШИ»',
      planTotal: 31.5, subject: 'Обслуживание пожарной сигнализации',
    }),
  ];

  it('находит пару 31,5 тыс. ₽ при разных предметах', () => {
    const found = detectRepeatOfNeighbour(ndshi);
    expect(found).toHaveLength(1);
    expect(found[0].address).toMatchObject({ sheetRow: 374, rowSeq: '367', cell: 'K374' });
    expect(found[0].amountAtRisk).toBe(31.5);
  });

  it('ровные суммы (100 тыс. ₽ у соседей) в признак не идут', () => {
    expect(detectRepeatOfNeighbour(ndshi.map(r => ({ ...r, planTotal: 100 }))))
      .toHaveLength(0);
  });

  it('одинаковый предмет у соседей — это не копия, а продолжение', () => {
    expect(detectRepeatOfNeighbour(ndshi.map(r => ({ ...r, subject: 'Одно и то же' }))))
      .toHaveLength(0);
  });
});

describe('признак: правка суммы в кратное десяти число раз', () => {
  /** Живые записи журнала УО, лист ВСЕ (11.06.2026 и 05.08.2026). */
  const journal: AnomalyJournalEntry[] = [
    { book: 'УО', sheet: 'ВСЕ', cell: 'J2220', was: '201971.83', became: 20197183, at: 46184.53623398148, author: 'vysotskaya717@gmail.com' },
    { book: 'УО', sheet: 'ВСЕ', cell: 'J2220', was: '2.0197183E7', became: '201.97183', at: 46184.53634844907, author: 'vysotskaya717@gmail.com' },
    { book: 'УО', sheet: 'ВСЕ', cell: 'H28', was: '34975.0', became: '34975002.17', at: 46239.70307990741, author: 'dapofigist@gmail.com' },
    { book: 'УО', sheet: 'ВСЕ', cell: 'G28', was: 'Бумага', became: 'Бумага А4', at: 46239.7, author: 'dapofigist@gmail.com' },
  ];

  it('находит три денежные правки и пропускает текстовую', () => {
    const found = detectThousandfoldEdits(journal);
    expect(found).toHaveLength(3);
    expect(found.every(f => f.sign === 'thousandfold-edit')).toBe(true);
    // вторая правка той же ячейки — откат в сто тысяч раз вниз
    expect(found[1].explanation.replace(/[\s\u00a0]/gu, '')).toContain('100000развниз');
  });

  it('под риском — меньшая из величин, а не разность', () => {
    const found = detectThousandfoldEdits([journal[2]]);
    expect(found[0].amountAtRisk).toBe(34975);
    expect(found[0].explanation.replace(/[\s\u00a0]/gu, '')).toContain('1000развверх');
    expect(found[0].note).toContain('05.08.2026');
  });

  it('строка реестра добавляет к адресу № п/п и учреждение', () => {
    const found = detectThousandfoldEdits([journal[2]], [row({
      book: 'УО', sheet: 'ВСЕ', sheetRow: 28, rowSeq: '25',
      subordinate: 'МБОУ «Елизовская средняя школа №1 имени М.В.Ломоносова»',
      planTotal: 40482.96,
    })]);
    expect(found[0].address.rowSeq).toBe('25');
    expect(found[0].subordinate).toContain('школа №1');
  });
});

// ────────────────────────────────────────────────────────────
// Шкала «похоже на подгон»
// ────────────────────────────────────────────────────────────

describe('признак: распределение первых цифр', () => {
  it('на выборке меньше 30 сумм закон не применяется', () => {
    const few = Array.from({ length: 29 }, (_, i) =>
      row({ sheetRow: i + 4, planTotal: 600 + i }));
    expect(detectBenfordDeviation(few)).toHaveLength(0);
  });

  it('живая картина УИО: 43 % сумм начинаются на шестёрку — отклонение видно', () => {
    // 70 плановых сумм, из них 30 в шестой сотне: так выглядит книга УИО
    const sums = [
      ...Array.from({ length: 30 }, (_, i) => 600 + i * 3),
      ...Array.from({ length: 12 }, (_, i) => 100 + i * 7),
      ...Array.from({ length: 8 }, (_, i) => 200 + i * 9),
      ...Array.from({ length: 6 }, (_, i) => 300 + i * 11),
      ...Array.from({ length: 5 }, (_, i) => 400 + i * 13),
      ...Array.from({ length: 4 }, (_, i) => 500 + i * 17),
      ...Array.from({ length: 5 }, (_, i) => 700 + i * 19),
    ];
    const found = detectBenfordDeviation(sums.map((v, i) =>
      row({ book: 'УИО', sheet: 'УИО', sheetRow: i + 4, subordinate: 'Х', planTotal: v })));
    expect(found).toHaveLength(1);
    expect(found[0].sign).toBe('benford-deviation');
    expect(found[0].scale).toBe('fitted');
    expect(found[0].subordinate).toBe('УИО (само управление)');
    expect(found[0].address.sheetRow).toBe(0);
    expect(found[0].benford.sampleSize).toBe(70);
    // 70 < 80 — выборка честно помечена ненадёжной
    expect(found[0].smallSample).toBe(true);
    expect(found[0].note).toContain('Данных мало');
  });
});

describe('признак: суммы липнут к порогу закона снизу', () => {
  it('коридор 540-600 тыс. ₽ вдвое плотнее опорной полосы', () => {
    const rows: AnomalyRow[] = [
      // опорная полоса 300-540: три закупки
      ...[320, 400, 500].map((v, i) => row({ sheetRow: i + 4, planTotal: v })),
      // коридор 540-600: шесть закупок
      ...[545, 555, 570, 580, 590, 599].map((v, i) => row({ sheetRow: i + 10, planTotal: v })),
    ];
    const found = detectThresholdHugging(rows);
    expect(found).toHaveLength(1);
    expect(found[0].sign).toBe('threshold-hugging');
    expect(found[0].rows).toBe(6);
    expect(found[0].explanation).toContain('600 тыс. ₽');
    expect(found[0].members).toHaveLength(6);
  });

  it('меньше пяти закупок в коридоре — признака нет', () => {
    const rows = [545, 555, 570, 580].map((v, i) => row({ sheetRow: i + 4, planTotal: v }));
    expect(detectThresholdHugging(rows)).toHaveLength(0);
  });
});

describe('признак: дробление в коротком окне', () => {
  /**
   * Живая связка УКСиМП, МБУ ЦФКС ЕМР: три закупки «услуги по передаче
   * тепловой энергии» одной датой 12.01.2026 на 3 774,82 + 1 304,81 +
   * 1 587,22 = 6 666,84 тыс. ₽ — вместе выше порога 600 тыс. ₽.
   */
  const cfks: AnomalyRow[] = [
    [274, 3774.8151, '271'], [275, 1304.80606, '272'], [276, 1587.22223, '273'],
  ].map(([sheetRow, plan, seq]) => row({
    book: 'УКСиМП',
    sheetRow: sheetRow as number,
    rowSeq: seq as string,
    subordinate: 'МБУ ЦФКС ЕМР',
    subject: 'Услуги по передаче тепловой энергии',
    method: 'ЕП',
    planTotal: plan as number,
    planDate: serial('2026-01-12'),
  }));

  it('находит тройку одной даты на 6 666,84 тыс. ₽', () => {
    const found = detectSplittingWindow(cfks);
    expect(found).toHaveLength(1);
    expect(found[0].rows).toBe(3);
    expect(found[0].amountAtRisk).toBeCloseTo(6666.84339, 4);
    expect(found[0].address.rowSeq).toBe('271');
    expect(found[0].note).toContain('Поставщика в источнике нет');
  });

  it('разнесённые больше чем на 30 дней закупки дроблением не считаются', () => {
    const spread = cfks.map((r, i) => ({
      ...r,
      planDate: serial(['2026-01-12', '2026-03-12', '2026-06-12'][i]),
    }));
    expect(detectSplittingWindow(spread)).toHaveLength(0);
  });

  it('конкурентный способ в признак не идёт — порог про единственного поставщика', () => {
    expect(detectSplittingWindow(cfks.map(r => ({ ...r, method: 'ЭА' })))).toHaveLength(0);
  });
});

describe('признак: факт равен плану, экономии нет', () => {
  /**
   * Живая картина УДТХ (лист УДТХ): 23 конкурентные закупки с фактом,
   * у 21 из них факт равен плану до копейки и экономия ровно ноль.
   */
  const udth: AnomalyRow[] = [
    1210.59135, 1540.36774, 642.09499, 1599.79974, 4000, 1878.5448,
    120.5, 300.25, 88.8, 950.125, 47.3, 612.7, 1024.4, 75.55,
    230.1, 480.9, 66.6, 1290.35, 158.2, 3312.05, 999.99,
  ].map((v, i) => row({
    book: 'УДТХ', sheet: 'УДТХ', sheetRow: i + 4, rowSeq: String(i + 4),
    subordinate: 'Х', method: 'ЭА', planTotal: v, factTotal: v, economy: 0,
  }));
  // две конкурентные закупки со снижением — они дают знаменатель 23
  const withSaving: AnomalyRow[] = [
    row({ book: 'УДТХ', sheet: 'УДТХ', sheetRow: 40, subordinate: 'Х', method: 'ЭА', planTotal: 1000, factTotal: 800, economy: 200 }),
    row({ book: 'УДТХ', sheet: 'УДТХ', sheetRow: 41, subordinate: 'Х', method: 'ЭА', planTotal: 500, factTotal: 450, economy: 50 }),
  ];

  it('находит массу «факт равен плану»: 21 из 23', () => {
    const found = detectFactEqualsPlan([...udth, ...withSaving]);
    expect(found).toHaveLength(1);
    expect(found[0].rows).toBe(21);
    expect(found[0].explanation).toContain('21 из 23');
    expect(found[0].subordinate).toBe('УДТХ (само управление)');
  });

  it('на четырёх конкурентных закупках признак молчит', () => {
    expect(detectFactEqualsPlan(udth.slice(0, 4))).toHaveLength(0);
  });

  it('закупки у единственного поставщика в знаменатель не берутся', () => {
    expect(detectFactEqualsPlan(udth.map(r => ({ ...r, method: 'ЕП' })))).toHaveLength(0);
  });

  it('доля нулевой экономии ниже 90 % признака не даёт', () => {
    const moreSaving = [
      ...withSaving,
      row({ book: 'УДТХ', sheet: 'УДТХ', sheetRow: 42, subordinate: 'Х', method: 'ЭА', planTotal: 700, factTotal: 600, economy: 100 }),
    ];
    // 21 из 24 = 87,5 %
    expect(detectZeroEconomyMass([...udth, ...moreSaving])).toHaveLength(0);
    // 21 из 23 = 91,3 % — уже признак
    expect(detectZeroEconomyMass([...udth, ...withSaving])).toHaveLength(1);
  });

  it('когда экономии нет вообще ни у одной конкурентной — признак срабатывает', () => {
    const found = detectZeroEconomyMass(udth);
    expect(found).toHaveLength(1);
    expect(found[0].sign).toBe('zero-economy-mass');
    expect(found[0].rows).toBe(21);
    expect(found[0].note).toContain('не отличима от незаполненной');
  });
});

describe('признак: плановая сумма правилась после появления факта', () => {
  const journal: AnomalyJournalEntry[] = [
    { book: 'УО', sheet: 'ВСЕ', cell: 'Q2220', was: '(пусто)', became: 46242, at: 46180.1, author: 'a@b.ru' },
    { book: 'УО', sheet: 'ВСЕ', cell: 'J2220', was: '201971.83', became: 20197183, at: 46184.53623398148, author: 'vysotskaya717@gmail.com' },
    { book: 'УО', sheet: 'ВСЕ', cell: 'J2220', was: '2.0197183E7', became: '201.97183', at: 46184.53634844907, author: 'vysotskaya717@gmail.com' },
  ];

  it('свёртывает все правки строки в одну карточку', () => {
    const found = detectRetroEdits(journal, [row({
      book: 'УО', sheet: 'ВСЕ', sheetRow: 2220, rowSeq: '2539',
      subordinate: 'МБОУ «Начикинская средняя школа»', planTotal: 201.97183,
    })]);
    expect(found).toHaveLength(1);
    expect(found[0].members).toHaveLength(2);
    expect(found[0].address.rowSeq).toBe('2539');
    // под риском — сумма, которая осталась в книге, а не промежуточные 20 млрд
    expect(found[0].amountAtRisk).toBeCloseTo(201.97183, 5);
    expect(found[0].note).toContain('2');
  });

  it('правка до появления факта признаком не считается', () => {
    const before: AnomalyJournalEntry[] = [
      { book: 'УО', sheet: 'ВСЕ', cell: 'Q30', was: '(пусто)', became: 46242, at: 46200, author: 'a@b.ru' },
      { book: 'УО', sheet: 'ВСЕ', cell: 'J30', was: '10', became: '20', at: 46100, author: 'a@b.ru' },
    ];
    expect(detectRetroEdits(before)).toHaveLength(0);
  });

  it('строка без заполненной фактической даты в признак не идёт', () => {
    const noFact: AnomalyJournalEntry[] = [
      { book: 'УО', sheet: 'ВСЕ', cell: 'Q31', was: '46242', became: 'Х', at: 46100, author: 'a@b.ru' },
      { book: 'УО', sheet: 'ВСЕ', cell: 'J31', was: '10', became: '20', at: 46200, author: 'a@b.ru' },
    ];
    expect(detectRetroEdits(noFact)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
// Отчёт целиком
// ────────────────────────────────────────────────────────────

describe('отчёт целиком', () => {
  const rows: AnomalyRow[] = [
    ...[28, 88, 63.03332, 132.57332, 400, 3078.96, 11500.94952, 359.49322, 350, 1399.72773]
      .map((v, i) => row({ sheetRow: i + 4, planTotal: v })),
    row({ sheetRow: 12, planTotal: 60000, rowSeq: '57', subject: 'Демонтажные работы' }),
  ];
  const journal: AnomalyJournalEntry[] = [
    { book: 'УО', sheet: 'ВСЕ', cell: 'H28', was: '34975.0', became: '34975002.17', at: 46239.70307990741, author: 'dapofigist@gmail.com' },
  ];

  it('две шкалы возвращаются раздельно и не сводятся в один балл', () => {
    const report = detectAnomalies({ rows, journal });
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining(['typo', 'fitted', 'counts', 'amountAtRisk', 'rowsScanned', 'notes']),
    );
    expect(report).not.toHaveProperty('score');
    expect(report).not.toHaveProperty('trust');
    expect(report.amountAtRisk).toHaveProperty('typo');
    expect(report.amountAtRisk).toHaveProperty('fitted');
    expect(report.rowsScanned).toBe(11);
  });

  it('счётчики признаков сходятся со списками', () => {
    const report = detectAnomalies({ rows, journal });
    const total = Object.values(report.counts).reduce((s, v) => s + v, 0);
    expect(total).toBe(report.typo.length + report.fitted.length);
    expect(report.counts['magnitude-outlier']).toBe(1);
    expect(report.counts['thousandfold-edit']).toBe(1);
  });

  it('без журнала два признака честно объявляются непроверенными', () => {
    const report = detectAnomalies({ rows });
    expect(report.counts['thousandfold-edit']).toBe(0);
    expect(report.counts['retro-edit-after-fact']).toBe(0);
    expect(report.notes.join(' ')).toContain('Журнал правок не передан');
  });

  it('находки отсортированы по деньгам под риском', () => {
    const report = detectAnomalies({ rows, journal });
    const amounts = report.typo.map(f => f.amountAtRisk);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });

  it('пустой вход даёт пустой отчёт, а не выдуманные признаки', () => {
    const report = detectAnomalies({ rows: [] });
    expect(report.typo).toHaveLength(0);
    expect(report.fitted).toHaveLength(0);
    expect(report.amountAtRisk).toEqual({ typo: 0, fitted: 0 });
  });
});

describe('тон и язык признаков', () => {
  const rows: AnomalyRow[] = [
    ...[28, 88, 63.03332, 132.57332, 400, 3078.96, 11500.94952, 359.49322, 350, 1399.72773]
      .map((v, i) => row({ sheetRow: i + 4, planTotal: v, factTotal: v, economy: 0, method: 'ЭА' })),
    row({ sheetRow: 12, planTotal: 60000, factTotal: 60000, economy: 0, method: 'ЭА', rowSeq: '57' }),
    row({ sheetRow: 13, planTotal: 12430.5, rowSeq: '13' }),
    row({ sheetRow: 14, planTotal: 124305, rowSeq: '14' }),
  ];
  const report = detectAnomalies({
    rows,
    journal: [{ book: 'УО', sheet: 'ВСЕ', cell: 'H28', was: '34975.0', became: '34975002.17', at: 46239.70307990741 }],
  });
  const all = [...report.typo, ...report.fitted];

  it('ни одна формулировка не обвиняет', () => {
    const forbidden = /коррупц|нарушен|виновн|умышленн|мошенн|хищен|преступ/iu;
    for (const f of all) {
      expect(f.title).not.toMatch(forbidden);
      expect(f.explanation).not.toMatch(forbidden);
    }
  });

  it('в названиях и объяснениях нет латиницы, кроме адресов ячеек', () => {
    // «ячейка K12» — это настоящий адрес в книге, буква колонки латинская
    // по природе таблицы; всё остальное обязано быть по-русски.
    const withoutCellRefs = (text: string): string =>
      text.replace(/\b[A-Z]{1,2}\d*\b/gu, '');
    for (const f of all) {
      expect(withoutCellRefs(f.title)).not.toMatch(/[A-Za-z]/u);
      expect(withoutCellRefs(f.explanation)).not.toMatch(/[A-Za-z]/u);
    }
  });

  it('у каждой находки есть механизм, адрес и сумма под риском', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) {
      expect(f.explanation.length).toBeGreaterThan(80);
      expect(f.address.book).toBeTruthy();
      expect(f.address.sheet).toBeTruthy();
      expect(f.address.cell).toBeTruthy();
      expect(Number.isFinite(f.amountAtRisk)).toBe(true);
      expect(typeof f.smallSample).toBe('boolean');
    }
  });

  it('каждое объяснение зовёт проверить, а не выносит приговор', () => {
    for (const f of all) {
      expect(f.explanation).toMatch(/может означать|Сверьте|Проверьте|посмотрите|Посмотрите/u);
    }
  });
});
