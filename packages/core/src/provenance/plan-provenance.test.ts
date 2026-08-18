/**
 * plan-provenance.test.ts — регресс ядра провенанса плановых сумм (канон п.102).
 *
 * Живые примеры взяты из полных дампов книг 18.08.2026 (E:/aemr-dumps/book-dumps),
 * лист «_ChangeLog» каждой книги, значения приведены дословно:
 *   УО   H28 — два шага 05.08.2026: «34975.0» → «34975002.17» (16:52:26) и
 *              «3.497500217E7» → «34975.00217» (17:17:20), автор dapofigist@gmail.com,
 *              строка «№ 25 · Капитальный ремонт учебных классов», лист «ВСЕ»;
 *   УКСиМП J96 — 08.04.2026 12:18:20, «1116.72» → «12», mariyavolkovaforwork@gmail.com;
 *   УФБП  J4  — 17.08.2026, «32440.54795» → «24500.2162», mefmat@gmail.com
 *              (кредитная линия — самое крупное одиночное ретро-снижение замера);
 *   УД    — поле «Строка» голым числом («177»), маркер пустоты «(пусто)»,
 *              тройной дубль одной правки J177.
 * Правило теста: числа НЕ подгоняются под удобные — если правка в книге
 * записана экспонентой, тест кормит экспоненту.
 *
 * СВЕРКА НА ПОЛНЫХ ЖУРНАЛАХ (прогон 18.08 по дампам всех восьми книг: лист
 * «_ChangeLog» вычитан потоком, модуль отработал на живых записях):
 *   УФБП   — 1 снижение на 7 940,33 тыс. руб. (замер: 1 на 7 940,33) — сходится;
 *   УКСиМП — 101 событие на 6 276,52 (замер: 112 на 6 693,57) — тот же порядок;
 *   УД     — 29 событий на 125 109,36 (замер: 33 на 3 900,31) — НЕ сходится:
 *            почти вся масса в одной правке J163 «123 544 → 0»;
 *   УО     — 157 событий на 4 400 360,66 (замер: 192 события) — НЕ сходится:
 *            4 331 291 из них дают две правки, I2041 «2 842 440 → 21,87» и
 *            J36 «1 488 851 → 2 068,34».
 * Расхождения НЕ подгонялись порогами: правило, которое подтянуло бы эти три
 * случая, обязано было бы отнести к «переезду запятой» отношения 719 и 129 968,
 * а тогда под нож попал бы и живой УКСиМП J96 (отношение 93). Пока источник
 * замера не сверен построчно, честнее показывать эти правки как снижения и
 * подписывать сомнение, чем молча их спрятать.
 *
 * ЧЕМ ЭТО ВАЖНО. Если считать «в лоб» (только коридор ×1000, как в первой
 * редакции модуля), витрина «растворённой экономии» выдавала: УО 27 217 178
 * тыс. руб., УКСиМП 968 257. После разделения дефектов заполнения осталось
 * 4 400 361 и 6 277. Разница — не логика продукта, а грязь в книгах:
 * переезд запятой (×100, ×100 000), даты в денежных ячейках и минусы.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPlanProvenance,
  classifyPlanEdit,
  parseJournalInstant,
  parseJournalRowKey,
  summarizeBookProvenance,
  planColumnLabel,
  UNIT_FIX_RATIO_MAX,
  UNIT_FIX_RATIO_MIN,
  type JournalRecord,
  type PlanRowInput,
} from './plan-provenance.js';

// ── Разбор поля «Строка» ──────────────────────────────────────────────

describe('parseJournalRowKey — оба живых формата поля «Строка»', () => {
  it('формат УФБП/УО: «№ 38 · Услуги почтовой связи» → номер и предмет', () => {
    const r = parseJournalRowKey('№ 38 · Услуги почтовой связи');
    expect(r.ordinal).toBe(38);
    expect(r.subject).toBe('Услуги почтовой связи');
    expect(r.truncated).toBe(false);
  });

  it('живой УО: «№ 25 · Капитальный ремонт учебных классов»', () => {
    expect(parseJournalRowKey('№ 25 · Капитальный ремонт учебных классов').ordinal).toBe(25);
  });

  it('формат УД: голый номер «177»', () => {
    const r = parseJournalRowKey('177');
    expect(r.ordinal).toBe(177);
    expect(r.subject).toBeNull();
  });

  it('число, а не строка (Google отдаёт numberValue) — тоже номер', () => {
    expect(parseJournalRowKey(177).ordinal).toBe(177);
    expect(parseJournalRowKey('157.0').ordinal).toBe(157);
  });

  it('обрезанный журналом предмет помечается флагом, многоточие в текст не идёт', () => {
    const r = parseJournalRowKey(
      '№ 14 · Приобретение образовательных услуг по профессиональной переподготовке и повышению квалифик…',
    );
    expect(r.ordinal).toBe(14);
    expect(r.truncated).toBe(true);
    expect(r.subject?.endsWith('квалифик')).toBe(true);
  });

  it('многострочное наименование (живой УФБП № 1) склеивается в одну строку', () => {
    const r = parseJournalRowKey(
      '№ 1 · Оказание услуг по предоставлению кредита в форме возобновляемой кредитной линии\n с лимитом…',
    );
    expect(r.ordinal).toBe(1);
    expect(r.subject).toContain('кредитной линии с лимитом');
    expect(r.truncated).toBe(true);
  });

  it('номер без предмета — «№ 42»', () => {
    const r = parseJournalRowKey('№ 42');
    expect(r.ordinal).toBe(42);
    expect(r.subject).toBeNull();
  });

  it('неразрывные пробелы Google не ломают разбор', () => {
    expect(parseJournalRowKey('№\u00a038\u00a0·\u00a0Услуги').ordinal).toBe(38);
  });

  describe('мусор — ordinal null, строка честно остаётся несопоставленной', () => {
    const garbage = ['', '   ', '—', 'Х', 'abc', '№', '№ ·  предмет', '№ 0 · нулевой', '-5', '38.5', 'строка 38'];
    for (const bad of garbage) {
      it(`«${bad}»`, () => {
        expect(parseJournalRowKey(bad).ordinal).toBeNull();
      });
    }
    it('null/undefined', () => {
      expect(parseJournalRowKey(null).ordinal).toBeNull();
      expect(parseJournalRowKey(undefined).ordinal).toBeNull();
    });
  });

  it('raw сохраняется для показа даже у мусора', () => {
    expect(parseJournalRowKey('  строка 38  ').raw).toBe('строка 38');
  });
});

// ── Разбор колонки «Время» ────────────────────────────────────────────

describe('parseJournalInstant — живые формы колонки «Время»', () => {
  it('Google-serial с дробью → время книги без выдуманного смещения', () => {
    // 46239.70307990741 = 05.08.2026 16:52:26 по подписи самой книги (УО H28).
    expect(parseJournalInstant(46239.70307990741)?.at).toBe('2026-08-05T16:52:26');
    expect(parseJournalInstant(46239.720365625)?.at).toBe('2026-08-05T17:17:20');
  });

  it('serial без дроби — полночь, а не «сейчас»', () => {
    expect(parseJournalInstant(46238)?.at).toBe('2026-08-04T00:00:00');
  });

  it('«дд.мм.гггг чч:мм:сс» и «дд.мм.гггг»', () => {
    expect(parseJournalInstant('08.04.2026 12:18:20')?.at).toBe('2026-04-08T12:18:20');
    expect(parseJournalInstant('17.08.2026')?.at).toBe('2026-08-17T00:00:00');
  });

  it('ISO принимается — роут может отдать уже разобранное время', () => {
    expect(parseJournalInstant('2026-08-05T16:52:26')?.at).toBe('2026-08-05T16:52:26');
  });

  it('мусор → null (событию некуда встать на ленту)', () => {
    expect(parseJournalInstant('позавчера')).toBeNull();
    expect(parseJournalInstant('')).toBeNull();
    expect(parseJournalInstant(null)).toBeNull();
  });
});

// ── Классификация ─────────────────────────────────────────────────────

describe('classifyPlanEdit — детерминированный вид правки', () => {
  it('живой УО H28, шаг 1: ввели рубли вместо тысяч (рост ×1000) — unit-fix, не raise', () => {
    expect(classifyPlanEdit('34975.0', '34975002.17')).toBe('unit-fix');
  });

  it('живой УО H28, шаг 2: вернули тысячи (экспонента в «Было») — unit-fix, не retro-cut', () => {
    expect(classifyPlanEdit('3.497500217E7', '34975.00217')).toBe('unit-fix');
  });

  it('живой УКСиМП J96: 1116.72 → 12 — настоящее ретро-снижение', () => {
    expect(classifyPlanEdit('1116.72', '12')).toBe('retro-cut');
  });

  it('живой УФБП J4: 32440.54795 → 24500.2162 — ретро-снижение', () => {
    expect(classifyPlanEdit('32440.54795', '24500.2162')).toBe('retro-cut');
  });

  it('границы коридора единиц включительны, за ними — обычное снижение/рост', () => {
    expect(classifyPlanEdit(String(UNIT_FIX_RATIO_MIN), '1')).toBe('unit-fix');
    expect(classifyPlanEdit(String(UNIT_FIX_RATIO_MAX), '1')).toBe('unit-fix');
    expect(classifyPlanEdit('899.9', '1')).toBe('retro-cut');
    expect(classifyPlanEdit('1', '1100.1')).toBe('raise');
  });

  it('рост, появление из пустоты и очистка в пустоту', () => {
    expect(classifyPlanEdit('205.83', '411.66')).toBe('raise');
    expect(classifyPlanEdit('(пусто)', '1521.75986')).toBe('fill');
    expect(classifyPlanEdit('306.5232', '(пусто)')).toBe('clear');
  });

  it('снижение в ноль — это снижение, а не очистка (0 ≠ пусто)', () => {
    expect(classifyPlanEdit('38.1', '0')).toBe('retro-cut');
  });

  it('рост из нуля — рост, отношение не считается (деление на ноль)', () => {
    expect(classifyPlanEdit('0.0', '76.2')).toBe('raise');
  });

  it('маркер журнала «(до массовой правки не отслежено)» → unknown, а не «плана не было»', () => {
    expect(classifyPlanEdit('(до массовой правки не отслежено)', '0')).toBe('unknown');
  });

  it('текст в денежной ячейке — незнание, а не ноль', () => {
    expect(classifyPlanEdit('12 рублей', '5')).toBe('unknown');
  });

  it('операторский формат «1 234,56» читается как число', () => {
    expect(classifyPlanEdit('1 234,56', '2 000,00')).toBe('raise');
  });
});

// ── Дефекты заполнения, которые нельзя путать со снижением плана ───────

describe('classifyPlanEdit — грязь в книгах отделена от движения плана', () => {
  it('живой УО J2220: «2.0197183E7» → «201.97183» — переезд запятой (×100 000), не снижение', () => {
    expect(classifyPlanEdit('2.0197183E7', '201.97183')).toBe('scale-shift');
  });

  it('живой УО J2220, шаг до него: «201971.83» → 20197183 (×100) — тоже переезд запятой', () => {
    expect(classifyPlanEdit('201971.83', '20197183')).toBe('scale-shift');
  });

  it('канон п.102 сохранён: отношение 93 (УКСиМП J96) остаётся ретро-снижением', () => {
    // Порог «точная степень десяти» выбран жёстким именно ради этого случая:
    // при допуске ±10 % отношение 93,06 попало бы в «переезд запятой» и
    // флагманский пример канона исчез бы из «растворённой экономии».
    expect(classifyPlanEdit('1116.72', '12')).toBe('retro-cut');
  });

  it('отношение 719,8 (живой УО J36) — не степень десяти, значит снижение', () => {
    expect(classifyPlanEdit('1488851', '2068.33741')).toBe('retro-cut');
  });

  it('живой УКСиМП J147: 46149 → 4 — в денежную ячейку попала дата', () => {
    expect(classifyPlanEdit('46149', '4')).toBe('date-in-money');
  });

  it('живой УКСиМП J479: 46276 → 46277 — правка даты внутри денежной ячейки', () => {
    expect(classifyPlanEdit('46276', '46277')).toBe('date-in-money');
  });

  it('дата, записанная ПОВЕРХ суммы, ловится в обе стороны', () => {
    expect(classifyPlanEdit('1500', '46295')).toBe('date-in-money');
  });

  it('копейки спасают настоящую сумму из календарной полосы от подмены', () => {
    // Целость — обязательное условие: 46 149,55 это деньги, 46 149 — подозрение.
    expect(classifyPlanEdit('46149.55', '4')).toBe('retro-cut');
  });

  it('законный перевод рублей в тысячи не считается датой, хотя «Стало» в полосе', () => {
    // 46,2 тыс. → 46 200 руб.: «Стало» целое и внутри 44000..48000, но отношение
    // ровно 1000 — единицы проверяются РАНЬШЕ полосы дат, иначе правка соврёт.
    expect(classifyPlanEdit('46.2', '46200')).toBe('unit-fix');
  });

  it('живой УКСиМП J82: 1 291,22 → −268 939 — отрицательного плана не бывает', () => {
    expect(classifyPlanEdit('1291.22092', '-268939')).toBe('invalid-value');
  });
});

describe('buildPlanProvenance — дефекты не попадают в «ушедший план», но и не прячутся', () => {
  const journal: JournalRecord[] = [
    rec('ВСЕ', 'J2220', '2436', '2.0197183E7', '201.97183', '11.06.2026 10:00:00', 'a@b.c'),
    rec('ВСЕ', 'J147', '144', '46149', '4', '09.06.2026 10:00:00', 'a@b.c'),
    rec('ВСЕ', 'J82', '80', '1291.22092', '-268939', '30.04.2026 10:00:00', 'a@b.c'),
    rec('ВСЕ', 'K12', '12', '500', '300', '10.05.2026 12:00:00', 'a@b.c'),
  ];
  const rows: PlanRowInput[] = [
    { ordinal: 2436, planNow: 201.97183 }, { ordinal: 144, planNow: 4 },
    { ordinal: 80, planNow: 0 }, { ordinal: 12, planNow: 300 },
  ];

  it('в «ушедший план» идёт только настоящее снижение', () => {
    const list = buildPlanProvenance(journal, rows, { bookLabel: 'УО' });
    const s = summarizeBookProvenance(list, 'УО');
    expect(s.retroCutCount).toBe(1);
    expect(s.retroCutTotal).toBeCloseTo(200, 6);
    expect(s.scaleShiftCount).toBe(1);
    expect(s.dateInMoneyCount).toBe(1);
    expect(s.invalidValueCount).toBe(1);
  });

  it('отложенная масса названа числом — есть чем ответить на «почему не в лоб»', () => {
    const s = summarizeBookProvenance(buildPlanProvenance(journal, rows), 'УО');
    // 20 196 981,03 (запятая) + 46 145,00 (дата) + 270 230,22 (минус)
    expect(s.defectMassExcluded).toBeCloseTo(20196981.03 + 46145 + 270230.22, 1);
    expect(s.note).toContain('Это не экономия, а грязь в данных');
  });

  it('каждый дефект получает свой адрес и своё действие в тексте строки', () => {
    const list = buildPlanProvenance(journal, rows, { bookLabel: 'УО' });
    expect(list[0].summary.note).toContain('Переездов запятой');
    expect(list[1].summary.note).toContain('попадала дата');
    expect(list[1].summary.note).toContain('правило ошиблось'); // честная оговорка
    expect(list[2].summary.note).toContain('уходила в минус');
  });
});

// ── Сборка провенанса ─────────────────────────────────────────────────

/** Запись журнала в порядке живой шапки — помощник, чтобы тесты читались. */
function rec(
  sheet: string, cell: string, row: unknown, was: unknown, became: unknown,
  at: unknown, author: string,
): JournalRecord {
  return { sheet, cell, column: 'подпись колонки — свободный текст', row, was, became, at, author };
}

