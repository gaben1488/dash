/**
 * collect-pages.ts — сбор ВСЕХ страниц постраничного ответа сервера.
 *
 * Зачем отдельный дом: страница «Реестр» грузила ровно одну страницу в 1000
 * строк, а у УО в книге 2157 строк за 2026 год — 1157 из них молча не
 * доезжали до экрана, и подпись «Показано 25 из 1000» выглядела правдой.
 * Это и была жалоба сотрудницы 27.07.2026: «не понимаю, по какому принципу
 * показывает то или иное количество строк».
 *
 * Функция чистая: источник страниц приходит параметром, поэтому поведение
 * (сколько запросов, что при отказе одной страницы) проверяется тестом без
 * сети и без моков модуля api.
 */

/** Ответ роута /api/rows/:dept — только то, что нужно сборщику. */
export interface PagedResponse<T> {
  rows?: T[];
  pagination?: { totalPages?: number };
}

/** Загрузчик одной страницы (1-based номер), как его отдаёт api.getRows. */
export type PageFetcher<T> = (page: number) => Promise<PagedResponse<T> | T[]>;

/** Дополнительные рычаги сборщика. */
export interface CollectPagesOptions {
  /**
   * Зов на КАЖДУЮ проглоченную страницу (первую или хвостовую). Сборщик
   * по-прежнему не роняет выборку, но молчать об утере не имеет права:
   * покрытию периодов важно знать, что книга доехала НЕ целиком — иначе
   * отказ семи книг из восьми выглядел бы как «пустой год» (находка 28.08).
   */
  onPageError?: (page: number, error: unknown) => void;
}

/**
 * Собрать все строки: первая страница называет число страниц, остальные
 * догружаются параллельно. Отказ ОДНОЙ страницы не рушит выборку — она
 * пропускается (частичные данные лучше пустого экрана), отказ ПЕРВОЙ
 * означает, что показывать нечего, и возвращается пустой список. О каждом
 * пропуске сообщается через options.onPageError.
 */
export async function collectAllPages<T>(
  fetchPage: PageFetcher<T>,
  options?: CollectPagesOptions,
): Promise<T[]> {
  let first: PagedResponse<T> | T[];
  try {
    first = await fetchPage(1);
  } catch (error) {
    options?.onPageError?.(1, error);
    return [];
  }
  // Массив вместо конверта — старая форма ответа: страниц нет, это всё.
  if (Array.isArray(first)) return first;

  const rows = first.rows ?? [];
  const totalPages = first.pagination?.totalPages ?? 1;
  if (totalPages <= 1) return rows;

  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      Promise.resolve()
        .then(() => fetchPage(i + 2))
        .then((r) => (Array.isArray(r) ? r : r.rows ?? []))
        .catch((error) => {
          options?.onPageError?.(i + 2, error);
          return [] as T[];
        }),
    ),
  );
  return rows.concat(...rest);
}
