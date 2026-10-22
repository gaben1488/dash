/**
 * GET /api/changes — правки книг ГРБС с даты последнего среза.
 *
 * Ответ на прямую просьбу коллеги: «кто что поменял с даты последнего
 * среза». Источник — вкладка «_ChangeLog» каждой книги (журнал Apps Script
 * с автором, временем и адресом); разбор — services/changelog.ts.
 *
 * ?since=YYYY-MM-DD — явная дата; без параметра — четверг предыдущей
 * календарной недели в 18:00 по Камчатке. Кэш привязан к версиям книг;
 * пятиминутное окно остаётся только для неизвестных версий.
 *
 * Прочитанное оседает в таблице changelog_entries и оттуда же отдаётся
 * (пирамида, блок Е п.23): память процесса теряла всю историю правок при
 * рестарте, а молчащая книга выглядела как книга без правок.
 */
import type { FastifyInstance } from 'fastify';
import { desc, getTableColumns, gte, inArray } from 'drizzle-orm';
import { dayNumberOf, liveBaselineDay, weeklyCutoffMs, isoOfDayNumber } from '@aemr/shared';
import { DEPARTMENT_SPREADSHEETS, config } from '../config.js';
import { db, schema } from '../db/index.js';
import { logSourceProblem } from '../services/source-log.js';
import { readChangelogRows, changelogInputKey } from '../services/changelog-source.js';
import { changeEntryIdentity, changesSince, parseChangeLogDetailed, type ChangeRecord, type ChangeLogCoverage } from '../services/changelog.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
type CoverageByBook = Record<string, ChangeLogCoverage>;
let cache: { at: number; key: string | null; records: ChangeRecord[];
  failedDepts: string[]; coverage: CoverageByBook } | null = null;

/**
 * Журналы всех книг. Книга, которая НЕ ответила, попадает в failedDepts:
 * для страницы провенанса тихий пропуск — ложное «этот ГРБС ничего не менял»
 * (code-review 03.08). Частичный результат не кэшируется: иначе отказ живёт
 * пять минут после того, как книга ожила.
 *
 * Сырьё берётся из ОБЩЕГО читателя (services/changelog-source.ts): тот же лист
 * «_ChangeLog» читает страница провенанса и сводка нагрузки, и до сих пор
 * каждый ходил к Google своей дорогой со своим окном. Разбор остаётся здесь
 * свой — он выбрасывает колонку «Строка», которая провенансу нужна как ключ.
 */
async function readAllChangeLogs(): Promise<{
  records: ChangeRecord[]; failedDepts: string[]; coverage: CoverageByBook; fresh: boolean;
}> {
  const key = changelogInputKey(DEPARTMENT_SPREADSHEETS);
  if (cache && cache.key === key && (key !== null || Date.now() - cache.at < CACHE_TTL_MS)) {
    return { records: cache.records, failedDepts: cache.failedDepts,
      coverage: cache.coverage, fresh: false };
  }
  const failedDepts: string[] = [];
  const coverage: CoverageByBook = {};
  const parts = await Promise.all(Object.entries(DEPARTMENT_SPREADSHEETS).map(async ([dept, spreadsheetId]) => {
    try {
      const result = parseChangeLogDetailed(await readChangelogRows(dept, spreadsheetId), dept);
      coverage[dept] = result.coverage;
      return result.records;
    } catch {
      failedDepts.push(dept);
      return [];
    }
  }));
  const records = parts.flat();
  if (failedDepts.length === 0 && changelogInputKey(DEPARTMENT_SPREADSHEETS) === key) {
    cache = { at: Date.now(), key, records, failedDepts, coverage };
  }
  return { records, failedDepts, coverage, fresh: true };
}

/**
 * Устойчивый ключ записи журнала. У правки в источнике нет собственного
 * номера, поэтому опознаём её адресом: книга ГРБС + лист + ячейка + отметка
 * времени + автор + точные значения. Два разных перехода одной ячейки
 * в одну секунду не сливаются в одну запись. Журнал append-only, значит
 * повторное чтение той же правки даёт тот же ключ, и дубли не заводятся.
 */
export function changeEntryKey(r: ChangeRecord): string {
  return changeEntryIdentity(r);
}

/**
 * Потолок связываемых параметров одного SQL-запроса берём по историческому
 * пределу SQLite (999), а не по нынешнему: размер пакета не должен зависеть от
 * того, чем собран better-sqlite3 на конкретной машине.
 */
const MAX_BIND_PARAMS = 900;
const ENTRIES_PER_BATCH = Math.floor(
  MAX_BIND_PARAMS / Object.keys(getTableColumns(schema.changelogEntries)).length,
);

