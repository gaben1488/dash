import { describe, it, expect } from 'vitest';
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

describe('Status signals', () => {
  it('detects signed from U="Подписан"', () => {
    const s = detectSignals(makeCells({ U: 'Подписан' }), REF_DATE);
    expect(s.signed).toBe(true);
    expect(s.planning).toBe(false);
    expect(s.canceled).toBe(false);
  });

  it('detects signed from AE="договор заключен"', () => {
    const s = detectSignals(makeCells({ AE: 'договор заключен' }), REF_DATE);
    expect(s.signed).toBe(true);
  });

  it('detects signed from AE="Исполнен"', () => {
    const s = detectSignals(makeCells({ AE: 'Исполнен полностью' }), REF_DATE);
    expect(s.signed).toBe(true);
  });

  it('detects planning from U="В стадии планирования"', () => {
    const s = detectSignals(makeCells({ U: 'В стадии планирования' }), REF_DATE);
    expect(s.planning).toBe(true);
    expect(s.signed).toBe(false);
  });

  it('detects planning from AE comment with "подготовка"', () => {
    const s = detectSignals(makeCells({ AE: 'идет подготовка документов' }), REF_DATE);
    expect(s.planning).toBe(true);
  });

  it('detects notDue from combined U+AE text', () => {
    const s = detectSignals(makeCells({ AE: 'срок не наступил, ожидание' }), REF_DATE);
    expect(s.notDue).toBe(true);
  });

  it('detects canceled from U="Отменена"', () => {
    const s = detectSignals(makeCells({ U: 'Отменена' }), REF_DATE);
    expect(s.canceled).toBe(true);
  });

  it('detects canceled from AE="снят с плана"', () => {
    const s = detectSignals(makeCells({ AE: 'снят с плана по решению руководства' }), REF_DATE);
    expect(s.canceled).toBe(true);
  });

  it('detects canceled from "не требуется"', () => {
    const s = detectSignals(makeCells({ AE: 'закупка не требуется' }), REF_DATE);
    expect(s.canceled).toBe(true);
  });

  it('no status signals on empty U and AE', () => {
    const s = detectSignals(makeCells({ U: '', AE: '' }), REF_DATE);
    expect(s.signed).toBe(false);
    expect(s.planning).toBe(false);
    expect(s.notDue).toBe(false);
    expect(s.canceled).toBe(false);
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

  it('NOT overdue when signed', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 0,
      AE: 'договор заключен',
    }), REF_DATE);
    expect(s.overdue).toBe(false);
    expect(s.signed).toBe(true);
  });

  it('NOT overdue when canceled', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 0, U: 'Отменена',
    }), REF_DATE);
    expect(s.overdue).toBe(false);
  });

  it('NOT overdue when has fact amounts', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 500_000,
    }), REF_DATE);
    expect(s.overdue).toBe(false);
    expect(s.hasFact).toBe(true);
  });

  it('NOT overdue when AE has schedule transfer "переносится на..."', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 0,
      AE: 'переносится на 2 квартал',
    }), REF_DATE);
    expect(s.overdue).toBe(false);
  });

  it('NOT overdue when AE has "перенос"', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 0,
      AE: 'перенос на 2 квартал',
    }), REF_DATE);
    expect(s.overdue).toBe(false);
  });

  it('NOT overdue when AE has "перенесён"', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 0,
      AE: 'срок перенесён на май',
    }), REF_DATE);
    expect(s.overdue).toBe(false);
  });

  it('NOT overdue when AE has "отложен"', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 0,
      AE: 'отложен до получения финансирования',
    }), REF_DATE);
    expect(s.overdue).toBe(false);
  });

  // FP-fix 2026-06-05 (SIGNAL_VALIDATION §4): forward план-график.
  it('NOT overdue when status is "планирование" (forward plan-graph)', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 0,
      AE: 'планирование',
    }), REF_DATE);
    expect(s.planning).toBe(true);
    expect(s.overdue).toBe(false);
  });

  it('NOT overdue when status is "срок не наступил"', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 0,
      AE: 'срок не наступил',
    }), REF_DATE);
    expect(s.notDue).toBe(true);
    expect(s.overdue).toBe(false);
  });

  it('NOT overdue when AE has "срок изменён на ..."', () => {
    const s = detectSignals(makeCells({
      N: '01.01.2026', Q: null, Y: 0,
      AE: 'срок изменён на 01.06.2026',
    }), REF_DATE);
    expect(s.overdue).toBe(false);
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

  it('NOT planSoon when already signed', () => {
    const s = detectSignals(makeCells({
      N: '23.04.2026', Q: null, Y: 0, AE: 'подписан',
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

    it('conflict (случай б): AD="·" (плейсхолдер = не определён) + экономия 43% (УД стр.10: K=333.8024, Y=188.56238)', () => {
      const s = detectSignals(makeCells({
        K: 333.8024, Y: 188.56238, AD: '·', L: 'ЭА',
      }), REF_DATE);
      expect(s.economyConflict).toBe(true);
    });

    it('conflict: economy >15% but no AD flag (competitive method)', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 800_000, AD: '', L: 'ЭА',
      }), REF_DATE);
      // economy = 20% > 15%
      expect(s.economyConflict).toBe(true);
    });

    it('NO conflict: economy >15% on EP (sole source)', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 800_000, AD: '', L: 'ЕП',
      }), REF_DATE);
      // ЕП is exempt from economy flag requirement
      expect(s.economyConflict).toBe(false);
    });

    it('NO conflict: economy <15% without flag', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 900_000, AD: '', L: 'ЭА',
      }), REF_DATE);
      // economy = 10% < 15%
      expect(s.economyConflict).toBe(false);
    });

    it('NO conflict when factTotal = 0 (not yet executed)', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 0, AD: 'экономия',
      }), REF_DATE);
      expect(s.economyConflict).toBe(false);
    });
  });

  describe('epRisk', () => {
    it('true: method=ЕП, plan > 600K, not canceled', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 600_001, M: '',
      }), REF_DATE);
      expect(s.epRisk).toBe(true);
    });

    it('false: ЕП but plan <= 600K', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 600_000, M: '',
      }), REF_DATE);
      expect(s.epRisk).toBe(false);
    });

    it('false: ЕП but canceled', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 2_500_000, U: 'Отменена', M: '',
      }), REF_DATE);
      expect(s.epRisk).toBe(false);
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

    it('false: дубль singleParticipant — УИО-квартира (стр.20: K=5812.91, Y=5812.90875, аукцион не состоялся)', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', K: 5812.91, Y: 5812.90875,
        U: 'Аукцион не состоялся, заключен контракт с ед.подавшим заявку на участие, контракт исполнен',
      }), REF_DATE);
      expect(s.singleParticipant).toBe(true);
      expect(s.lowCompetition).toBe(false);
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

    it('false: canceled row (data may be stale)', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 2_000_000, U: 'Отменена',
      }), REF_DATE);
      expect(s.factExceedsPlan).toBe(false);
    });
  });
});

