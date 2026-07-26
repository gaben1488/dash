/**
 * Четверг-cron еженедельного снимка (services/weekly-snapshot-cron.ts).
 *
 * Канон дня: срез отчёта — ЧЕТВЕРГ; день 0 эпохи (1970-01-01) — четверг,
 * поэтому «сегодня четверг» = номер суток % 7 === 0. Календарь продукта —
 * Камчатка (UTC+12, DST нет): на UTC-сервере «четверг Камчатки» начинается
 * в среду 12:00 UTC — граница пояса покрыта тестами отдельно.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
  };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** Четверг-фикстура 23.07.2026; сверка % 7 === 0 — в первом тесте. */
const THURSDAY_ISO = '2026-07-23';

describe('shouldTakeWeeklySnapshot — правило четверга', () => {
  it('четверг без снимка этого дня → снимать', async () => {
    const { shouldTakeWeeklySnapshot } = await import('./weekly-snapshot-cron.js');
    const { dayNumberOf } = await import('@aemr/shared');

    const thursday = dayNumberOf(THURSDAY_ISO)!;
    // Сверка фикстуры: 23.07.2026 — действительно четверг эпохи.
    expect(thursday % 7).toBe(0);
    expect(shouldTakeWeeklySnapshot(thursday, [])).toBe(true);
    // Снимки других дней снятию не мешают.
    expect(shouldTakeWeeklySnapshot(thursday, [thursday - 7, thursday - 1])).toBe(true);
    // Таймаут 20s: первый в файле dynamic import компилирует весь модульный
    // граф сервера (snapshot.js → googleapis) — на холодном кэше дольше 5s.
    // Сами ассерты — чистая арифметика, к латентности нечувствительны.
  }, 20000);

  it('четверг, снимок этого дня уже есть → не снимать (идемпотентность)', async () => {
    const { shouldTakeWeeklySnapshot } = await import('./weekly-snapshot-cron.js');
    const { dayNumberOf } = await import('@aemr/shared');

    const thursday = dayNumberOf(THURSDAY_ISO)!;
    expect(shouldTakeWeeklySnapshot(thursday, [thursday])).toBe(false);
  });

  it('не-четверг → не снимать даже без единого снимка', async () => {
    const { shouldTakeWeeklySnapshot } = await import('./weekly-snapshot-cron.js');
    const { dayNumberOf } = await import('@aemr/shared');

    const thursday = dayNumberOf(THURSDAY_ISO)!;
    for (const offset of [1, 2, 3, 4, 5, 6]) {
      expect(shouldTakeWeeklySnapshot(thursday + offset, [])).toBe(false);
    }
  });
});

describe('productCalendarDay — календарь Камчатки на UTC-сервере', () => {
  it('UTC-среда 16:00 — уже четверг 04:00 Камчатки → снимать', async () => {
    const { productCalendarDay, shouldTakeWeeklySnapshot } = await import('./weekly-snapshot-cron.js');
    const { dayNumberOf } = await import('@aemr/shared');

    const nowDay = productCalendarDay(new Date('2026-07-22T16:00:00Z'), 12);
    expect(nowDay).toBe(dayNumberOf(THURSDAY_ISO)!);
    expect(shouldTakeWeeklySnapshot(nowDay, [])).toBe(true);
  });

  it('UTC-четверг 13:00 — уже пятница 01:00 Камчатки → не снимать', async () => {
    const { productCalendarDay, shouldTakeWeeklySnapshot } = await import('./weekly-snapshot-cron.js');
    const { dayNumberOf } = await import('@aemr/shared');

    const nowDay = productCalendarDay(new Date('2026-07-23T13:00:00Z'), 12);
    expect(nowDay).toBe(dayNumberOf('2026-07-24')!);
    expect(shouldTakeWeeklySnapshot(nowDay, [])).toBe(false);
  });
});

describe('collectSnapshotDays — дни существующих снимков из БД', () => {
  /** Минимальный валидный снимок для saveSnapshot (как в snapshot.test.ts). */
  function snap(id: string, createdAt: string) {
    return {
      id,
      spreadsheetId: 'test',
      createdAt,
      officialMetrics: {},
      calculatedMetrics: {},
      deltas: [],
      issues: [],
      trust: { overall: 100, components: [], grade: 'A' as const, computedAt: createdAt, basedOnSnapshot: id },
      rowCount: 0,
      metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
    };
  }

  it('createdAt хранится в UTC, но день снимка считается по Камчатке — дедуп через UTC-полночь работает', async () => {
    const { collectSnapshotDays } = await import('./weekly-snapshot-cron.js');
    const { saveSnapshot } = await import('./snapshot.js');
    const { dayNumberOf } = await import('@aemr/shared');

    const thursday = dayNumberOf(THURSDAY_ISO)!;
    // Снимок снят в четверг 04:30 Камчатки = среда 16:30 UTC: по UTC-календарю
    // это ещё среда, но день снимка обязан совпасть с четвергом продукта.
    await saveSnapshot(snap('thu-early', '2026-07-22T16:30:00.000Z'));
    // Древний снимок за горизонтом ~10 недель — в дедуп-окно не попадает.
    await saveSnapshot(snap('ancient', '2025-01-09T00:00:00.000Z'));

    const days = await collectSnapshotDays(thursday, 12);
    expect(days).toContain(thursday);
    expect(days).toHaveLength(1);
    // Таймаут: этот тест — единственный в файле, кому нужен snapshot.js
    // (SQLite + весь серверный граф); чистые функции рядом грузятся мгновенно.
  }, 20000);
});

describe('tickWeeklySnapshot — тик планировщика', () => {
  const kamchatkaThursdayMorning = new Date('2026-07-22T20:00:00Z'); // четверг 08:00 Камчатки

  function makeDeps(overrides: Record<string, unknown> = {}) {
    return {
      now: () => kamchatkaThursdayMorning,
      utcOffsetHours: 12,
      listSnapshotDays: vi.fn(() => [] as number[]),
      refresh: vi.fn(async () => ({ id: 'snap-fresh' })),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ...overrides,
    };
  }

  it('четверг без снимка: дёргает refresh один раз и логирует снятие', async () => {
    const { tickWeeklySnapshot } = await import('./weekly-snapshot-cron.js');
    const deps = makeDeps();

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('taken');
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining('Еженедельный снимок четверга снят'));
  });

  it('снимок этого четверга уже есть: refresh не дёргается', async () => {
    const { tickWeeklySnapshot, productCalendarDay } = await import('./weekly-snapshot-cron.js');
    const nowDay = productCalendarDay(kamchatkaThursdayMorning, 12);
    const deps = makeDeps({ listSnapshotDays: vi.fn(() => [nowDay]) });

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('skipped');
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it('refresh упал в демо-фолбэк (Google недоступен): снимок не снят, предупреждение, повтор следующим тиком', async () => {
    const { tickWeeklySnapshot } = await import('./weekly-snapshot-cron.js');
    const deps = makeDeps({ refresh: vi.fn(async () => ({ id: 'demo-123' })) });

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('failed');
    expect(deps.log.warn).toHaveBeenCalledWith(expect.stringContaining('не снят'));
  });

  it('ошибка тика — лог, не падение процесса', async () => {
    const { tickWeeklySnapshot } = await import('./weekly-snapshot-cron.js');
    const deps = makeDeps({ refresh: vi.fn(async () => { throw new Error('sheets down'); }) });

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('failed');
    expect(deps.log.error).toHaveBeenCalled();
  });
});
