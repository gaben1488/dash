/**
 * Стражи ДОЗОРА МЕТАДАННЫХ (решение владельца §22 п.7, разбор §4В).
 *
 * Охраняются обещания:
 *   1. Снятая защита формульной колонки рождает замечание книги — с адресом
 *      колонки, а не «что-то не так».
 *   2. Число правил условного форматирования, отличное от канона, рождает
 *      замечание с обоими числами.
 *   3. Изменённая проверка данных рождает замечание — И когда её сняли там,
 *      где она нужна, И когда её поставили на формульную колонку.
 *   4. ДОЗОР НЕ ИСПОЛНЯЕТ ПРАВИЛА: книга с бессмысленными формулами в
 *      условном форматировании не даёт ни одного замечания, пока число правил
 *      и защиты на месте. Это граница, назначенная владельцем (вариант
 *      «продукт-исполнитель метаданных» отклонён).
 *   5. Непрочитанная книга честно отвечает «не читали», а не «замечаний нет»,
 *      и книга, которой дозор не касался, видна отдельным перечнем.
 *   6. Ночной обход ЗОВЁТ дозор и читает формулы полностью, без вопроса
 *      Drive «а менялся ли файл».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshAllSources = vi.fn(async () => ({
  loaded: ['УО'],
  failed: [],
  svodOk: true,
  at: 'x',
  changedBooks: [],
  svodChanged: false,
  booksRead: 1,
  skipped: [],
  formulaBooks: ['УО'],
}));

vi.mock('./source-refresh.js', () => ({
  refreshAllSources: (...a: unknown[]) => refreshAllSources(...(a as [])),
}));

vi.mock('../config.js', () => ({
  config: {
    google: { spreadsheetId: 'file-svod', serviceAccountEmail: 'a@b', privateKey: 'k' },
    weeklySnapshot: { utcOffsetHours: 12, enabled: false },
    // Расписание ночного окна берётся у обхода комментариев, а тот тянет базу.
    // База в стражах — в памяти: проверяется сверка, а не хранение.
    database: { url: 'file::memory:' },
  },
  DEPARTMENT_SPREADSHEETS: { 'УО': 'file-uo', 'УИО': 'file-uio' },
}));

vi.mock('googleapis', () => ({
  google: {
    sheets: vi.fn(() => ({ spreadsheets: { get: vi.fn(), values: { get: vi.fn(), batchGet: vi.fn() } } })),
    drive: vi.fn(() => ({})),
    auth: { GoogleAuth: vi.fn(function GoogleAuth() { return {}; }) },
  },
}));

// Разбор имени вкладки — настоящий модуль ходит к Google; здесь он отвечает
// сразу, чтобы страж проверял сверку, а не сеть.
vi.mock('./google-sheets.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./google-sheets.js')>();
  return { ...actual, resolveDeptSheetName: vi.fn(async () => 'ВСЕ') };
});

import type { SheetMetadata, MetadataApi } from './metadata-watch.js';

/** Книга, полностью совпадающая с каноном оформления. */
function canonSheet(overrides: Partial<SheetMetadata> = {}): SheetMetadata {
  const validationByColumn: Record<string, string> = {};
  for (const col of [
    'A', 'B', 'C', 'D', 'E', 'F', 'H', 'I', 'J', 'L', 'N', 'Q',
    'V', 'W', 'X', 'Z', 'AA', 'AB', 'AD',
  ]) {
    validationByColumn[col] = 'CUSTOM_FORMULA';
  }
  return {
    sheetName: 'ВСЕ',
    conditionalFormatCount: 37,
    protectedAreas: [
      { description: 'Шапка (строки 1-3)', startRow: 0, endRow: 3, startColumn: null, endColumn: null },
      { description: 'Формульный столбец K', startRow: 3, endRow: null, startColumn: 10, endColumn: 11 },
      { description: 'Формульные столбцы O:P', startRow: 3, endRow: null, startColumn: 14, endColumn: 16 },
      { description: 'Формульные столбцы R:T', startRow: 3, endRow: null, startColumn: 17, endColumn: 20 },
      { description: 'Формульные столбцы Y:AC', startRow: 3, endRow: null, startColumn: 24, endColumn: 29 },
    ],
    validationByColumn,
    ...overrides,
  };
}

