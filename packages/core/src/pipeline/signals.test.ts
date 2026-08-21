import { describe, it, expect } from 'vitest';
import { PLAN_SOURCE_COLUMNS, SIGNAL_LABELS } from '@aemr/shared';
import { detectSignals, classifyRowState, getSignalBadges, type RowSignals } from './signals.js';

// ────────────────────────────────────────────────────────────
// Helper: build a cells dict from partial column data.
// Keys are column letters (A, B, ..., AF), values are cell contents.
// ────────────────────────────────────────────────────────────

function makeCells(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    A: 1, B: null, C: 'Подвед-1', D: 'Поставка ГСМ',
    E: null, F: 'Текущая деятельность', G: 'Горючее',
    H: 0, I: 0, J: 0, K: 1_000_000,
    L: 'ЭА', M: '', N: '15.03.2026', O: 1,
    P: 2026, Q: null, R: null, S: null, T: null,
    U: '', V: 0, W: 0, X: 0, Y: 0,
    Z: 0, AA: 0, AB: 0, AC: 0, AD: '',
    AE: '', AF: '',
  };
  return { ...base, ...overrides };
}

/** Fixed reference date for deterministic tests */
const REF_DATE = new Date(2026, 3, 13); // April 13, 2026

// ────────────────────────────────────────────────────────────
// 1. Status Signals
// ────────────────────────────────────────────────────────────

describe('Статус строки — только структурные колонки (канон п.27, интервью 14.08.2026)', () => {
  it('signed: дата заключения (Q) проставлена и разобрана', () => {
    const s = detectSignals(makeCells({ Q: '10.03.2026' }), REF_DATE);
    expect(s.signed).toBe(true);
    expect(s.hasFact).toBe(true);
  });

  it('signed=false: только суммы факта без даты — «есть факт», но не «заключено»', () => {
    const s = detectSignals(makeCells({ Q: null, Y: 500_000 }), REF_DATE);
    expect(s.signed).toBe(false);
    expect(s.hasFact).toBe(true);
  });

  it('«Подписан»/«заключен»/«исполнен» в U/AE/AF статуса НЕ дают (п.27)', () => {
    for (const cells of [{ U: 'Подписан' }, { AE: 'договор заключен' }, { AF: 'Исполнен полностью' }]) {
      const s = detectSignals(makeCells(cells), REF_DATE);
      expect(s.signed).toBe(false);
    }
  });

  it('СТРАЖ п.40 (баг #16 охоты 08.08): «не заключен» в комментарии не делает строку подписанной', () => {
    // До канона подстрока «заключен» матчилась внутри «не заключен» —
    // отрицание читалось как подписанный контракт при пустом факте.
    const s = detectSignals(makeCells({ Q: null, Y: 0, AE: 'Контракт не заключен' }), REF_DATE);
    expect(s.signed).toBe(false);
    expect(s.hasFact).toBe(false);
  });

  it('СТРАЖ п.41: «отменён» при состоявшейся закупке не гасит её сигналы', () => {
    // Есть факт (дата + суммы, превышение плана) — слово «отменён» в U
    // больше не переводит строку в canceled и не глушит factExceedsPlan.
    const s = detectSignals(makeCells({
      U: 'отменена', K: 1_000_000, Y: 1_200_000, Q: '10.03.2026',
    }), REF_DATE);
    expect(s.canceled).toBe(false);
    expect(s.factExceedsPlan).toBe(true);
    expect(s.signed).toBe(true);
  });

  it('текстовые статусы planning/notDue/canceled всегда false (п.27)', () => {
    const s = detectSignals(makeCells({
      U: 'Отменена', AE: 'В стадии планирования, срок не наступил, снят с плана, не требуется',
    }), REF_DATE);
    expect(s.planning).toBe(false);
    expect(s.notDue).toBe(false);
    expect(s.canceled).toBe(false);
  });

  it('СТРАЖ класса (харнесс п.27): свободный текст U/AE/AF не меняет НИ ОДНОГО сигнала', () => {
    // Фикстура из решения владельца: «не заключен», «отменён», «будет
    // подписан», «ожидается 03.09.2025» в комментариях. Полное равенство
    // наборов сигналов с текстами и без — тексты обязаны быть невидимы
    // для машины на любой строке (без правки этот тест падал: signed,
    // canceled, financeDelay, singleParticipant и гейты читали текст).
    const variants: Array<Record<string, unknown>> = [
      {}, // пустая строка плана
      { N: '01.01.2026' }, // просроченный план
      { Q: '10.03.2026', Y: 500_000 }, // заключённая
      { K: 1_000, Y: 1_200 }, // факт больше плана
      { L: 'ЕП', K: 700, M: '' }, // ЕП-риск без обоснования
      { P: '', K: 190 }, // не обеспечена финансированием
    ];
    for (const base of variants) {
      const clean = detectSignals(makeCells(base), REF_DATE);
      const withText = detectSignals(makeCells({
        ...base,
        U: 'не заключен, будет подписан',
        AE: 'отменён, не требуется, ожидается 03.09.2025',
        AF: 'договор заключен, снят с плана, отсутствие финансирования, 1 участник, переносится на 2 квартал',
      }), REF_DATE);
      expect(withText).toEqual(clean);
    }
  });
});

// ────────────────────────────────────────────────────────────
// 2. Date / Time Signals
// ────────────────────────────────────────────────────────────

