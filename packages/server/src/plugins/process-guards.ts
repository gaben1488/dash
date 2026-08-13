/**
 * Страховка процесса: необработанная ошибка не должна убивать сервер.
 *
 * Почему не «упасть и перезапуститься». Ошибка почти всегда прилетает из
 * ФОНОВОЙ работы — предзагрузка книг при старте, четверговый крон недельного
 * среза, отвалившийся таймер, — то есть из места, которое к обслуживанию
 * запросов отношения не имеет. Ронять из-за неё веб-сервер значит менять
 * частную поломку на общую: в пятницу утром отчёт нужен людям, а контейнер в
 * этот момент перезапускается и теряет весь прогретый кэш книг (несколько
 * десятков секунд чтения Google на холодную).
 *
 * Что взамен: ошибка записывается в журнал целиком, с местом и причиной, а
 * процесс продолжает обслуживать запросы. Состояние источников при этом видно
 * снаружи — GET /api/health показывает, какие книги прочитаны, а какие нет,
 * так что «жив, но неполон» не выглядит как «всё в порядке».
 *
 * В тестах страховка НЕ ставится: заглушить падение в прогоне значит спрятать
 * настоящую поломку от того, кто её чинит.
 */
import type { FastifyBaseLogger } from 'fastify';

let installed = false;

/** Причина отклонённого обещания бывает чем угодно — приводим к виду для журнала. */
function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === 'string' ? reason : JSON.stringify(reason ?? null));
}

export function reportUnhandledRejection(log: FastifyBaseLogger, reason: unknown): void {
  log.error(
    { err: toError(reason) },
    'Необработанный отказ обещания: работа продолжается, но результат этой операции потерян',
  );
}

export function reportUncaughtException(log: FastifyBaseLogger, err: unknown): void {
  log.error(
    { err: toError(err) },
    'Необработанное исключение: работа продолжается, состояние источников — в ответе о здоровье',
  );
}

/**
 * Ставит обработчики один раз на процесс. Повторный вызов (несколько
 * приложений в одном процессе) ничего не делает — иначе Node справедливо
 * ругается на утечку слушателей.
 */
export function installProcessGuards(log: FastifyBaseLogger): void {
  if (installed) return;
  if (process.env.NODE_ENV === 'test') return;
  installed = true;

  process.on('unhandledRejection', (reason) => reportUnhandledRejection(log, reason));
  process.on('uncaughtException', (err) => reportUncaughtException(log, err));
}
