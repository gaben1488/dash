/**
 * Ограничение частоты тяжёлых обращений.
 *
 * Дорого не для процесса, а для источника: перечитка снимка и проверка
 * источников открывают ВСЕ книги управлений разом, чтение журнала правок —
 * вкладку «_ChangeLog» каждой книги (около 37 тыс. строк суммарно). Повторный
 * клик по «Обновить», забытый цикл в скрипте или пять открытых вкладок дают
 * шквал, который упирается в квоту Google (это её 429 в ответ) и оставляет
 * продукт без данных на минуты. Честный отказ с названным сроком повтора
 * дешевле сожжённой квоты и пустого отчёта.
 *
 * Почему свой счётчик, а не готовый плагин: зависимости в этом контуре не
 * ставятся, а нужного здесь ровно столько — окно, счётчик и фраза отказа.
 *
 * Ключ окна — адрес клиента. За обратным прокси (Caddy, deploy/docker-compose.yml)
 * адрес у всех читателей общий, поэтому пороги подобраны как общие для конторы,
 * а не как персональные: шквал отсекают, обычной работе нескольких человек
 * одновременно не мешают. Заголовку X-Forwarded-For доверия нет намеренно —
 * подделать его может кто угодно, и тогда ограничение либо обходится, либо
 * выжигает чужое окно.
 *
 * Окно фиксированное, состояние — в памяти процесса: после перезапуска счёт
 * начинается заново. Для защиты от случайного шквала этого достаточно;
 * распределённый учёт здесь был бы механизмом дороже задачи.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface HeavyRouteRule {
  /** Методы, к которым правило применяется (в верхнем регистре). */
  readonly methods: readonly string[];
  /** Путь без строки запроса. */
  readonly path: RegExp;
  /** Сколько обращений разрешено в окне. */
  readonly limit: number;
  readonly windowMs: number;
  /** Подлежащее фразы отказа: «Обновление данных выполняется не чаще…». */
  readonly subject: string;
  /** Почему это дорого: читатель должен понять, что отказ не каприз. */
  readonly why: string;
}

const MINUTE_MS = 60_000;

/**
 * Пороги намеренно щедрые. Смысл не в дозировании работы, а в отсечении
 * шквала: человек за экраном столько раз подряд не нажимает, а цикл в скрипте
 * упирается сразу.
 */
