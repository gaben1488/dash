/**
 * GET /api/health — жив ли сервер и что он знает об источниках.
 *
 * Маршрут публичный (проверка ключа его пропускает, так же его дёргает
 * healthcheck контейнера), поэтому наружу не выходит НИЧЕГО, по чему можно
 * добраться до данных: ни идентификаторов книг, ни адресов, ни почты служебной
 * учётной записи, ни текста ошибки от Google — только название управления,
 * время последнего успешного чтения, число строк и причина отказа русской
 * фразой из закрытого списка. Причина классифицируется, а не пересказывается:
 * сообщение Google может содержать и адрес книги, и почту учётки.
 *
 * Поле `status` наверху сохраняет прежний смысл — «процесс отвечает». Его
 * читают healthcheck контейнера (deploy/docker-compose.yml) и вкладка
 * «Подключение»; менять смысл поля, на котором стоит запуск связки, из-за
 * недоступной книги одного управления нельзя. Состояние источников живёт
 * рядом, в `sources`, со своим собственным честным признаком.
 *
 * Честная пустота: у непрочитанного источника нет ни времени, ни числа строк —
 * там null, а не ноль и не время попытки, выданное за успех.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SVOD_SHEET_NAME, SHDYU_MONTHLY_SHEET_NAME } from '@aemr/shared';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import {
  getDeptLoadMeta,
  getSvodGridCache,
  getSvodLoadFailure,
  getSHDYULoadMeta,
} from '../services/snapshot.js';
import { classifySourceFailure } from '../services/source-failure.js';

/** Состояние одного источника: прочитан, не прочитан, ещё не читался. */
export type SourceState = 'ok' | 'failed' | 'pending';

export interface SourceHealthItem {
  /** Название управления или листа — то же, что видит читатель в продукте. */
  name: string;
  state: SourceState;
  /** Время последнего УСПЕШНОГО чтения; null — успешного не было. */
  loadedAt: string | null;
  /** Время последней попытки — есть и у неудачной. */
  checkedAt: string | null;
  /** Строк прочитано; null — читать не удалось (не ноль: нуля мы не знаем). */
  rowCount: number | null;
  /** Почему не прочитан — русская фраза из закрытого списка. */
  reason?: string;
}

export interface SourcesHealth {
  state: 'ok' | 'degraded' | 'unknown';
  /** Одна фраза для человека: сколько прочитано и что именно молчит. */
  summary: string;
  total: number;
  loaded: number;
  failed: number;
  /** Самое свежее успешное чтение среди всех источников. */
  lastSuccessAt: string | null;
  items: SourceHealthItem[];
}

export interface HealthReport {
  status: 'ok';
  timestamp: string;
  service: 'aemr-server';
  sources: SourcesHealth;
}

/**
 * Причина отказа источника русской фразой. Наружу идёт только результат этой
 * классификации: исходный текст Google несёт и адрес книги, и почту учётной
 * записи, а маршрут публичный. Подробность остаётся в журнале сервера.
 *
 * Сама классификация живёт в services/source-failure.ts и используется ещё и
 * журналом сервера. Здесь она ТОЛЬКО переизлучается: две одинаковые копии
 * (а именно так и было — байт в байт) означают две правды о том, что такое
 * «403», и расходятся они молча, при первой же правке одной из них.
 */
export { classifySourceFailure };

function svodItem(): SourceHealthItem {
  const grid = getSvodGridCache();
  const failure = getSvodLoadFailure();

  // Отказ в последнем цикле важнее прежнего успеха: лист, который сегодня не
  // читается, обязан числиться непрочитанным, даже если вчера прочитался. Ради
  // честности время прошлого успеха остаётся видимым — оно и говорит, насколько
  // стары числа, собранные на этой сетке.
  if (failure) {
    return {
      name: SVOD_SHEET_NAME,
      state: 'failed',
      loadedAt: grid?.loadedAt ?? null,
      checkedAt: failure.checkedAt,
      rowCount: null,
      reason: failure.error,
    };
  }

  if (!grid) {
    return {
      name: SVOD_SHEET_NAME,
      state: 'pending',
      loadedAt: null,
      checkedAt: null,
      rowCount: null,
      reason: 'ещё не читался с запуска сервера',
    };
  }
  return {
    name: SVOD_SHEET_NAME,
    state: 'ok',
    loadedAt: grid.loadedAt,
    checkedAt: grid.loadedAt,
    rowCount: grid.values.length,
  };
}

