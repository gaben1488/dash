/**
 * source-failure.ts — ОДНА классификация отказа источника русской фразой.
 *
 * Жила внутри маршрута здоровья (routes/health.ts) и была видна только ему.
 * А нужна она в двух местах сразу: наружу — читателю на вкладке «Подключение»,
 * и внутрь — в журнал сервера, где вопрос «почему число такое» упирается ровно
 * в него: «книга не прочитана» без причины не отвечает ни на что. Вторая копия
 * классификатора завела бы две правды о том, что такое «403».
 *
 * Список закрытый намеренно. Исходный текст Google несёт и адрес книги, и почту
 * служебной учётной записи; наружу идёт только результат этой классификации.
 */

/** Причина отказа источника русской фразой из закрытого списка. */
export function classifySourceFailure(raw: string): string {
  const text = raw.toLowerCase();
  if (/не ответил|таймаут|timeout|timedout|etimedout|deadline/.test(text)) {
    return 'источник не ответил вовремя';
  }
  if (/\b429\b|quota|rate.?limit|too many requests/.test(text)) {
    return 'источник ограничил частоту обращений';
  }
  if (/\b403\b|permission|forbidden|does not have access|insufficient/.test(text)) {
    return 'нет доступа к книге';
  }
  if (/enotfound|eai_again|econnrefused|econnreset|socket hang up|network/.test(text)) {
    return 'нет связи с источником';
  }
  if (/\b5\d\d\b|internal error|backend error|service unavailable/.test(text)) {
    return 'источник временно недоступен';
  }
  if (/\b404\b|not found|no readable sheet|unable to parse range/.test(text)) {
    return 'нужный лист в книге не найден';
  }
  return 'книга не прочитана';
}

/** Automatic retries require positive evidence of a transient transport/service error. */
export function isTransientSourceFailure(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const value = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
    const status = Number(value.response?.status ?? value.status ?? value.code);
    if (Number.isInteger(status) && status >= 400 && status < 600) return [408, 429, 500, 502, 503, 504].includes(status);
  }
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/schema|contract|invalid|\b40[134]\b|permission|forbidden|not found|unable to parse range/i.test(raw)) return false;
  const transient = ['источник не ответил вовремя', 'источник ограничил частоту обращений',
    'нет связи с источником', 'источник временно недоступен'];
  return transient.includes(raw) || transient.includes(classifySourceFailure(raw));
}
