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
  if (/не ответил|timeout|timedout|etimedout|deadline/.test(text)) {
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
