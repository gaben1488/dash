/**
 * GET /api/report — страница «Отчёт» как серверная проекция (волна 2A,
 * спека docs/superpowers/specs/2026-07-13-report-2-0-product-design.md §5).
 *
 * Роут — тонкий адаптер над чистым buildReport из @aemr/core: собирает вход
 * из живых источников и не добавляет собственной счётной семантики.
 *   - строки-атомы: кэш книг ГРБС (deptSheetCache, ключи — кириллические
 *     короткие имена), шапка в DEPT_HEADER_ROWS строки срезается здесь;
 *   - официал: лист СВОД ТД-ПМ через parseSvodGrid; лист недоступен —
 *     отчёт отдаётся без официальной колонки, buildReport ставит плашку;
 *   - сигналы: issues снапшота того же года (демо-снапшот — не источник).
 *
 * Параметры (все опциональны):
 *   year     план-год среза (2020..2100); дефолт — год даты среза;
 *   quarter  отчётный квартал 1..4; дефолт — календарный квартал даты среза;
 *   asOf     дата среза YYYY-MM-DD; дефолт — ПОСЛЕДНИЙ ЧЕТВЕРГ (еженедельный
 *            канон: срез отчёта — четверг; явный asOf уважается как задан).
 * Дефолты документированы и в METHODOLOGY ответа.
 */
import type { FastifyInstance } from 'fastify';
import { buildReport, type BuildReportInput } from '@aemr/core';
import {
  DEPT_HEADER_ROWS,
  SVOD_SHEET_NAME,
  dayNumberOf,
  findDept,
  parseSvodGrid,
  type Issue,
  type SvodGridBlock,
} from '@aemr/shared';
import { getDeptSheetValues, getSnapshot } from '../services/snapshot.js';
import { getSheetData } from '../services/google-sheets.js';

/** Методология отчёта — та же строка уходит читателю страницы. */
const METHODOLOGY =
  'Исполнение квартала — канон G = E/D листа СВОД: D — процедуры плана квартала ' +
  '(столбцы O/P), E — из них заключённые (есть дата в столбце Q), накопительно на дату среза. ' +
  'Числа origin=calc пересчитаны из строк-атомов книг ГРБС каноническим движком; ' +
  'origin=svod — ячейки официального листа СВОД ТД-ПМ без пересчёта (двухисточниковость: ' +
  'расхождение видно, подмены нет). Экономия — только утверждённая (флаг AD=«да» + дата факта). ' +
  'Деньги — тыс. руб., трёхсрез ФБ/КБ/МБ. Срез отчёта — еженедельный, ЧЕТВЕРГ: без явного asOf ' +
  'берётся последний четверг (квартал и год — из этой даты среза).';

interface ReportQuery {
  year?: string;
  quarter?: string;
  asOf?: string;
}

/** Разобранный период среза или честная ошибка валидации (текст для 400). */
type PeriodParse =
  | { ok: true; year: number; quarter: 1 | 2 | 3 | 4; asOfDay: number }
  | { ok: false; message: string };

/**
 * Период из query: asOf → компоненты даты среза (без TZ-сдвигов — разбор
 * строки, не Date-парс), year/quarter поверх — явные значения побеждают дефолт.
 *
 * ДЕФОЛТ БЕЗ asOf — ПОСЛЕДНИЙ ЧЕТВЕРГ (канон пользователя 23.07: отчёты
 * еженедельные, срез — четверг). Арифметика: день 0 эпохи (1970-01-01) —
 * четверг, поэтому floorToThursday(d) = d − (d % 7). Год/квартал-дефолты
 * выводятся из ЭТОЙ даты среза (в пятницу 01.10 отчёт по умолчанию — на
 * четверг 30.09, т.е. ещё Q3). Явный asOf уважается как задан, без флора.
 */
const DAYS_PER_WEEK = 7;
const floorToThursday = (day: number): number => day - (day % DAYS_PER_WEEK);

