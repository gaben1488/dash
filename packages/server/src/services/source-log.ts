/**
 * source-log.ts — журнал обращений к таблицам-источникам.
 *
 * ЗАЧЕМ. Журнал сервера обязан отвечать на вопрос «почему число такое». До сих
 * пор чтения книг уходили в `console.log`/`console.warn`: строки шли мимо
 * журнала Fastify (pino), поэтому у них не было ни уровня, ни времени, ни
 * полей — их нельзя было ни отфильтровать, ни сопоставить с запросом. А главное
 * в них не было двух чисел, ради которых журнал и заводят: СКОЛЬКО СТРОК
 * прочитано и ЗА СКОЛЬКО. Без них «в отчёте 661 закупка» — утверждение без
 * происхождения.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ `app.log` НАПРЯМУЮ. Чтение источников живёт в
 * services/, а журнал принадлежит приложению: тянуть экземпляр Fastify в модуль
 * чтения значит замкнуть слои и лишить его собственных стражей. Здесь стоит
 * приёмник, который приложение подменяет одной строкой при старте
 * (`setSourceLogger(app.log)`), а до подмены и в стражах он пишет в консоль —
 * ровно как было.
 *
 * ЧТО НЕ ПОПАДАЕТ В ЖУРНАЛ. Ключи доступа, закрытый ключ служебной учётной
 * записи и почты (в журнале правок книг почта автора стоит в каждой записи) —
 * значения полей проходят через `redactFieldValue`. Это страховка, а не
 * основной приём: вызывающие и так передают человеческую фразу и числа. Но
 * страховка нужна: сообщение об ошибке от Google несёт и адрес книги, и почту
 * учётки, и однажды кто-нибудь передаст его сюда целиком.
 */

/** Приёмник журнала. Форма совпадает с `app.log` (pino): (поля, сообщение). */
export interface SourceLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
}

/**
 * След ключа, закрытого ключа или почты в значении поля. Почта попадает под
 * подозрение целиком: журнал правок книг несёт почту автора в каждой записи,
 * и это персональные данные, а не диагностика.
 */
const SECRET_RE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{16,}|ya29\.[0-9A-Za-z_-]+|[^\s@<>()«»]+@[^\s@<>()«».]+\.[^\s@<>()«».]{2,}/u;

/** Замена значению, в котором нашёлся след ключа или почты. */
export const REDACTED = '[скрыто]';

/** Значение поля для журнала: строка со следом ключа или почты не пишется. */
export function redactFieldValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return SECRET_RE.test(value) ? REDACTED : value;
}

/** Поля записи журнала после вычистки. */
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = redactFieldValue(value);
  return out;
}

/**
 * Приёмник по умолчанию — консоль. Нужен затем, что чтения случаются и до
 * старта приложения (стражи, разовые скрипты), и терять их нельзя.
 */
const consoleLogger: SourceLogger = {
  info: (fields, msg) => console.log(msg, fields),
  warn: (fields, msg) => console.warn(msg, fields),
  error: (fields, msg) => console.error(msg, fields),
};

let sink: SourceLogger = consoleLogger;

/** Приложение подменяет приёмник на свой журнал при старте. */
export function setSourceLogger(logger: SourceLogger | null): void {
  sink = logger ?? consoleLogger;
}

function write(level: keyof SourceLogger, fields: Record<string, unknown>, msg: string): void {
  sink[level]({ src: 'источник', ...redactFields(fields) }, msg);
}

/**
 * Успешное чтение источника: что прочитано, сколько строк, за сколько.
 * `what` — человеческая фраза («чтение листа „ВСЕ“»), идентификатора книги в
 * ней нет никогда: маршрут здоровья и журнал держат одно и то же правило.
 */
export function logSourceRead(what: string, fields: { rows?: number; ms: number }): void {
  const rows = fields.rows === undefined ? '' : `: строк ${fields.rows}`;
  write('info', { what, ...fields }, `Источник прочитан (${what})${rows}, за ${fields.ms} мс`);
}

/**
 * Успешная запись в источник: что записано и за сколько.
 *
 * Записи в журнале не было вовсе — правка уходила в книгу молча. При разборе
 * «кто поменял число» это худший из возможных пробелов: чтения видно, а
 * собственная правка продукта невидима. Значение ячейки в журнал НЕ пишется:
 * в него вводят и суммы, и фамилии.
 */
export function logSourceWrite(what: string, fields: { cells: number; ms: number }): void {
  write('info', { what, ...fields }, `Источник изменён (${what}): ячеек ${fields.cells}, за ${fields.ms} мс`);
}

/** Повтор после временного отказа: видно, что пауза — не зависание. */
export function logSourceRetry(what: string, fields: { attempt: number; delayMs: number; reason: string }): void {
  write(
    'warn',
    { what, ...fields },
    `Источник ответил отказом (${what}): ${fields.reason}; повтор ${fields.attempt} через ${fields.delayMs} мс`,
  );
}

/** Окончательный отказ источника — с причиной по-русски, а не текстом Google. */
export function logSourceFailure(what: string, fields: { ms: number; reason: string }): void {
  write('warn', { what, ...fields }, `Источник не прочитан (${what}): ${fields.reason}, за ${fields.ms} мс`);
}

/** Обновление снимка: что изменилось после перечитки. */
export function logSnapshotChange(msg: string, fields: Record<string, unknown> = {}): void {
  write('info', fields, msg);
}

/** Поломка, о которой нельзя молчать (сохранение снимка, зеркало книги). */
export function logSourceProblem(msg: string, fields: Record<string, unknown> = {}): void {
  write('error', fields, msg);
}
