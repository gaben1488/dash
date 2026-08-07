/**
 * Фаза 1 оси времени: канонизация TimeSelection, дизъюнктность ключей,
 * roundtrip сериализации, asOfDay на границе среды/четверга.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_TIME_SELECTION,
  parseTimeSelection,
  productCalendarDay,
  resolveTimeSelection,
  serializeTimeSelection,
  type Month,
  type PeriodKey,
  type Quarter,
  type TimeSelection,
} from './time-selection.js';
import { dayNumberOf } from './parse-sheet-date.js';

function sel(o: {
  years?: number[];
  byYear?: Record<number, { q?: Quarter[]; m?: Month[] }>;
  week?: string | null;
}): TimeSelection {
  return {
    years: new Set(o.years ?? []),
    byYear: new Map(
      Object.entries(o.byYear ?? {}).map(([y, v]) => [
        Number(y),
        { quarters: new Set(v.q ?? []), months: new Set(v.m ?? []) },
      ]),
    ),
    weekStart: o.week ?? null,
  };
}

/** Месяцы, покрытые ключом, — для проверки дизъюнктности. */
function monthsOf(k: PeriodKey): string[] {
  if (k.kind === 'year') {
    return Array.from({ length: 12 }, (_, i) => `${k.year}-${i + 1}`);
  }
  if (k.kind === 'quarter') {
    return [0, 1, 2].map((i) => `${k.year}-${(k.quarter - 1) * 3 + i + 1}`);
  }
  return [`${k.year}-${k.month}`];
}

describe('resolveTimeSelection — канонизация', () => {
  it('пусто = всё: keys=[], label «все годы»', () => {
    const r = resolveTimeSelection(EMPTY_TIME_SELECTION);
    expect(r.keys).toEqual([]);
    expect(r.years).toEqual([]);
    expect(r.asOfDay).toBeNull();
    expect(r.label).toBe('все годы');
  });

  it('пустые годы + availableYears → развёрнутые целые годы', () => {
    const r = resolveTimeSelection(EMPTY_TIME_SELECTION, { availableYears: [2026, 2025] });
    expect(r.keys).toEqual([
      { kind: 'year', year: 2025 },
      { kind: 'year', year: 2026 },
    ]);
    expect(r.granularity).toBe('year');
  });

  it('квартал поглощает свои месяцы', () => {
    const r = resolveTimeSelection(sel({ byYear: { 2026: { q: [1], m: [2, 5] } } }));
    // Февраль внутри q1 — поглощён; май остался месяцем.
    expect(r.keys).toEqual([
      { kind: 'quarter', year: 2026, quarter: 1 },
      { kind: 'month', year: 2026, month: 5 },
    ]);
    expect(r.granularity).toBe('mixed');
  });

  it('полная тройка месяцев схлопывается в квартал', () => {
    const r = resolveTimeSelection(sel({ byYear: { 2026: { m: [4, 5, 6] } } }));
    expect(r.keys).toEqual([{ kind: 'quarter', year: 2026, quarter: 2 }]);
    expect(r.granularity).toBe('quarter');
  });

  it('четыре квартала = год целиком; 12 месяцев = год целиком', () => {
    expect(resolveTimeSelection(sel({ byYear: { 2026: { q: [1, 2, 3, 4] } } })).keys)
      .toEqual([{ kind: 'year', year: 2026 }]);
    const all12 = Array.from({ length: 12 }, (_, i) => (i + 1) as Month);
    expect(resolveTimeSelection(sel({ byYear: { 2026: { m: all12 } } })).keys)
      .toEqual([{ kind: 'year', year: 2026 }]);
  });

  it('год из byYear попадает в years и без явного years', () => {
    const r = resolveTimeSelection(sel({ byYear: { 2025: { q: [3] } } }));
    expect(r.years).toEqual([2025]);
    expect(r.keys).toEqual([{ kind: 'quarter', year: 2025, quarter: 3 }]);
  });

  it('дизъюнктность: никакие два ключа не покрывают один месяц', () => {
    const cases: TimeSelection[] = [
      sel({ byYear: { 2026: { q: [1, 2], m: [1, 4, 7, 12] } } }),
      sel({ years: [2025], byYear: { 2026: { q: [4], m: [10, 11, 12, 1] } } }),
      sel({ byYear: { 2025: { m: [1, 2, 3, 4] }, 2026: { q: [1], m: [2] } } }),
    ];
    for (const s of cases) {
      const r = resolveTimeSelection(s);
      const covered = r.keys.flatMap(monthsOf);
      expect(new Set(covered).size).toBe(covered.length);
    }
  });
});