describe('buildPlanProvenance — живой УО H28 (исправление единиц в два шага)', () => {
  const journal: JournalRecord[] = [
    rec('ВСЕ', 'H28', '№ 25 · Капитальный ремонт учебных классов',
      '34975.0', '34975002.17', 46239.70307990741, 'dapofigist@gmail.com'),
    rec('ВСЕ', 'H28', '№ 25 · Капитальный ремонт учебных классов',
      '3.497500217E7', '34975.00217', 46239.720365625, 'dapofigist@gmail.com'),
  ];
  const rows: PlanRowInput[] = [{ ordinal: 25, planNow: 34975.00217 }];

  it('обе правки — unit-fix, ретро-снижений нет: план не уходил', () => {
    const [p] = buildPlanProvenance(journal, rows, { bookLabel: 'УО' });
    expect(p.events).toHaveLength(2);
    expect(p.events.map((e) => e.kind)).toEqual(['unit-fix', 'unit-fix']);
    expect(p.summary.retroCutTotal).toBe(0);
    expect(p.summary.retroCutCount).toBe(0);
    expect(p.summary.unitFixCount).toBe(2);
  });

  it('адрес, автор и момент сохранены дословно — правку видно в книге', () => {
    const [p] = buildPlanProvenance(journal, rows);
    expect(p.events[0].cell).toBe('H28');
    expect(p.events[0].column).toBe('H');
    expect(p.events[0].author).toBe('dapofigist@gmail.com');
    expect(p.events[0].at).toBe('2026-08-05T16:52:26');
    expect(p.events[1].at).toBe('2026-08-05T17:17:20');
  });

  it('экспонента «3.497500217E7» прочитана как 34 975 002,17', () => {
    const [p] = buildPlanProvenance(journal, rows);
    expect(p.events[1].was).toBeCloseTo(34975002.17, 2);
    expect(p.events[1].delta).toBeCloseTo(34975.00217 - 34975002.17, 2);
  });

  it('фраза диагноста называет исправление единиц и не считает его ушедшим планом', () => {
    const [p] = buildPlanProvenance(journal, rows, { bookLabel: 'УО' });
    expect(p.summary.note).toContain('Исправлений единиц');
    expect(p.summary.note).toContain('H28');
    expect(p.summary.note).not.toContain('снижали задним числом');
  });
});

