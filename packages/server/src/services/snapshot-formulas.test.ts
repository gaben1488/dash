/**
 * Страж ПОСЛЕДНЕГО ШВА: формулы книги доезжают до ядра — и только когда их
 * читали (решение владельца §22 п.7).
 *
 * Между чтением формул (services/google-sheets.ts) и разбором целостности
 * (core/pipeline/formula-integrity.ts) стоит сборка снимка: она складывает
 * вход конвейера. Шов тихий — если поле `sheetFormulas` не положить, ядро
 * промолчит, и молчание будет неотличимо от «дефектов нет». Здесь оно
 * закреплено с обеих сторон:
 *
 *   · книга с прочитанными формулами — поле есть и несёт её сетку;
 *   · книга без чтения формул — поля НЕТ ВОВСЕ (не пустой объект): пустой
 *     объект в переписке читался бы как «формулы читали, и они чисты».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotCalculationInput } from './snapshot-calculation.js';

const ORIGINAL_ENV = { ...process.env };

const batchGetCells = vi.fn(async () => []);
const batchGetFormulas = vi.fn(async () => []);
const getSheetData = vi.fn(async () => [['строка']] as unknown[][]);
const batchGetSheetValues = vi.fn(async (names: readonly string[]) =>
  Object.fromEntries(names.map((n) => [n, [['строка']] as unknown[][]])),
);

vi.mock('./google-sheets.js', () => ({
  batchGetCells,
  batchGetFormulas,
  batchGetSheetValues,
  getSheetData,
  fetchSHDYUSheet: vi.fn(async () => ({ values: [], formulas: [], sheetName: 'monthly' })),
}));

const seenInputs: SnapshotCalculationInput[] = [];

vi.mock('./snapshot-calculation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./snapshot-calculation.js')>();
  return {
    ...actual,
    runSnapshotCalculation: (input: SnapshotCalculationInput) => {
      seenInputs.push(input);
      return actual.runSnapshotCalculation(input);
    },
  };
});

/** Сетка формул книги: формулы в K и Y четвёртой строки листа. */
function formulaGrid(): unknown[][] {
  const grid: unknown[][] = [];
  grid[3] = [];
  grid[3][10] = '=H4+I4+J4';
  grid[3][24] = '=V4+W4+X4';
  return grid;
}

const bookValues: unknown[][] = [
  ['шапка'], ['шапка'], ['шапка'], [1, 'УО АЕМР'],
];