function parsePeriod(query: ReportQuery): PeriodParse {
  let sliceYear: number;
  let sliceMonth: number; // 0-based, для квартала
  let asOfDay: number;
  if (query.asOf !== undefined) {
    const m = query.asOf.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const day = dayNumberOf(query.asOf);
    if (!m || day === null) {
      return { ok: false, message: `Параметр asOf «${query.asOf}» не является датой формата YYYY-MM-DD.` };
    }
    sliceYear = parseInt(m[1], 10);
    sliceMonth = parseInt(m[2], 10) - 1;
    asOfDay = day;
  } else {
    asOfDay = floorToThursday(dayNumberOf(new Date())!);
    const sliceDate = new Date(asOfDay * 86400000);
    sliceYear = sliceDate.getUTCFullYear();
    sliceMonth = sliceDate.getUTCMonth();
  }

  let year = sliceYear;
  if (query.year !== undefined) {
    const parsed = Number(query.year);
    if (!Number.isInteger(parsed) || parsed < 2020 || parsed > 2100) {
      return { ok: false, message: `Параметр year «${query.year}» вне диапазона 2020..2100.` };
    }
    year = parsed;
  }

  let quarter = (Math.floor(sliceMonth / 3) + 1) as 1 | 2 | 3 | 4;
  if (query.quarter !== undefined) {
    const parsed = Number(query.quarter);
    if (parsed !== 1 && parsed !== 2 && parsed !== 3 && parsed !== 4) {
      return { ok: false, message: `Параметр quarter «${query.quarter}» не является кварталом 1..4.` };
    }
    quarter = parsed;
  }

  return { ok: true, year, quarter, asOfDay };
}

/** Кэш книг ГРБС → строки-атомы без шапки; не-ГРБС листы кэша отсеиваются. */
function collectRowsByDept(): Record<string, unknown[][]> {
  const rowsByDept: Record<string, unknown[][]> = {};
  for (const [name, values] of Object.entries(getDeptSheetValues())) {
    if (!findDept(name)) continue;
    if (values.length <= DEPT_HEADER_ROWS) continue;
    rowsByDept[name] = values.slice(DEPT_HEADER_ROWS);
  }
  return rowsByDept;
}

/** Официальный лист СВОД ТД-ПМ; недоступен/пуст → undefined (плашка в notes). */
async function readSvodGrid(): Promise<SvodGridBlock[] | undefined> {
  try {
    const values = await getSheetData(SVOD_SHEET_NAME);
    const grid = parseSvodGrid(values);
    return grid.length > 0 ? grid : undefined;
  } catch {
    return undefined;
  }
}

/** Сигналы снапшота года; демо-фолбэк и отказ снапшота — честные «без сигналов». */
async function readIssues(year: number): Promise<Issue[]> {
  try {
    const snapshot = await getSnapshot(false, year);
    return snapshot.id.startsWith('demo-') ? [] : snapshot.issues;
  } catch {
    return [];
  }
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ReportQuery }>('/api/report', async (request, reply) => {
    const period = parsePeriod(request.query);
    if (!period.ok) {
      return reply.status(400).send({ error: 'BadRequest', message: period.message, statusCode: 400 });
    }

    const rowsByDept = collectRowsByDept();
    if (Object.keys(rowsByDept).length === 0) {
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        message:
          'Кэш книг ГРБС пуст — данные ещё не загружены (стартовый preload не выполнен ' +
          'или Google Sheets недоступен). Повторите запрос позже.',
        statusCode: 503,
      });
    }

    const [svodGrid, issues] = await Promise.all([readSvodGrid(), readIssues(period.year)]);

    const input: BuildReportInput = { rowsByDept, ...(svodGrid ? { svodGrid } : {}), issues };
    const report = buildReport(input, {
      year: period.year,
      quarter: period.quarter,
      asOfDay: period.asOfDay,
    });

    return { ...report, methodology: METHODOLOGY };
  });
}