describe('buildPlanProvenance — живой УКСиМП J96 (ретро-снижение)', () => {
  const journal: JournalRecord[] = [
    rec('УКСиМП', 'J96', '№ 94 · строка культуры',
      '1116.72', '12', '08.04.2026 12:18:20', 'mariyavolkovaforwork@gmail.com'),
  ];

  it('снижение 1 116,72 → 12,00 попадает в «ушедший план» положительной суммой', () => {
    const [p] = buildPlanProvenance(journal, [{ ordinal: 94, planNow: 12 }], { bookLabel: 'УКСиМП' });
    expect(p.events[0].kind).toBe('retro-cut');
    expect(p.events[0].delta).toBeCloseTo(-1104.72, 2);
    expect(p.summary.retroCutTotal).toBeCloseTo(1104.72, 2);
    expect(p.summary.retroCutCount).toBe(1);
  });

  it('без даты факта признак factAtEdit молчит (null), а не врёт «факта не было»', () => {
    const [p] = buildPlanProvenance(journal, [{ ordinal: 94, planNow: 12 }]);
    expect(p.events[0].factAtEdit).toBeNull();
    expect(p.summary.retroCutAfterFactTotal).toBeNull();
    expect(p.summary.retroCutAfterFactCount).toBeNull();
  });

  it('правка ПОСЛЕ заключения выделяется отдельно — это признак изъятия экономии', () => {
    const [p] = buildPlanProvenance(journal, [
      { ordinal: 94, planNow: 12, factDate: '01.03.2026' },
    ], { bookLabel: 'УКСиМП' });
    expect(p.events[0].factAtEdit).toBe(true);
    expect(p.summary.retroCutAfterFactCount).toBe(1);
    expect(p.summary.retroCutAfterFactTotal).toBeCloseTo(1104.72, 2);
    expect(p.summary.note).toContain('ПОСЛЕ');
  });

  it('правка ДО заключения — снижение есть, признака «после факта» нет', () => {
    const [p] = buildPlanProvenance(journal, [
      { ordinal: 94, planNow: 12, factDate: '20.06.2026' },
    ]);
    expect(p.events[0].factAtEdit).toBe(false);
    expect(p.summary.retroCutAfterFactCount).toBe(0);
  });

  it('фраза диагноста несёт адрес книги, ячейку, дату и что делать', () => {
    const [p] = buildPlanProvenance(journal, [{ ordinal: 94, planNow: 12 }], { bookLabel: 'УКСиМП' });
    expect(p.summary.note).toContain('УКСиМП');
    expect(p.summary.note).toContain('J96');
    expect(p.summary.note).toContain('08.04.2026');
    // Разряды разделены неразрывным пробелом — сумму нельзя разорвать переносом.
    expect(p.summary.note).toContain('1 104,72');
    expect(p.summary.note).toContain('НМЦК');
  });
});

