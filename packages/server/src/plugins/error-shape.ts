/**
 * Единый вид отказа: одна форма тела, устойчивый машинный код, ни одной
 * внутренности наружу.
 *
 * ЗАЧЕМ. Отказы этого сервера приходили из четырёх разных мест и выглядели
 * по-разному: общий обработчик отдавал `{error, message, statusCode}`, проверка
 * ключа — `{error, message}` без кода, ограничитель частоты — свою четвёрку
 * полей, а «нет такого маршрута» — вообще `{error: 'Not found'}` одним полем.
 * Веб на это отвечал разбором подстрок, а не полей (см. историю класса
 * `ApiError` в `packages/web/src/api.ts`: различие «сервер отказал» и «сервера
 * нет» когда-то ловили через `String(e).includes('API error')`). Форма ответа —
 * это контракт, и он должен быть один.
 *
 * ЧЕМ ЭТО НЕ ЛОМАЕТ ВЕБ. Прежние поля остаются на прежних местах и с прежними
 * значениями: `error`, `message`, `statusCode`, а в явно названной среде
 * разработки — `stack`. Добавляются два: `code` (устойчивое слово из закрытого
 * списка, по которому можно ветвиться без разбора русского текста) и
 * `requestId` (тот же идентификатор, что в журнале сервера, — по нему находят
 * строку журнала, не пересказывая её читателю). Расширение, не замена.
 *
 * ЧТО НАРУЖУ НЕ ВЫХОДИТ. У отказов от 500 и выше — ни сообщения, ни кода
 * библиотеки, ни стека: там бывают пути файлов, адреса книг и почта служебной
 * учётной записи. Единственное исключение — ошибка, сама объявившая себя
 * показываемой (`expose`): молчащий источник несёт русскую фразу с действием, и
 * подменять её на «Внутренняя ошибка» значит отнимать у читателя единственное
 * объяснение.
 *
 * Опора — документация Fastify (Reference/Errors.md, «Registering a custom
 * error handler»): отказы ниже 500 подняты приложением намеренно и показываются
 * как есть, всё остальное записывается в журнал, но не пересказывается клиенту.
 * Оттуда же (lib/error-handler.js) важная тонкость: свой обработчик обязан сам
 * выставить код ответа — автоматической установки из `err.statusCode`, как у
 * обработчика по умолчанию, для него не происходит.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Объявленная форма отказа для маршрутов, которые объявляют форму успеха.
 *
 * Нужна не ради скорости, а ради самого факта объявления: как только у
 * маршрута появляется схема ответа хоть на один код, все остальные его коды
 * обязаны быть названы тоже — иначе тело отказа собирается общим сериализатором
 * и расходится по виду с ответами прочих маршрутов. Составом повторяет
 * `ErrorBody`.
 */
export const ERROR_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    statusCode: { type: 'number' },
    code: { type: 'string' },
    requestId: { type: 'string' },
    retryAfterSeconds: { type: 'number' },
    details: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { at: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
} as const;

/** Устойчивое слово отказа. Список закрытый: по нему ветвятся, его не читают. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'SERVICE_UNAVAILABLE'
  | 'GATEWAY_TIMEOUT';

const BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'TOO_MANY_REQUESTS',
  501: 'NOT_IMPLEMENTED',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

/** Код по состоянию ответа. Незнакомое 4xx — «запрос отклонён», 5xx — «внутренняя». */
export function codeForStatus(statusCode: number): ErrorCode {
  const known = BY_STATUS[statusCode];
  if (known) return known;
  return statusCode >= 500 || statusCode < 400 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
}

/** Одна запись о непройденной проверке запроса. */
export interface ValidationDetail {
  /** Где именно: `body/rows/0/deptId`. */
  readonly at: string;
  /** Что не так — текст проверяющего. */
  readonly message: string;
}

export interface ErrorBody {
  readonly error: string;
  readonly message: string;
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly requestId?: string;
  readonly details?: readonly ValidationDetail[];
  readonly stack?: string;
}

interface HttpishError extends Error {
  statusCode?: number;
  status?: number;
  expose?: boolean;
  code?: string;
  validation?: ReadonlyArray<{ instancePath?: string; schemaPath?: string; message?: string }>;
  validationContext?: string;
}