describe('Date signals', () => {
  it('overdue: plan date passed, no fact, not signed', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', // well past REF_DATE (April 13)
      Q: null, Y: 0, U: '',
    }), REF_DATE);
    expect(s.overdue).toBe(true);
  });

  it('overdue: план-дата как Google-serial (46023 = 01.01.2026), НЕ год 46023', () => {
    // 6 из 8 ГРБС-листов хранят даты как serial-число (столбцы N/Q). До фикса
    // parseDate('46023') уходил в new Date('46023') = год 46023 (далёкое будущее)
    // → overdue=false, вся датная семья сигналов молча мертва на этих листах.
    const s = detectSignals(makeCells({ N: '46023', Q: null, Y: 0, U: '' }), REF_DATE);
    expect(s.overdue).toBe(true);
  });

  it('factDateBeforePlan: обе даты как serial', () => {
    // Q (факт) раньше N (план): 46000 < 46023 — сигнал должен сработать на serial.
    const s = detectSignals(makeCells({ N: '46023', Q: '46000', Y: 100, U: 'Подписан' }), REF_DATE);
    expect(s.factDateBeforePlan).toBe(true);
  });

  // FP-fix signal_audit 2026-07-14 §3.7: «дедлайн сегодня» — ещё не просрочка
  it('NOT overdue в день дедлайна: N=15.07.2026, прогон 15.07.2026 23:41 (off-by-one из-за времени суток)', () => {
    // 4 из 8 срабатываний 15.07 были строками с N=15.07.2026 (УО стр.2365/2377/2396/2397)
    const s = detectSignals(makeCells({
      N: '15.07.2026', Q: null, Y: 0, U: 'Х', AF: '·',
    }), new Date(2026, 6, 15, 23, 41));
    expect(s.overdue).toBe(false);
  });

  it('overdue строго со следующего дня после дедлайна: N=15.07.2026, прогон 16.07.2026 00:10', () => {
    const s = detectSignals(makeCells({
      N: '15.07.2026', Q: null, Y: 0, U: 'Х', AF: '·',
    }), new Date(2026, 6, 16, 0, 10));
    expect(s.overdue).toBe(true);
  });

  // TZ-fix 2026-07-20 (mulch-диагноз триажа 15.07): serial даёт UTC-полночь,
  // «дд.мм.гггг» — локальную → daysDiff по Date-объектам расходился на ±1 на
  // дальних поясах. Serial и строка ОДНОГО дня обязаны давать одинаковый вердикт.
  it('TZ-инвариантность: N=сегодня как serial → overdue=false (паритет со строкой)', () => {
    const serialToday = Date.UTC(2026, 6, 15) / 86400000 + 25569; // = 15.07.2026
    const runAt = new Date(2026, 6, 15, 23, 41);
    const sSerial = detectSignals(makeCells({ N: String(serialToday), Q: null, Y: 0, U: 'Х', AF: '·' }), runAt);
    const sString = detectSignals(makeCells({ N: '15.07.2026', Q: null, Y: 0, U: 'Х', AF: '·' }), runAt);
    expect(sSerial.overdue).toBe(false);
    expect(sSerial.overdue).toBe(sString.overdue);
  });

  it('TZ-инвариантность: N=вчера как serial → overdue=true (паритет со строкой)', () => {
    const serialYesterday = Date.UTC(2026, 6, 15) / 86400000 + 25569; // = 15.07.2026
    const runAt = new Date(2026, 6, 16, 0, 10);
    const sSerial = detectSignals(makeCells({ N: String(serialYesterday), Q: null, Y: 0, U: 'Х', AF: '·' }), runAt);
    const sString = detectSignals(makeCells({ N: '15.07.2026', Q: null, Y: 0, U: 'Х', AF: '·' }), runAt);
    expect(sSerial.overdue).toBe(true);
    expect(sSerial.overdue).toBe(sString.overdue);
  });

  it('NOT overdue when заключено (дата Q)', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: '05.02.2026', Y: 0,
    }), REF_DATE);
    expect(s.overdue).toBe(false);
    expect(s.signed).toBe(true);
  });

  it('NOT overdue when has fact amounts', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 500_000,
    }), REF_DATE);
    expect(s.overdue).toBe(false);
    expect(s.hasFact).toBe(true);
  });

  // Канон п.27 (14.08.2026): текстовые смягчители просрочки сняты — перенос,
  // «планирование», «срок не наступил», «отменена» живут в комментарии,
  // который показывается как есть, но машинный статус не меняют.
  it('СТРАЖ п.27: «переносится на…»/«планирование»/«срок не наступил»/«отменена» просрочку больше не гасят', () => {
    const texts = [
      { AE: 'переносится на 2 квартал' },
      { AE: 'срок перенесён на май' },
      { AE: 'отложен до получения финансирования' },
      { AE: 'планирование' },
      { AE: 'срок не наступил' },
      { AE: 'срок изменён на 01.06.2026' },
      { U: 'Отменена' },
    ];
    for (const t of texts) {
      const s = detectSignals(makeCells({ N: '01.01.2026', Q: null, Y: 0, ...t }), REF_DATE);
      expect(s.overdue).toBe(true);
    }
  });

  it('planSoon: plan date within 14 days', () => {
    // April 13 + 10 days = April 23
    const s = detectSignals(makeCells({
      N: '23.04.2026', Q: null, Y: 0, U: '',
    }), REF_DATE);
    expect(s.planSoon).toBe(true);
    expect(s.overdue).toBe(false);
  });

  it('planSoon: exactly 14 days away', () => {
    const s = detectSignals(makeCells({
      N: '27.04.2026', Q: null, Y: 0, U: '',
    }), REF_DATE);
    expect(s.planSoon).toBe(true);
  });

  it('NOT planSoon: 15 days away', () => {
    const s = detectSignals(makeCells({
      N: '28.04.2026', Q: null, Y: 0, U: '',
    }), REF_DATE);
    expect(s.planSoon).toBe(false);
  });

  it('NOT planSoon when уже заключено (дата Q)', () => {
    const s = detectSignals(makeCells({
      N: '23.04.2026', Q: '10.04.2026', Y: 0,
    }), REF_DATE);
    expect(s.planSoon).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 3. hasFact Signal
// ────────────────────────────────────────────────────────────

describe('hasFact signal', () => {
  it('true when Y > 0', () => {
    const s = detectSignals(makeCells({ Y: 100_000 }), REF_DATE);
    expect(s.hasFact).toBe(true);
  });

  it('true when fact date exists', () => {
    const s = detectSignals(makeCells({ Q: '10.03.2026', Y: 0 }), REF_DATE);
    expect(s.hasFact).toBe(true);
  });

  it('true when V+W+X > 0 (even if Y=0)', () => {
    const s = detectSignals(makeCells({ Y: 0, V: 100_000, W: 0, X: 0 }), REF_DATE);
    expect(s.hasFact).toBe(true);
  });

  it('false when no fact date and no fact amounts', () => {
    const s = detectSignals(makeCells({ Q: null, Y: 0, V: 0, W: 0, X: 0 }), REF_DATE);
    expect(s.hasFact).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 4. Financial Signals
// ────────────────────────────────────────────────────────────

describe('Financial signals', () => {
  describe('economyFlag (канон AD = «да»/«нет», signal_audit 2026-07-14 §3.1)', () => {
    it('true when AD="да" (канон, как в calc-engine GATE_ECONOMY_APPROVED)', () => {
      const s = detectSignals(makeCells({ AD: 'да' }), REF_DATE);
      expect(s.economyFlag).toBe(true);
    });

    it('true when AD=" Да " (регистр и пробелы нормализуются)', () => {
      const s = detectSignals(makeCells({ AD: ' Да ' }), REF_DATE);
      expect(s.economyFlag).toBe(true);
    });

    it('false when AD="нет" (флаг определён, но экономия не подтверждена)', () => {
      const s = detectSignals(makeCells({ AD: 'нет' }), REF_DATE);
      expect(s.economyFlag).toBe(false);
    });

    it('false when AD="экономия" — подстроки «эконом» в каноне AD не бывает', () => {
      const s = detectSignals(makeCells({ AD: 'экономия' }), REF_DATE);
      expect(s.economyFlag).toBe(false);
    });

    it('false when AD empty', () => {
      const s = detectSignals(makeCells({ AD: '' }), REF_DATE);
      expect(s.economyFlag).toBe(false);
    });
  });

  describe('economyConflict', () => {
    it('conflict (случай а, оживает): AD="да" but fact >= plan', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 1_000_000, AD: 'да',
      }), REF_DATE);
      expect(s.economyConflict).toBe(true);
    });

    it('NO conflict: AD="да" + экономия 30% — флаг честно проставлен (УЭР стр.6: K=445, Y=312.79)', () => {
      const s = detectSignals(makeCells({
        K: 445, Y: 312.79, AD: 'да', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyConflict).toBe(false);
    });

    it('NO conflict: AD="нет" + экономия 84% — «нет» это решение органа, не пробел (УАГЗО стр.6: K=63.03332, Y=9.81406)', () => {
      const s = detectSignals(makeCells({
        K: 63.03332, Y: 9.81406, AD: 'нет', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyConflict).toBe(false);
    });

    it('случай (а) границу не заметил: AD="да" при равенстве плана и факта (УО стр.7: K=Y=15799.9968)', () => {
      const s = detectSignals(makeCells({
        K: 15_799.9968, Y: 15_799.9968, AD: 'да', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyConflict).toBe(true);
    });

    // Консолидация 21.08.2026 (решение владельца 20.08): второй случай
    // конфликта («экономия есть, отметки нет») здесь больше не живёт — он и
    // есть класс «Экономия без отметки», у которого теперь одно имя и один
    // счёт. Строки ниже — те самые живые числа, на которых прежде проверялась
    // полоса 15–25 %: они не замолчали, они переехали в свой класс.
    it('экономия без отметки — это НЕ конфликт: конфликт остался про отметку «да» (УД стр.122: K=624.6345, Y=477.84504)', () => {
      const s = detectSignals(makeCells({
        K: 624.6345, Y: 477.84504, AD: '', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyConflict).toBe(false);
      expect(s.economyFlagUndetermined).toBe(true);
    });

    it('экономия выше 25 % без отметки — тоже свой класс, а не конфликт (УД стр.10: K=333.8024, Y=188.56238)', () => {
      const s = detectSignals(makeCells({
        K: 333.8024, Y: 188.56238, AD: '·', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyConflict).toBe(false);
      expect(s.economyFlagUndetermined).toBe(true);
      // Размер экономии по-прежнему называет своя проверка.
      expect(s.highEconomy).toBe(true);
    });

    it('НЕТ конфликта, когда факта нет вовсе', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 0, AD: 'да',
      }), REF_DATE);
      expect(s.economyConflict).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────
  // «Экономия без отметки» — единый канон (@aemr/shared economy-flag.ts).
  // Консолидация 21.08.2026: до неё одно положение дел считалось тремя
  // способами (полоса 15–25 % в конфликте, правило листа со своим гейтом по
  // столбцам экономии, мёртвая запись «Скрытая экономия») и давало три разных
  // числа. Живые числа ниже — те же строки книг, что и в тестах выше.
  // ────────────────────────────────────────────────────────────
  describe('economyFlagUndetermined (класс «Экономия без отметки»)', () => {
    it('экономия 15,5 % без отметки — строка в классе (УД стр.20: K=74.79996, Y=63.20598)', () => {
      const s = detectSignals(makeCells({
        K: 74.79996, Y: 63.20598, AD: '', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyFlagUndetermined).toBe(true);
    });

    it('мелкая экономия тоже в классе: полос и порогов у явления нет', () => {
      // Прежде 10 % не доходили ни до одного счётчика: конфликт требовал 15 %,
      // правило листа — заполненных столбцов экономии и целой тысячи рублей.
      const s = detectSignals(makeCells({
        K: 1_000, Y: 900, AD: '', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyFlagUndetermined).toBe(true);
    });

    it('отметка «нет» — решение органа: строка вне класса (УАГЗО стр.6: K=63.03332, Y=9.81406)', () => {
      const s = detectSignals(makeCells({
        K: 63.03332, Y: 9.81406, AD: 'нет', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyFlagUndetermined).toBe(false);
    });

    it('отметка «да» — решение принято: строка вне класса (УЭР стр.6: K=445, Y=312.79)', () => {
      const s = detectSignals(makeCells({
        K: 445, Y: 312.79, AD: 'да', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyFlagUndetermined).toBe(false);
    });

    it('единственный поставщик ВХОДИТ в класс (решение владельца 20.08: «ЕП включённо»)', () => {
      const s = detectSignals(makeCells({
        K: 1_000, Y: 800, AD: '', L: 'ЕП',
      }), REF_DATE);
      expect(s.economyFlagUndetermined).toBe(true);
      // Род называется соседней проверкой, а не вычёркиванием из счёта.
      expect(s.epFactDeviation).toBe(true);
    });

    it('заглушка «Х» в графе — та же непроставленная отметка', () => {
      const s = detectSignals(makeCells({
        K: 1_000, Y: 800, AD: 'Х', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyFlagUndetermined).toBe(true);
    });

    it('факта нет — вопроса об отметке ещё не возникло', () => {
      const s = detectSignals(makeCells({
        K: 1_000, Y: 0, AD: '', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyFlagUndetermined).toBe(false);
    });

    it('факт выше плана — экономии по числам нет', () => {
      const s = detectSignals(makeCells({
        K: 1_000, Y: 1_200, AD: '', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyFlagUndetermined).toBe(false);
    });

    it('бейдж класса — жёлтый и называется «Экономия без отметки»', () => {
      const s = detectSignals(makeCells({
        K: 1_000, Y: 800, AD: '', L: 'ЭА',
      }), REF_DATE);
      const badge = getSignalBadges(s).find((b) => b.label === 'Экономия без отметки');
      expect(badge).toBeDefined();
      expect(badge!.color).toBe('yellow');
    });
  });

  describe('epRisk', () => {
    // K — тыс. руб. (канон колонок книг ГРБС): 601/600 значат 601/600 тыс. руб.,
    // граница лимита 600 тыс. по п.4 ч.1 ст.93 44-ФЗ. bug-hunt 2026-08-08 (БАГ #1):
    // раньше порог был в рублях (600_000), а K тоже сравнивался как рубли —
    // граница проверялась верно только случайно; после фикса единица явная.
    it('true: method=ЕП, plan > 600K, not canceled', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 601, M: '',
      }), REF_DATE);
      expect(s.epRisk).toBe(true);
    });

    it('false: ЕП but plan <= 600K', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 600, M: '',
      }), REF_DATE);
      expect(s.epRisk).toBe(false);
    });

    it('СТРАЖ п.27/41: «Отменена» в U риск больше не гасит', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 2_500_000, U: 'Отменена', M: '',
      }), REF_DATE);
      expect(s.epRisk).toBe(true);
    });

    it('false: ЕП but legitimate (natural monopoly)', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 2_500_000, M: 'Монополист (энергоснабжение)',
      }), REF_DATE);
      expect(s.epRisk).toBe(false);
    });

    it('false: ЕП but legitimate (Governor order)', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 2_500_000, M: 'По поручению губернатора',
      }), REF_DATE);
      expect(s.epRisk).toBe(false);
    });

    it('false: competitive method (ЭА)', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', K: 5_000_000, M: '',
      }), REF_DATE);
      expect(s.epRisk).toBe(false);
    });

    // Ссылка на пункт ч.1 ст.93 читается разбором, а не поиском подстроки
    // (правка 19.08.2026, живая сверка по E:/aemr-dumps/book-dumps, 3 885 строк
    // восьми управлений). Прежний список ловил «п.6 ч.1» и спотыкался о пробел
    // после «ч.», как его ставят операторы.
    it('false: «п.6 ч. 1 ст. 93» с пробелами — лимит 600 тыс. к этому пункту не относится (УАГЗО стр.9 № 42, план 3 078,96)', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 3_078.96,
        M: 'Услуги оказываются в соответствии с п.6 ч. 1 ст. 93 ФЗ-44 ГАУ "Государственная экспертиза"',
      }), REF_DATE);
      expect(s.epRisk).toBe(false);
    });

    it('true: ссылка на распоряжение администрации лимит не снимает (УО стр.311 № 314: «пп. 8, п.1 Распоряжения АЕМР от 03.09.2025 № 112»)', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 2_500,
        M: 'пп. 8, п.1 Распоряжения Администрации ЕМР от 03.09.2025 № 112',
      }), REF_DATE);
      expect(s.epRisk).toBe(true);
    });

    it('true: п.12 ч.1 ст.93 в список беспредельных пунктов не входит — замечание остаётся (живой корпус: 26 строк)', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 1_500, M: 'п. 12 ч.1 ст.93 44-ФЗ',
      }), REF_DATE);
      expect(s.epRisk).toBe(true);
    });
  });

  describe('highEconomy', () => {
    it('true: economy > 25% on competitive method', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', K: 1_000_000, Y: 700_000,
      }), REF_DATE);
      // economy = 30% > 25%
      expect(s.highEconomy).toBe(true);
    });

    it('false: economy exactly 25%', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', K: 1_000_000, Y: 750_000,
      }), REF_DATE);
      expect(s.highEconomy).toBe(false);
    });

    it('false: economy > 25% but method is ЕП', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 1_000_000, Y: 700_000,
      }), REF_DATE);
      expect(s.highEconomy).toBe(false);
    });

    it('false: fact > plan (negative economy)', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', K: 1_000_000, Y: 1_200_000,
      }), REF_DATE);
      expect(s.highEconomy).toBe(false);
    });
  });

  describe('lowCompetition (FP-fix signal_audit 2026-07-14 §3.2)', () => {
    it('true: economy < 2% on competitive method', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', K: 1_000_000, Y: 990_000,
      }), REF_DATE);
      // economy = 1% < 2%
      expect(s.lowCompetition).toBe(true);
    });

    it('false: economy >= 2%', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', K: 1_000_000, Y: 970_000,
      }), REF_DATE);
      // economy = 3%
      expect(s.lowCompetition).toBe(false);
    });

    it('false: method is ЕП (no competition expected)', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 1_000_000, Y: 990_000,
      }), REF_DATE);
      expect(s.lowCompetition).toBe(false);
    });

    it('false: план == факт копейка-в-копейку — артефакт заполнения, не конкуренция (УДТХ стр.4: K=Y=1210.59135)', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', K: 1210.59135, Y: 1210.59135,
      }), REF_DATE);
      expect(s.lowCompetition).toBe(false);
    });

    it('УИО-квартира (стр.20): сигнал «1 участник» снят (п.27) — строка получает lowCompetition по числам', () => {
      // До канона текст «ед.подавшим заявку» давал singleParticipant и гасил
      // lowCompetition. Свободный текст больше не интерпретируется: остаётся
      // числовой информационный сигнал о нулевой экономии.
      const s = detectSignals(makeCells({
        L: 'ЭА', K: 5812.91, Y: 5812.90875,
        U: 'Аукцион не состоялся, заключен контракт с ед.подавшим заявку на участие, контракт исполнен',
      }), REF_DATE);
      expect(s.singleParticipant).toBe(false);
      expect(s.lowCompetition).toBe(true);
    });

    it('true: честная малая экономия ~1% без единственного участника (УЭР стр.11: K=123.46, Y=122.23)', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', K: 123.46, Y: 122.23,
      }), REF_DATE);
      expect(s.lowCompetition).toBe(true);
    });
  });

  describe('factExceedsPlan', () => {
    // FP-fix 2026-06-05 (SIGNAL_VALIDATION §4): допуск 0.5% против округлительного шума.
    it('false: excess below 0.5% tolerance (rounding noise, e.g. УИО r24/25)', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 1_000_001, // +0.0001% — план в 2 знака vs факт в 5
      }), REF_DATE);
      expect(s.factExceedsPlan).toBe(false);
    });

    it('true: material excess (>0.5%)', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 1_100_000, // +10%
      }), REF_DATE);
      expect(s.factExceedsPlan).toBe(true);
    });

    it('false: fact = plan', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 1_000_000,
      }), REF_DATE);
      expect(s.factExceedsPlan).toBe(false);
    });

    it('СТРАЖ п.41: «Отменена» в U превышение больше не гасит', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 2_000_000, U: 'Отменена',
      }), REF_DATE);
      expect(s.factExceedsPlan).toBe(true);
    });
  });

  describe('epFactDeviation — по ЕП факт обязан равняться плану (канон п.98м + п.102)', () => {
    it('ЕП, факт < план — горит: «экономия», которой по ЕП быть не должно', () => {
      const s = detectSignals(makeCells({ L: 'ЕП', K: 1_000_000, Y: 900_000 }), REF_DATE);
      expect(s.epFactDeviation).toBe(true);
      // Превышения нет — factExceedsPlan молчит: сигналы про разное.
      expect(s.factExceedsPlan).toBe(false);
    });

    it('ЕП, факт = план — молчит: канон соблюдён', () => {
      const s = detectSignals(makeCells({ L: 'ЕП', K: 1_000_000, Y: 1_000_000 }), REF_DATE);
      expect(s.epFactDeviation).toBe(false);
    });

    it('ЭА, факт < план — молчит: у конкурентного способа план = НМЦК, экономия — норма торгов (п.102)', () => {
      const s = detectSignals(makeCells({ L: 'ЭА', K: 1_000_000, Y: 900_000 }), REF_DATE);
      expect(s.epFactDeviation).toBe(false);
    });

    it('допуск округления 0.5% (как у factExceedsPlan): микрорасхождение в обе стороны не горит', () => {
      // План в 2 знака, факт в 5 — копеечный шум не считается расхождением.
      for (const y of [999_999, 1_000_001, 995_001, 1_004_999]) {
        const s = detectSignals(makeCells({ L: 'ЕП', K: 1_000_000, Y: y }), REF_DATE);
        expect(s.epFactDeviation, `Y=${y}`).toBe(false);
      }
    });

    it('ЕП, факт > план сверх допуска — то же расхождение (горит вместе с factExceedsPlan)', () => {
      const s = detectSignals(makeCells({ L: 'ЕП', K: 1_000_000, Y: 1_100_000 }), REF_DATE);
      expect(s.epFactDeviation).toBe(true);
      expect(s.factExceedsPlan).toBe(true);
    });

    it('ЕП без факта — молчит: строка ещё не исполнена, сравнивать нечего', () => {
      const s = detectSignals(makeCells({ L: 'ЕП', K: 1_000_000, Y: 0 }), REF_DATE);
      expect(s.epFactDeviation).toBe(false);
    });
  });
});

