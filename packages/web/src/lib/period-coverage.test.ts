/**
 * Стражи покрытия периодов.
 *
 * Что здесь защищается:
 *   • индекс по строкам: неделя/месяц/год считаются по плановой И фактической
 *     дате, один период у одной строки — один раз;
 *   • канон §12.3: будущее ПОБЕЖДАЕТ данные — сентябрь-декабрь 2026 при живом
 *     плане несут вид «ещё не наступило», не «есть данные» и не пустоту;
 *   • границы будущего — по продуктовому времени Камчатки (UTC+12), не по
 *     часам зрителя;
 *   • даты с хвостами («31.12.2026 г.») и легаси-формы не выпадают из
 *     покрытия молча;
 *   • честность по-книжно: отказ книги — не пустота ('partial'/'failed',
 *     находка 28.08), после сбоя индекс оживает повтором не чаще минуты,
 *     invalidatePeriodCoverage возвращает его к 'idle'.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRows = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ api: { getRows: (...a: unknown[]) => getRows(...a) } }));

const deptIds = vi.hoisted(() => ({ current: ['УО', 'ЦБ'] as string[] }));
vi.mock('../store', () => ({
  useStore: {
    getState: () => ({
      subordinatesMap: Object.fromEntries(deptIds.current.map((d) => [d, {}])),
    }),
  },
}));

import {
  buildCoverageIndex,
  classifyPeriod,
  classifyPeriodByStatus,
  classifyQuarter,
  dayPartsOfDateValue,
  isFutureMonth,
  isoWeekKeyOfDate,
  isoWeekKeyOfParts,
  monthCountOf,
  summarizeBookLoads,
  weekCountOf,
  weekPosition,
  yearCountOf,
  type CoverageIndex,
} from './period-coverage';
import {
  ensurePeriodCoverage,
  getPeriodCoverageState,
  invalidatePeriodCoverage,
  resetPeriodCoverage,
} from '../hooks/usePeriodCoverage';

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

describe('три вида покрытия: будущее побеждает данные (канон §12.3)', () => {
  it('индекс не готов — «неизвестно», а не «данных нет»', () => {
    expect(classifyPeriod(0, false, false)).toBe('unknown');
  });
  it('будущий период с плановыми строками — «ещё не наступило», не «есть данные»', () => {
    expect(classifyPeriod(10, true, true)).toBe('future');
  });
  it('канон §12.3 дословно: сентябрь-декабрь 2026 при живом плане — «ещё не наступило»', () => {
    const now = new Date(Date.UTC(2026, 7, 27, 12)); // 28.08.2026 по Камчатке
    const planByMonth: Array<[number, number]> = [[9, 146], [10, 42], [11, 41], [12, 101]];
    for (const [month, planCount] of planByMonth) {
      expect(classifyPeriod(planCount, isFutureMonth(2026, month, now), true)).toBe('future');
    }
    // Август идёт и полон строк — «есть данные», будущим не притворяется.
    expect(classifyPeriod(175, isFutureMonth(2026, 8, now), true)).toBe('has-data');
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

describe('вид квартала — агрегат трёх его месяцев', () => {
  const now = new Date(Date.UTC(2026, 7, 27, 12)); // 28.08.2026 по Камчатке
  const idx: CoverageIndex = {
    weeks: {},
    months: {
      '2026-7': 200, '2026-8': 175, '2026-9': 146,
      '2026-10': 42, '2026-11': 41, '2026-12': 101,
      '2025-1': 3,
    },
    years: {},
  };

  it('все месяцы прошли и пусты — «данных нет»', () => {
    expect(classifyQuarter(2025, 2, idx, true, now)).toBe('empty');
  });
  it('квартал целиком в будущем — «ещё не наступило», даже с плановыми строками', () => {
    expect(classifyQuarter(2026, 4, idx, true, now)).toBe('future');
    expect(classifyQuarter(2027, 1, idx, true, now)).toBe('future');
  });
  it('смесь идущих и будущих месяцев со строками — «есть данные»', () => {
    expect(classifyQuarter(2026, 3, idx, true, now)).toBe('has-data');
  });
  it('1–3 строки на весь квартал — «почти пусто»', () => {
    expect(classifyQuarter(2025, 1, idx, true, now)).toBe('scarce');
  });
  it('индекс не готов — «неизвестно»', () => {
    expect(classifyQuarter(2026, 3, idx, false, now)).toBe('unknown');
  });
});

describe('продуктовое время — Камчатка (UTC+12), не часы зрителя', () => {
  it('зритель ещё 31 августа, на Камчатке уже 1 сентября — сентябрь наступил', () => {
    const now = new Date(Date.UTC(2026, 7, 31, 23, 0)); // 01.09 11:00 на Камчатке
    expect(isFutureMonth(2026, 9, now)).toBe(false);
  });
  it('на Камчатке ещё 31 августа — сентябрь впереди', () => {
    const now = new Date(Date.UTC(2026, 7, 31, 8, 0)); // 31.08 20:00 на Камчатке
    expect(isFutureMonth(2026, 9, now)).toBe(true);
  });
  it('неделя переключается по камчатской полуночи', () => {
    // Понедельник 31.08.2026: в 13:00 UTC воскресенья 30.08 на Камчатке
    // уже 01:00 понедельника — неделя стала текущей, прошлая — срезом.
    const now = new Date(Date.UTC(2026, 7, 30, 13, 0));
    expect(weekPosition(new Date(2026, 7, 31), now)).toBe('current');
    expect(weekPosition(new Date(2026, 7, 24), now)).toBe('past');
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

  it('дата с хвостом «31.12.2026 г.» не выпадает из покрытия', () => {
    expect(dayPartsOfDateValue('31.12.2026 г.')).toEqual({ y: 2026, m: 12, d: 31 });
    expect(dayPartsOfDateValue('31.12.2026г.')).toEqual({ y: 2026, m: 12, d: 31 });
    // А лишняя цифра за годом — не дата, хвостом не считается.
    expect(dayPartsOfDateValue('31.12.20261')).toBeNull();
  });

  it('легаси-серийник разбирается фоллбэком parseSheetDate', () => {
    // 46023 дня от 30.12.1899 = 01.01.2026
    expect(dayPartsOfDateValue('46023')).toEqual({ y: 2026, m: 1, d: 1 });
  });
});

describe('честность по-книжно (находка 28.08: отказ книги глотался как пустота)', () => {
  const row = { planDate: '2026-08-24' };

  it('все книги целиком — ready', () => {
    const out = summarizeBookLoads([
      { ok: true, rows: [row] },
      { ok: true, rows: [row] },
    ]);
    expect(out.status).toBe('ready');
    expect(out.rows).toHaveLength(2);
  });

  it('упали 7 книг из 8 — partial, не ready', () => {
    const books = [
      { ok: true, rows: [row] },
      ...Array.from({ length: 7 }, () => ({ ok: false, rows: [] })),
    ];
    expect(summarizeBookLoads(books).status).toBe('partial');
  });

  it('книга довезла часть страниц — тоже partial: её недостача не доказывает пустоту', () => {
    expect(summarizeBookLoads([
      { ok: true, rows: [row] },
      { ok: false, rows: [row] },
    ]).status).toBe('partial');
  });

  it('упали все — failed', () => {
    expect(summarizeBookLoads([
      { ok: false, rows: [] },
      { ok: false, rows: [] },
    ]).status).toBe('failed');
  });

  it('ноль строк из всех книг даже без явных ошибок — сбой, не пустой год', () => {
    expect(summarizeBookLoads([
      { ok: true, rows: [] },
      { ok: true, rows: [] },
    ]).status).toBe('failed');
  });

  it('partial: доехавшее красится как обычно, пустота — «неизвестно», не приглушение', () => {
    expect(classifyPeriodByStatus(10, false, 'partial')).toBe('has-data');
    expect(classifyPeriodByStatus(2, false, 'partial')).toBe('scarce');
    expect(classifyPeriodByStatus(0, false, 'partial')).toBe('unknown');
    expect(classifyPeriodByStatus(0, true, 'partial')).toBe('future');
  });

  it('ready классифицирует как обычно, остальные статусы — «неизвестно»', () => {
    expect(classifyPeriodByStatus(0, false, 'ready')).toBe('empty');
    expect(classifyPeriodByStatus(0, false, 'failed')).toBe('unknown');
    expect(classifyPeriodByStatus(0, false, 'loading')).toBe('unknown');
    expect(classifyPeriodByStatus(0, false, 'idle')).toBe('unknown');
  });
});

describe('хук покрытия: по-книжный статус, повтор после сбоя, сброс индекса', () => {
  const page = (rows: Array<Record<string, unknown>>) =>
    ({ rows, pagination: { totalPages: 1 } });

  beforeEach(() => {
    vi.useFakeTimers();
    deptIds.current = ['УО', 'ЦБ'];
    getRows.mockReset();
    resetPeriodCoverage();
  });
  afterEach(() => {
    resetPeriodCoverage();
    vi.useRealTimers();
  });

  it('упало семь книг из восьми — partial, живая книга в индексе', async () => {
    deptIds.current = ['к1', 'к2', 'к3', 'к4', 'к5', 'к6', 'к7', 'к8'];
    getRows.mockImplementation((dept: string) => dept === 'к1'
      ? Promise.resolve(page([{ planDate: '2026-08-24' }]))
      : Promise.reject(new Error('502')));
    ensurePeriodCoverage();
    await vi.advanceTimersByTimeAsync(1500);
    const st = getPeriodCoverageState();
    expect(st.status).toBe('partial');
    expect(monthCountOf(st.index, 2026, 8)).toBe(1);
  });

  it('после сбоя всех книг повтор оживает, но не раньше минуты', async () => {
    deptIds.current = ['УО'];
    getRows.mockRejectedValue(new Error('offline'));
    ensurePeriodCoverage();
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPeriodCoverageState().status).toBe('failed');
    const callsAfterFail = getRows.mock.calls.length;

    // Сервер ожил, но минута с последней попытки не прошла — не дёргаемся.
    getRows.mockResolvedValue(page([{ planDate: '2026-08-24' }]));
    await vi.advanceTimersByTimeAsync(30_000);
    ensurePeriodCoverage();
    await vi.advanceTimersByTimeAsync(0);
    expect(getPeriodCoverageState().status).toBe('failed');
    expect(getRows.mock.calls.length).toBe(callsAfterFail);

    // Минута прошла — повтор загружает индекс.
    await vi.advanceTimersByTimeAsync(31_000);
    ensurePeriodCoverage();
    await vi.runAllTimersAsync();
    const st = getPeriodCoverageState();
    expect(st.status).toBe('ready');
    expect(monthCountOf(st.index, 2026, 8)).toBe(1);
  });

  it('invalidatePeriodCoverage возвращает к idle, следующий ensure грузит заново', async () => {
    deptIds.current = ['УО'];
    getRows.mockResolvedValue(page([{ planDate: '2026-08-24' }]));
    ensurePeriodCoverage();
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPeriodCoverageState().status).toBe('ready');

    invalidatePeriodCoverage();
    expect(getPeriodCoverageState().status).toBe('idle');

    getRows.mockResolvedValue(page([{ planDate: '2026-09-05' }]));
    ensurePeriodCoverage();
    await vi.advanceTimersByTimeAsync(1500);
    const st = getPeriodCoverageState();
    expect(st.status).toBe('ready');
    expect(monthCountOf(st.index, 2026, 9)).toBe(1);
    expect(monthCountOf(st.index, 2026, 8)).toBe(0); // старый индекс не подмешан
  });

  it('сброс во время полёта: устаревший ответ не оживляет индекс', async () => {
    let release: (v: unknown) => void = () => {};
    getRows.mockReturnValue(new Promise((res) => { release = res; }));
    ensurePeriodCoverage();
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPeriodCoverageState().status).toBe('loading');

    invalidatePeriodCoverage();
    release(page([{ planDate: '2026-08-24' }]));
    await vi.advanceTimersByTimeAsync(0);
    expect(getPeriodCoverageState().status).toBe('idle');
  });
});
