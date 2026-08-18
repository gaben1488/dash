/**
 * GET /api/monitoring — реестр процедур определения поставщика из книги
 * «Ежедневный мониторинг» (канон п.69в: отдельная вкладка; п.101а: название
 * с «Реестром процедур»; спека docs/superpowers/specs/2026-08-14-daily-monitoring-tab.md).
 *
 * Роут — тонкий адаптер: чтение листов — services/monitoring.ts (кэш,
 * дедупликация, честные отказы по листам), разбор строк и агрегаты —
 * @aemr/core (чистые функции, покрыты юнит-тестами). Собственной счётной
 * семантики здесь нет.
 *
 * Правила ответа:
 *  - деньги — РУБЛИ (решение владельца 18.08; книги ГРБС — тысячи), и ответ
 *    называет единицу прямо в source.moneyUnit — экран обязан её подписать;
 *  - момент чтения книги едет в source.readAt — плашка периода данных (п.58);
 *  - непрочитанные листы перечислены поимённо (source.sheetsFailed) — счёт
 *    по прочитанным листам объявляется неполным, а не выдаётся за целый;
 *  - строки с неразобранным кодом процедуры — отдельным списком с адресами
 *    (unparsedCodes): искажение формата — сигнал, не молчаливая потеря.
 */
import type { FastifyInstance } from 'fastify';
import {
  MONITORING_DEPT_SHEETS,
  aggregateMonitoring,
  parseMonitoringProcedures,
  type MonitoringAggregates,
  type MonitoringProcedure,
  type UnparsedCodeRef,
} from '@aemr/core';
import { getMonitoringBook } from '../services/monitoring.js';

export interface MonitoringResponsePayload {
  source: {
    /** Название книги-источника — для плашки периметра. */
    bookName: string;
    /** Момент чтения книги (ISO) — «данные на …» (п.58). */
    readAt: string;
    /** Единица денег ответа. Книги ГРБС — тысячи; здесь — рубли (18.08). */
    moneyUnit: 'руб';
    sheetsRead: string[];
    /** Лист → русская причина отказа. Пусто — прочитано всё. */
    sheetsFailed: Record<string, string>;
  };
  procedures: MonitoringProcedure[];
  aggregates: MonitoringAggregates;
  unparsedCodes: UnparsedCodeRef[];
  notes: string[];
}

export async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { refresh?: string } }>('/api/monitoring', async (request, reply) => {
    const book = await getMonitoringBook(request.query.refresh === 'true');
    const sheetsRead = Object.keys(book.sheets);

    if (sheetsRead.length === 0) {
      // Ни один лист не прочитан — реестра нет. 503, а не пустой 200:
      // «книга недоступна» и «в книге нет процедур» — разные новости.
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        message:
          'Книга «Ежедневный мониторинг» не прочитана: ни один лист управлений не ответил. '
          + 'Повторите запрос позже.',
        statusCode: 503,
      });
    }

    const registry = parseMonitoringProcedures(book.sheets);
    const aggregates = aggregateMonitoring(registry);

    const notes: string[] = [
      'Деньги книги мониторинга — в рублях (книги управлений ведутся в тысячах рублей).',
    ];
    const failedNames = Object.keys(book.failed);
    if (failedNames.length > 0) {
      notes.push(
        `Листы не прочитаны: ${failedNames.join(', ')} — счётчики собраны только по прочитанным листам и неполные.`,
      );
    }
    if (registry.unparsedCodes.length > 0) {
      notes.push(
        `Строк с нераспознанным кодом процедуры: ${registry.unparsedCodes.length} — они входят в счётчики, адреса перечислены отдельно.`,
      );
    }

    return {
      source: {
        bookName: 'Ежедневный мониторинг',
        readAt: book.readAt,
        moneyUnit: 'руб',
        // Порядок листов — канонический порядок книги, не порядок ответов сети.
        sheetsRead: MONITORING_DEPT_SHEETS
          .map(({ sheet }) => sheet)
          .filter((sheet) => sheet in book.sheets),
        sheetsFailed: book.failed,
      },
      procedures: registry.procedures,
      aggregates,
      unparsedCodes: registry.unparsedCodes,
      notes,
    } satisfies MonitoringResponsePayload;
  });
}