export const HEAVY_ROUTE_RULES: readonly HeavyRouteRule[] = [
  {
    methods: ['POST'],
    path: /^\/api\/refresh$/,
    limit: 4,
    windowMs: MINUTE_MS,
    subject: 'Обновление данных',
    why: 'каждая перечитка поднимает все книги управлений и пересчитывает отчёт целиком',
  },
  {
    methods: ['POST'],
    path: /^\/api\/sources\/validate-all$/,
    limit: 4,
    windowMs: MINUTE_MS,
    subject: 'Проверка всех источников',
    why: 'она открывает книгу каждого управления',
  },
  {
    methods: ['POST'],
    path: /^\/api\/sources\/[^/]+\/(test|validate)$/,
    limit: 20,
    windowMs: MINUTE_MS,
    subject: 'Проверка источника',
    why: 'каждая проверка обращается к таблице-источнику',
  },
  {
    methods: ['GET'],
    path: /^\/api\/changes$/,
    limit: 20,
    windowMs: MINUTE_MS,
    subject: 'Чтение журнала правок',
    why: 'журналы всех книг читаются целиком',
  },
  {
    // Сводка наблюдаемости провенанса (канон п.102) стоит ровно столько же,
    // сколько /api/changes: она открывает «_ChangeLog» каждой из восьми книг и
    // вдобавок проходит по всем их строкам.
    methods: ['GET'],
    path: /^\/api\/provenance\/health$/,
    limit: 20,
    windowMs: MINUTE_MS,
    subject: 'Сводка наблюдаемости провенанса',
    why: 'журналы правок всех книг читаются целиком и сверяются со строками книг',
  },
  {
    // Нагрузка управлений и три рода событий (канон п.103/п.105) стоят ровно
    // столько же: открываются журналы всех восьми книг (около 40 тыс. записей)
    // и вдобавок пересчитываются строки и учреждения каждой книги.
    methods: ['GET'],
    path: /^\/api\/workload$/,
    limit: 20,
    windowMs: MINUTE_MS,
    subject: 'Сводка нагрузки управлений',
    why: 'журналы правок всех книг разбираются на события, а строки книг пересчитываются',
  },
  {
    // Гигиена текста и орфография (канон п.122): сети нет, но детекторы и
    // сличение со словарём проходят по всем строкам всех книг — это счёт,
    // который незачем повторять чаще, чем живёт его пятиминутный кэш.
    methods: ['GET'],
    path: /^\/api\/text-hygiene$/,
    limit: 30,
    windowMs: MINUTE_MS,
    subject: 'Сводка гигиены текста',
    why: 'детекторы набора и проверка орфографии проходят по всем строкам всех книг',
  },
  {
    // Реестр процедур определения поставщика (канон п.101а) открывает
    // одиннадцать листов книги «Ежедневный мониторинг» разом; сверка вдобавок
    // проходит по строкам всех восьми книг управлений. Порог мягче, чем у
    // журналов: ответ кэшируется на пять минут, и вкладка живёт переключением
    // режимов, а не одним запросом.
    methods: ['GET'],
    path: /^\/api\/monitoring(\/(analytics|match))?$/,
    limit: 30,
    windowMs: MINUTE_MS,
    subject: 'Реестр процедур определения поставщика',
    why: 'книга мониторинга читается всеми листами разом, а сверка проходит по строкам книг управлений',
  },
  // ── Ниже — не отдельные маршруты, а КЛАССЫ обращений ──────────────────────
  //
  // Правила выше названы поимённо и стоят раньше не случайно: совпадение ищется
  // по порядку, первое найденное и применяется, — поэтому дорогой маршрут
  // остаётся при своём узком пороге, а классы ловят всё прочее.
  //
  // Зачем классы вообще, если тяжёлое уже перечислено. Затем, что перечень
  // тяжёлого — список известного, а шквал приходит от неизвестного: забытый
  // цикл в чужом скрипте, вкладка с автообновлением раз в секунду, чужой
  // обходчик, нашедший открытый адрес. Такому обращению незачем быть дорогим по
  // отдельности — хватает частоты. Пороги подобраны заведомо выше живой работы:
  // человек за экраном столько не нажимает, страница при полной загрузке даёт
  // порядка двух десятков обращений, — то есть в класс упирается только машина.
  {
    // Запись дороже чтения не счётом, а последствиями: каждая правка уходит в
    // Google-таблицу и в журнал, откатывать её потом руками.
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    path: /^\/api\//,
    limit: 240,
    windowMs: MINUTE_MS,
    subject: 'Изменение данных',
    why: 'каждая правка уходит в книгу-источник и в журнал правок',
  },
  {
    methods: ['GET', 'HEAD'],
    path: /^\/api\//,
    limit: 1200,
    windowMs: MINUTE_MS,
    subject: 'Чтение данных',
    why: 'поток обращений такой частоты приходит не от человека за экраном, а от забытого цикла',
  },
];

export interface RateLimitRefusal {
  /** Через сколько секунд окно закроется и обращение снова примут. */
  readonly retryAfterSeconds: number;
  /** Готовая фраза для читателя. */
  readonly message: string;
}

export interface HeavyRouteLimiter {
  /** null — обращение проходит; объект — отказ с готовым текстом. */
  check(method: string, path: string, clientKey: string, now?: number): RateLimitRefusal | null;
  reset(): void;
}

