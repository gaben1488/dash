/**
 * Четверг-cron еженедельного снимка (services/weekly-snapshot-cron.ts).
 *
 * Канон дня: срез отчёта — ЧЕТВЕРГ; день 0 эпохи (1970-01-01) — четверг,
 * поэтому «сегодня четверг» = номер суток % 7 === 0. Календарь продукта —
 * Камчатка (UTC+12, DST нет): на UTC-сервере «четверг Камчатки» начинается
 * в среду 12:00 UTC — граница пояса покрыта тестами отдельно.
 *
 * Второй охраняемый инвариант (Д17): снимок недели не подписывает сегодняшней
 * датой строки книг произвольной давности. Устаревший источник до вечера
 * четверга откладывает срез, вечером — снимает с честным признаком.
 */
import { describe, expect, it, vi } from 'vitest';

// Среда выставляется ДО импорта модулей: config.js читает переменные при
// первом импорте, а beforeEach выполняется уже после него — попытка
// настроить env там требовала vi.resetModules() и полной пересборки графа
// (snapshot.js → googleapis) ПЕРЕД КАЖДЫМ тестом. На 22 тестах это давало
// плавающий таймаут под нагрузкой: тест падал не из-за логики, а из-за
// того, что параллельные пакеты заняли процессор. Один импорт на файл —
// и файл проходит за секунды.
process.env.NODE_ENV = 'test';
process.env.AEMR_API_KEY = '';
process.env.SQLITE_PATH = ':memory:';
process.env.LOG_LEVEL = 'silent';

const {
  shouldTakeWeeklySnapshot,
  productCalendarDay,
  productCalendarHour,
  collectSnapshotDays,
  assessSourceFreshness,
  describeSourceFreshness,
  tickWeeklySnapshot,
} = await import('./weekly-snapshot-cron.js');
const { dayNumberOf } = await import('@aemr/shared');
const { saveSnapshot } = await import('./snapshot.js');

/** Четверг-фикстура 23.07.2026; сверка % 7 === 0 — в первом тесте. */
const THURSDAY_ISO = '2026-07-23';

describe('shouldTakeWeeklySnapshot — правило четверга', () => {
  it('четверг без снимка этого дня → снимать', async () => {
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
    const thursday = dayNumberOf(THURSDAY_ISO)!;
    expect(shouldTakeWeeklySnapshot(thursday, [thursday])).toBe(false);
  });

  it('не-четверг → не снимать даже без единого снимка', async () => {
    const thursday = dayNumberOf(THURSDAY_ISO)!;
    for (const offset of [1, 2, 3, 4, 5, 6]) {
      expect(shouldTakeWeeklySnapshot(thursday + offset, [])).toBe(false);
    }
  });
});