describe('buildPlanProvenance — живой УФБП J4 (кредитная линия)', () => {
  const journal: JournalRecord[] = [
    rec('УФБП', 'J4', '№ 1 · Оказание услуг по предоставлению кредита в форме возобновляемой кредитной линии\n с лимитом…',
      '32440.54795', '24500.2162', 46251.37235287037, 'mefmat@gmail.com'),
  ];

  it('снижение на 7 940,33 тыс. руб. — ровно то, что показал замер 18.08', () => {
    const [p] = buildPlanProvenance(journal, [{ ordinal: 1, planNow: 24500.2162 }], { bookLabel: 'УФБП' });
    expect(p.events[0].kind).toBe('retro-cut');
    expect(p.summary.retroCutTotal).toBeCloseTo(7940.33, 2);
  });

  it('первое и последнее известное значение плана по наблюдаемой колонке', () => {
    const [p] = buildPlanProvenance(journal, [{ ordinal: 1, planNow: 24500.2162 }]);
    expect(p.summary.planColumnObserved).toBe('J');
    expect(p.summary.firstKnownPlan).toBeCloseTo(32440.54795, 5);
    expect(p.summary.firstKnownAt).toBe('2026-08-17T08:56:11');
    expect(p.summary.lastKnownPlan).toBeCloseTo(24500.2162, 4);
  });
});

