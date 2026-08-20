/**
 * Отпечаток ответа и повторное чтение без пересылки тела (ETag + 304).
 *
 * ЗАЧЕМ. Тяжёлые чтения продукта — пульт, реестр процедур, единая сетка СВОД,
 * журнал правок — отдают мегабайты одного и того же содержимого. Страницу
 * открывают заново, переключают вкладку, возвращаются из отчёта, и каждый раз
 * по проводу едут те же байты, хотя книги не менялись. Отпечаток решает ровно
 * это: сервер считает подпись тела, браузер при следующем обращении присылает
 * её обратно в `If-None-Match`, и если подпись совпала — уходит пустой ответ
 * «не изменилось» вместо мегабайта.
 *
 * ЧЕМ ЭТО НЕ ЛОМАЕТ ВЕБ. Заголовок `Cache-Control: private, no-cache` означает
 * «храни, но каждый раз спрашивай», а не «показывай старое». Браузер сам
 * проводит сверку и отдаёт коду страницы обычный ответ 200 с телом из своего
 * хранилища — `fetchJSON` в `packages/web/src/api.ts` даже не узнаёт, что тело
 * приехало не по сети. Голого 304 клиентский код не увидит никогда: его видит
 * только тот, кто присылает `If-None-Match` руками.
 *
 * ПОЧЕМУ СВОИМИ РУКАМИ, А НЕ ПЛАГИНОМ. Зависимости в этом контуре не ставятся
 * (то же соображение записано в plugins/rate-limit.ts). Нужного здесь ровно
 * столько: свёртка тела, сравнение со списком присланных подписей и пустой
 * ответ при совпадении.
 *
 * Документация Fastify (Reference/Hooks.md, раздел onSend): хук получает тело
 * до отправки и вправе заменить его строкой, буфером, потоком или null; null
 * даёт пустой ответ без Content-Length — ровно то, что требуется для 304.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Подпись отпечатка, приписываемая сжатым представлениям. По RFC 9110 у разных
 * представлений одного ресурса (сжатое и несжатое) отпечатки обязаны
 * различаться; тот же приём применяет nginx. Хук сжатия дописывает суффикс, а
 * сверка снимает его перед сравнением — иначе клиент, получивший сжатый ответ,
 * никогда бы не попал в 304.
 */
export const ENCODING_ETAG_SUFFIXES = ['-gzip', '-br', '-deflate'] as const;

/** Считает отпечаток тела. Сильный: свёртка берётся с целого тела, не с длины. */
export function computeEtag(payload: string | Buffer): string {
  const hash = createHash('sha1')
    .update(typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload)
    .digest('base64url');
  return `"${hash}"`;
}

/** Снимает приписку кодировки: `"abc-gzip"` → `"abc"`. */
export function stripEncodingSuffix(tag: string): string {
  const unquoted = tag.startsWith('W/') ? tag.slice(2) : tag;
  for (const suffix of ENCODING_ETAG_SUFFIXES) {
    if (unquoted.endsWith(`${suffix}"`)) {
      return `${unquoted.slice(0, -(suffix.length + 1))}"`;
    }
  }
  return unquoted;
}

/**
 * Совпал ли отпечаток с одним из присланных. `*` по RFC означает «любой
 * существующий» и тоже засчитывается.
 */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const wanted = stripEncodingSuffix(etag);
  return header
    .split(',')
    .map((raw) => stripEncodingSuffix(raw.trim()))
    .some((tag) => tag === '*' || tag === wanted);
}

/**
 * Пути, которым отпечаток не нужен и вреден: живая лента событий (поток, а не
 * тело) и приёмник вебхука (записывающий вызов, отвечать «не изменилось»
 * бессмысленно). Проверка потока и без того отсеивает ленту, но названный
 * список честнее молчаливого совпадения.
 */
const NEVER_CACHED = /^\/api\/(events|webhook)\b/;

/** Кому пересчитывать отпечаток нельзя: у ответа уже есть свой. */
function alreadyTagged(reply: FastifyReply): boolean {
  return reply.getHeader('etag') !== undefined;
}

export interface HttpCacheOptions {
  /** Ниже этой длины отпечаток не окупает свёртку. */
  readonly minBytes?: number;
}

/**
 * Ставится ПЕРЕД сжатием: отпечаток обязан считаться с исходного тела, иначе
 * два клиента с разной поддержкой сжатия получат разные подписи одного и того
 * же содержимого.
 */
export function registerHttpCache(app: FastifyInstance, options: HttpCacheOptions = {}): void {
  const minBytes = options.minBytes ?? 0;

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return payload;
    if (reply.statusCode !== 200) return payload;
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;

    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/')) return payload;
    if (NEVER_CACHED.test(path)) return payload;
    if (alreadyTagged(reply)) return payload;

    const size = Buffer.byteLength(payload as string | Buffer);
    if (size < minBytes) return payload;

    const etag = computeEtag(payload as string | Buffer);
    reply.header('etag', etag);
    // «Храни, но каждый раз спрашивай». Числа продукта меняются от правки в
    // книге, а не по расписанию, поэтому срока годности у ответа нет — есть
    // только сверка. private: ответ принадлежит читателю с его ключом доступа
    // и в общем кэше прокси лежать не должен.
    if (reply.getHeader('cache-control') === undefined) {
      reply.header('cache-control', 'private, no-cache');
    }

    if (matchesIfNoneMatch(request.headers['if-none-match'], etag)) {
      reply.code(304);
      reply.removeHeader('content-length');
      reply.removeHeader('content-type');
      return null;
    }

    return payload;
  });
}
