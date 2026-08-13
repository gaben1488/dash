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
import type { FastifyInstance } from 'fastify';
import { SVOD_SHEET_NAME } from '@aemr/shared';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { getDeptLoadMeta, getSvodGridCache } from '../services/snapshot.js';

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
 */
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

function svodItem(): SourceHealthItem {
  const grid = getSvodGridCache();
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
    sources = summarize([svodItem(), ...departmentItems()]);
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

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => buildHealthReport());
}