/**
 * Помесячный лист «СВОД с месяцами» — третий источник наравне с книгами и
 * листом СВОД. В картине здоровья его не было вовсе, и фраза «прочитаны все
 * источники» звучала даже тогда, когда весь помесячный официал не прочитан.
 */
function monthlyItem(): SourceHealthItem {
  const meta = getSHDYULoadMeta();
  if (meta.error) {
    return {
      name: SHDYU_MONTHLY_SHEET_NAME,
      state: 'failed',
      loadedAt: meta.loadedAt,
      checkedAt: meta.checkedAt,
      rowCount: null,
      // Причина классифицируется здесь же: сохранённый текст отказа несёт
      // сообщение Google, а маршрут публичный.
      reason: classifySourceFailure(meta.error),
    };
  }
  if (!meta.loadedAt) {
    return {
      name: SHDYU_MONTHLY_SHEET_NAME,
      state: 'pending',
      loadedAt: null,
      checkedAt: meta.checkedAt,
      rowCount: null,
      reason: 'ещё не читался с запуска сервера',
    };
  }
  return {
    name: SHDYU_MONTHLY_SHEET_NAME,
    state: 'ok',
    loadedAt: meta.loadedAt,
    checkedAt: meta.checkedAt,
    rowCount: meta.rowCount,
  };
}

function departmentItems(): SourceHealthItem[] {
  const meta = getDeptLoadMeta();
  // Перебираем НАСТРОЕННЫЕ книги, а не только прочитанные: управление, до
  // которого ни разу не дошли, обязано числиться непрочитанным, а не исчезнуть
  // из списка и тем самым улучшить картину.
  return Object.keys(DEPARTMENT_SPREADSHEETS).map((name) => {
    const entry = meta[name];
    if (!entry) {
      return {
        name,
        state: 'pending' as const,
        loadedAt: null,
        checkedAt: null,
        rowCount: null,
        reason: 'ещё не читалась с запуска сервера',
      };
    }
    if (entry.error) {
      return {
        name,
        state: 'failed' as const,
        loadedAt: null,
        checkedAt: entry.loadedAt,
        rowCount: null,
        reason: classifySourceFailure(entry.error),
      };
    }
    return {
      name,
      state: 'ok' as const,
      loadedAt: entry.loadedAt,
      checkedAt: entry.loadedAt,
      rowCount: entry.rowCount,
    };
  });
}

function summarize(items: readonly SourceHealthItem[]): SourcesHealth {
  const loaded = items.filter((i) => i.state === 'ok');
  const failed = items.filter((i) => i.state === 'failed');
  const pending = items.filter((i) => i.state === 'pending');

  const lastSuccessAt = loaded.reduce<string | null>(
    (latest, item) => (item.loadedAt && (!latest || item.loadedAt > latest) ? item.loadedAt : latest),
    null,
  );

  const base = {
    total: items.length,
    loaded: loaded.length,
    failed: failed.length,
    lastSuccessAt,
    items: [...items],
  };

  if (loaded.length === 0 && failed.length === 0) {
    return { state: 'unknown', summary: 'Источники ещё не читались с запуска сервера', ...base };
  }
  if (failed.length === 0 && pending.length === 0) {
    return { state: 'ok', summary: `Прочитаны все источники: ${items.length}`, ...base };
  }

  const silent = [...failed, ...pending]
    .map((i) => `${i.name} (${i.reason ?? 'причина не установлена'})`)
    .join(', ');
  return {
    state: 'degraded',
    summary: `Прочитано ${loaded.length} из ${items.length}. Не прочитаны: ${silent}`,
    ...base,
  };
}

/** Собирает ответ. Ни при каких условиях не бросает: это проверка живости. */
export function buildHealthReport(now: Date = new Date()): HealthReport {
  let sources: SourcesHealth;
  try {
    sources = summarize([svodItem(), monthlyItem(), ...departmentItems()]);
  } catch {
    sources = {
      state: 'unknown',
      summary: 'Состояние источников сейчас недоступно',
      total: 0,
      loaded: 0,
      failed: 0,
      lastSuccessAt: null,
      items: [],
    };
  }

  return {
    status: 'ok',
    timestamp: now.toISOString(),
    service: 'aemr-server',
    sources,
  };
}

