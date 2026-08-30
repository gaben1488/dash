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
import type { PipelineInput } from '@aemr/core';

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

const seenInputs: PipelineInput[] = [];

vi.mock('@aemr/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aemr/core')>();
  return {
    ...actual,
    runPipeline: (input: PipelineInput) => {
      seenInputs.push(input);
      return actual.runPipeline(input);
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
