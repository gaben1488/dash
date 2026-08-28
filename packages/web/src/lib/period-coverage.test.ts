import { describe, expect, it } from 'vitest';
import {
  buildCoverageIndex,
  classifyPeriod,
  dayPartsOfDateValue,
  isFutureMonth,
  isoWeekKeyOfDate,
  isoWeekKeyOfParts,
  monthCountOf,
  weekCountOf,
  weekPosition,
  yearCountOf,
} from './period-coverage';

describe('период-покрытие: индекс по загруженным строкам', () => {
  it('строка попадает в неделю, месяц и год по плановой и фактической дате', () => {
    const idx = buildCoverageIndex([
      { planDate: '2026-08-24', factDate: '2026-09-02' },
    ]);
    expect(monthCountOf(idx, 2026, 8)).toBe(1);
    expect(monthCountOf(idx, 2026, 9)).toBe(1);
    expect(yearCountOf(idx, 2026)).toBe(1);
    // 24.08.2026 — понедельник 35-й недели; 02.09.2026 — 36-я
    expect(idx.weeks['2026-35']).toBe(1);
    expect(idx.weeks['2026-36']).toBe(1);
  });

  it('план и факт в одном месяце считаются одной строкой, не двумя', () => {
    const idx = buildCoverageIndex([
      { planDate: '2026-03-10', factDate: '2026-03-12' },
    ]);
    expect(monthCountOf(idx, 2026, 3)).toBe(1);
    expect(yearCountOf(idx, 2026)).toBe(1);
  });

  it('строки без дат не попадают никуда', () => {
    const idx = buildCoverageIndex([
      { planDate: null, factDate: '' },
      { planDate: 'Х', factDate: undefined },
    ]);
    expect(Object.keys(idx.months)).toHaveLength(0);
    expect(Object.keys(idx.weeks)).toHaveLength(0);
  });

  it('понимает «дд.мм.гггг» наравне с ISO', () => {
    const idx = buildCoverageIndex([{ planDate: '15.03.2026' }]);
    expect(monthCountOf(idx, 2026, 3)).toBe(1);
  });
});

describe('ключ ISO-недели: год берётся у недели, не у даты', () => {
  it('29.12.2025 (понедельник) — первая неделя 2026 года', () => {
    expect(isoWeekKeyOfParts({ y: 2025, m: 12, d: 29 })).toBe('2026-1');
  });
  it('локальная дата даёт тот же ключ, что её части', () => {
    expect(isoWeekKeyOfDate(new Date(2026, 7, 24))).toBe('2026-35');
  });
  it('счёт по неделе барабана совпадает с индексом', () => {
    const idx = buildCoverageIndex([{ planDate: '2025-12-30' }]);
    expect(weekCountOf(idx, new Date(2025, 11, 29))).toBe(1);
  });
});

describe('три вида покрытия (владелец 22.08: будущее — не пустота)', () => {
  it('индекс не готов — «неизвестно», а не «данных нет»', () => {
    expect(classifyPeriod(0, false, false)).toBe('unknown');
  });
  it('есть строки — «есть данные», даже если период в будущем (план)', () => {
    expect(classifyPeriod(10, true, true)).toBe('has-data');
  });
  it('1–3 строки — «почти пусто»', () => {
    expect(classifyPeriod(1, false, true)).toBe('scarce');
    expect(classifyPeriod(3, false, true)).toBe('scarce');
    expect(classifyPeriod(4, false, true)).toBe('has-data');
  });
  it('нет строк: прошлое — «данных нет», будущее — «ещё не наступило»', () => {
    expect(classifyPeriod(0, false, true)).toBe('empty');
    expect(classifyPeriod(0, true, true)).toBe('future');
  });
});

describe('положение периодов относительно сегодня', () => {
  const today = new Date(2026, 7, 28); // 28.08.2026, пятница 35-й недели

  it('неделя: прошлая — срез, текущая — эфир, следующая — будущее', () => {
    expect(weekPosition(new Date(2026, 7, 17), today)).toBe('past');
    expect(weekPosition(new Date(2026, 7, 24), today)).toBe('current');
    expect(weekPosition(new Date(2026, 7, 31), today)).toBe('future');
  });

  it('месяц: текущий — не будущее, следующий и следующий год — будущее', () => {
    expect(isFutureMonth(2026, 8, today)).toBe(false);
    expect(isFutureMonth(2026, 9, today)).toBe(true);
    expect(isFutureMonth(2025, 12, today)).toBe(false);
    expect(isFutureMonth(2027, 1, today)).toBe(true);
  });
});

describe('разбор значений дат', () => {
  it('ISO, «дд.мм.гггг» и не-даты', () => {
    expect(dayPartsOfDateValue('2026-01-05')).toEqual({ y: 2026, m: 1, d: 5 });
    expect(dayPartsOfDateValue('05.01.2026')).toEqual({ y: 2026, m: 1, d: 5 });
    expect(dayPartsOfDateValue('Х')).toBeNull();
    expect(dayPartsOfDateValue('')).toBeNull();
    expect(dayPartsOfDateValue(null)).toBeNull();
  });
});