describe('FP-fixes 2026-06-05 и их судьба после канона п.27 (14.08.2026)', () => {
  it('factDateBeforePlan: NOT for ЕП (early sole-source conclusion is legal)', () => {
    const s = detectSignals(makeCells({ L: 'ЕП', N: '01.05.2026', Q: '15.04.2026' }), REF_DATE);
    expect(s.factDateBeforePlan).toBe(false);
  });
  it('factDateBeforePlan: YES for competitive method (ЭА) — информационно (п.28)', () => {
    const s = detectSignals(makeCells({ L: 'ЭА', N: '01.05.2026', Q: '15.04.2026' }), REF_DATE);
    expect(s.factDateBeforePlan).toBe(true);
  });
  it('п.34/п.39: кредитная линия «при необходимости» без года плана — planYearMissing подавляет planWithoutExecution', () => {
    // Раньше строку спасал текстовый гейт «при необходимости» (снят п.27).
    // Теперь работает структура: год плана P пуст → первопричина «не
    // обеспечена финансированием», следствие «план без исполнения» подавлено.
    const s = detectSignals(makeCells({
      K: 32_000_000, N: null, Q: null, Y: 0, P: '', AE: 'будет проведена при необходимости',
    }), REF_DATE);
    expect(s.planYearMissing).toBe(true);
    expect(s.planWithoutExecution).toBe(false);
  });
  it('СТРАЖ п.27: дата контракта в комментарии AE сигнал factWithoutDate больше не гасит', () => {
    // ae-parser снят: «01.02.2026 заключен контракт №17» — свободный текст,
    // машинно не читается. Структурно дата Q пуста (заглушка «Х») при
    // заполненных суммах — неполнота данных остаётся видимой.
    const s = detectSignals(makeCells({ Y: 170_000, Q: 'Х', AE: '01.02.2026 заключен контракт №17' }), REF_DATE);
    expect(s.factWithoutDate).toBe(true);
  });
  it('СТРАЖ п.27: правовое основание в комментарии AE не заменяет пустое поле M', () => {
    const s = detectSignals(makeCells({ L: 'ЕП', M: '', K: 20_000, AE: 'Не учитывается по п.4 ч.1 ст.93' }), REF_DATE);
    expect(s.epJustificationMissing).toBe(true);
  });
});