/**
 * Обезличенный текст для отказов, чей собственный показывать нельзя.
 *
 * У 500 текст оставлен прежним, английским, и намеренно: он не попадает
 * читателю на глаза — веб рисует свою русскую фразу по коду ответа
 * (`httpErrorPhrase` в `packages/web/src/api.ts`), а здесь это отметка для
 * журнала и для стража `app-security.test.ts`, который проверяет ровно эту
 * строку как признак «внутренности не вынесены».
 */
const GENERIC_MESSAGE: Readonly<Partial<Record<ErrorCode, string>>> = {
  INTERNAL_ERROR: 'Internal server error',
  NOT_FOUND: 'Такого адреса на сервере нет.',
};

/**
 * Собирает тело отказа. Единственное место, где решается, что показать.
 *
 * @param exposeStack показывать ли стек (только явно названная среда разработки)
 */
export function buildErrorBody(
  error: HttpishError,
  request: Pick<FastifyRequest, 'id'> | undefined,
  exposeStack: boolean,
): ErrorBody {
  const raw = error.statusCode ?? error.status ?? 500;
  const statusCode = raw >= 400 && raw <= 599 ? raw : 500;
  const validation = error.validation;
  const code: ErrorCode = validation ? 'VALIDATION_FAILED' : codeForStatus(statusCode);

  // Ниже 500 отказ поднят приложением намеренно — его текст и есть объяснение.
  // Выше 500 показывается только то, что само объявило себя показываемым.
  const showOwnMessage = statusCode < 500 || error.expose === true;
  const message = showOwnMessage && error.message
    ? error.message
    : GENERIC_MESSAGE[code] ?? GENERIC_MESSAGE.INTERNAL_ERROR!;

  const details = validation?.length
    ? validation.map((v) => ({
        at: `${error.validationContext ?? 'запрос'}${v.instancePath ?? ''}`,
        message: v.message ?? 'значение не подходит',
      }))
    : undefined;

  return {
    // Прежнее поле на прежнем месте: веб и тесты читают именно его.
    error: showOwnMessage ? error.name || code : 'InternalServerError',
    message,
    statusCode,
    code,
    ...(request?.id ? { requestId: String(request.id) } : {}),
    ...(details ? { details } : {}),
    ...(exposeStack && error.stack ? { stack: error.stack } : {}),
  };
}

export interface ErrorShapeOptions {
  /** Показывать ли стек — решение о среде принимается снаружи (app.ts). */
  readonly exposeStack: boolean;
}

/**
 * Ставит общий обработчик отказов и обработчик «нет такого маршрута» для /api.
 *
 * Обработчик «нет маршрута» ставится ЗДЕСЬ только для обращений к /api;
 * отдачей страницы приложения по остальным адресам по-прежнему занимается
 * app.ts (там же, где регистрируется статика), — иначе один и тот же
 * обработчик пришлось бы объявлять дважды.
 */
export function registerErrorShape(app: FastifyInstance, options: ErrorShapeOptions): void {
  app.setErrorHandler((error: HttpishError, request, reply) => {
    const body = buildErrorBody(error, request, options.exposeStack);

    // Уровень записи по роду отказа: 4xx — обычное течение дел (не тот адрес,
    // не тот ключ, слишком часто), 5xx — поломка. Прежний общий `error` на всё
    // подряд превращал журнал в шум, в котором настоящая поломка не видна.
    const line = { err: error, url: request.url, method: request.method, requestId: request.id };
    if (body.statusCode >= 500) {
      request.log.error(line, 'Отказ обработки запроса');
    } else {
      request.log.warn(line, 'Запрос отклонён');
    }

    // Свой обработчик обязан выставить код сам: автоматическая установка из
    // err.statusCode работает только у обработчика по умолчанию
    // (Fastify, lib/error-handler.js).
    return reply.status(body.statusCode).send(body);
  });
}

/**
 * Тело отказа «нет такого маршрута» — той же формы, что и все прочие.
 * Вынесено отдельно, потому что зовётся из обработчика в app.ts, где рядом
 * живёт отдача страницы приложения.
 */
export function notFoundBody(request: Pick<FastifyRequest, 'id'>): ErrorBody {
  return {
    error: 'NotFound',
    message: GENERIC_MESSAGE.NOT_FOUND!,
    statusCode: 404,
    code: 'NOT_FOUND',
    requestId: String(request.id),
  };
}

/** Отправляет отказ «нет такого маршрута» в общей форме. */
export function sendNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.status(404).send(notFoundBody(request));
}