/**
 * Готовность принимать работу — не то же самое, что живость.
 *
 * Различие взято из практики оркестраторов и нужно здесь буквально: процесс
 * поднимается за доли секунды, а книги управлений читаются с Google десятки
 * секунд. В это окно сервер ЖИВ (перезапускать его нечего) и при этом ещё НЕ
 * ГОТОВ (числа показывать не из чего). Единственная прежняя проверка отвечала
 * `status: 'ok'` уже в первую секунду, поэтому связка объявляла версию
 * работающей и пускала на неё читателей на пустой продукт.
 *
 * Граница проведена по числу прочитанных источников: прочитан хотя бы один —
 * продукту есть что показать; ни одного — 503 с причиной. Отказ отдельной
 * книги готовности не отменяет: восемь управлений из девяти это рабочее
 * состояние, а не повод убрать сервер из выдачи.
 */
export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  timestamp: string;
  /** Та же фраза, что и в /api/health: сколько прочитано и что молчит. */
  summary: string;
  loaded: number;
  total: number;
}

export function buildReadinessReport(now: Date = new Date()): ReadinessReport {
  const { sources } = buildHealthReport(now);
  return {
    status: sources.loaded > 0 ? 'ready' : 'not_ready',
    timestamp: now.toISOString(),
    summary: sources.summary,
    loaded: sources.loaded,
    total: sources.total,
  };
}

/**
 * Объявленная форма ответа о здоровье.
 *
 * Здесь она не про скорость, а про закрытую дверь. Маршрут ПУБЛИЧНЫЙ, и всё,
 * что случайно окажется в объекте — идентификатор книги, адрес, почта служебной
 * учётной записи, сырой текст отказа Google, — уйдёт в мир без единого вопроса.
 * Объявленная схема отдаёт наружу ровно перечисленные поля и вырезает любое
 * другое: документация Fastify (Guides/Getting-Started.md, «Serialize your
 * data») называет это второй, помимо скорости, причиной объявлять форму ответа.
 *
 * Состав повторяет интерфейсы выше буква в букву. Разошлись — вырежется поле,
 * и это увидит страж routes/health.test.ts.
 */
const SOURCE_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    state: { type: 'string' },
    loadedAt: { type: ['string', 'null'] },
    checkedAt: { type: ['string', 'null'] },
    rowCount: { type: ['number', 'null'] },
    reason: { type: 'string' },
  },
} as const;

export const HEALTH_RESPONSE_SCHEMA = {
  200: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string' },
      timestamp: { type: 'string' },
      service: { type: 'string' },
      sources: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string' },
          summary: { type: 'string' },
          total: { type: 'number' },
          loaded: { type: 'number' },
          failed: { type: 'number' },
          lastSuccessAt: { type: ['string', 'null'] },
          items: { type: 'array', items: SOURCE_ITEM_SCHEMA },
        },
      },
    },
  },
} as const;

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', { schema: { response: HEALTH_RESPONSE_SCHEMA } }, async () =>
    buildHealthReport(),
  );

  /**
   * Живость: отвечает ли процесс вообще. Ничего не читает и не считает —
   * значит, не может ни подвиснуть на источнике, ни соврать из-за него.
   */
  const live = async () => ({ status: 'ok' as const, service: 'aemr-server' as const });

  const ready = async (_request: FastifyRequest, reply: FastifyReply) => {
    const report = buildReadinessReport();
    return reply.status(report.status === 'ready' ? 200 : 503).send(report);
  };

  // Адреса ВНЕ /api: проверка ключа доступа охраняет только /api/*, а
  // оркестратору (healthcheck связки, балансировщик) ключа не выдают. Под /api
  // те же проверки заведены рядом — их дёргает вкладка «Подключение», у
  // которой ключ есть.
  app.get('/health/live', live);
  app.get('/health/ready', ready);
  app.get('/api/health/live', live);
  app.get('/api/health/ready', ready);
}
