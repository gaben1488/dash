/**
 * /api/timeline — таймлайн строки книги ГРБС по всей истории проекта.
 *
 * КАНОН п.75 (реестр интервью 14.08.2026):
 *   75б — «закупки, БЛИЗКИЕ к реализации: произойдут ли сейчас или есть
 *         нюансы — риск-статус по мере приближения к плановой дате»;
 *   75в — «относительно плановой даты показывать ВСЕ изменения по строке,
 *         ОСОБЕННО просрочки — по всей истории проекта».
 *
 * Три источника истории (сборка — @aemr/core buildRowTimeline):
 *   а) журнал правок книг (_ChangeLog → таблица changelog_entries) — жив с
 *      06.08.2026; отказ БД не валит роут, а честно помечается;
 *   б) снимки сервера: строки-атомы procurement_rows + момент снимка;
 *      глубина — какая реально накоплена в SQL, не выдумывается;
 *   в) срезы трёх архивных недель (фикстуры ручного отчёта 08.05/29.05/26.06)
 *      — точки ДО журнала; строка опознаётся структурным ключом-содержимым.
 *
 * Просрочка — СТРУКТУРНО (п.27): плановая дата прошла, заключения нет.
 * Свободный текст комментариев машинно не интерпретируется нигде.
 *
 * Регистрацию в app.ts выполняет интеграционная волна (гейт).
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import {
  DEPT_COLUMNS,
  DEPT_HEADER_ROWS,
  buildCellDict,
  collectRowsByDept,
  findDept,
  isoOfDayNumber,
  productCalendarDay,
} from '@aemr/shared';
import {
  buildRowTimeline,
  buildUpcoming,
  weekSliceObservations,
  type JournalCellChange,
  type RowObservation,
  type UpcomingInputRow,
} from '@aemr/core';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { getDeptSheetValues, getSnapshot } from '../services/snapshot.js';
import { buildRowDto, isDataRow } from '../services/rows-dto.js';

/** «Сегодня» календаря продукта (Камчатка +12), как у /api/report и /api/changes. */
const productToday = (): number =>
  productCalendarDay(new Date(), config.weeklySnapshot.utcOffsetHours);

/** Окно «близких к реализации» по умолчанию и потолок (год — дальше не «близко»). */
const DEFAULT_UPCOMING_DAYS = 14;
const MAX_UPCOMING_DAYS = 366;

/**
 * Строки книг для сводных расчётов: живой кэш книг ГРБС (канонический
 * периметр /api/report), при пустом кэше — rowsByDept последнего снимка.
 * Ключи — кириллические имена листов.
 */
async function readAllDeptRows(): Promise<Record<string, unknown[][]>> {
  const live = collectRowsByDept(getDeptSheetValues());
  if (Object.keys(live).length > 0) return live;
  try {
    const snapshot = await getSnapshot();
    if (snapshot.rowsByDept && Object.keys(snapshot.rowsByDept).length > 0) {
      return snapshot.rowsByDept;
    }
  } catch {
    // источники молчат — честный пустой результат, роут ответит 503
  }
  return {};
}

/**
 * Журнал правок книги из БД. Таблицу changelog_entries наполняет /api/changes
 * (drizzle-миграции ad-hoc): её может ещё не быть — тогда журнал честно
 * недоступен (available=false), а не «правок не было».
 */
function readJournal(deptId: string): { available: boolean; changes: JournalCellChange[] } {
  try {
    const rows = db
      .select({
        cell: schema.changelogEntries.cell,
        oldValue: schema.changelogEntries.oldValue,
        newValue: schema.changelogEntries.newValue,
        atMs: schema.changelogEntries.atMs,
      })
      .from(schema.changelogEntries)
      .where(eq(schema.changelogEntries.dept, deptId))
      .all();
    return {
      available: true,
      changes: rows.map((r) => ({
        cell: r.cell,
        oldValue: r.oldValue ?? '',
        newValue: r.newValue ?? '',
        atMs: r.atMs,
      })),
    };
  } catch {
    return { available: false, changes: [] };
  }
}

/**
 * Наблюдения строки в сохранённых снимках: строки-атомы procurement_rows
 * (cellsJson по буквам) + момент снимка. Глубина — сколько реально лежит в
 * SQL (ретеншен: ежедневные — неделя, четверг-срезы — вся история).
 */