beforeEach(() => {
  seenInputs.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    AEMR_API_KEY: '',
    SQLITE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
    GOOGLE_PRIVATE_KEY: '',
    GOOGLE_API_KEY: '',
  };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('формулы книг во входе конвейера', () => {
  it('clears source provenance after a confirmed edit without changing selected inputs or read time', async () => {
    const { setDeptSheetCache, getDeptSheetCache, setDeptLoadMeta, getDeptLoadMeta, patchDeptSheetCacheCell } = await import('./snapshot.js');
    const sourceRevision = `SRC-${'a'.repeat(64)}`;
    const loadedAt = '2026-10-20T01:00:00Z';
    setDeptSheetCache({ УО: { values: bookValues, formulas: [], sheetName: 'ВСЕ', sourceRevision, sourceVersion: '42' } });
    setDeptLoadMeta({ УО: { loadedAt, rowCount: 4, sheetName: 'ВСЕ', sourceRevision } });
    const selected = getDeptSheetCache()['УО'];
    const selectedMeta = getDeptLoadMeta()['УО'];
    expect(patchDeptSheetCacheCell('УО', 4, 1, 'updated')).toBe(true);
    expect(getDeptSheetCache()['УО'].sourceRevision).toBeUndefined();
    expect(getDeptSheetCache()['УО'].sourceVersion).toBeUndefined();
    expect(getDeptLoadMeta()['УО']).toEqual({ loadedAt, rowCount: 4, sheetName: 'ВСЕ' });
    expect(selected.sourceRevision).toBe(sourceRevision);
    expect(selected.values[3][1]).toBe('УО АЕМР');
    expect(selectedMeta.sourceRevision).toBe(sourceRevision);
  });

  it('marks a calculation interrupted by a confirmed row edit as refreshing', async () => {
    const { getSnapshot, setDeptSheetCache, patchDeptSheetCacheCell } = await import('./snapshot.js');
    setDeptSheetCache({ УО: { values: bookValues, formulas: formulaGrid(), formulasRead: true, sheetName: 'ВСЕ' } });
    batchGetCells.mockImplementationOnce(async () => {
      expect(patchDeptSheetCacheCell('УО', 4, 1, 'updated')).toBe(true);
      return [];
    });
    const snapshot = await getSnapshot(true);
    expect(seenInputs[0].sheetRows['УО']).toEqual(bookValues);
    expect(snapshot.metadata.readModel?.state).toBe('refreshing');
    await getSnapshot();
    expect(seenInputs).toHaveLength(2);
    expect(seenInputs[1].sheetRows['УО'][3][1]).toBe('updated');
  }, 30_000);

  it('keeps the selected books, formulas and cached summary when sources refresh during acquisition', async () => {
    const { SVOD_SHEET_NAME } = await import('@aemr/shared');
    const { getSnapshot, setDeptSheetCache, setSvodGridCache, getDeptSheetCache } = await import('./snapshot.js');
    const originalSummary = [['before']];
    setSvodGridCache(originalSummary);
    setDeptSheetCache({ УО: { values: bookValues, formulas: formulaGrid(), formulasRead: true, sheetName: 'ВСЕ' } });
    batchGetCells.mockImplementationOnce(async () => {
      setSvodGridCache([['after']]);
      setDeptSheetCache({ УО: { values: [[], [], [], [2, 'later']], formulas: [['=0']], formulasRead: true, sheetName: 'ВСЕ' } });
      return [];
    });
    await getSnapshot(true);
    expect(seenInputs[0].sheetRows['УО']).toEqual(bookValues);
    expect(seenInputs[0].sheetFormulas?.['УО']).toEqual(formulaGrid());
    expect(seenInputs[0].sheetRows[SVOD_SHEET_NAME]).toEqual(originalSummary);
    expect(getDeptSheetCache()['УО'].values[3][0]).toBe(2);
  }, 30_000);

  it('прочитанные формулы книги доезжают до ядра', async () => {
    const { getSnapshot, setDeptSheetCache } = await import('./snapshot.js');
    setDeptSheetCache(
      {
        'УО': {
          values: bookValues,
          formulas: formulaGrid(),
          sheetName: 'ВСЕ',
          startRow: 1,
          formulasRead: true,
        },
      },
      [],
    );
    await getSnapshot(true);

    expect(seenInputs).toHaveLength(1);
    const formulas = seenInputs[0].sheetFormulas;
    expect(formulas).toBeDefined();
    expect(formulas?.['УО']?.[3]?.[10]).toBe('=H4+I4+J4');
  }, 30_000);


  it('keeps checked formulas through a values-only read of the identical provider revision', async () => {
    const { getSnapshot, setDeptSheetCache, getDeptSheetCache } = await import('./snapshot.js');
    const sameSource = { providerId: 'file-uo', sourceVersion: 'rev-42', sheetName: 'ВСЕ' };
    setDeptSheetCache({ УО: {
      ...sameSource, values: bookValues, formulas: formulaGrid(), formulasRead: true,
    } });
    setDeptSheetCache({ УО: {
      ...sameSource, values: bookValues.map(row => row.slice()), formulas: [], formulasRead: false,
    } });
    expect(getDeptSheetCache()['УО']).toMatchObject({ formulasRead: false, retainedFormulas: true });
    await getSnapshot(true);
    expect(seenInputs[0].sheetFormulas?.['УО']).toEqual(formulaGrid());
  }, 30_000);

  it('never reuses checked formulas after changing values, revision, tab, provider or losing proof of revision', async () => {
    const { setDeptSheetCache, getDeptSheetCache } = await import('./snapshot.js');
    const old = { providerId: 'file-uo', sourceVersion: 'rev-42', sheetName: 'ВСЕ',
      values: bookValues, formulas: formulaGrid(), formulasRead: true };
    const changed = [
      { values: [[], [], [], [1, 'другая закупка']] },
      { sourceVersion: 'rev-43' },
      { sourceVersion: undefined },
      { sheetName: 'Другая вкладка' },
      { providerId: 'another-provider' },
    ];
    for (const difference of changed) {
      setDeptSheetCache({ УО: old });
      setDeptSheetCache({ УО: {
        ...old, ...difference, values: difference.values ?? bookValues,
        formulas: [], formulasRead: false,
      } });
      const current = getDeptSheetCache()['УО'];
      expect(current.retainedFormulas).toBeUndefined();
      expect(current.formulas).toEqual([]);
    }
  });

  it('книга без чтения формул поля не создаёт вовсе', async () => {
    const { getSnapshot, setDeptSheetCache } = await import('./snapshot.js');
    setDeptSheetCache(
      { 'УО': { values: bookValues, formulas: [], sheetName: 'ВСЕ' } },
      [],
    );
    await getSnapshot(true);

    expect(seenInputs).toHaveLength(1);
    // Ключа НЕТ — «не читали». Пустой объект здесь был бы ложью о полноте.
    expect(seenInputs[0].sheetFormulas).toBeUndefined();
  }, 30_000);
});