describe('FP-fixes 2026-06-05 (SIGNAL_VALIDATION §4)', () => {
  it('factDateBeforePlan: NOT for ЕП (early sole-source conclusion is legal)', () => {
    const s = detectSignals(makeCells({ L: 'ЕП', N: '01.05.2026', Q: '15.04.2026' }), REF_DATE);
    expect(s.factDateBeforePlan).toBe(false);
  });
  it('factDateBeforePlan: YES for competitive method (ЭА)', () => {
    const s = detectSignals(makeCells({ L: 'ЭА', N: '01.05.2026', Q: '15.04.2026' }), REF_DATE);
    expect(s.factDateBeforePlan).toBe(true);
  });
  it('planWithoutExecution: NOT for contingent «при необходимости» purchase', () => {
    const s = detectSignals(makeCells({ K: 32_000_000, N: null, Q: null, Y: 0, AE: 'будет проведена при необходимости' }), REF_DATE);
    expect(s.planWithoutExecution).toBe(false);
  });
  it('factWithoutDate: NOT flagged when fact date is in AE comment (ae-parser)', () => {
    const s = detectSignals(makeCells({ Y: 170_000, Q: 'Х', AE: '01.02.2026 заключен контракт №17' }), REF_DATE);
    expect(s.factWithoutDate).toBe(false);
  });
  it('epJustificationMissing: NOT flagged when legal basis is in AE comment (ae-parser)', () => {
    const s = detectSignals(makeCells({ L: 'ЕП', M: '', K: 20_000, AE: 'Не учитывается по п.4 ч.1 ст.93' }), REF_DATE);
    expect(s.epJustificationMissing).toBe(false);
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

    it('false: canceled rows are skipped', () => {
      const s = detectSignals(makeCells({
        D: '', K: 1_000_000, L: '', N: '01.01.2026', U: 'Отменена',
      }), REF_DATE);
      expect(s.dataQuality).toBe(false);
    });

    it('false: planning rows are skipped', () => {
      const s = detectSignals(makeCells({
        D: '', K: 1_000_000, L: '', N: '01.01.2026', U: 'В стадии планирования',
      }), REF_DATE);
      expect(s.dataQuality).toBe(false);
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

    it('false: canceled row', () => {
      const s = detectSignals(makeCells({
        Y: 500_000, Q: null, U: 'Отменена',
      }), REF_DATE);
      expect(s.factWithoutDate).toBe(false);
    });

    it('false: has fact date', () => {
      const s = detectSignals(makeCells({
        Y: 500_000, Q: '10.03.2026',
      }), REF_DATE);
      expect(s.factWithoutDate).toBe(false);
    });

    // FP-fix signal_audit 2026-07-14 §3.6: периодические закупки «в течение года»
    it('false: периодическая закупка «в течение года по мере необходимости» (УДТХ стр.55)', () => {
      const s = detectSignals(makeCells({
        N: '31.12.2026', Q: 'х', X: 179.843, Y: 179.843,
        M: 'пп. 1, п.1 Распоряжения Администрации ЕМР от 03.09.2025 № 112', L: 'ЕП',
        AF: 'приобретение канц. и хоз. товаров осуществляется в течение года по мере необходимости',
      }), REF_DATE);
      expect(s.factWithoutDate).toBe(false);
    });

    it('false: периодическая с опечаткой «в течении года» (УКСиМП стр.552)', () => {
      const s = detectSignals(makeCells({
        N: '31.12.2026', Q: 'Х', X: 12.8, Y: 12.8, L: 'ЕП',
        M: 'нецелесообразность проведения аукциона',
        AF: 'Выдача денежных средств по ведомости в течении года',
      }), REF_DATE);
      expect(s.factWithoutDate).toBe(false);
    });

    it('false: «по мере возникновения фактической потребности» (УФБП стр.14)', () => {
      const s = detectSignals(makeCells({
        N: '30.12.2026', Q: 'Х', X: 94.5, Y: 94.5, L: 'ЕП',
        M: 'Небольшие суммы контракта и узкая специализация по обучению',
        AF: 'Данная закупка будет проводится в течение года, по мере возникновения фактической потребности в обучении специалистов',
      }), REF_DATE);
      expect(s.factWithoutDate).toBe(false);
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

    it('false: canceled row', () => {
      const s = detectSignals(makeCells({
        Q: '10.03.2026', Y: 0, U: 'Отменена',
      }), REF_DATE);
      expect(s.dateWithoutFact).toBe(false);
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

    it('false: canceled row', () => {
      const s = detectSignals(makeCells({
        K: 0, Y: 500_000, U: 'Отменена',
      }), REF_DATE);
      expect(s.budgetUnderallocation).toBe(false);
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

    it('false: canceled row', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, H: 0, I: 0, J: 0, U: 'Отменена',
      }), REF_DATE);
      expect(s.budgetSourceMissing).toBe(false);
    });
  });
});

// ────────────────────────────────────────────────────────────
// 6. Behavioral Signals
// ────────────────────────────────────────────────────────────

describe('Behavioral signals', () => {
  describe('stalledContract', () => {
    it('true: signed, no fact date, plan date > 30 days overdue', () => {
      const s = detectSignals(makeCells({
        AE: 'договор заключен', Q: null, Y: 0,
        N: '01.01.2026', // ~103 days before REF_DATE
      }), REF_DATE);
      expect(s.stalledContract).toBe(true);
    });

    it('false: signed but has fact date', () => {
      const s = detectSignals(makeCells({
        AE: 'договор заключен', Q: '10.03.2026',
        N: '01.01.2026',
      }), REF_DATE);
      expect(s.stalledContract).toBe(false);
    });

    it('false: signed but plan date only 20 days ago', () => {
      const s = detectSignals(makeCells({
        AE: 'подписан', Q: null, Y: 0,
        N: '25.03.2026', // ~19 days before REF_DATE
      }), REF_DATE);
      expect(s.stalledContract).toBe(false);
    });

    it('false: canceled', () => {
      const s = detectSignals(makeCells({
        AE: 'подписан', Q: null, Y: 0,
        N: '01.01.2026', U: 'Отменена',
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

    it('false: отменённая строка — её даты не считаем данными', () => {
      const s = detectSignals(makeCells({ N: '30.06.2026', Q: '15.07.2027', U: 'Отменена' }), REF_DATE);
      expect(s.futureFactDate).toBe(false);
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

    it('false: canceled (даже при смене года)', () => {
      const s = detectSignals(makeCells({
        N: '30.04.2026', Q: '15.04.2025', U: 'Отменена',
      }), new Date(2026, 6, 15));
      expect(s.earlyClosure).toBe(false);
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

    it('true: plan date >30 days in past, no fact, not overdue', () => {
      // Plan date well in the past (>30 days) and no fact = legitimate signal
      const s = detectSignals(makeCells({
        K: 1_000_000, N: '01.01.2026', // Jan 1 — 102 days before April 13 REF_DATE
        Y: 0, Q: null, U: '', AE: 'заключен', // signed → not overdue
      }), REF_DATE);
      // signed=true means overdue won't fire, but planWithoutExecution skips signed too
      expect(s.planWithoutExecution).toBe(false);
    });

    it('true: plan date >30 days past, not signed, has schedule transfer (not overdue)', () => {
      // Plan date in past, schedule transfer prevents overdue but not planWithoutExecution
      const s = detectSignals(makeCells({
        K: 1_000_000, N: '01.02.2026', // Feb 1 — 71 days before REF_DATE
        Y: 0, Q: null, U: '', AE: 'переносится на 2кв',
      }), REF_DATE);
      // hasScheduleTransfer=true → not overdue; plan date >30 days past → fires
      expect(s.overdue).toBe(false);
      expect(s.planWithoutExecution).toBe(true);
    });

    it('true: no plan date but plan sum exists, April+', () => {
      // Fallback: no plan date → use month check (April+)
      const s = detectSignals(makeCells({
        K: 1_000_000, N: null,
        Y: 0, Q: null, U: '', AE: '',
      }), REF_DATE);
      expect(s.planWithoutExecution).toBe(true);
    });

    it('false: before April', () => {
      const marchDate = new Date(2026, 1, 15); // February 15
      const s = detectSignals(makeCells({
        K: 1_000_000, N: '30.06.2026',
        Y: 0, Q: null, U: '', AE: '',
      }), marchDate);
      expect(s.planWithoutExecution).toBe(false);
    });

    it('false: signed row', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, N: '30.04.2026',
        Y: 0, Q: null, AE: 'подписан',
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

    it('false: canceled', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', M: '', K: 500_000, U: 'Отменена',
      }), REF_DATE);
      expect(s.epJustificationMissing).toBe(false);
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
  });

  describe('singleParticipant', () => {
    it('true: "1 участник" in AE for competitive method', () => {
      const s = detectSignals(makeCells({
        L: 'ЭА', AE: 'Торги проведены, 1 участник',
      }), REF_DATE);
      expect(s.singleParticipant).toBe(true);
    });

    it('false: "1 участник" but method is ЕП', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', AE: '1 участник',
      }), REF_DATE);
      expect(s.singleParticipant).toBe(false);
    });
  });

  describe('financeDelay', () => {
    it('true: AE contains "финансир"', () => {
      const s = detectSignals(makeCells({
        AE: 'отсутствие финансирования',
      }), REF_DATE);
      expect(s.financeDelay).toBe(true);
    });

    it('true: AF contains "нет финансирования"', () => {
      const s = detectSignals(makeCells({
        AF: 'нет финансирования из бюджета',
      }), REF_DATE);
      expect(s.financeDelay).toBe(true);
    });

    it('false: no finance-related text', () => {
      const s = detectSignals(makeCells({ AE: 'все в порядке' }), REF_DATE);
      expect(s.financeDelay).toBe(false);
    });

    // FP-fix signal_audit 2026-07-14 §3.8: ложные классы подстроки «финансир»
    it('false: софинансирование — доведение, не задержка (УД стр.35)', () => {
      const s = detectSignals(makeCells({
        AF: 'уточнение в связи с доведением софинансирования из бюджета КК, в настоящее время подготовлена техническая документация',
      }), REF_DATE);
      expect(s.financeDelay).toBe(false);
    });

    it('false: «добавлением финансирования» — сумму увеличили (УО стр.1052)', () => {
      const s = detectSignals(makeCells({
        AF: 'договор заключен, изменение суммы в связи с добавлением финансирования',
      }), REF_DATE);
      expect(s.financeDelay).toBe(false);
    });

    it('false: «финансирования дефицита» — слово в предмете закупки-кредита (УФБП стр.4)', () => {
      const s = detectSignals(makeCells({
        AF: 'Данная закупка будет проведена при необходимости в привлечении коммерческого кредита для финансирования дефицита бюджета ЕМР',
      }), REF_DATE);
      expect(s.financeDelay).toBe(false);
    });

    it('true: ядро «после доведения финансирования» остаётся (УО стр.336)', () => {
      const s = detectSignals(makeCells({
        AE: 'страховка на автобус действует до 08.06.26. Договор будет заключен после доведения финансирования',
      }), REF_DATE);
      expect(s.financeDelay).toBe(true);
    });

    it('true: исключение + ядро в одном комментарии — ядро побеждает', () => {
      const s = detectSignals(makeCells({
        AF: 'доведение софинансирования задержано, отсутствие финансирования из МБ',
      }), REF_DATE);
      expect(s.financeDelay).toBe(true);
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

  it('boundary: EP_RISK_THRESHOLD exactly 600000 (not exceeded)', () => {
    const s = detectSignals(makeCells({
      L: 'ЕП', K: 600_000, M: '',
    }), REF_DATE);
    expect(s.epRisk).toBe(false);
  });

  it('boundary: EP_RISK_THRESHOLD 600001 (exceeded)', () => {
    const s = detectSignals(makeCells({
      L: 'ЕП', K: 600_001, M: '',
    }), REF_DATE);
    expect(s.epRisk).toBe(true);
  });

  it('2M EP is not treated as the single-contract boundary', () => {
    const s = detectSignals(makeCells({
      L: 'ЕП', K: 2_000_000, M: '',
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
      economyFlag: false, economyConflict: false, epRisk: false,
      dataQuality: false, formulaBroken: false, singleParticipant: false,
      highEconomy: false, lowCompetition: false, earlyClosure: false,
      factExceedsPlan: false, stalledContract: false, budgetMismatch: false,
      factWithoutDate: false, dateWithoutFact: false, factDateBeforePlan: false,
      futureFactDate: false,
      planWithoutExecution: false, epJustificationMissing: false,
      methodReasonMismatch: false, unmappedReasonEP: false,
      budgetUnderallocation: false,
      budgetSourceMissing: false, tdWithProgram: false,
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
      economyFlag: false, economyConflict: false, epRisk: false,
      dataQuality: false, formulaBroken: false, singleParticipant: false,
      highEconomy: false, lowCompetition: false, earlyClosure: false,
      factExceedsPlan: false, stalledContract: false, budgetMismatch: false,
      factWithoutDate: false, dateWithoutFact: false, factDateBeforePlan: false,
      futureFactDate: false,
      planWithoutExecution: false, epJustificationMissing: false,
      methodReasonMismatch: false, unmappedReasonEP: false,
      budgetUnderallocation: false,
      budgetSourceMissing: false, tdWithProgram: false,
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
    expect(badges[0].label).toBe('Просрочено');
  });

  it('returns green badge for signed', () => {
    const badges = getSignalBadges(makeSignals({ signed: true }));
    expect(badges.some(b => b.color === 'green' && b.label === 'Подписано')).toBe(true);
  });

  it('returns blue badge for planning', () => {
    const badges = getSignalBadges(makeSignals({ planning: true }));
    expect(badges.some(b => b.color === 'blue' && b.label === 'Планирование')).toBe(true);
  });

  it('returns gray badge for canceled', () => {
    const badges = getSignalBadges(makeSignals({ canceled: true }));
    expect(badges.some(b => b.color === 'gray' && b.label === 'Отменено')).toBe(true);
  });

  it('returns multiple badges for compound signals', () => {
    const badges = getSignalBadges(makeSignals({
      overdue: true, epRisk: true, dataQuality: true,
    }));
    expect(badges.length).toBe(3);
    const labels = badges.map(b => b.label);
    expect(labels).toContain('Просрочено');
    expect(labels).toContain('ЕП-риск');
    expect(labels).toContain('Пустые поля');
  });

  it('economyFlag shows green badge only when no conflict', () => {
    const withConflict = getSignalBadges(makeSignals({ economyFlag: true, economyConflict: true }));
    expect(withConflict.some(b => b.label === 'Экономия')).toBe(false);
    expect(withConflict.some(b => b.label === 'Флаг экономии')).toBe(true);

    const noConflict = getSignalBadges(makeSignals({ economyFlag: true, economyConflict: false }));
    expect(noConflict.some(b => b.label === 'Экономия')).toBe(true);
  });

  it('e2e §3.1: бейдж «Экономия» оживает на реальной строке AD="да" + экономия (до фикса не показывался никогда)', () => {
    // УЭР стр.6: K=445, Y=312.79, AD=да — честная экономия с проставленным флагом
    const s = detectSignals(makeCells({ K: 445, Y: 312.79, AD: 'да', L: 'ЭА' }), REF_DATE);
    const badges = getSignalBadges(s);
    expect(badges.some(b => b.label === 'Экономия' && b.color === 'green')).toBe(true);
    expect(badges.some(b => b.label === 'Флаг экономии')).toBe(false);
  });

  it('hasFact shows green badge only when NOT signed', () => {
    const withSigned = getSignalBadges(makeSignals({ hasFact: true, signed: true }));
    expect(withSigned.some(b => b.label === 'Есть факт')).toBe(false);

    const noSigned = getSignalBadges(makeSignals({ hasFact: true, signed: false }));
    expect(noSigned.some(b => b.label === 'Есть факт')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// tdWithProgram — ТД с заполненной графой программы (вводная 06.08)
// ────────────────────────────────────────────────────────────

describe('tdWithProgram', () => {
  it('ТД с реальной программой в D — сигнал горит', () => {
    const s = detectSignals({ F: 'Текущая деятельность', D: 'МП «Развитие культуры»', K: 100 });
    expect(s.tdWithProgram).toBe(true);
  });

  it('ТД с пустой/Х графой программы — не горит', () => {
    expect(detectSignals({ F: 'Текущая деятельность', D: 'Х', K: 100 }).tdWithProgram).toBe(false);
    expect(detectSignals({ F: 'Текущая деятельность', D: '', K: 100 }).tdWithProgram).toBe(false);
  });

  it('программное мероприятие с программой — не горит (это норма)', () => {
    expect(detectSignals({ F: 'Программное мероприятие', D: 'МП «Развитие культуры»', K: 100 }).tdWithProgram).toBe(false);
  });
});