describe('resolveTimeSelection — неделя-срез', () => {
  // Продуктовое «сейчас»: пятница 24.07.2026 Камчатки.
  const now = new Date('2026-07-24T00:00:00+12:00');
  const thu2307 = dayNumberOf('23.07.2026')!;

  it('выбранная прошедшая неделя → её четверг', () => {
    const r = resolveTimeSelection(sel({ week: '2026-07-13' }), { now });
    expect(r.asOfDay).toBe(dayNumberOf('16.07.2026'));
    expect(r.label).toContain('срез 2026-07-16');
  });

  it('текущая неделя после четверга → её четверг (не в будущее)', () => {
    const r = resolveTimeSelection(sel({ week: '2026-07-20' }), { now });
    expect(r.asOfDay).toBe(thu2307);
  });

  it('будущая неделя клампится к последнему прошедшему четвергу', () => {
    const r = resolveTimeSelection(sel({ week: '2026-08-03' }), { now });
    expect(r.asOfDay).toBe(thu2307);
  });

  it('граница среды/четверга: в среду четверг текущей недели ещё не наступил', () => {
    const wed = new Date('2026-07-22T12:00:00+12:00');
    const r = resolveTimeSelection(sel({ week: '2026-07-20' }), { now: wed });
    expect(r.asOfDay).toBe(dayNumberOf('16.07.2026')); // четверг прошлой недели
  });

  it('weekStart нормализуется к понедельнику своей недели', () => {
    const r = resolveTimeSelection(sel({ week: '2026-07-15' }), { now }); // среда
    expect(r.asOfDay).toBe(dayNumberOf('16.07.2026'));
  });
});

describe('productCalendarDay', () => {
  it('полночь Камчатки и вечер UTC накануне — один продуктовый день', () => {
    const utcEvening = new Date('2026-07-22T13:00:00Z'); // 23.07 01:00 Камчатки
    expect(productCalendarDay(utcEvening, 12)).toBe(dayNumberOf('23.07.2026'));
    expect(productCalendarDay(utcEvening, 0)).toBe(dayNumberOf('22.07.2026'));
  });
});

describe('сериализация — roundtrip', () => {
  it('пустой выбор → пустая строка → пустой выбор', () => {
    expect(serializeTimeSelection(EMPTY_TIME_SELECTION)).toBe('');
    const parsed = parseTimeSelection('');
    expect(parsed.years.size).toBe(0);
    expect(parsed.byYear.size).toBe(0);
    expect(parsed.weekStart).toBeNull();
  });

  it('полный выбор переживает serialize → parse без потерь', () => {
    const s = sel({
      years: [2025, 2026],
      byYear: { 2026: { q: [1, 3], m: [5] }, 2025: { m: [11] } },
      week: '2026-07-20',
    });
    const qs = serializeTimeSelection(s);
    const p = parseTimeSelection(qs);
    expect([...p.years].sort()).toEqual([2025, 2026]);
    expect([...p.byYear.get(2026)!.quarters].sort()).toEqual([1, 3]);
    expect([...p.byYear.get(2026)!.months]).toEqual([5]);
    expect([...p.byYear.get(2025)!.months]).toEqual([11]);
    expect(p.weekStart).toBe('2026-07-20');
    // Резолв обеих форм даёт одинаковые ключи.
    expect(resolveTimeSelection(p, { now: new Date('2026-08-01T00:00:00+12:00') }).keys)
      .toEqual(resolveTimeSelection(s, { now: new Date('2026-08-01T00:00:00+12:00') }).keys);
  });

  it('мусор отбрасывается молча, неделя нормализуется к понедельнику', () => {
    const p = parseTimeSelection('years=abc,2026&quarters=2026:9,2026:2&months=2026:13,2026:7&week=2026-07-15');
    expect([...p.years]).toEqual([2026]);
    expect([...p.byYear.get(2026)!.quarters]).toEqual([2]);
    expect([...p.byYear.get(2026)!.months]).toEqual([7]);
    expect(p.weekStart).toBe('2026-07-13');
  });

  it('календарный rollover в week отбрасывается (2026-02-30)', () => {
    expect(parseTimeSelection('week=2026-02-30').weekStart).toBeNull();
  });
});