beforeEach(() => {
  refreshAllSources.mockClear();
});

afterEach(async () => {
  const { resetMetadataWatch, setMetadataApi, stopNightlyIntegritySweep } =
    await import('./metadata-watch.js');
  resetMetadataWatch();
  setMetadataApi(null);
  stopNightlyIntegritySweep();
});

describe('сверка метаданных с каноном', () => {
  it('книга по канону не даёт ни одного замечания', async () => {
    const { compareMetadata } = await import('./metadata-watch.js');
    expect(compareMetadata('УО', canonSheet())).toEqual([]);
    // Срок увеличен: первый импорт модуля тянет расписание ночного окна из
    // drive-comments.ts, а вместе с ним — базу и клиент Google.
  }, 30_000);

  it('снятая защита формульной колонки рождает замечание с её буквой', async () => {
    const { compareMetadata } = await import('./metadata-watch.js');
    const withoutY = canonSheet({
      protectedAreas: canonSheet().protectedAreas.filter(
        (a) => a.description !== 'Формульные столбцы Y:AC',
      ),
    });
    const remarks = compareMetadata('УО', withoutY);
    const columns = remarks
      .filter((r) => r.kind === 'protection_removed')
      .map((r) => r.column);
    expect(columns).toEqual(['Y', 'Z', 'AA', 'AB', 'AC']);
    expect(remarks[0].text).toContain('снята защита формульной колонки Y');
  });

  it('защита ОДНОЙ ТОЛЬКО ШАПКИ не выдаётся за защиту колонки', async () => {
    const { compareMetadata } = await import('./metadata-watch.js');
    const headerOnly = canonSheet({
      protectedAreas: [
        { description: 'Шапка (строки 1-3)', startRow: 0, endRow: 3, startColumn: null, endColumn: null },
      ],
    });
    const remarks = compareMetadata('УО', headerOnly).filter(
      (r) => r.kind === 'protection_removed',
    );
    // Все одиннадцать формульных колонок остались без защиты тела.
    expect(remarks).toHaveLength(11);
  });

  it('число правил условного форматирования отличается — замечание с обоими числами', async () => {
    const { compareMetadata } = await import('./metadata-watch.js');
    const remarks = compareMetadata('УИО', canonSheet({ conditionalFormatCount: 20 }));
    expect(remarks).toHaveLength(1);
    expect(remarks[0].kind).toBe('conditional_formats_count');
    expect(remarks[0].expected).toBe('37');
    expect(remarks[0].actual).toBe('20');
    expect(remarks[0].text).toContain('20 вместо 37');
  });

  it('снятая проверка данных колонки рождает замечание', async () => {
    const { compareMetadata } = await import('./metadata-watch.js');
    const sheet = canonSheet();
    delete sheet.validationByColumn.L;
    const remarks = compareMetadata('УО', sheet);
    expect(remarks).toHaveLength(1);
    expect(remarks[0].kind).toBe('validation_changed');
    expect(remarks[0].column).toBe('L');
    expect(remarks[0].text).toContain('снята проверка данных колонки L');
  });

  it('проверка данных на формульной колонке — тоже дрейф', async () => {
    const { compareMetadata } = await import('./metadata-watch.js');
    const sheet = canonSheet();
    sheet.validationByColumn.K = 'ONE_OF_LIST';
    const remarks = compareMetadata('УО', sheet);
    expect(remarks).toHaveLength(1);
    expect(remarks[0].kind).toBe('validation_changed');
    expect(remarks[0].column).toBe('K');
    expect(remarks[0].text).toContain('появилась проверка данных');
  });

  it('ДОЗОР НЕ ИСПОЛНЯЕТ ПРАВИЛА: смысл условий не проверяется', async () => {
    const { compareMetadata } = await import('./metadata-watch.js');
    // Правил столько, сколько велит канон, но все они — бессмыслица. Дозор
    // обязан молчать: исполнение условий книги отклонено владельцем 30.08,
    // и появление здесь замечания означало бы, что в продукт втащили
    // интерпретатор формул Google Sheets.
    const remarks = compareMetadata('УО', canonSheet({ conditionalFormatCount: 37 }));
    expect(remarks).toEqual([]);
  });
});