// ── Наблюдаемость: главное требование ─────────────────────────────────

describe('PlanObservability — «правок не было» никогда не подменяет «журнал не ведётся»', () => {
  const rows: PlanRowInput[] = [{ ordinal: 7, planNow: 100 }];

  it('пустой журнал: coversRow=false, journalEntries=0, текст прямо говорит о дыре', () => {
    const [p] = buildPlanProvenance([], rows);
    expect(p.observability.journalEntries).toBe(0);
    expect(p.observability.coversRow).toBe(false);
    expect(p.observability.note).toContain('не значит, что правок не было');
    expect(p.summary.note).toContain('журнал правок книги не ведётся');
    expect(p.events).toHaveLength(0);
  });

  it('журнал ведётся, но эту строку не покрывает — это уже другой текст', () => {
    const journal = [rec('УД', 'J10', '9', '1', '2', '06.04.2026 10:00:00', 'a@b.c')];
    const [p] = buildPlanProvenance(journal, rows);
    expect(p.observability.journalEntries).toBe(1);
    expect(p.observability.coversRow).toBe(false);
    expect(p.observability.note).toContain('правок по этой строке в нём нет');
  });

  it('строку журнал видит, но плановых ячеек правки не касались', () => {
    const journal = [rec('УД', 'M7', '7', 'а', 'б', '06.04.2026 10:00:00', 'a@b.c')];
    const [p] = buildPlanProvenance(journal, rows);
    expect(p.observability.coversRow).toBe(true);
    expect(p.observability.planEntries).toBe(0);
    expect(p.observability.note).toContain('плановых ячеек H/I/J/K они не касались');
  });

  it('нечитаемые ключи строк и адреса считаются, а не исчезают молча', () => {
    const journal = [
      rec('УД', 'J10', 'мусор', '1', '2', '06.04.2026 10:00:00', 'a@b.c'),
      rec('УД', 'не-адрес', '7', '1', '2', '06.04.2026 10:00:00', 'a@b.c'),
    ];
    const [p] = buildPlanProvenance(journal, rows);
    expect(p.observability.unparsedRowKeys).toBe(1);
    expect(p.observability.unparsedCells).toBe(1);
    // Строку № 7 журнал всё же видит — она не уходит в «правок не было».
    expect(p.observability.coversRow).toBe(true);
  });

  it('живой УАГЗО: журнал без колонки «Строка» — это не «правок не было»', () => {
    // Замер 18.08: у УАГЗО шапка журнала укорочена до «Ячейка | Было | Стало |
    // Время | Автор | Статус» — колонок «Лист», «Столбец» и «Строка» нет вовсе,
    // поэтому ключ не читается у всех 69 записей. Сказать про такую книгу
    // «правок по строке нет» — выдать отсутствие КЛЮЧА за отсутствие ПРАВОК.
    const journal: JournalRecord[] = [
      { cell: 'УАГЗО!B48', row: undefined, was: 'УАГЗО АЕМР', became: '', at: 46118.54, author: '' },
      { cell: 'K10', row: undefined, was: '300', became: '200', at: 46118.6, author: '' },
    ];
    const [p] = buildPlanProvenance(journal, rows);
    expect(p.observability.journalEntries).toBe(2);
    expect(p.observability.unparsedRowKeys).toBe(2);
    expect(p.observability.coversRow).toBe(false);
    expect(p.observability.note).toContain('НИ ОДНА запись не несёт номера строки');
    expect(p.observability.note).toContain('без колонки «Строка»');
    // И прямое действие вместо упрёка (канон п.53).
    expect(p.observability.note).toContain('Добавить колонку «Строка»');
  });

  it('часть ключей не читается — оговорка попадает в текст, а не теряется', () => {
    const journal = [
      rec('УД', 'J10', '9', '1', '2', '06.04.2026 10:00:00', 'a@b.c'),
      rec('УД', 'J11', 'мусор', '1', '2', '06.04.2026 10:00:00', 'a@b.c'),
    ];
    const [p] = buildPlanProvenance(journal, rows);
    expect(p.observability.coversRow).toBe(false);
    expect(p.observability.note).toContain('могли относиться и к этой строке');
  });

  it('строки без записей всё равно получают ответ — длина и порядок сохранены', () => {
    const journal = [rec('УД', 'J10', '9', '1', '2', '06.04.2026 10:00:00', 'a@b.c')];
    const list = buildPlanProvenance(journal, [
      { ordinal: 9, planNow: 2 },
      { ordinal: 7, planNow: 100 },
      { ordinal: 3, planNow: null },
    ]);
    expect(list.map((p) => p.ordinal)).toEqual([9, 7, 3]);
    expect(list[0].observability.coversRow).toBe(true);
    expect(list[1].observability.coversRow).toBe(false);
  });
});

