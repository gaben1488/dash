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
  describe('economyFlag', () => {
    it('true when AD contains "экономия"', () => {
      const s = detectSignals(makeCells({ AD: 'экономия' }), REF_DATE);
      expect(s.economyFlag).toBe(true);
    });

    it('true when AD contains "эконом" (partial)', () => {
      const s = detectSignals(makeCells({ AD: 'Экономические средства' }), REF_DATE);
      expect(s.economyFlag).toBe(true);
    });

    it('false when AD empty', () => {
      const s = detectSignals(makeCells({ AD: '' }), REF_DATE);
      expect(s.economyFlag).toBe(false);
    });
  });

  describe('economyConflict', () => {
    it('conflict: AD="экономия" but fact >= plan', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 1_000_000, AD: 'экономия',
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
    it('true: method=ЕП, plan > 2M, not canceled', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 2_500_000, M: '',
      }), REF_DATE);
      expect(s.epRisk).toBe(true);
    });

    it('false: ЕП but plan <= 2M', () => {
      const s = detectSignals(makeCells({
        L: 'ЕП', K: 2_000_000, M: '',
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

  describe('lowCompetition', () => {
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
  });

  describe('factExceedsPlan', () => {
    it('true: fact > plan (any excess)', () => {
      const s = detectSignals(makeCells({
        K: 1_000_000, Y: 1_000_001,
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

    it('false: fact date > 30 days before plan (earlyClosure territory, plan in past)', () => {
      const s = detectSignals(makeCells({
        N: '01.03.2026', Q: '15.01.2026', // 45 days diff, plan in past
      }), REF_DATE);
      // diff > 30 -> earlyClosure, not factDateBeforePlan
      expect(s.factDateBeforePlan).toBe(false);
      expect(s.earlyClosure).toBe(true);
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

  describe('earlyClosure', () => {
    it('true: fact date > 30 days before plan date, plan date in past', () => {
      // Plan date 01.03.2026 is in past (REF_DATE=13.04.2026), fact 15.01.2026 = 45 days diff
      const s = detectSignals(makeCells({
        N: '01.03.2026', Q: '15.01.2026',
      }), REF_DATE);
      expect(s.earlyClosure).toBe(true);
    });

    it('false: plan date in future (retroactive date entry filter)', () => {
      // Plan date 30.06.2026 is in future — likely retroactive data entry, not real early closure
      const s = detectSignals(makeCells({
        N: '30.06.2026', Q: '15.03.2026', // planDate - factDate = 107 days > 30
      }), REF_DATE);
      expect(s.earlyClosure).toBe(false);
    });

    it('false: fact date only 20 days before plan', () => {
      const s = detectSignals(makeCells({
        N: '15.03.2026', Q: '25.02.2026', // 18 days diff, plan in past
      }), REF_DATE);
      expect(s.earlyClosure).toBe(false);
    });

    it('false: fact date after plan date', () => {
      const s = detectSignals(makeCells({
        N: '01.03.2026', Q: '15.03.2026',
      }), REF_DATE);
      expect(s.earlyClosure).toBe(false);
    });

    it('false: canceled', () => {
      const s = detectSignals(makeCells({
        N: '01.03.2026', Q: '15.01.2026', U: 'Отменена',
      }), REF_DATE);
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

  it('boundary: EP_RISK_THRESHOLD exactly 2000000 (not exceeded)', () => {
    const s = detectSignals(makeCells({
      L: 'ЕП', K: 2_000_000, M: '',
    }), REF_DATE);
    expect(s.epRisk).toBe(false);
  });

  it('boundary: EP_RISK_THRESHOLD 2000001 (exceeded)', () => {
    const s = detectSignals(makeCells({
      L: 'ЕП', K: 2_000_001, M: '',
    }), REF_DATE);
    expect(s.epRisk).toBe(true);
  });

  it('600K EP is no longer flagged (threshold raised to 2M per п.4 ст.93)', () => {
    const s = detectSignals(makeCells({
      L: 'ЕП', K: 600_001, M: '',
    }), REF_DATE);
    expect(s.epRisk).toBe(false);
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
      planWithoutExecution: false, epJustificationMissing: false,
      budgetUnderallocation: false,
      budgetSourceMissing: false,
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
      planWithoutExecution: false, epJustificationMissing: false,
      budgetUnderallocation: false,
      budgetSourceMissing: false,
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

  it('hasFact shows green badge only when NOT signed', () => {
    const withSigned = getSignalBadges(makeSignals({ hasFact: true, signed: true }));
    expect(withSigned.some(b => b.label === 'Есть факт')).toBe(false);

    const noSigned = getSignalBadges(makeSignals({ hasFact: true, signed: false }));
    expect(noSigned.some(b => b.label === 'Есть факт')).toBe(true);
  });
});