describe('productCalendarDay — календарь Камчатки на UTC-сервере', () => {
  it('UTC-среда 16:00 — уже четверг 04:00 Камчатки → снимать', async () => {
    const nowDay = productCalendarDay(new Date('2026-07-22T16:00:00Z'), 12);
    expect(nowDay).toBe(dayNumberOf(THURSDAY_ISO)!);
    expect(shouldTakeWeeklySnapshot(nowDay, [])).toBe(true);
  });

  it('UTC-четверг 13:00 — уже пятница 01:00 Камчатки → не снимать', async () => {
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

describe('productCalendarHour — час продуктового дня', () => {
  it('UTC-полдень и вечер пересчитываются в часы Камчатки', async () => {
    expect(productCalendarHour(new Date('2026-07-22T20:00:00Z'), 12)).toBe(8);
    expect(productCalendarHour(new Date('2026-07-23T06:00:00Z'), 12)).toBe(18);
    // Переход через полночь пояса: UTC-полдень — уже полночь следующего дня.
    expect(productCalendarHour(new Date('2026-07-22T12:00:00Z'), 12)).toBe(0);
  });
});

describe('assessSourceFreshness — свежесть книг ГРБС (Д17)', () => {
  const NOW = new Date('2026-07-22T20:00:00Z');

  /** Запись чтения книги: сдвиг в часах назад от NOW. */
  function read(hoursAgo: number, error?: string) {
    return {
      loadedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
      rowCount: 100,
      sheetName: 'УЭР',
      ...(error ? { error } : {}),
    };
  }

  it('книги не читались ни разу → «неизвестно», возраст null (а не ноль)', async () => {
    const f = assessSourceFreshness(NOW, {});
    expect(f.status).toBe('unknown');
    // Пустое множество чтений не даёт возраста: ноль здесь означал бы
    // «прочитано только что» — ровно та ложь, против которой гейт.
    expect(f.ageHours).toBeNull();
    expect(f.readAt).toBeNull();
  });

  it('все книги прочитаны час назад → свежо', async () => {
    const f = assessSourceFreshness(NOW, { 'УЭР': read(1), 'УО': read(2) });
    expect(f.status).toBe('fresh');
    expect(f.readDepts).toBe(2);
    expect(f.failedDepts).toEqual([]);
    // Возраст — по самой отставшей книге, а не по последней.
    expect(f.ageHours).toBeCloseTo(2, 5);
  });

  it('одна книга отстала на 40 часов → устарело, возраст считается по ней', async () => {
    const f = assessSourceFreshness(NOW, { 'УЭР': read(1), 'УКСиМП': read(40) });
    expect(f.status).toBe('stale');
    expect(f.ageHours).toBeCloseTo(40, 5);
    expect(f.readAt).toBe(read(40).loadedAt);
  });

  it('книга с ошибкой загрузки → устарело, даже когда остальные свежие', async () => {
    const f = assessSourceFreshness(NOW, { 'УЭР': read(1), 'УКСиМП': read(1, 'IMPORTRANGE #REF!') });
    expect(f.status).toBe('stale');
    expect(f.failedDepts).toEqual(['УКСиМП']);
    expect(f.readDepts).toBe(1);
  });

  it('нечитаемая отметка времени за чтение не считается', async () => {
    const f = assessSourceFreshness(NOW, {
      'УЭР': { loadedAt: 'позавчера', rowCount: 100, sheetName: 'УЭР' },
    });
    expect(f.status).toBe('unknown');
    expect(f.failedDepts).toEqual(['УЭР']);
  });

  it('описание свежести называет числа: сколько книг, когда и насколько отстают', async () => {
    const text = describeSourceFreshness(assessSourceFreshness(NOW, { 'УЭР': read(40.5) }));
    expect(text).toContain('40,5 ч назад');
    expect(text).toContain(read(40.5).loadedAt);
  });
});

describe('tickWeeklySnapshot — тик планировщика', () => {
  const kamchatkaThursdayMorning = new Date('2026-07-22T20:00:00Z'); // четверг 08:00 Камчатки
  const kamchatkaThursdayEvening = new Date('2026-07-23T06:00:00Z'); // четверг 18:00 Камчатки

  /** Свежий источник по умолчанию: книги прочитаны за час до тика. */
  function freshMeta(now: Date) {
    return {
      'УЭР': {
        loadedAt: new Date(now.getTime() - 3_600_000).toISOString(),
        rowCount: 100,
        sheetName: 'УЭР',
      },
    };
  }

  /** Устаревший источник: книги прочитаны три недели назад (типичный прод). */
  function staleMeta(now: Date) {
    return {
      'УЭР': {
        loadedAt: new Date(now.getTime() - 21 * 24 * 3_600_000).toISOString(),
        rowCount: 100,
        sheetName: 'УЭР',
      },
    };
  }

  function makeDeps(overrides: Record<string, unknown> = {}) {
    return {
      now: () => kamchatkaThursdayMorning,
      utcOffsetHours: 12,
      listSnapshotDays: vi.fn(() => [] as number[]),
      refresh: vi.fn(async () => ({ id: 'snap-fresh' })),
      sourceMeta: vi.fn(() => freshMeta(kamchatkaThursdayMorning)),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ...overrides,
    };
  }

  it('четверг без снимка: дёргает refresh один раз и логирует снятие', async () => {
    const deps = makeDeps();

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('taken');
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining('Еженедельный снимок четверга снят'));
  });

  it('снимок этого четверга уже есть: refresh не дёргается', async () => {
    const nowDay = productCalendarDay(kamchatkaThursdayMorning, 12);
    const deps = makeDeps({ listSnapshotDays: vi.fn(() => [nowDay]) });

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('skipped');
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it('refresh упал в демо-фолбэк (Google недоступен): снимок не снят, предупреждение, повтор следующим тиком', async () => {
    const deps = makeDeps({ refresh: vi.fn(async () => ({ id: 'demo-123' })) });

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('failed');
    expect(deps.log.warn).toHaveBeenCalledWith(expect.stringContaining('не снят'));
  });

  it('ошибка тика — лог, не падение процесса', async () => {
    const deps = makeDeps({ refresh: vi.fn(async () => { throw new Error('sheets down'); }) });

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('failed');
    expect(deps.log.error).toHaveBeenCalled();
  });

  it('утро четверга, книги трёхнедельной давности: снимок отложен, refresh не дёргается (Д17)', async () => {
    const deps = makeDeps({ sourceMeta: vi.fn(() => staleMeta(kamchatkaThursdayMorning)) });

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('deferred');
    // Главное: устаревшие строки НЕ уходят в архив недели молча.
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.log.warn).toHaveBeenCalledWith(expect.stringContaining('отложен'));
    expect(deps.log.warn).toHaveBeenCalledWith(expect.stringContaining('504,0 ч назад'));
  });

  it('книги не читались ни разу: тоже отложить, свежесть неизвестна', async () => {
    const deps = makeDeps({ sourceMeta: vi.fn(() => ({})) });

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('deferred');
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.log.warn).toHaveBeenCalledWith(expect.stringContaining('свежесть источника неизвестна'));
  });

  it('вечер четверга, источник так и не обновился: снимок снят с честным признаком', async () => {
    const deps = makeDeps({
      now: () => kamchatkaThursdayEvening,
      sourceMeta: vi.fn(() => staleMeta(kamchatkaThursdayEvening)),
    });

    // Неделю терять нельзя — срез снимается, но признак отличается от 'taken'.
    await expect(tickWeeklySnapshot(deps)).resolves.toBe('taken-stale');
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(deps.log.warn).toHaveBeenCalledWith(expect.stringContaining('ПО УСТАРЕВШЕМУ ИСТОЧНИКУ'));
    expect(deps.log.info).not.toHaveBeenCalled();
  });

  it('вечер четверга, источник свежий: обычное снятие', async () => {
    const deps = makeDeps({
      now: () => kamchatkaThursdayEvening,
      sourceMeta: vi.fn(() => freshMeta(kamchatkaThursdayEvening)),
    });

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('taken');
    expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining('Источник свеж'));
  });

  it('вечер четверга, устаревший источник и демо-фолбэк: снимка нет, признак не «снят»', async () => {
    const deps = makeDeps({
      now: () => kamchatkaThursdayEvening,
      sourceMeta: vi.fn(() => staleMeta(kamchatkaThursdayEvening)),
      refresh: vi.fn(async () => ({ id: 'demo-123' })),
    });

    await expect(tickWeeklySnapshot(deps)).resolves.toBe('failed');
  });
});