// ── Живые повадки журнала ─────────────────────────────────────────────

describe('buildPlanProvenance — повадки живого журнала', () => {
  it('тройной дубль одной правки (живой УД J177) схлопывается в одно событие', () => {
    const journal = [
      rec('УД', 'J177', '195', '(пусто)', '1521.7598600000001', '06.04.2026 18:54:53', 'a@b.c'),
      rec('УД', 'J177', '195', '(пусто)', '1521.7598600000001', '06.04.2026 18:54:53', 'a@b.c'),
      rec('УД', 'J177', '195', '(пусто)', '1521.7598600000001', '06.04.2026 18:54:53', 'a@b.c'),
    ];
    const [p] = buildPlanProvenance(journal, [{ ordinal: 195, planNow: 1521.76 }]);
    expect(p.events).toHaveLength(1);
    expect(p.events[0].kind).toBe('fill');
    expect(p.events[0].delta).toBeCloseTo(1521.75986, 5);
  });

  it('«правка» без изменения значения (живой УД «5.0» → «5») событием не считается', () => {
    const journal = [rec('УД', 'J113', '107', '5.0', '5', '06.04.2026 19:00:00', 'a@b.c')];
    const [p] = buildPlanProvenance(journal, [{ ordinal: 107, planNow: 5 }]);
    expect(p.events).toHaveLength(0);
    // Но строку журнал видел — наблюдаемость об этом честно говорит.
    expect(p.observability.coversRow).toBe(true);
    expect(p.observability.planEntries).toBe(1);
  });

  it('очистка в пустоту учитывается отдельно от снижений', () => {
    const journal = [rec('УД', 'I128', '138', '306.5232', '(пусто)', '06.04.2026 19:10:00', 'a@b.c')];
    const [p] = buildPlanProvenance(journal, [{ ordinal: 138, planNow: null }]);
    expect(p.events[0].kind).toBe('clear');
    expect(p.summary.clearedTotal).toBeCloseTo(306.5232, 4);
    expect(p.summary.retroCutTotal).toBe(0);
    expect(p.summary.note).toContain('очищали в пустоту');
  });

  it('незнание журнала не превращается в арифметику: delta = null', () => {
    const journal = [
      rec('УКСиМП', 'H280', '278', '(до массовой правки не отслежено)', '0',
        '14.08.2026 15:53:44', 'mariyavolkovaforwork@gmail.com (?)'),
    ];
    const [p] = buildPlanProvenance(journal, [{ ordinal: 278, planNow: 0 }]);
    expect(p.events[0].kind).toBe('unknown');
    expect(p.events[0].wasKnown).toBe(false);
    expect(p.events[0].delta).toBeNull();
    expect(p.summary.retroCutTotal).toBe(0);
  });

  it('события отсортированы по времени книги, независимо от порядка записей', () => {
    const journal = [
      rec('УД', 'K10', '8', '200', '150', '10.06.2026 09:00:00', 'a@b.c'),
      rec('УД', 'K10', '8', '300', '200', '01.05.2026 09:00:00', 'a@b.c'),
    ];
    const [p] = buildPlanProvenance(journal, [{ ordinal: 8, planNow: 150 }]);
    expect(p.events.map((e) => e.at)).toEqual([
      '2026-05-01T09:00:00', '2026-06-10T09:00:00',
    ]);
    expect(p.summary.retroCutTotal).toBeCloseTo(150, 6);
  });

  it('колонка ИТОГО (K) приоритетна для «первого/последнего значения плана»', () => {
    const journal = [
      rec('УД', 'J10', '8', '50', '40', '01.05.2026 09:00:00', 'a@b.c'),
      rec('УД', 'K10', '8', '300', '200', '01.05.2026 09:00:00', 'a@b.c'),
    ];
    const [p] = buildPlanProvenance(journal, [{ ordinal: 8, planNow: 190 }]);
    expect(p.summary.planColumnObserved).toBe('K');
    expect(p.summary.firstKnownPlan).toBe(300);
    // Лист свежее журнала: последнее известное берётся из строки, момент — «сейчас».
    expect(p.summary.lastKnownPlan).toBe(190);
    expect(p.summary.lastKnownAt).toBeNull();
  });

  it('фильтр по имени листа отсекает чужие записи, когда имя известно', () => {
    const journal = [
      rec('УКСиМП', 'K10', '8', '300', '200', '01.05.2026 09:00:00', 'a@b.c'),
      rec('ВСЕ', 'K10', '8', '200', '100', '02.05.2026 09:00:00', 'a@b.c'),
    ];
    const both = buildPlanProvenance(journal, [{ ordinal: 8, planNow: 100 }]);
    expect(both[0].events).toHaveLength(2);
    const only = buildPlanProvenance(journal, [{ ordinal: 8, planNow: 100 }], { sheetName: 'УКСиМП' });
    expect(only[0].events).toHaveLength(1);
    expect(only[0].observability.journalEntries).toBe(1);
  });

  it('правка плана с нечитаемым временем не выдумывает момент, но строку не теряет', () => {
    const journal = [rec('УД', 'K10', '8', '300', '200', 'позавчера', 'a@b.c')];
    const [p] = buildPlanProvenance(journal, [{ ordinal: 8, planNow: 200 }]);
    expect(p.events).toHaveLength(0);
    expect(p.observability.coversRow).toBe(true);
  });

  it('правки прочих колонок (свободный текст, п.27) в провенанс плана не попадают', () => {
    const journal = [
      rec('УФБП', 'M18', '№ 19 · Переплетный станок', 'старый текст', 'новый текст',
        '04.08.2026', 'paninamaria1996@gmail.com'),
      rec('УФБП', 'AF46', '№ 19 · Переплетный станок', 'а', 'б', '04.08.2026', 'a@b.c'),
    ];
    const [p] = buildPlanProvenance(journal, [{ ordinal: 19, planNow: 10 }]);
    expect(p.events).toHaveLength(0);
    expect(p.observability.coversRow).toBe(true);
    expect(p.observability.planEntries).toBe(0);
  });
});

