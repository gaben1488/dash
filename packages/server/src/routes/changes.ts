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
import { dayNumberOf, floorToThursday } from '@aemr/shared';
import { DEPARTMENT_SPREADSHEETS } from '../config.js';
import { getSheetDataFromSpreadsheet } from '../services/google-sheets.js';
import { changesSince, parseChangeLog, type ChangeRecord } from '../services/changelog.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; records: ChangeRecord[] } | null = null;

async function readAllChangeLogs(): Promise<ChangeRecord[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.records;
  const entries = Object.entries(DEPARTMENT_SPREADSHEETS);
  const parts = await Promise.all(entries.map(async ([dept, spreadsheetId]) => {
    try {
      const rows = await getSheetDataFromSpreadsheet(spreadsheetId, '_ChangeLog');
      return parseChangeLog(rows, dept);
    } catch {
      // Книга без журнала — не ошибка страницы: отдаём, что прочлось.
      return [];
    }
  }));
  const records = parts.flat();
  cache = { at: Date.now(), records };
  return records;
}

export async function changesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { since?: string } }>('/api/changes', async (request, reply) => {
    let sinceDay: number | null = null;
    if (request.query.since !== undefined) {
      sinceDay = dayNumberOf(request.query.since);
      if (sinceDay === null) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: `Параметр since «${request.query.since}» не является датой YYYY-MM-DD.`,
          statusCode: 400,
        });
      }
    } else {
      sinceDay = floorToThursday(dayNumberOf(new Date())!);
    }

    const sinceMs = sinceDay * 86400000;
    const all = await readAllChangeLogs();
    const records = changesSince(all, sinceMs);
    return {
      since: new Date(sinceMs).toISOString().slice(0, 10),
      total: records.length,
      records,
    };
  });
}
