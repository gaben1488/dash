/**
 * Загрузка кусков сборки, переживающая выкат новой версии.
 *
 * Механизм дефекта (пойман владельцем на проде 14.08.2026): вкладка открыта на
 * старой версии, пользователь жмёт «Отчёт в Word», страница лениво просит кусок
 * `text-blocks-<хэш>.js` — но после выката на сервере лежат куски с НОВЫМИ
 * хэшами, старый удалён вместе со старым образом. Браузер получает 404 и
 * показывает красное «TypeError: Failed to fetch dynamically imported module».
 * В день бывает несколько выкатов, поэтому класс ошибки постоянный.
 *
 * Лечение: такой отказ — не ошибка данных, а сигнал «вышло обновление».
 * Страница перезагружается ОДИН раз (метка в sessionStorage защищает от
 * цикла, если сеть действительно упала) и открывается уже новой версией.
 */

const RELOAD_MARK = 'aemr-chunk-reload';

/** Отказ загрузки куска сборки: Vite/браузеры формулируют по-разному. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as Error | undefined)?.message ?? err ?? '');
  return /failed to fetch dynamically imported module|error loading dynamically imported module|chunkloaderror|importing a module script failed/i.test(msg);
}

/**
 * Обёртка динамического импорта. При отказе куска после выката перезагружает
 * страницу один раз; при повторном отказе (реальный обрыв сети) пробрасывает
 * ошибку наверх — там её покажет обычная русская плашка.
 */
export async function freshImport<T>(load: () => Promise<T>): Promise<T> {
  try {
    const mod = await load();
    // Метка снимается лениво: сюда попадают только страницы, где кусок реально
    // загрузился, — значит версия свежая и защита от цикла больше не нужна.
    try { sessionStorage.removeItem(RELOAD_MARK); } catch { /* storage недоступен — не мешаем */ }
    return mod;
  } catch (err) {
    let marked: boolean;
    try { marked = sessionStorage.getItem(RELOAD_MARK) === '1'; } catch { marked = true; }
    if (isChunkLoadError(err) && !marked) {
      try { sessionStorage.setItem(RELOAD_MARK, '1'); } catch { /* без метки перезагрузку не рискуем зациклить */ }
      window.location.reload();
      // Перезагрузка уже запущена; возвращаем вечное ожидание, чтобы вызвавший
      // код не успел нарисовать ошибку поверх уходящей страницы.
      return new Promise<T>(() => undefined);
    }
    throw err;
  }
}