describe('EP reason classification (ep-reason-clusters wiring 2026-06-05)', () => {
  it('methodReasonMismatch: ЕП + «малая электронная закупка» (процедура, не основание)', () => {
    const s = detectSignals(makeCells({ L: 'ЕП', M: 'малая электронная закупка', K: 100_000 }), REF_DATE);
    expect(s.methodReasonMismatch).toBe(true);
    expect(s.unmappedReasonEP).toBe(false);
  });
  it('methodReasonMismatch: NOT for competitive method (ЭА)', () => {
    const s = detectSignals(makeCells({ L: 'ЭА', M: 'малая электронная закупка', K: 100_000 }), REF_DATE);
    expect(s.methodReasonMismatch).toBe(false);
  });
  it('unmappedReasonEP: ЕП + нераспознанное обоснование', () => {
    const s = detectSignals(makeCells({ L: 'ЕП', M: 'согласовано руководством учреждения', K: 100_000 }), REF_DATE);
    expect(s.unmappedReasonEP).toBe(true);
    expect(s.methodReasonMismatch).toBe(false);
  });
  it('recognized legitimate reason (монополист): neither EP-reason signal fires', () => {
    const s = detectSignals(makeCells({ L: 'ЕП', M: 'монополист', K: 100_000 }), REF_DATE);
    expect(s.methodReasonMismatch).toBe(false);
    expect(s.unmappedReasonEP).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 5. Data Quality Signals
// ────────────────────────────────────────────────────────────

describe('Data quality signals', () => {
  describe('dataQuality', () => {
    it('true: missing required field D, plan date in past', () => {
      const s = detectSignals(makeCells({
        D: '', K: 1_000_000, L: 'ЭА', N: '01.01.2026',
      }), REF_DATE);
      expect(s.dataQuality).toBe(true);
    });

    it('true: missing required field L, has fact date', () => {
      const s = detectSignals(makeCells({
        D: 'Поставка', K: 1_000_000, L: '', Q: '10.03.2026',
      }), REF_DATE);
      expect(s.dataQuality).toBe(true);
    });

    it('false: all required fields present', () => {
      const s = detectSignals(makeCells({
        D: 'Поставка', K: 1_000_000, L: 'ЭА', Q: '10.03.2026',
      }), REF_DATE);
      expect(s.dataQuality).toBe(false);
    });

    it('false: future plan date, no fact (not yet due for checking)', () => {
      const s = detectSignals(makeCells({
        D: '', K: 1_000_000, L: '', N: '01.12.2026',
      }), REF_DATE);
      expect(s.dataQuality).toBe(false);
    });

    it('СТРАЖ п.27: «Отменена»/«планирование» в U пропуски полей больше не прячут', () => {
      for (const u of ['Отменена', 'В стадии планирования']) {
        const s = detectSignals(makeCells({
          D: '', K: 1_000_000, L: '', N: '01.01.2026', U: u,
        }), REF_DATE);
        expect(s.dataQuality).toBe(true);
      }
    });
  });

  describe('formulaBroken', () => {
    it('true: cell contains #REF!', () => {
      const s = detectSignals(makeCells({ K: '#REF!' }), REF_DATE);
      expect(s.formulaBroken).toBe(true);
    });

    it('true: cell contains #VALUE!', () => {
      const s = detectSignals(makeCells({ Y: '#VALUE!' }), REF_DATE);
      expect(s.formulaBroken).toBe(true);
    });

    it('true: cell contains #N/A', () => {
      const s = detectSignals(makeCells({ AD: '#N/A' }), REF_DATE);
      expect(s.formulaBroken).toBe(true);
    });

    it('true: cell contains #DIV/0!', () => {
      const s = detectSignals(makeCells({ H: '#DIV/0!' }), REF_DATE);
      expect(s.formulaBroken).toBe(true);
    });

    it('false: no formula errors', () => {
      const s = detectSignals(makeCells(), REF_DATE);
      expect(s.formulaBroken).toBe(false);
    });
  });

  describe('factWithoutDate', () => {
    it('true: fact amounts > 0 but no fact date', () => {
      const s = detectSignals(makeCells({
        Y: 500_000, Q: null,
      }), REF_DATE);
      expect(s.factWithoutDate).toBe(true);
    });

    it('СТРАЖ п.41: «Отменена» в U неполноту факта больше не прячет', () => {
      const s = detectSignals(makeCells({
        Y: 500_000, Q: null, U: 'Отменена',
      }), REF_DATE);
      expect(s.factWithoutDate).toBe(true);
    });

    it('false: has fact date', () => {
      const s = detectSignals(makeCells({
        Y: 500_000, Q: '10.03.2026',
      }), REF_DATE);
      expect(s.factWithoutDate).toBe(false);
    });

    // Канон п.27 (14.08.2026): текстовые гейты «в течение года / по мере
    // необходимости» сняты — фразы остаются видимыми в пояснениях как есть,
    // а структурная неполнота (суммы без даты Q) больше не прячется.
    it('СТРАЖ п.27: «в течение года по мере необходимости» (УДТХ стр.55) сигнал больше не гасит', () => {
      const s = detectSignals(makeCells({
        N: '31.12.2026', Q: 'х', X: 179.843, Y: 179.843,
        M: 'пп. 1, п.1 Распоряжения Администрации ЕМР от 03.09.2025 № 112', L: 'ЕП',
        AF: 'приобретение канц. и хоз. товаров осуществляется в течение года по мере необходимости',
      }), REF_DATE);
      expect(s.factWithoutDate).toBe(true);
    });
  });

  describe('dateWithoutFact', () => {
    it('true: fact date exists but no fact amounts', () => {
      const s = detectSignals(makeCells({
        Q: '10.03.2026', Y: 0, V: 0, W: 0, X: 0,
      }), REF_DATE);
      expect(s.dateWithoutFact).toBe(true);
    });

    it('false: has both date and amounts', () => {
      const s = detectSignals(makeCells({
        Q: '10.03.2026', Y: 100_000,
      }), REF_DATE);
      expect(s.dateWithoutFact).toBe(false);
    });

    it('СТРАЖ п.41: «Отменена» в U пропуск сумм больше не прячет', () => {
      const s = detectSignals(makeCells({
        Q: '10.03.2026', Y: 0, U: 'Отменена',
      }), REF_DATE);
      expect(s.dateWithoutFact).toBe(true);
    });
  });

  describe('factDateBeforePlan', () => {
    it('true: fact date 15 days before plan date (1-30 range)', () => {
      const s = detectSignals(makeCells({
        N: '30.03.2026', Q: '15.03.2026',
      }), REF_DATE);
      expect(s.factDateBeforePlan).toBe(true);
    });

    it('false: fact date > 30 days before plan (не 1-30-дневный диапазон)', () => {
      const s = detectSignals(makeCells({
        N: '01.03.2026', Q: '15.01.2026', // 45 days diff, plan in past
      }), REF_DATE);
      // diff > 30 → вне диапазона factDateBeforePlan; earlyClosure тоже молчит
      // (45 дней в одном году — нормальное раннее исполнение, signal_audit §3.5)
      expect(s.factDateBeforePlan).toBe(false);
      expect(s.earlyClosure).toBe(false);
    });

    it('false: fact date > 30 days before plan but plan in future (no earlyClosure)', () => {
      const s = detectSignals(makeCells({
        N: '30.06.2026', Q: '15.03.2026', // 107 days diff, but plan in future
      }), REF_DATE);
      // Plan is in future → earlyClosure retroactive filter blocks it
      expect(s.factDateBeforePlan).toBe(false);
      expect(s.earlyClosure).toBe(false);
    });

    it('false: fact date after plan date', () => {
      const s = detectSignals(makeCells({
        N: '15.03.2026', Q: '30.03.2026',
      }), REF_DATE);
      expect(s.factDateBeforePlan).toBe(false);
    });

    // Страж гейта по способу закупки (SIGNAL_VALIDATION В-4/П-4). Реестр июня
    // числил гейт непоставленным; живой прогон 18.08.2026 по восьми книгам
    // (E:/aemr-dumps/book-dumps, 8476 строк) показал обратное: сигнал зажёгся
    // 115 раз и НИ РАЗУ на ЕП, при том что строк «ЕП, факт на 1–30 суток
    // раньше плана» в книгах 212. Тесты ниже держат оба края на живых адресах:
    // снятие гейта утроило бы поток замечаний.
    it('false: ЕП, факт на 12 суток раньше плана (УАГЗО стр.16: N=16.02.2026, Q=04.02.2026, K=Y=190)', () => {
      const s = detectSignals(makeCells({
        N: '16.02.2026', Q: '04.02.2026', L: 'ЕП', K: 190, Y: 190,
      }), REF_DATE);
      expect(s.factDateBeforePlan).toBe(false);
    });

    it('false: ЕП, факт на сутки раньше плана (УД стр.40: N=31.03.2026, Q=30.03.2026, K=Y=64.2724)', () => {
      const s = detectSignals(makeCells({
        N: '31.03.2026', Q: '30.03.2026', L: 'ЕП', K: 64.2724, Y: 64.2724,
      }), REF_DATE);
      expect(s.factDateBeforePlan).toBe(false);
    });

    it('true: тот же разрыв на конкурентном способе — справка остаётся (УАГЗО стр.6: N=20.02.2026, Q=17.02.2026, ЭА)', () => {
      const s = detectSignals(makeCells({
        N: '20.02.2026', Q: '17.02.2026', L: 'ЭА',
      }), REF_DATE);
      expect(s.factDateBeforePlan).toBe(true);
    });
  });

  describe('budgetUnderallocation', () => {
    it('true: Y > 0 but K = 0', () => {
      const s = detectSignals(makeCells({
        K: 0, Y: 500_000,
      }), REF_DATE);
      expect(s.budgetUnderallocation).toBe(true);
    });

    it('true: Y > 0 but K is NaN/empty', () => {
      const s = detectSignals(makeCells({
        K: '', Y: 500_000,
      }), REF_DATE);
      expect(s.budgetUnderallocation).toBe(true);
    });

    it('false: both K and Y > 0', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 500_000,
      }), REF_DATE);
      expect(s.budgetUnderallocation).toBe(false);
    });

    it('СТРАЖ п.41: «Отменена» в U аномалию больше не прячет', () => {
      const s = detectSignals(makeCells({
        K: 0, Y: 500_000, U: 'Отменена',
      }), REF_DATE);
      expect(s.budgetUnderallocation).toBe(true);
    });
  });

  describe('budgetSourceMissing', () => {
    it('true: K > 0 but H/I/J all zero', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, H: 0, I: 0, J: 0,
      }), REF_DATE);
      expect(s.budgetSourceMissing).toBe(true);
    });

    it('true: K > 0 but H/I/J all empty', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, H: '', I: '', J: '',
      }), REF_DATE);
      expect(s.budgetSourceMissing).toBe(true);
    });

    it('true: K > 0 but H/I/J null', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, H: null, I: null, J: null,
      }), REF_DATE);
      expect(s.budgetSourceMissing).toBe(true);
    });

    it('false: H > 0 (has budget source)', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, H: 500_000, I: 0, J: 500_000,
      }), REF_DATE);
      expect(s.budgetSourceMissing).toBe(false);
    });

    it('false: K = 0 (no plan)', () => {
      const s = detectSignals(makeCells({
        K: 0, H: 0, I: 0, J: 0,
      }), REF_DATE);
      expect(s.budgetSourceMissing).toBe(false);
    });

    it('СТРАЖ п.41: «Отменена» в U пропуск разбивки больше не прячет', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, H: 0, I: 0, J: 0, U: 'Отменена',
      }), REF_DATE);
      expect(s.budgetSourceMissing).toBe(true);
    });

    /**
     * Страж §W-7 (DEADCODE_DISPOSITION_2026-06-05): колонки источников признак
     * берёт из справочника PLAN_SOURCE_COLUMNS, а не из букв, переписанных в
     * коде сигнала. Любая заполненная колонка справочника снимает признак.
     */
    it('колонки источников совпадают со справочником, и каждая снимает признак', () => {
      expect(PLAN_SOURCE_COLUMNS).toEqual(['H', 'I', 'J']);
      for (const col of PLAN_SOURCE_COLUMNS) {
        const s = detectSignals(makeCells({
          K: 1_000_000, H: 0, I: 0, J: 0, [col]: 400_000,
        }), REF_DATE);
        expect(s.budgetSourceMissing).toBe(false);
      }
    });
  });
});

