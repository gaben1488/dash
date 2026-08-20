/**
 * Стражи общего читателя журнала правок.
 *
 * Охраняются три обещания:
 *   1. Два РАЗНЫХ потребителя (журнал правок и провенанс) за одно окно берут
 *      одно и то же чтение книги, а не ходят к Google каждый за своим.
 *   2. Одновременные запросы склеиваются в одно обращение: окно кэша от шквала
 *      не спасает — при пустом окне пять параллельных запросов честно уходят к
 *      источнику все пять раз.
 *   3. Отказ книги НЕ кэшируется: ожившая через минуту книга читается сразу.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSheetDataFromSpreadsheet = vi.fn();

vi.mock('./google-sheets.js', () => ({
  getSheetDataFromSpreadsheet,
}));

const { readChangelogRows, resetChangelogSource, changelogReadAt, CHANGELOG_CACHE_TTL_MS } =
  await import('./changelog-source.js');

beforeEach(() => {
  getSheetDataFromSpreadsheet.mockReset();
  resetChangelogSource();
});

describe('окно чтения', () => {
  it('второй читатель за то же окно не идёт к источнику повторно', async () => {
    getSheetDataFromSpreadsheet.mockResolvedValue([['A1', 'было', 'стало']]);

    const first = await readChangelogRows('УО', 'book-uo', 1_000);
    const second = await readChangelogRows('УО', 'book-uo', 2_000);

    expect(second).toBe(first);
    expect(getSheetDataFromSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it('по истечении окна книга перечитывается', async () => {
    getSheetDataFromSpreadsheet.mockResolvedValue([['A1']]);

    await readChangelogRows('УО', 'book-uo', 1_000);
    await readChangelogRows('УО', 'book-uo', 1_000 + CHANGELOG_CACHE_TTL_MS);

    expect(getSheetDataFromSpreadsheet).toHaveBeenCalledTimes(2);
  });

  it('окно покнижное: соседняя книга своего чтения не теряет', async () => {
    getSheetDataFromSpreadsheet.mockResolvedValue([['A1']]);

    await readChangelogRows('УО', 'book-uo', 1_000);
    await readChangelogRows('УИО', 'book-uio', 1_000);

    expect(getSheetDataFromSpreadsheet).toHaveBeenCalledTimes(2);
    expect(getSheetDataFromSpreadsheet).toHaveBeenCalledWith('book-uo', '_ChangeLog');
    expect(getSheetDataFromSpreadsheet).toHaveBeenCalledWith('book-uio', '_ChangeLog');
  });

  it('момент чтения виден снаружи — по нему судят о свежести', async () => {
    getSheetDataFromSpreadsheet.mockResolvedValue([['A1']]);
    expect(changelogReadAt('УО')).toBeNull();

    await readChangelogRows('УО', 'book-uo', 7_000);

    expect(changelogReadAt('УО')).toBe(7_000);
  });
});

describe('одновременные запросы', () => {
  it('пять параллельных читателей дают ОДНО обращение к книге', async () => {
    let release: (rows: unknown[][]) => void = () => {};
    getSheetDataFromSpreadsheet.mockImplementation(
      () => new Promise<unknown[][]>((resolve) => { release = resolve; }),
    );

    const waiting = Promise.all(
      Array.from({ length: 5 }, () => readChangelogRows('УО', 'book-uo', 1_000)),
    );
    release([['A1']]);
    const results = await waiting;

    expect(getSheetDataFromSpreadsheet).toHaveBeenCalledTimes(1);
    for (const rows of results) expect(rows).toEqual([['A1']]);
  });
});

describe('отказ книги', () => {
  it('не кэшируется: следующий запрос снова спрашивает источник', async () => {
    getSheetDataFromSpreadsheet.mockRejectedValueOnce(new Error('источник молчит'));
    getSheetDataFromSpreadsheet.mockResolvedValueOnce([['A1']]);

    await expect(readChangelogRows('УО', 'book-uo', 1_000)).rejects.toThrow('источник молчит');
    await expect(readChangelogRows('УО', 'book-uo', 1_100)).resolves.toEqual([['A1']]);

    expect(getSheetDataFromSpreadsheet).toHaveBeenCalledTimes(2);
    expect(changelogReadAt('УО')).toBe(1_100);
  });

  it('отказ достаётся всем, кто ждал того же обращения', async () => {
    getSheetDataFromSpreadsheet.mockRejectedValue(new Error('слишком часто'));

    const both = await Promise.allSettled([
      readChangelogRows('УО', 'book-uo', 1_000),
      readChangelogRows('УО', 'book-uo', 1_000),
    ]);

    expect(both.every((r) => r.status === 'rejected')).toBe(true);
    expect(getSheetDataFromSpreadsheet).toHaveBeenCalledTimes(1);
  });
});