// ── Книжная сводка ────────────────────────────────────────────────────

describe('summarizeBookProvenance — витрина «экономии, растворённой в плане»', () => {
  const journal: JournalRecord[] = [
    rec('УКСиМП', 'J96', '№ 94 · культура', '1116.72', '12', '08.04.2026 12:18:20', 'a@b.c'),
    rec('УКСиМП', 'K12', '№ 12 · вторая', '500', '300', '10.05.2026 12:00:00', 'a@b.c'),
    rec('УКСиМП', 'H28', '№ 25 · единицы', '34975.0', '34975002.17', '05.08.2026 16:52:26', 'a@b.c'),
  ];
  const rows: PlanRowInput[] = [
    { ordinal: 94, planNow: 12, factDate: '01.03.2026' },
    { ordinal: 12, planNow: 300 },
    { ordinal: 25, planNow: 34975002.17 },
    { ordinal: 999, planNow: 50 },
  ];

  it('складывает ретро-снижения и НЕ складывает исправления единиц', () => {
    const s = summarizeBookProvenance(buildPlanProvenance(journal, rows), 'УКСиМП');
    expect(s.retroCutCount).toBe(2);
    expect(s.retroCutTotal).toBeCloseTo(1104.72 + 200, 2);
    expect(s.unitFixCount).toBe(1);
    expect(s.rowsWithRetroCut).toBe(2);
  });

  it('подписывает покрытие журналом — иначе число снижений читается как оценка управления', () => {
    const s = summarizeBookProvenance(buildPlanProvenance(journal, rows), 'УКСиМП');
    expect(s.rows).toBe(4);
    expect(s.rowsCovered).toBe(3);
    expect(s.note).toContain('75 %');
    expect(s.note).toContain('По непокрытым строкам судить о правках плана нельзя');
  });

  it('пустой журнал книги → витрина говорит о дыре наблюдаемости, а не о чистоте данных', () => {
    const s = summarizeBookProvenance(buildPlanProvenance([], rows), 'УИО');
    expect(s.journalEntries).toBe(0);
    expect(s.retroCutTotal).toBe(0);
    expect(s.note).toContain('дыра наблюдаемости');
    // Ноль снижений при пустом журнале не должен читаться как «снижений не было»:
    // витрина обязана сказать, что провенанс недоступен.
    expect(s.note).toContain('недоступен');
    expect(s.note).toContain('ничего не доказывает');
  });

  it('пустой список строк не роняет сводку', () => {
    const s = summarizeBookProvenance([]);
    expect(s.rows).toBe(0);
    expect(s.journalEntries).toBe(0);
  });
});

describe('planColumnLabel — подписи вместо букв', () => {
  it('интерфейсу нужны слова', () => {
    expect(planColumnLabel('H')).toBe('план ФБ');
    expect(planColumnLabel('K')).toBe('план ИТОГО');
  });
});
