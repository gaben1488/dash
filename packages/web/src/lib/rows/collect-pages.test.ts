/**
 * Тесты сборщика страниц. Главный из них — «догружает все страницы»:
 * именно его отсутствие стоило 1157 невидимых строк УО.
 */
import { describe, it, expect } from 'vitest';
import { collectAllPages, type PagedResponse } from './collect-pages';

/** Источник страниц по образцу /api/rows/:dept (1000 строк на страницу). */
function pagedSource(total: number, perPage = 1000) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const calls: number[] = [];
  const fetchPage = (page: number): Promise<PagedResponse<number>> => {
    calls.push(page);
    const start = (page - 1) * perPage;
    const rows = Array.from({ length: Math.min(perPage, total - start) }, (_, i) => start + i);
    return Promise.resolve({ rows, pagination: { totalPages } });
  };
  return { fetchPage, calls };
}

describe('collectAllPages — реестр целиком, а не первая страница', () => {
  it('УО: 2157 строк собираются со всех трёх страниц', async () => {
    const { fetchPage, calls } = pagedSource(2157);
    const rows = await collectAllPages(fetchPage);
    expect(rows).toHaveLength(2157);
    expect(calls.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    // Порядок сохранён: строки идут подряд, страницы не перемешаны.
    expect(rows[0]).toBe(0);
    expect(rows[2156]).toBe(2156);
  });

  it('одна страница — второго запроса нет', async () => {
    const { fetchPage, calls } = pagedSource(42);
    expect(await collectAllPages(fetchPage)).toHaveLength(42);
    expect(calls).toEqual([1]);
  });

  it('отказ одной страницы не рушит выборку — остальные показываются', async () => {
    const fetchPage = (page: number): Promise<PagedResponse<number>> =>
      page === 2
        ? Promise.reject(new Error('сеть'))
        : Promise.resolve({ rows: [page], pagination: { totalPages: 3 } });
    expect(await collectAllPages(fetchPage)).toEqual([1, 3]);
  });

  it('отказ первой страницы — пустой список, не исключение наружу', async () => {
    await expect(collectAllPages(() => Promise.reject(new Error('503')))).resolves.toEqual([]);
  });

  it('старая форма ответа (голый массив) поддержана как есть', async () => {
    expect(await collectAllPages(() => Promise.resolve([7, 8]))).toEqual([7, 8]);
  });
});