/**
 * Записывает прочитанные правки в БД одной транзакцией пакетами. Возвращает
 * число ДЕЙСТВИТЕЛЬНО новых записей: конфликт по ключу игнорируется, поэтому
 * повторное чтение того же журнала (а он читается каждые пять минут целиком)
 * ничего не удваивает. Дедуп в пределах пакета — не украшение: один и тот же
 * ключ дважды в одном INSERT конфликтует сам с собой.
 */
export function saveChangeLogEntries(records: readonly ChangeRecord[], now: Date = new Date()): number {
  if (records.length === 0) return 0;
  const recordedAt = now.toISOString();
  const byKey = new Map<string, typeof schema.changelogEntries.$inferInsert>();
  const ancestors = new Map<string, { modern: string; ancient: string; occurrence: number }>();
  for (const r of records) {
    const id = changeEntryKey(r);
    const modern = changeEntryIdentity({ ...r, timePrecision: undefined, sourceOccurrence: 0 });
    ancestors.set(id, {
      modern,
      ancient: [r.dept, r.sheet, r.cell, r.atMs, r.author].join('|'),
      occurrence: r.sourceOccurrence ?? 0,
    });
    byKey.set(id, {
      id, dept: r.dept, sheet: r.sheet, cell: r.cell, attribute: r.attribute,
      oldValue: r.oldValue, newValue: r.newValue, atMs: r.atMs,
      author: r.author, recordedAt,
    });
  }

  let written = 0;
  const values = [...byKey.values()];
  db.transaction(tx => {
    for (let i = 0; i < values.length; i += ENTRIES_PER_BATCH) {
      const batch = values.slice(i, i + ENTRIES_PER_BATCH);
      const priorIds = [...new Set(batch.flatMap(value => {
        const previous = ancestors.get(value.id)!;
        return [previous.modern, previous.ancient];
      }))];
      const existing = new Map(tx.select().from(schema.changelogEntries)
        .where(inArray(schema.changelogEntries.id, priorIds))
        .all().map(row => [row.id, row]));
      const pending = batch.filter(value => {
        const prior = ancestors.get(value.id)!;
        // An older release could persist only one of indistinguishable events.
        // Preserve that occurrence, but do NOT discard later identical events.
        if (prior.occurrence > 0) return true;
        for (const id of [prior.modern, prior.ancient]) {
          const row = existing.get(id);
          if (row && row.oldValue === value.oldValue && row.newValue === value.newValue) {
            return false;
          }
        }
        return true;
      });
      if (!pending.length) continue;
      const result = tx.insert(schema.changelogEntries).values(pending).onConflictDoNothing().run();
      written += result.changes;
    }
  });
  return written;
}

/** Правки из БД начиная с момента среза, свежие сверху (порядок как у changesSince). */
/**
 * DB time uses the source's local wall clock encoded in UTC fields.
 * A date-only event at 00:00 on the cutoff day may have occurred later;
 * query from that day's start, then apply a precision-aware final filter.
 */
export function readChangeLogEntriesSince(sinceSourceLocalMs: number): ChangeRecord[] {
  const DAY = 86400000;
  const dayStart = Math.floor(sinceSourceLocalMs / DAY) * DAY;
  const rows = db.select().from(schema.changelogEntries)
    .where(gte(schema.changelogEntries.atMs, dayStart))
    .orderBy(desc(schema.changelogEntries.atMs)).all();
  return changesSince(rows.map(r => ({
    dept: r.dept, sheet: r.sheet, cell: r.cell,
    attribute: r.attribute ?? '', oldValue: r.oldValue ?? '',
    newValue: r.newValue ?? '', atMs: r.atMs, author: r.author ?? '',
    ...(r.id.startsWith('journal-day-v2:')
      ? { timePrecision: 'day' as const }
      : r.atMs % DAY === 0 ? { timePrecision: 'unknown' as const } : {}),
  })), sinceSourceLocalMs);
}

/**
 * Отказ БД произносится один раз за жизнь процесса: роут дёргается на каждый
 * рендер страницы, и повторяющаяся строка в логе через пять минут перестала бы
 * читаться. Один раз — но громко: без персиста журнал не переживает рестарт, и
 * молчать об этом нельзя.
 */
let dbFailureAnnounced = false;
function announceDbFailure(error: unknown): void {
  if (dbFailureAnnounced) return;
  dbFailureAnnounced = true;
  logSourceProblem(
    'Журнал правок не сохраняется в базу — ответ собран живым чтением книг и рестарт его не переживёт',
    { reason: (error as Error)?.message ?? String(error) },
  );
}