// ────────────────────────────────────────────────────────────
// 6. Behavioral Signals
// ────────────────────────────────────────────────────────────

describe('Behavioral signals', () => {
  describe('stalledContract — СНЯТ каноном п.27 (14.08.2026)', () => {
    it('всегда false: «подписан» из текста больше не читается, «подписан без даты Q» структурно невыразимо', () => {
      // Прежний положительный кейс: «договор заключен» в AE, Q пуст,
      // план просрочен >30 дней — держался целиком на тексте комментария.
      const s = detectSignals(makeCells({
        AE: 'договор заключен', Q: null, Y: 0,
        N: '01.01.2026',
      }), REF_DATE);
      expect(s.stalledContract).toBe(false);
      // Строка при этом не теряется из виду: она просрочена структурно.
      expect(s.overdue).toBe(true);
    });

    it('всегда false и при дате факта', () => {
      const s = detectSignals(makeCells({
        AE: 'договор заключен', Q: '10.03.2026', N: '01.01.2026',
      }), REF_DATE);
      expect(s.stalledContract).toBe(false);
    });
  });

  describe('futureFactDate (опечатка в годе, расследование 27.07.2026)', () => {
    it('true: договор «заключён» в следующем году — УО, «Белочка», факт 15.07.2027', () => {
      const s = detectSignals(makeCells({ N: '30.06.2026', Q: '15.07.2027' }), REF_DATE);
      expect(s.futureFactDate).toBe(true);
    });

    it('false: дата факта сегодня — граница не срабатывает', () => {
      const s = detectSignals(makeCells({ N: '01.03.2026', Q: REF_DATE }), REF_DATE);
      expect(s.futureFactDate).toBe(false);
    });

    it('false: дата факта в прошлом — обычное заключение', () => {
      const s = detectSignals(makeCells({ N: '01.03.2026', Q: '10.03.2026' }), REF_DATE);
      expect(s.futureFactDate).toBe(false);
    });

    it('СТРАЖ п.41: «Отменена» в U опечатку года больше не прячет', () => {
      const s = detectSignals(makeCells({ N: '30.06.2026', Q: '15.07.2027', U: 'Отменена' }), REF_DATE);
      expect(s.futureFactDate).toBe(true);
    });

    it('false: даты факта нет вовсе', () => {
      const s = detectSignals(makeCells({ N: '30.06.2026', Q: null }), REF_DATE);
      expect(s.futureFactDate).toBe(false);
    });
  });

  describe('earlyClosure (сигнал = кандидат на опечатку даты, signal_audit 2026-07-14 §3.5)', () => {
    it('true: смена календарного года — вероятная опечатка (УД стр.101: факт 15.04.2025 при плане 30.04.2026)', () => {
      const s = detectSignals(makeCells({
        N: '30.04.2026', Q: '15.04.2025',
      }), new Date(2026, 6, 15)); // 15.07.2026, план в прошлом
      expect(s.earlyClosure).toBe(true);
    });

    it('true: разрыв > 180 дней в одном году, план в прошлом', () => {
      const s = detectSignals(makeCells({
        N: '30.12.2026', Q: '15.06.2026', // 198 дней
      }), new Date(2026, 11, 31)); // 31.12.2026 — план уже в прошлом
      expect(s.earlyClosure).toBe(true);
    });

    it('false: 45 дней опережения в одном году — нормальное раннее исполнение против квартального дедлайна', () => {
      // До фикса это давало 73 из 74 ложных срабатываний (порог был 30 дней)
      const s = detectSignals(makeCells({
        N: '01.03.2026', Q: '15.01.2026',
      }), REF_DATE);
      expect(s.earlyClosure).toBe(false);
    });

    it('false: 36 дней опережения (УАГЗО стр.31: N=30.06.2026, Q=25.05.2026)', () => {
      const s = detectSignals(makeCells({
        N: '30.06.2026', Q: '25.05.2026',
      }), new Date(2026, 6, 15));
      expect(s.earlyClosure).toBe(false);
    });

    // Гейт по способу 18.08.2026 (SIGNAL_VALIDATION В-9). Живой прогон по
    // восьми книгам (E:/aemr-dumps/book-dumps, 8476 строк, дамп 18.08.2026):
    // сигнал зажигался пять раз, все пять — ЕП. Три остаются (смена года),
    // два гаснут (полугодовое опережение мягкой плановой даты у ЕП).
    it('false: опережение 189 дней в одном году у ЕП — обычное исполнение, не описка (УО стр.1591: N=31.07.2026, Q=23.01.2026, K=Y=9.6)', () => {
      const s = detectSignals(makeCells({
        N: '31.07.2026', Q: '23.01.2026', L: 'ЕП', K: 9.6, Y: 9.6,
      }), new Date(2026, 7, 18)); // 18.08.2026 — план уже в прошлом
      expect(s.earlyClosure).toBe(false);
    });

    it('false: опережение 184 дня у ЕП (УО стр.1684: N=15.07.2026, Q=12.01.2026, K=Y=3.6)', () => {
      const s = detectSignals(makeCells({
        N: '15.07.2026', Q: '12.01.2026', L: 'ЕП', K: 3.6, Y: 3.6,
      }), new Date(2026, 7, 18));
      expect(s.earlyClosure).toBe(false);
    });

    it('true: смена года у ЕП гейт не снимает — перепутанный год ошибка при любом способе (УО стр.2587: N=27.07.2026, Q=27.07.2025, ровно год)', () => {
      const s = detectSignals(makeCells({
        N: '27.07.2026', Q: '27.07.2025', L: 'ЕП', K: 71.15, Y: 71.15,
      }), new Date(2026, 7, 18));
      expect(s.earlyClosure).toBe(true);
    });

    it('true: смена года у ЕП, разрыв 313 дней (УО стр.1585: N=31.10.2026, Q=22.12.2025, K=Y=125)', () => {
      const s = detectSignals(makeCells({
        N: '31.10.2026', Q: '22.12.2025', L: 'ЕП', K: 125, Y: 125,
      }), new Date(2026, 7, 18));
      expect(s.earlyClosure).toBe(true);
    });

    it('true: полугодовое опережение у конкурентного способа гейт переживает (тот же разрыв, что у УО стр.1591, но способ ЭА)', () => {
      const s = detectSignals(makeCells({
        N: '31.07.2026', Q: '23.01.2026', L: 'ЭА', K: 9.6, Y: 9.6,
      }), new Date(2026, 7, 18));
      expect(s.earlyClosure).toBe(true);
    });

    it('false: смена года при опережении <= 30 дней (декабрь → январь — норма)', () => {
      const s = detectSignals(makeCells({
        N: '15.01.2026', Q: '20.12.2025', // 26 дней, год сменился
      }), REF_DATE);
      expect(s.earlyClosure).toBe(false);
    });

    it('false: разрыв > 180 дней, но план в будущем (ретроспективный ввод)', () => {
      const s = detectSignals(makeCells({
        N: '30.12.2026', Q: '15.06.2026', // 198 дней, но план ещё не наступил
      }), new Date(2026, 6, 15));
      expect(s.earlyClosure).toBe(false);
    });

    it('false: fact date after plan date', () => {
      const s = detectSignals(makeCells({
        N: '01.03.2026', Q: '15.03.2026',
      }), REF_DATE);
      expect(s.earlyClosure).toBe(false);
    });

    it('СТРАЖ п.41: «Отменена» в U кандидата на опечатку больше не прячет', () => {
      const s = detectSignals(makeCells({
        N: '30.04.2026', Q: '15.04.2025', U: 'Отменена',
      }), new Date(2026, 6, 15));
      expect(s.earlyClosure).toBe(true);
    });
  });

  describe('planWithoutExecution', () => {
    it('true: plan exists, no fact, after April, not signed/canceled/planning', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, N: '15.03.2026',
        Y: 0, Q: null, U: '', AE: '',
      }), REF_DATE); // April 13 — past Q1
      // Row is overdue (plan date passed, no fact, not signed) so overdue=true
      // planWithoutExecution skips overdue rows
      expect(s.overdue).toBe(true);
      expect(s.planWithoutExecution).toBe(false);
    });

    it('false: future plan date (date gate prevents firing on not-yet-due plans)', () => {
      // Plan date in future — should NOT fire even though it's after April
      // This was a bug: 48% of rows fired because future plans were flagged
      const s = detectSignals(makeCells({
        K: 1_000_000, N: '30.04.2026', // future plan date
        Y: 0, Q: null, U: '', AE: '',
      }), REF_DATE);
      expect(s.overdue).toBe(false);
      expect(s.planWithoutExecution).toBe(false);
    });

    it('СТРАЖ п.27: «заключен» в AE не спасает от просрочки — и не даёт planWithoutExecution', () => {
      // До канона текст «заключен» гасил overdue и открывал дорогу
      // planWithoutExecution; теперь строка честно просрочена структурно.
      const s = detectSignals(makeCells({
        K: 1_000_000, N: '01.01.2026',
        Y: 0, Q: null, U: '', AE: 'заключен',
      }), REF_DATE);
      expect(s.overdue).toBe(true);
      expect(s.planWithoutExecution).toBe(false);
    });

    it('СТРАЖ п.27: «переносится на 2кв» просрочку больше не гасит — строка overdue, не planWithoutExecution', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, N: '01.02.2026', // Feb 1 — 71 days before REF_DATE
        Y: 0, Q: null, U: '', AE: 'переносится на 2кв',
      }), REF_DATE);
      expect(s.overdue).toBe(true);
      expect(s.planWithoutExecution).toBe(false);
    });

    it('true: no plan date but plan sum exists, April+', () => {
      // Fallback: no plan date → use month check (April+)
      const s = detectSignals(makeCells({
        K: 1_000_000, N: null,
        Y: 0, Q: null, U: '', AE: '',
      }), REF_DATE);
      expect(s.planWithoutExecution).toBe(true);
    });

    it('СТРАЖ п.34: без года плана (P пусто) первопричина главнее — planWithoutExecution подавлен', () => {
      // Та же строка, что и в предыдущем тесте, но P пуст: строка «не
      // обеспечена финансированием» (planYearMissing) и НЕ получает вдобавок
      // «план без исполнения» — двойное замечание путает исполнителей.
      const s = detectSignals(makeCells({
        K: 1_000_000, N: null, P: '',
        Y: 0, Q: null, U: '', AE: '',
      }), REF_DATE);
      expect(s.planYearMissing).toBe(true);
      expect(s.planWithoutExecution).toBe(false);
    });

    it('false: before April', () => {
      const marchDate = new Date(2026, 1, 15); // February 15
      const s = detectSignals(makeCells({
        K: 1_000_000, N: '30.06.2026',
        Y: 0, Q: null, U: '', AE: '',
      }), marchDate);
      expect(s.planWithoutExecution).toBe(false);
    });

    it('false: заключённая строка (дата Q)', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, N: '30.04.2026',
        Y: 0, Q: '10.02.2026',
      }), REF_DATE);
      expect(s.planWithoutExecution).toBe(false);
    });
  });

  describe('epJustificationMissing', () => {
    it('true: ЕП method, no justification, plan > 0', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', M: '', K: 500_000,
      }), REF_DATE);
      expect(s.epJustificationMissing).toBe(true);
    });

    it('false: ЕП with justification', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', M: 'п.4 ч.1 ст.93', K: 500_000,
      }), REF_DATE);
      expect(s.epJustificationMissing).toBe(false);
    });

    it('СТРАЖ п.41: «Отменена» в U пропуск обоснования больше не прячет', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', M: '', K: 500_000, U: 'Отменена',
      }), REF_DATE);
      expect(s.epJustificationMissing).toBe(true);
    });

    it('false: non-ЕП method', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', M: '', K: 500_000,
      }), REF_DATE);
      expect(s.epJustificationMissing).toBe(false);
    });

    it('false: ЕП but plan = 0', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', M: '', K: 0,
      }), REF_DATE);
      expect(s.epJustificationMissing).toBe(false);
    });

    // Маркер отсутствия = «не заполнено» (канон п.62 интервью 14.08.2026,
    // предикат isAbsentCell). Живая сверка 19.08.2026 по восьми книгам
    // (E:/aemr-dumps/book-dumps, 3 397 строк ЕП): пустая M ровно одна,
    // заглушек десять — до правки замечание молчало на всех десяти, хотя
    // читателю в карточке печаталось «Основание выбора ЕП: Х».
    it('true: заглушка «Х» в M — это «не заполнено» (УАГЗО стр.33 № 47, план 187,47)', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', M: 'Х', K: 187.47,
      }), REF_DATE);
      expect(s.epJustificationMissing).toBe(true);
    });

    it('true: латинская «X» — та же заглушка (УО стр.9 № 6, план 594,67)', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', M: 'X', K: 594.67,
      }), REF_DATE);
      expect(s.epJustificationMissing).toBe(true);
    });

    it('true: строчная «х» (УКСиМП стр.361 № 354, план 4,57)', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', M: 'х', K: 4.57,
      }), REF_DATE);
      expect(s.epJustificationMissing).toBe(true);
    });

    it('false: настоящее обоснование заглушкой не считается (УО стр.6 № 3: «Заключение с ЕП по наименьшей цене.»)', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', M: 'Заключение с ЕП по наименьшей цене.', K: 3_950,
      }), REF_DATE);
      expect(s.epJustificationMissing).toBe(false);
    });
  });

  describe('singleParticipant — СНЯТ каноном п.27 (14.08.2026)', () => {
    it('всегда false: «1 участник» — текст комментария, структурной колонки участников нет', () => {
      for (const cells of [
        { L: 'ЭА', AE: 'Торги проведены, 1 участник' },
        { L: 'ЭА', U: 'заключен контракт с ед.подавшим заявку' },
        { L: 'ЕП', AE: '1 участник' },
      ]) {
        expect(detectSignals(makeCells(cells), REF_DATE).singleParticipant).toBe(false);
      }
    });
  });

  describe('financeDelay — СНЯТ каноном п.27 (14.08.2026)', () => {
    it('всегда false: «финансир» в комментариях машинно не читается; структурный класс — planYearMissing', () => {
      for (const cells of [
        { AE: 'отсутствие финансирования' },
        { AF: 'нет финансирования из бюджета' },
        { AE: 'Договор будет заключен после доведения финансирования' },
        { AF: 'доведение софинансирования задержано, отсутствие финансирования из МБ' },
      ]) {
        expect(detectSignals(makeCells(cells), REF_DATE).financeDelay).toBe(false);
      }
    });
  });
});