/** Порог, после которого имеет смысл вычищать окна умерших клиентов. */
const SWEEP_AT_ENTRIES = 500;

export function createHeavyRouteLimiter(
  rules: readonly HeavyRouteRule[] = HEAVY_ROUTE_RULES,
): HeavyRouteLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();

  function sweep(now: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
  }

  return {
    check(method, path, clientKey, now = Date.now()) {
      const upperMethod = method.toUpperCase();
      const index = rules.findIndex(
        (rule) => rule.methods.includes(upperMethod) && rule.path.test(path),
      );
      if (index < 0) return null;

      const rule = rules[index];
      // Индекс правила в ключе, а не путь: два обращения к разным управлениям
      // делят одно окно «проверки источника» — дорога именно суммарная частота.
      // Разделитель записан escape-последовательностью, а не самим знаком:
      // сырой нулевой байт в исходнике делал файл двоичным для поиска —
      // grep и обзор правок его пропускали. Ключ окна от этого не меняется.
      const key = `${index}\u0000${clientKey}`;
      const window = windows.get(key);

      if (!window || window.resetAt <= now) {
        if (windows.size > SWEEP_AT_ENTRIES) sweep(now);
        windows.set(key, { count: 1, resetAt: now + rule.windowMs });
        return null;
      }

      window.count += 1;
      if (window.count <= rule.limit) return null;

      // Окно фиксированное: превышение НЕ отодвигает срок повтора — иначе
      // клиент, продолжающий стучать, наказывал бы сам себя бесконечно.
      const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
      return { retryAfterSeconds, message: refusalMessage(rule, retryAfterSeconds) };
    },
    reset() {
      windows.clear();
    },
  };
}

/** Русское склонение по числу: 1 секунду, 3 секунды, 11 секунд. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = mod100 % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function secondsPhrase(n: number): string {
  return `${n} ${pluralRu(n, 'секунду', 'секунды', 'секунд')}`;
}

function windowPhrase(windowMs: number): string {
  if (windowMs === MINUTE_MS) return 'в минуту';
  const seconds = Math.round(windowMs / 1000);
  return `за ${secondsPhrase(seconds)}`;
}

function refusalMessage(rule: HeavyRouteRule, retryAfterSeconds: number): string {
  const rate = rule.limit === 1 ? 'одного раза' : `${rule.limit} раз`;
  return (
    `${rule.subject} выполняется не чаще ${rate} ${windowPhrase(rule.windowMs)}: ${rule.why}. ` +
    `Повторите через ${secondsPhrase(retryAfterSeconds)}.`
  );
}

function clientKeyOf(request: FastifyRequest): string {
  return request.ip || 'адрес не определён';
}

/**
 * Ставится ПОСЛЕ проверки ключа доступа: обращение без ключа отсекается
 * дешевле и не тратит окно настоящих читателей.
 */
export function registerHeavyRouteRateLimit(
  app: FastifyInstance,
  rules: readonly HeavyRouteRule[] = HEAVY_ROUTE_RULES,
): HeavyRouteLimiter {
  const limiter = createHeavyRouteLimiter(rules);

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    const refusal = limiter.check(request.method, path, clientKeyOf(request));
    if (!refusal) return;

    app.log.warn(
      { url: path, method: request.method, retryAfterSeconds: refusal.retryAfterSeconds },
      'Отказ по частоте обращений',
    );
    return reply
      .status(429)
      .header('Retry-After', String(refusal.retryAfterSeconds))
      .send({
        error: 'Слишком часто',
        message: refusal.message,
        retryAfterSeconds: refusal.retryAfterSeconds,
        statusCode: 429,
        // Общая форма отказа (plugins/error-shape.ts): устойчивое слово, по
        // которому веб ветвится, не разбирая русский текст, и тот же
        // идентификатор запроса, что в журнале сервера.
        code: 'TOO_MANY_REQUESTS',
        requestId: String(request.id),
      });
  });

  return limiter;
}