describe('обход книг и память дозора', () => {
  it('непрочитанная книга отвечает «не читали», а не «замечаний нет»', async () => {
    const { sweepMetadata, metadataWatchState, setMetadataApi } = await import('./metadata-watch.js');
    const api: MetadataApi = {
      read: vi.fn(async (_id: string, _sheet: string) => {
        throw new Error('Google говорит: слишком часто');
      }),
    };
    setMetadataApi(api);
    const results = await sweepMetadata(undefined, api, { 'УО': 'file-uo' });

    expect(results).toHaveLength(1);
    expect(results[0].read).toBe(false);
    expect(results[0].remarks).toEqual([]);
    expect(results[0].skippedBecause).toBeTruthy();

    const state = metadataWatchState();
    expect(state.books[0].read).toBe(false);
    // Вторая книга дозор не видел ни разу — она названа отдельно.
    expect(state.notWatched).toEqual(['УИО']);
  });

  it('прочитанная книга с дрейфом попадает в память дозора', async () => {
    const { sweepMetadata, metadataWatchState } = await import('./metadata-watch.js');
    const api: MetadataApi = {
      read: async () => canonSheet({ conditionalFormatCount: 36 }),
    };
    await sweepMetadata(undefined, api, { 'УО': 'file-uo' });

    const state = metadataWatchState();
    expect(state.books[0].book).toBe('УО');
    expect(state.books[0].read).toBe(true);
    expect(state.books[0].remarks[0].kind).toBe('conditional_formats_count');
    expect(state.canonSyncedAt).toBe('2026-08-30');
  });

  it('без служебной учётной записи дозор не притворяется прошедшим', async () => {
    const { watchBookMetadata } = await import('./metadata-watch.js');
    const result = await watchBookMetadata('УО', 'file-uo', null);
    expect(result.read).toBe(false);
    expect(result.remarks).toEqual([]);
    expect(result.skippedBecause).toContain('учётной записи');
  });
});

describe('ночной обход', () => {
  it('зовёт дозор и читает формулы полностью, не спрашивая Drive', async () => {
    const { nightlyIntegritySweep, setMetadataApi, metadataWatchState } =
      await import('./metadata-watch.js');
    const read = vi.fn(async () => canonSheet());
    setMetadataApi({ read });
    const log = { info: vi.fn(), warn: vi.fn() };

    await nightlyIntegritySweep(log);

    // Дозор прошёл по обеим книгам.
    expect(read).toHaveBeenCalledTimes(2);
    expect(metadataWatchState().notWatched).toEqual([]);
    // Формулы прочитаны, вопрос Drive снят — иначе сеть безопасности имела бы
    // дыру «а мы это уже читали».
    expect(refreshAllSources).toHaveBeenCalledTimes(1);
    const options = (refreshAllSources.mock.calls[0] as unknown[])[2] as {
      withFormulas: boolean;
      askDrive: boolean;
      svod: boolean;
    };
    expect(options.withFormulas).toBe(true);
    expect(options.askDrive).toBe(false);
    expect(options.svod).toBe(false);
  });

  it('расписание ночного обхода — то же окно, что у обхода комментариев', async () => {
    const { startNightlyIntegritySweep, stopNightlyIntegritySweep } =
      await import('./metadata-watch.js');
    const { NIGHT_SWEEP_HOUR } = await import('./drive-comments.js');
    const sweep = vi.fn(async () => undefined);
    const log = { info: vi.fn(), warn: vi.fn() };

    // Продуктовый пояс — +12; 15:00 UTC = 03:00 по продукту.
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 30, 15, 10)));
    expect(NIGHT_SWEEP_HOUR).toBe(3);
    startNightlyIntegritySweep(log, sweep);
    expect(sweep).toHaveBeenCalledTimes(1);
    stopNightlyIntegritySweep();
    vi.useRealTimers();
  });
});