// ────────────────────────────────────────────────────────────
// 7. Edge Cases
// ────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('completely empty cells dict — no crashes, all false', () => {
    const s = detectSignals({}, REF_DATE);
    expect(s.signed).toBe(false);
    expect(s.overdue).toBe(false);
    expect(s.epRisk).toBe(false);
    expect(s.formulaBroken).toBe(false);
    expect(s.economyConflict).toBe(false);
  });

  it('all null values — no crashes', () => {
    const cells: Record<string, unknown> = {};
    for (const col of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) {
      cells[col] = null;
    }
    cells['AA'] = null; cells['AB'] = null; cells['AC'] = null;
    cells['AD'] = null; cells['AE'] = null; cells['AF'] = null;
    const s = detectSignals(cells, REF_DATE);
    expect(s.signed).toBe(false);
    expect(s.hasFact).toBe(false);
  });

  it('NaN in numeric columns — treated as missing', () => {
    const s = detectSignals(makeCells({ K: NaN, Y: NaN }), REF_DATE);
    expect(s.factExceedsPlan).toBe(false);
    expect(s.highEconomy).toBe(false);
    expect(s.epRisk).toBe(false);
  });

  it('string numbers with spaces (Russian thousand separator)', () => {
    const s = detectSignals(makeCells({
      K: '1 000 000', Y: '1 100 000', L: 'ЭА',
    }), REF_DATE);
    expect(s.factExceedsPlan).toBe(true);
  });

  it('string numbers with comma decimal separator', () => {
    const s = detectSignals(makeCells({
      K: '1000000,50', Y: '500000,25', L: 'ЭА',
    }), REF_DATE);
    expect(s.highEconomy).toBe(true); // ~50% economy
  });

  it('formula errors in every position', () => {
    const cells = makeCells({
      K: '#REF!', Y: '#VALUE!', N: '#N/A', Q: '#NAME?',
    });
    const s = detectSignals(cells, REF_DATE);
    expect(s.formulaBroken).toBe(true);
    // Numeric signals should not fire on error strings
    expect(s.epRisk).toBe(false);
    expect(s.highEconomy).toBe(false);
  });

  it('boundary: EP_RISK_THRESHOLD exactly 600 (тыс. руб., not exceeded)', () => {
    const s = detectSignals(makeCells({
      L: 'ЕП', K: 600, M: '',
    }), REF_DATE);
    expect(s.epRisk).toBe(false);
  });

  it('boundary: EP_RISK_THRESHOLD 601 (тыс. руб., exceeded)', () => {
    const s = detectSignals(makeCells({
      L: 'ЕП', K: 601, M: '',
    }), REF_DATE);
    expect(s.epRisk).toBe(true);
  });

  it('2M (тыс. руб.) EP is not treated as the single-contract boundary', () => {
    const s = detectSignals(makeCells({
      L: 'ЕП', K: 2_000, M: '',
    }), REF_DATE);
    expect(s.epRisk).toBe(true);
  });

  it('budgetMismatch is always false (deprecated)', () => {
    const s = detectSignals(makeCells({
      H: 500_000, I: 300_000, J: 200_000, K: 999_999,
    }), REF_DATE);
    expect(s.budgetMismatch).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 8. classifyRowState
// ────────────────────────────────────────────────────────────

describe('classifyRowState', () => {
  function makeSignals(overrides: Partial<RowSignals> = {}): RowSignals {
    return {
      signed: false, planning: false, notDue: false, canceled: false,
      overdue: false, hasFact: false, planSoon: false, financeDelay: false,
      economyFlag: false, economyConflict: false, economyFlagUndetermined: false, epRisk: false,
      dataQuality: false, formulaBroken: false, singleParticipant: false,
      highEconomy: false, lowCompetition: false, earlyClosure: false,
      factExceedsPlan: false, epFactDeviation: false, stalledContract: false, budgetMismatch: false,
      factWithoutDate: false, dateWithoutFact: false, factDateBeforePlan: false,
      futureFactDate: false,
      planWithoutExecution: false, epJustificationMissing: false,
      methodReasonMismatch: false, unmappedReasonEP: false,
      budgetUnderallocation: false,
      budgetSourceMissing: false, tdWithProgram: false, planYearMissing: false,
      derivedFormulaBroken: false, factQuarterMissing: false,
      foreignYearExecution: false, initiativeRequest: false,
      ...overrides,
    };
  }

  it('formulaBroken => error (highest priority)', () => {
    expect(classifyRowState(makeSignals({ formulaBroken: true, signed: true }))).toBe('error');
  });

  it('signed => signed', () => {
    expect(classifyRowState(makeSignals({ signed: true }))).toBe('signed');
  });

  it('canceled => canceled', () => {
    expect(classifyRowState(makeSignals({ canceled: true }))).toBe('canceled');
  });

  it('overdue => overdue', () => {
    expect(classifyRowState(makeSignals({ overdue: true }))).toBe('overdue');
  });

  it('hasFact => has-fact', () => {
    expect(classifyRowState(makeSignals({ hasFact: true }))).toBe('has-fact');
  });

  it('financeDelay => finance-delay', () => {
    expect(classifyRowState(makeSignals({ financeDelay: true }))).toBe('finance-delay');
  });

  it('planSoon => near-plan', () => {
    expect(classifyRowState(makeSignals({ planSoon: true }))).toBe('near-plan');
  });

  it('planning => planning', () => {
    expect(classifyRowState(makeSignals({ planning: true }))).toBe('planning');
  });

  it('notDue => not-due', () => {
    expect(classifyRowState(makeSignals({ notDue: true }))).toBe('not-due');
  });

  it('dataQuality only => error', () => {
    expect(classifyRowState(makeSignals({ dataQuality: true }))).toBe('error');
  });

  it('no signals => open', () => {
    expect(classifyRowState(makeSignals())).toBe('open');
  });

  it('priority: signed beats overdue', () => {
    expect(classifyRowState(makeSignals({ signed: true, overdue: true }))).toBe('signed');
  });

  it('priority: canceled beats overdue', () => {
    expect(classifyRowState(makeSignals({ canceled: true, overdue: true }))).toBe('canceled');
  });
});

// ────────────────────────────────────────────────────────────
// 9. getSignalBadges
// ────────────────────────────────────────────────────────────

describe('getSignalBadges', () => {
  function makeSignals(overrides: Partial<RowSignals> = {}): RowSignals {
    return {
      signed: false, planning: false, notDue: false, canceled: false,
      overdue: false, hasFact: false, planSoon: false, financeDelay: false,
      economyFlag: false, economyConflict: false, economyFlagUndetermined: false, epRisk: false,
      dataQuality: false, formulaBroken: false, singleParticipant: false,
      highEconomy: false, lowCompetition: false, earlyClosure: false,
      factExceedsPlan: false, epFactDeviation: false, stalledContract: false, budgetMismatch: false,
      factWithoutDate: false, dateWithoutFact: false, factDateBeforePlan: false,
      futureFactDate: false,
      planWithoutExecution: false, epJustificationMissing: false,
      methodReasonMismatch: false, unmappedReasonEP: false,
      budgetUnderallocation: false,
      budgetSourceMissing: false, tdWithProgram: false, planYearMissing: false,
      derivedFormulaBroken: false, factQuarterMissing: false,
      foreignYearExecution: false, initiativeRequest: false,
      ...overrides,
    };
  }

  it('returns empty array when no signals', () => {
    const badges = getSignalBadges(makeSignals());
    expect(badges).toEqual([]);
  });

  it('returns red badge for overdue', () => {
    const badges = getSignalBadges(makeSignals({ overdue: true }));
    expect(badges.length).toBe(1);
    expect(badges[0].color).toBe('red');
    expect(badges[0].label).toBe('Просрочен');
  });

  it('returns green badge for signed', () => {
    const badges = getSignalBadges(makeSignals({ signed: true }));
    expect(badges.some(b => b.color === 'green' && b.label === 'Подписан')).toBe(true);
  });

  it('returns blue badge for planning', () => {
    const badges = getSignalBadges(makeSignals({ planning: true }));
    expect(badges.some(b => b.color === 'blue' && b.label === 'Планирование')).toBe(true);
  });

  it('returns gray badge for canceled', () => {
    const badges = getSignalBadges(makeSignals({ canceled: true }));
    expect(badges.some(b => b.color === 'gray' && b.label === 'Отменён')).toBe(true);
  });

  it('returns multiple badges for compound signals', () => {
    const badges = getSignalBadges(makeSignals({
      overdue: true, epRisk: true, dataQuality: true,
    }));
    expect(badges.length).toBe(3);
    const labels = badges.map(b => b.label);
    expect(labels).toContain('Просрочен');
    expect(labels).toContain('ЕП-риск');
    expect(labels).toContain('Пустые обязательные поля');
  });

  it('economyFlag shows green badge only when no conflict', () => {
    const withConflict = getSignalBadges(makeSignals({ economyFlag: true, economyConflict: true }));
    expect(withConflict.some(b => b.label === 'Экономия')).toBe(false);
    expect(withConflict.some(b => b.label === 'Конфликт флага экономии')).toBe(true);

    const noConflict = getSignalBadges(makeSignals({ economyFlag: true, economyConflict: false }));
    expect(noConflict.some(b => b.label === 'Экономия')).toBe(true);
  });

  it('e2e §3.1: бейдж «Экономия» оживает на реальной строке AD="да" + экономия (до фикса не показывался никогда)', () => {
    // УЭР стр.6: K=445, Y=312.79, AD=да — честная экономия с проставленным флагом
    const s = detectSignals(makeCells({ K: 445, Y: 312.79, AD: 'да', L: 'ЭА' }), REF_DATE);
    const badges = getSignalBadges(s);
    expect(badges.some(b => b.label === 'Экономия' && b.color === 'green')).toBe(true);
    expect(badges.some(b => b.label === 'Конфликт флага экономии')).toBe(false);
  });

  it('hasFact shows green badge only when NOT signed', () => {
    const withSigned = getSignalBadges(makeSignals({ hasFact: true, signed: true }));
    expect(withSigned.some(b => b.label === 'Есть факт')).toBe(false);

    const noSigned = getSignalBadges(makeSignals({ hasFact: true, signed: false }));
    expect(noSigned.some(b => b.label === 'Есть факт')).toBe(true);
  });

  it('СТРАЖ п.28: «Факт раньше плановой даты» — синий (информационный), не жёлтый', () => {
    const badges = getSignalBadges(makeSignals({ factDateBeforePlan: true }));
    const badge = badges.find(b => b.label === 'Факт раньше плановой даты');
    expect(badge).toBeDefined();
    expect(badge!.color).toBe('blue');
  });

  it('СТРАЖ п.23: бейдж planYearMissing называется «Не обеспечено финансированием»', () => {
    const badges = getSignalBadges(makeSignals({ planYearMissing: true }));
    expect(badges.some(b => b.label === 'Не обеспечено финансированием')).toBe(true);
    expect(badges.some(b => b.label === 'Без финансирования')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// tdWithProgram — СНЯТ каноном п.30 (интервью 14.08.2026)
// ────────────────────────────────────────────────────────────

describe('tdWithProgram снят (канон п.30): заполненная программа у ТД — норма', () => {
  it('страж класса: ТД с реальной программой в D сигнала НЕ рождает', () => {
    // Раньше такая строка получала предупреждение «возможная ошибка
    // заполнения» и попадала в срез «ТД-ПМ»; канон п.30 упразднил и срез,
    // и сигнал — строка есть обычная ТД во всей системе.
    const s = detectSignals({ F: 'Текущая деятельность', D: 'МП «Развитие культуры»', K: 100 });
    expect(s.tdWithProgram).toBe(false);
  });

  it('поле совместимости всегда false при любой комбинации F/D', () => {
    expect(detectSignals({ F: 'Текущая деятельность', D: 'Х', K: 100 }).tdWithProgram).toBe(false);
    expect(detectSignals({ F: 'Текущая деятельность', D: '', K: 100 }).tdWithProgram).toBe(false);
    expect(detectSignals({ F: 'Программное мероприятие', D: 'МП «Развитие культуры»', K: 100 }).tdWithProgram).toBe(false);
  });

  it('бейдж «ТД с программой» не рисуется даже для старого снимка с сигналом true', () => {
    // Старые атомы могут нести tdWithProgram=true — бейдж всё равно снят.
    const s = detectSignals({ F: 'Текущая деятельность', D: 'МП «Развитие культуры»', K: 100 });
    const badges = getSignalBadges({ ...s, tdWithProgram: true });
    expect(badges.map((b) => b.label)).not.toContain('ТД с программой');
  });
});

// ────────────────────────────────────────────────────────────
// planYearMissing — счётная строка без года плана (вводная 06.08,
// сверка лимита УЭР: 5 строк на 589,93 тыс. невидимы для SUMIFS СВОДа)
// ────────────────────────────────────────────────────────────

describe('planYearMissing', () => {
  it('способ и деньги есть, P пусто — сигнал горит', () => {
    const s = detectSignals({ L: 'ЭА', K: 190, H: 0, I: 0, J: 190, P: '' });
    expect(s.planYearMissing).toBe(true);
  });

  it('заглушки Х и «-» в P — та же пустота, горит', () => {
    expect(detectSignals({ L: 'ЕП', K: 85.53, P: 'Х' }).planYearMissing).toBe(true);
    expect(detectSignals({ L: 'ЕП', K: 85.53, P: '-' }).planYearMissing).toBe(true);
  });

  it('год проставлен — не горит', () => {
    expect(detectSignals({ L: 'ЭА', K: 190, P: 2026 }).planYearMissing).toBe(false);
    expect(detectSignals({ L: 'ЕП', K: 243.28, P: '2025' }).planYearMissing).toBe(false);
  });

  it('нет способа или нет денег — строка не счётная, не горит', () => {
    expect(detectSignals({ L: '', K: 190, P: '' }).planYearMissing).toBe(false);
    expect(detectSignals({ L: 'ЭА', K: 0, P: '' }).planYearMissing).toBe(false);
  });

  it('СТРАЖ п.41: «отменена» в U сигнал больше не гасит', () => {
    expect(detectSignals({ L: 'ЭА', K: 190, P: '', U: 'отменена' }).planYearMissing).toBe(true);
  });

  it('фикс п.98а: N датой + P пусто — НЕ «не обеспечено финансированием»', () => {
    // Живой кейс УКСиМП строка 280 (18.08.2026): N=30.11.2026, формулы O/P
    // стёрты. Финансирование есть — ложное обвинение снято, это поломка формулы.
    const s = detectSignals({ L: 'ЕП', K: 200, N: '30.11.2026', O: '', P: '' });
    expect(s.planYearMissing).toBe(false);
    expect(s.derivedFormulaBroken).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// derivedFormulaBroken — стёртая формула производной даты (канон п.93/45:
// рукописны только N и Q; O/P и R/S считаются формулами). Живые кейсы
// 18.08.2026: УКСиМП строки 280/283 — жалоба оператора «не обеспечено
// финансирование — 4 строки — все данные заполнены и сверены».
// ────────────────────────────────────────────────────────────

describe('derivedFormulaBroken', () => {
  it('живой кейс УКСиМП 283: N=31.08.2026, O/P без формулы — горит', () => {
    const s = detectSignals({ L: 'ЕП', K: 30, N: '31.08.2026', O: '', P: '' });
    expect(s.derivedFormulaBroken).toBe(true);
  });

  it('живой кейс УКСиМП 326: N=Х — формулы честно пусты, цела; это unfunded', () => {
    const s = detectSignals({ L: 'ЕП', K: 240, N: 'Х', O: '', P: '' });
    expect(s.derivedFormulaBroken).toBe(false);
    expect(s.planYearMissing).toBe(true);
  });

  it('здоровая строка: N датой, O/P посчитаны — молчит', () => {
    const s = detectSignals({ L: 'ЕП', K: 40, N: '15.08.2026', O: 3, P: 2026 });
    expect(s.derivedFormulaBroken).toBe(false);
    expect(s.planYearMissing).toBe(false);
  });

  it('производная без источника: P=2026 при пустой N — тоже поломка', () => {
    const s = detectSignals({ L: 'ЭА', K: 190, P: 2026 });
    expect(s.derivedFormulaBroken).toBe(true);
    expect(s.planYearMissing).toBe(false);
  });

  it('факт-сторона: Q датой, R/S пусты — горит', () => {
    const s = detectSignals({
      L: 'ЕП', K: 40, N: '15.08.2026', O: 3, P: 2026,
      Q: '11.08.2026', R: '', S: '',
    });
    expect(s.derivedFormulaBroken).toBe(true);
  });

  it('факт-сторона цела: Q датой, R/S посчитаны — молчит', () => {
    const s = detectSignals({
      L: 'ЕП', K: 40, N: '15.08.2026', O: 3, P: 2026,
      Q: '11.08.2026', R: 3, S: 2026,
    });
    expect(s.derivedFormulaBroken).toBe(false);
  });

  it('не счётная строка (нет способа или нулевой план) — молчит', () => {
    expect(detectSignals({ L: '', K: 190, N: '15.08.2026', P: '' }).derivedFormulaBroken).toBe(false);
    expect(detectSignals({ L: 'ЭА', K: 0, N: '15.08.2026', P: '' }).derivedFormulaBroken).toBe(false);
  });

  it('бейдж: красный «Сломана формула даты»', () => {
    const s = detectSignals({ L: 'ЕП', K: 200, N: '30.11.2026', O: '', P: '' });
    const b = getSignalBadges(s).find((x) => x.label === 'Сломана формула даты');
    expect(b).toBeDefined();
    expect(b!.color).toBe('red');
  });
});

// ────────────────────────────────────────────────────────────
// factQuarterMissing — факт без планового квартала (блок А п.2,
// замер 07.08: одна строка УДТХ на 67 666,68 тыс. = всё расхождение
// «год = Σ кварталов» против «год = Σ + _orphan»)
// ────────────────────────────────────────────────────────────

describe('factQuarterMissing — остаточная страховка (канон 20.08.2026: первичны N и Q)', () => {
  it('N пуста + факт есть + O бита → первопричина «не обеспечено финансированием», не этот сигнал', () => {
    const s = detectSignals({ L: 'ЭА', K: 67666.68, Q: '15.03.2026', N: '', O: '' });
    expect(s.planYearMissing).toBe(true);
    expect(s.factQuarterMissing).toBe(false);
  });

  it('N заполнена + O невалидна (0, 5, Х) → «сломана формула даты», не этот сигнал', () => {
    for (const O of [0, 5, 'Х']) {
      const s = detectSignals({ L: 'ЭА', K: 100, N: '10.02.2026', P: '2026', Q: '15.03.2026', O });
      expect(s.derivedFormulaBroken).toBe(true);
      expect(s.factQuarterMissing).toBe(false);
    }
  });

  it('остаточный хвост: строка не счётная (нет способа) — первопричины молчат, страховка горит', () => {
    const s = detectSignals({ L: '', K: 0, Q: '15.03.2026', O: '' });
    expect(s.planYearMissing).toBe(false);
    expect(s.derivedFormulaBroken).toBe(false);
    expect(s.factQuarterMissing).toBe(true);
  });

  it('квартал проставлен (число или строка) — не горит', () => {
    expect(detectSignals({ L: 'ЭА', K: 100, Q: '15.03.2026', O: 1 }).factQuarterMissing).toBe(false);
    expect(detectSignals({ L: 'ЭА', K: 100, Q: '15.03.2026', O: '4' }).factQuarterMissing).toBe(false);
  });

  it('факта нет — не горит (это не дефект факта)', () => {
    expect(detectSignals({ L: 'ЭА', K: 100, Q: '', O: '' }).factQuarterMissing).toBe(false);
    expect(detectSignals({ L: 'ЭА', K: 100, Q: 'Х', O: '' }).factQuarterMissing).toBe(false);
  });

  it('СТРАЖ п.41: «отменена» в U сигнал больше не гасит', () => {
    expect(detectSignals({ L: '', K: 0, Q: '15.03.2026', O: '', U: 'отменена' }).factQuarterMissing).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// Один дом имён (консолидация 21.08.2026)
//
// До неё подпись класса жила в четырёх независимых местах — бейджи здесь,
// словарь продукта, реестр проверок и формулировки экранов, — и синхронизация
// была ручной. Инвентаризация 20.08.2026 насчитала шестнадцать разъехавшихся
// имён. Тесты ниже держат дом единственным.
// ────────────────────────────────────────────────────────────

describe('имена классов строк — единственный дом (@aemr/shared)', () => {
  /** Все ключи RowSignals — по объекту, который возвращает детектор. */
  const allSignalKeys = Object.keys(detectSignals(makeCells(), REF_DATE)) as Array<keyof RowSignals>;

  /**
   * Единственное намеренное исключение: tdWithProgram снят каноном п.30
   * (14.08.2026) вместе с подписью — заполненная графа программы у текущей
   * деятельности норма, и класс не должен называться нигде. Поле держится в
   * типе ради чтения старых снимков и всегда false; бейджа у него нет, и веб
   * отфильтровывает его даже из исторических замечаний.
   */
  const RETIRED_WITHOUT_NAME = new Set(['tdWithProgram']);

  it('у каждого признака строки есть человеческая подпись в словаре продукта', () => {
    const missing = allSignalKeys
      .filter((key) => !RETIRED_WITHOUT_NAME.has(key))
      .filter((key) => SIGNAL_LABELS[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('снятый класс подписи не получает — иначе он вернётся на экран', () => {
    for (const key of RETIRED_WITHOUT_NAME) {
      expect(SIGNAL_LABELS[key]).toBeUndefined();
    }
  });

  it('словарь не подписывает признаков, которых движок не считает', () => {
    const known = new Set<string>(allSignalKeys);
    const extra = Object.keys(SIGNAL_LABELS).filter((key) => !known.has(key));
    expect(extra).toEqual([]);
  });

  it('бейдж берёт подпись из словаря, а не держит свою строку', () => {
    // Включаем ВСЕ признаки разом: каждый бейдж, который умеет родиться,
    // обязан назваться словами словаря.
    const all = Object.fromEntries(allSignalKeys.map((key) => [key, true])) as unknown as RowSignals;
    const known = new Set(Object.values(SIGNAL_LABELS));
    const foreign = getSignalBadges(all).map((b) => b.label).filter((label) => !known.has(label));
    expect(foreign).toEqual([]);
  });

  it('ни один бейдж не показывает служебное имя ключа', () => {
    const all = Object.fromEntries(allSignalKeys.map((key) => [key, true])) as unknown as RowSignals;
    for (const badge of getSignalBadges(all)) {
      expect(badge.label).not.toMatch(/[a-z]+[A-Z][a-zA-Z]*/);
    }
  });
});

// ────────────────────────────────────────────────────────────
// Консолидация сигналов — решения владельца п.137 от 21.08.2026
// ────────────────────────────────────────────────────────────

describe('п.137(4): исполнение по плану другого года', () => {
  it('год факта не равен году плана при обоих заполненных — признак горит', () => {
    // Живой случай УО: договор января 2026-го против декабрьского плана
    // 2025-го. Деньги потрачены в 2026-м, а в годовое число 2026-го не
    // входят — годовой срез решает по плановому году.
    const s = detectSignals(
      makeCells({ N: '26.12.2025', P: 2025, Q: '01.01.2026', S: 2026, Y: 148_900 }),
      REF_DATE,
    );
    expect(s.foreignYearExecution).toBe(true);
  });

  it('совпадение годов признака не даёт', () => {
    const s = detectSignals(
      makeCells({ N: '15.03.2026', P: 2026, Q: '20.03.2026', S: 2026, Y: 900_000 }),
      REF_DATE,
    );
    expect(s.foreignYearExecution).toBe(false);
  });

  it('пустой год с любой стороны признака не даёт — там свои классы', () => {
    // Пустой год плана — это «не обеспечена финансированием», пустой год
    // факта при живой дате — «сломана формула даты». Чужой год их не крадёт.
    expect(detectSignals(makeCells({ P: '', S: 2026, Q: '01.02.2026' }), REF_DATE).foreignYearExecution)
      .toBe(false);
    expect(detectSignals(makeCells({ P: 2026, S: '', Q: '01.02.2026' }), REF_DATE).foreignYearExecution)
      .toBe(false);
  });
});

describe('п.137(3): инициативная заявка отмечается признаком', () => {
  it('примечание ГРБС целиком равно маркеру «хотелки» — признак горит', () => {
    for (const marker of ['хотелки', 'Хотелки', 'просто хотелки', '  хотелки  ']) {
      expect(detectSignals(makeCells({ AF: marker }), REF_DATE).initiativeRequest).toBe(true);
    }
  });

  it('маркер внутри свободного текста признака не даёт (канон п.27)', () => {
    // Маркер читается структурно — как код, а не как слово в предложении:
    // иначе это было бы машинное толкование свободного текста.
    const s = detectSignals(makeCells({ AF: 'это скорее хотелки, чем потребность' }), REF_DATE);
    expect(s.initiativeRequest).toBe(false);
  });
});

describe('п.137(1): «в течение года» названа в оси состояния', () => {
  it('суммы факта без даты заключения дают состояние yearlong, а не «исполнение»', () => {
    // До 21.08.2026 стадия пряталась под подписью «Исполнение», и класс, ради
    // которого заведена отдельная вкладка, в оси не назывался вовсе.
    const s = detectSignals(makeCells({ Q: null, Y: 500_000 }), REF_DATE);
    expect(s.factWithoutDate).toBe(true);
    expect(classifyRowState(s)).toBe('yearlong');
  });
});

describe('п.137(6): гейт ЕП у «факта раньше плановой даты» держится сознательно', () => {
  it('конкурентный способ: опережение 1–30 дней — справка', () => {
    const s = detectSignals(makeCells({ L: 'ЭА', N: '15.03.2026', Q: '02.03.2026' }), REF_DATE);
    expect(s.factDateBeforePlan).toBe(true);
  });

  it('единственный поставщик: то же опережение справки НЕ даёт', () => {
    // Разбор 21.08.2026: гейт прячет 212 строк на 31 024,11 тыс. Оставлен
    // сознательно — у ЕП нет извещения и паузы, плановая дата мягкий
    // ориентир, и опережение о строке не сообщает ничего. Цена умолчания
    // названа вслух в паспорте fact_date_before_plan.
    const s = detectSignals(makeCells({ L: 'ЕП', N: '15.03.2026', Q: '02.03.2026' }), REF_DATE);
    expect(s.factDateBeforePlan).toBe(false);
  });
});