function readSnapshotObservations(latinId: string, sheetRow: number): RowObservation[] {
  try {
    const rows = db
      .select({
        cellsJson: schema.procurementRows.cellsJson,
        createdAt: schema.snapshots.createdAt,
      })
      .from(schema.procurementRows)
      .innerJoin(schema.snapshots, eq(schema.procurementRows.snapshotId, schema.snapshots.id))
      .where(and(
        eq(schema.procurementRows.departmentId, latinId),
        eq(schema.procurementRows.rowIndex, sheetRow),
      ))
      .orderBy(asc(schema.snapshots.createdAt))
      .all();
    const out: RowObservation[] = [];
    for (const r of rows) {
      try {
        out.push({
          at: r.createdAt,
          source: 'снимок',
          cells: JSON.parse(r.cellsJson) as Record<string, unknown>,
        });
      } catch {
        // повреждённый cellsJson — наблюдение пропускается, не валит таймлайн
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/timeline/upcoming?days=N — «близкие к реализации» (п.75б):
   * строки без заключения с плановой датой в ближайшие N дней ЛИБО уже
   * просроченные; каждая — с риск-контекстом (дни, живая причина по словарю
   * 2.0, номер процедуры из AG, стадия мониторинга — пока связки нет, null).
   */
  app.get<{ Querystring: { days?: string } }>('/api/timeline/upcoming', async (request, reply) => {
    let days = DEFAULT_UPCOMING_DAYS;
    if (request.query.days !== undefined) {
      const parsed = Number(request.query.days);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_UPCOMING_DAYS) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: `Параметр days «${request.query.days}» не подходит: нужно целое число дней от 1 до ${MAX_UPCOMING_DAYS}.`,
          statusCode: 400,
        });
      }
      days = parsed;
    }

    const rowsByDept = await readAllDeptRows();
    if (Object.keys(rowsByDept).length === 0) {
      return reply.status(503).send({
        error: 'ServiceUnavailable',
        message: 'Книги ГРБС не прочитаны и сохранённого снимка нет — список «близких к реализации» собрать не из чего. Обновите данные и повторите.',
        statusCode: 503,
      });
    }

    const inputRows: UpcomingInputRow[] = [];
    for (const [sheetName, rows] of Object.entries(rowsByDept)) {
      const dept = findDept(sheetName);
      if (!dept) continue;
      rows.forEach((row, idx) => {
        if (!Array.isArray(row)) return;
        const dto = buildRowDto(row, idx, { deptId: dept.id });
        if (!isDataRow(dto)) return; // служебные строки листа — не закупки
        inputRows.push({ dept: dept.id, sheetRow: dto.rowIndex, cells: buildCellDict(row) });
      });
    }

    const asOfDay = productToday();
    const upcoming = buildUpcoming(inputRows, { asOfDay, days });
    return reply.send({
      asOf: isoOfDayNumber(asOfDay),
      days,
      total: upcoming.length,
      rows: upcoming,
      // Стадия мониторинга появится со вкладкой «Ежедневный мониторинг»;
      // пока связки нет — поле у строк честно null, и это сказано вслух.
      monitoringLinked: false,
    });
  });

  /**
   * GET /api/timeline/:deptId/:sheetRow — таймлайн одной строки (п.75в).
   * sheetRow — номер строки ЛИСТА (1-based, как в книге; данные — с 4-й).
   */
  app.get<{ Params: { deptId: string; sheetRow: string } }>(
    '/api/timeline/:deptId/:sheetRow',
    async (request, reply) => {
      const dept = findDept(request.params.deptId);
      if (!dept) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Управление «${request.params.deptId}» не найдено в реестре ГРБС.`,
          statusCode: 404,
        });
      }
      const sheetRow = Number(request.params.sheetRow);
      if (!Number.isInteger(sheetRow) || sheetRow <= DEPT_HEADER_ROWS) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: `Номер строки «${request.params.sheetRow}» не подходит: данные листа начинаются со строки ${DEPT_HEADER_ROWS + 1}.`,
          statusCode: 400,
        });
      }

      // а) Журнал правок из БД — только записи адресов этой строки.
      const journal = readJournal(dept.id);
      const rowAddressRe = new RegExp(`^[A-Z]{1,2}${sheetRow}$`, 'i');
      const journalChanges = journal.changes.filter((c) => rowAddressRe.test(c.cell.trim()));

      // б) Наблюдения из сохранённых снимков (SQL).
      const observations = readSnapshotObservations(dept.latinId, sheetRow);

      // Текущее состояние — живой кэш книги: последняя точка таймлайна.
      const liveValues = getDeptSheetValues()[dept.id];
      const liveRow = liveValues?.[sheetRow - 1];
      if (Array.isArray(liveRow)) {
        observations.push({
          at: new Date().toISOString(),
          source: 'снимок',
          cells: buildCellDict(liveRow),
        });
      }

      if (observations.length === 0 && journalChanges.length === 0) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Строка ${sheetRow} книги «${dept.id}» не найдена ни в живых данных, ни в сохранённых снимках, ни в журнале правок.`,
          statusCode: 404,
        });
      }

      // в) Срезы архивных недель — по структурному ключу-содержимому (A+C+G)
      //    из самого свежего известного состояния строки.
      const newest = observations.length > 0 ? observations[observations.length - 1].cells : null;
      let weekSliceDates: string[] = [];
      if (newest) {
        const slices = weekSliceObservations({
          dept: dept.id,
          id: newest[letterOf('ID')],
          subordinate: newest[letterOf('SUBORDINATE')],
          subject: newest[letterOf('SUBJECT')],
        });
        weekSliceDates = slices.map((s) => s.at);
        for (const slice of slices) {
          observations.push({ at: slice.at, source: 'срез недели', cells: slice.cells });
        }
      }

      const timeline = buildRowTimeline({
        rowKey: `${dept.id}:${sheetRow}`,
        sheetRow,
        journal: journalChanges,
        observations,
        asOfDay: productToday(),
      });

      return reply.send({
        ...timeline,
        coverage: {
          /** Журнал правок: false — таблица журнала недоступна (не «правок не было»). */
          journalAvailable: journal.available,
          journalEntries: journalChanges.length,
          /** Сколько сохранённых снимков реально несут эту строку. */
          snapshotObservations: observations.filter((o) => o.source === 'снимок').length,
          /** Какие архивные срезы недель опознали строку. */
          weekSliceDates,
        },
      });
    },
  );
}

/** Буква колонки по канон-имени DEPT_COLUMNS («SUBJECT» → «G»). */
function letterOf(name: keyof typeof DEPT_COLUMNS): string {
  const idx = DEPT_COLUMNS[name];
  // A=0..Z=25, AA=26..AH=33 — обратная форма COL_LETTER_INDEX.
  if (idx < 26) return String.fromCharCode(65 + idx);
  return `A${String.fromCharCode(65 + idx - 26)}`;
}
