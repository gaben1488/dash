/**
 * GET /api/changes — правки книг ГРБС с даты последнего среза.
 *
 * Ответ на прямую просьбу коллеги: «кто что поменял с даты последнего
 * среза». Источник — вкладка «_ChangeLog» каждой книги (журнал Apps Script
 * с автором, временем и адресом); разбор — services/changelog.ts.
 *
 * ?since=YYYY-MM-DD — момент среза; без параметра — последний прошедший
 * четверг (канон недельного среза). Кэш пять минут: журналы суммарно
 * ~37 тыс. строк, дёргать девять книг на каждый рендер страницы незачем.
 */
import type { FastifyInstance } from 'fastify';
import { dayNumberOf, floorToThursday, isoOfDayNumber } from '@aemr/shared';
import { DEPARTMENT_SPREADSHEETS, config } from '../config.js';
import { productCalendarDay } from '../services/product-calendar.js';
import { getSheetDataFromSpreadsheet } from '../services/google-sheets.js';
import { changesSince, parseChangeLog, type ChangeRecord } from '../services/changelog.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; records: ChangeRecord[]; failedDepts: string[] } | null = null;

/**
 * Журналы всех книг. Книга, которая НЕ ответила, попадает в failedDepts:
 * для страницы провенанса тихий пропуск — ложное «этот ГРБС ничего не менял»
 * (code-review 03.08). Частичный результат не кэшируется: иначе отказ живёт
 * пять минут после того, как книга ожила.
 */
async function readAllChangeLogs(): Promise<{ records: ChangeRecord[]; failedDepts: string[] }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { records: cache.records, failedDepts: cache.failedDepts };
  }
  const entries = Object.entries(DEPARTMENT_SPREADSHEETS);
  const failedDepts: string[] = [];
  const parts = await Promise.all(entries.map(async ([dept, spreadsheetId]) => {
    try {
      const rows = await getSheetDataFromSpreadsheet(spreadsheetId, '_ChangeLog');
      return parseChangeLog(rows, dept);
    } catch {
      failedDepts.push(dept);
      return [];
    }
  }));
  const records = parts.flat();
  if (failedDepts.length === 0) cache = { at: Date.now(), records, failedDepts };
  return { records, failedDepts };
}

export async function changesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { since?: string } }>('/api/changes', async (request, reply) => {
    let sinceDay: number | null = null;
    if (request.query.since !== undefined) {
      sinceDay = dayNumberOf(request.query.since);
      // Формат мало проверить: Date.UTC переваливает «2026-06-31» в 1 июля
      // и окно тихо стартовало бы с чужой даты (code-review 03.08).
      if (sinceDay === null || isoOfDayNumber(sinceDay) !== request.query.since) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: `Параметр since «${request.query.since}» не является датой YYYY-MM-DD.`,
          statusCode: 400,
        });
      }
    } else {
      // Календарь ПРОДУКТА (+12), не машины: прод живёт в UTC, и в окне
      // среда 12:00 — четверг 00:00 UTC дефолт уезжал на неделю назад.
      // Та же ось недели, что у /api/report (currentProductThursday).
      sinceDay = floorToThursday(productCalendarDay(new Date(), config.weeklySnapshot.utcOffsetHours));
    }

    const sinceMs = sinceDay * 86400000;
    const { records: all, failedDepts } = await readAllChangeLogs();
    const records = changesSince(all, sinceMs);
    return {
      since: isoOfDayNumber(sinceDay),
      total: records.length,
      records,
      // Книги, которые не ответили: страница обязана сказать об этом вслух,
      // иначе «правок нет» неотличимо от «источник молчит».
      ...(failedDepts.length > 0 ? { failedDepts } : {}),
    };
  });
}
