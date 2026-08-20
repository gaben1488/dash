/**
 * Повтор обращения к таблице-источнику при временном отказе.
 *
 * Реестр багов 09.07.2026, раздел «ждут доверификации»: «google-sheets: голый
 * catch{} глотает 429/403 как 404, НЕТ повторов с задержкой при 48
 * одновременных запросах». Первая половина закрыта раньше (ошибки перестали
 * маскироваться под «листа нет», страж — google-sheets-dept-errors.test.ts),
 * вторая оставалась живой: сборка снимка читает девять книг управлений сразу,
 * каждая книга — до трёх имён-кандидатов по два запроса, и Google на пике
 * отвечает «слишком часто». Один такой отказ ронял ЦЕЛОЕ управление из снимка,
 * хотя достаточно было подождать полсекунды и спросить ещё раз.
 *
 * Что повторяем и чего не повторяем — граница проведена по смыслу отказа:
 *   • «слишком часто» (429) и поломка на стороне Google (5xx) проходят сами,
 *     их повторяем;
 *   • «доступа нет» (403) сам не пройдёт — служебной учётной записи не выдали
 *     прав на книгу; повтор только утроил бы ожидание, а лечится это выдачей
 *     доступа;
 *   • молчание источника (свой срок ожидания, SheetsUnavailableError) не
 *     повторяем по той же причине, по какой не перебираем дальше имена
 *     листов: три попытки по двадцать секунд — минута на одно управление.
 *
 * Пауза растёт вдвое от попытки к попытке и разбавляется случайной добавкой:
 * без неё девять книг, отказавших одновременно, вернулись бы к Google тоже
 * одновременно и снова получили бы отказ. Если Google сам назвал срок в
 * заголовке Retry-After — слушаем его, а не свой расчёт.
 */

/** Сколько всего попыток делает один вызов: первая плюс два повтора. */
export const SHEETS_RETRY_ATTEMPTS = 3;

/** Основание паузы: 500 мс, 1000 мс, дальше вдвое. */
export const SHEETS_RETRY_BASE_DELAY_MS = 500;

/** Верхняя граница одной паузы — источник не должен задерживать ответ читателю. */
export const SHEETS_RETRY_MAX_DELAY_MS = 8_000;

/** Достаём числовой код ответа из ошибки googleapis (status или code). */
function statusOf(err: unknown): number | undefined {
  const raw = (err as { status?: unknown; code?: unknown })?.status
    ?? (err as { status?: unknown; code?: unknown })?.code;
  return typeof raw === 'number' ? raw : undefined;
}

/**
 * Отказ временный — стоит спросить ещё раз?
 *
 * 403 сюда НЕ входит намеренно: это «прав не выдали», а не «сейчас занято».
 * Свой срок ожидания (SheetsUnavailableError) тоже не входит — у него нет
 * числового кода, и он отсеивается сам.
 */
export function isRetryableSheetsError(err: unknown): boolean {
  const status = statusOf(err);
  if (status === undefined) return false;
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Срок, названный самим Google в заголовке Retry-After, в миллисекундах.
 * Заголовок бывает и числом секунд, и датой; берём только число — дата в
 * ответах Sheets не встречается, а гадать о часовом поясе хуже, чем
 * посчитать паузу самому.
 */
export function retryAfterMs(err: unknown): number | undefined {
  const headers = (err as { response?: { headers?: Record<string, unknown> } })?.response?.headers;
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(seconds * 1000, SHEETS_RETRY_MAX_DELAY_MS);
}

/**
 * Пауза перед повтором номер `attempt` (нумерация с нуля: 0 — перед первым
 * повтором). Удвоение плюс добавка от нуля до половины паузы; `random` вынесен
 * в аргумент, чтобы страж проверял расчёт, а не подбрасывал монетку.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(SHEETS_RETRY_BASE_DELAY_MS * 2 ** attempt, SHEETS_RETRY_MAX_DELAY_MS);
  return Math.round(base + base * 0.5 * random());
}

export interface SheetsRetryOptions {
  /** Всего попыток, включая первую. */
  attempts?: number;
  /** Ожидание — вынесено, чтобы стражи не ждали по-настоящему. */
  sleep?: (ms: number) => Promise<void>;
  /** Источник случайной добавки к паузе. */
  random?: () => number;
  /** Куда сообщить о повторе; по умолчанию молча. */
  onRetry?: (info: { what: string; attempt: number; delayMs: number; error: unknown }) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    // Таймер не держит процесс живым: остановка сервера не ждёт паузы.
    timer.unref?.();
  });

/**
 * Выполняет обращение к источнику, повторяя его при временном отказе.
 * `what` — то, что поймёт читатель («чтение листа „ВСЕ“»); идентификатор
 * книги в текст не попадает.
 */
export async function withSheetsRetry<T>(
  what: string,
  run: () => Promise<T>,
  options: SheetsRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? SHEETS_RETRY_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      const isLast = attempt === attempts - 1;
      if (isLast || !isRetryableSheetsError(err)) throw err;
      const delayMs = retryAfterMs(err) ?? retryDelayMs(attempt, random);
      options.onRetry?.({ what, attempt: attempt + 1, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  // Недостижимо: цикл либо возвращает значение, либо бросает на последней
  // попытке. Строка нужна только типам.
  throw lastError;
}