/**
 * ПОЧЕМУ У ЭТОГО МАРШРУТА НЕТ ОБЪЯВЛЕННОЙ ФОРМЫ ОТВЕТА.
 *
 * Это самый длинный ответ продукта: журналы восьми книг дают десятки тысяч
 * записей, около четырёх с половиной мегабайт. Ровно на такое тело документация
 * Fastify (Guides/Getting-Started.md, «Serialize your data») советует объявлять
 * форму ответа и обещает сборку вдвое-втрое быстрее общего `JSON.stringify`.
 * Совет был взят и ЗАМЕРЕН на этом теле (20 тыс. записей, среднее по десяти
 * чередующимся прогонам, Node 22):
 *
 *     общий сериализатор     399 мс
 *     объявленная форма      567 мс   (0.70×)
 *
 * То есть на этом маршруте совет даёт не ускорение, а замедление примерно в
 * полтора раза. Проверено на разных размерах (200, 2000, 20 000 записей) и на
 * латинских данных вместо кириллических — соотношение держится: обещание
 * относится к более старым сборкам V8, а собственный `JSON.stringify` Node 22
 * стал быстрее скомпилированной сборки на телах такого рода.
 *
 * Поэтому здесь объявленной формы нет. Настоящий выигрыш на этом ответе даёт не
 * сборка, а провод: сжатие (plugins/compression.ts) уносит из такого списка
 * подавляющую часть байт, а отпечаток (plugins/http-cache.ts) при неизменившемся
 * журнале не отправляет тело вовсе. Форма ответа объявлена там, где у неё вторая,
 * несомненная польза — на ПУБЛИЧНОМ маршруте /api/health, где она закрывает
 * дверь случайной утечке, а тело мало и цена сборки незаметна.
 *
 * Замер повторяем: routes/changes-serialization.test.ts.
 */
export async function changesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { since?: string } }>('/api/changes', async (request, reply) => {
    let sinceDay: number | null;
    let sinceMs: number;
    if (request.query.since !== undefined) {
      sinceDay = dayNumberOf(request.query.since);
      // Формат мало проверить: Date.UTC переваливает «2026-06-31» в 1 июля
      // и окно тихо стартовало бы с чужой даты (code-review 03.08).
      if (sinceDay === null || isoOfDayNumber(sinceDay) !== request.query.since) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: `Параметр since «${request.query.since}» не является датой YYYY-MM-DD.`,
          statusCode: 400,
          code: 'BAD_REQUEST',
        });
      }
      sinceMs = sinceDay * 86400000;
    } else {
      sinceDay = liveBaselineDay(new Date(), config.weeklySnapshot.utcOffsetHours);
      // weeklyCutoffMs is an absolute UTC instant; existing _ChangeLog atMs
      // stores source-local wall time encoded in UTC components. Compare
      // within ONE clock domain, without changing persisted legacy IDs.
      sinceMs = weeklyCutoffMs(sinceDay, config.weeklySnapshot.utcOffsetHours)
        + config.weeklySnapshot.utcOffsetHours * 3600000;
    }

    const { records: all, failedDepts, coverage, fresh } = await readAllChangeLogs();

    // Прочитанное кладём в БД и оттуда же отвечаем. Смысл не в скорости:
    // журнал источника — единственный провенанс правок, а жил он кэшем в
    // памяти и умирал с процессом. В БД он переживает рестарт, и книга, не
    // ответившая в этом цикле, показывает свои прежние правки вместо ложного
    // «ничего не менял». Отказ БД (в том числе ещё не созданная таблица) —
    // не отказ страницы: ответ собирается живым чтением, как раньше.
    let records = changesSince(all, sinceMs);
    let source: 'db' | 'live' = 'live';
    try {
      if (fresh) saveChangeLogEntries(all);
      records = readChangeLogEntriesSince(sinceMs);
      source = 'db';
    } catch (error) {
      announceDbFailure(error);
    }

    return {
      since: isoOfDayNumber(sinceDay),
      total: records.length,
      records,
      // Откуда собран ответ: из журнала в БД (полная история) или из живого
      // чтения книг (только то, что ответило прямо сейчас). Читатель вправе
      // знать, насколько полон список, который он видит.
      source,
      coverage,
      // Книги, которые не ответили: страница обязана сказать об этом вслух,
      // иначе «правок нет» неотличимо от «источник молчит». При source='db'
      // их правки в списке есть, но свежесть — на момент последнего удачного
      // чтения, а не «сейчас».
      ...(failedDepts.length > 0 ? { failedDepts } : {}),
    };
  });
}
