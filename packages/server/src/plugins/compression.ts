/**
 * Сжатие ответов на лету.
 *
 * ЗАЧЕМ. Ответы этого продукта — длинные однородные списки: реестр строк,
 * журнал правок (около 37 тыс. записей), сетка СВОД, реестр процедур. У такого
 * содержимого повторов больше, чем собственно данных, и gzip уносит из него
 * восемь-девять байт из десяти. Для читателя в конторе за узким каналом это
 * разница между «страница открылась» и «страница думает».
 *
 * ЧЕМ ЭТО НЕ ЛОМАЕТ ВЕБ. Сжатие включается только тогда, когда клиент сам
 * объявил, что умеет его разбирать (`Accept-Encoding`), и распаковывает его
 * браузер, а не код страницы: `fetchJSON` в `packages/web/src/api.ts` получает
 * тот же самый JSON. Обращения без объявленной поддержки — в том числе все
 * прогоны `app.inject()` в тестах — получают тело как раньше, байт в байт.
 *
 * ПОЧЕМУ СВОИМИ РУКАМИ. Зависимости в этом контуре не ставятся (то же
 * соображение записано в plugins/rate-limit.ts), а zlib входит в Node.
 * Нужного здесь ровно столько: разбор объявленных кодировок, порог, за которым
 * сжатие окупается, и сама свёртка.
 *
 * Документация Fastify (Reference/Hooks.md, раздел onSend): хук вправе
 * заменить тело буфером; хуки выполняются в порядке регистрации — поэтому
 * сжатие ставится ПОСЛЕ отпечатка (plugins/http-cache.ts), а не до.
 */
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import type { FastifyInstance } from 'fastify';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

/**
 * Порог, ниже которого сжимать незачем: короткий ответ уходит одним пакетом,
 * и свёртка добавляет к нему только работу процессора и служебный заголовок.
 * Величина взята чуть меньше типичного полезного размера пакета (1500 байт
 * минус заголовки), то есть по границе «влезает в один пакет или нет».
 */
export const COMPRESS_MIN_BYTES = 1400;

/**
 * Что сжимаем. Список — по роду содержимого, а не по маршруту: продукт отдаёт
 * JSON, выгрузки CSV и статику. Уже сжатое (картинки, архивы) сюда не попадает.
 */
const COMPRESSIBLE = /^(?:application\/(?:json|javascript|xml)|text\/)/i;

export type Encoding = 'br' | 'gzip';

/**
 * Какую кодировку выбрать по объявлению клиента. Brotli предпочтительнее при
 * равных условиях: на однородных списках он выигрывает у gzip ещё десяток
 * процентов. Клиент, ничего не объявивший, получает несжатый ответ.
 *
 * Разбирается и `q=0`: «gzip;q=0» означает «gzip не предлагать».
 */
export function pickEncoding(header: string | undefined): Encoding | null {
  if (!header) return null;
  const offered = new Map<string, number>();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params
      .map((p) => p.trim())
      .find((p) => p.startsWith('q='));
    const weight = q ? Number.parseFloat(q.slice(2)) : 1;
    offered.set(name.trim().toLowerCase(), Number.isFinite(weight) ? weight : 0);
  }
  if ((offered.get('br') ?? 0) > 0) return 'br';
  if ((offered.get('gzip') ?? 0) > 0) return 'gzip';
  return null;
}

/**
 * Свёртка. Уровни выбраны для ответа «на лету», а не для архива: у brotli
 * качество по умолчанию (11) стоит секунд процессорного времени на мегабайт и
 * съедает весь выигрыш во времени ответа, поэтому берётся середина шкалы —
 * та же, что рекомендуют для динамической выдачи веб-серверы.
 */
export async function compressPayload(body: Buffer, encoding: Encoding): Promise<Buffer> {
  if (encoding === 'br') {
    return brotliAsync(body, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length,
      },
    });
  }
  return gzipAsync(body, { level: 6 });
}

export interface CompressionOptions {
  readonly minBytes?: number;
}

export function registerCompression(app: FastifyInstance, options: CompressionOptions = {}): void {
  const minBytes = options.minBytes ?? COMPRESS_MIN_BYTES;

  app.addHook('onSend', async (request, reply, payload) => {
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    // Ответ «не изменилось» тела не несёт — сжимать нечего.
    if (reply.statusCode === 204 || reply.statusCode === 304) return payload;
    if (reply.getHeader('content-encoding') !== undefined) return payload;

    const type = String(reply.getHeader('content-type') ?? '');
    if (!COMPRESSIBLE.test(type)) return payload;
    // Живая лента событий — поток, а не тело: сжатие копило бы его в буфере и
    // события перестали бы приходить вовремя. До сюда она и так не доходит
    // (поток не строка и не буфер), но правило названо вслух, а не оставлено
    // на молчаливое совпадение.
    if (type.startsWith('text/event-stream')) return payload;

    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
    if (body.length < minBytes) return payload;

    const encoding = pickEncoding(request.headers['accept-encoding'] as string | undefined);
    if (!encoding) {
      // Клиент сжатие не объявил, но посредник между ним и нами мог бы решить
      // иначе: пусть кэш различает представления по объявленной кодировке.
      reply.header('vary', appendVary(reply.getHeader('vary'), 'Accept-Encoding'));
      return payload;
    }

    let compressed: Buffer;
    try {
      compressed = await compressPayload(body, encoding);
    } catch (err) {
      // Отказ свёртки — не отказ страницы: отдаём как было.
      request.log.warn({ err }, 'Сжатие ответа не выполнено — отдаём тело без сжатия');
      return payload;
    }

    // Свёртка, оказавшаяся не короче исходника (бывает на уже сжатом), — повод
    // не трогать ответ вовсе.
    if (compressed.length >= body.length) return payload;

    reply.header('content-encoding', encoding);
    reply.header('vary', appendVary(reply.getHeader('vary'), 'Accept-Encoding'));
    reply.header('content-length', compressed.length);

    // Отпечаток посчитан по несжатому телу (plugins/http-cache.ts). У сжатого
    // представления он обязан отличаться — приписываем название кодировки, как
    // это делает nginx; сверка снимает приписку перед сравнением.
    const etag = reply.getHeader('etag');
    if (typeof etag === 'string' && etag.endsWith('"')) {
      reply.header('etag', `${etag.slice(0, -1)}-${encoding}"`);
    }

    return compressed;
  });
}

/** Дописывает поле в Vary, не плодя повторов. */
export function appendVary(current: unknown, field: string): string {
  const existing = String(current ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (existing.some((s) => s.toLowerCase() === field.toLowerCase())) return existing.join(', ');
  return [...existing, field].join(', ');
}
