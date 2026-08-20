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
 *
 * Прочитанное оседает в таблице changelog_entries и оттуда же отдаётся
 * (пирамида, блок Е п.23): память процесса теряла всю историю правок при
 * рестарте, а молчащая книга выглядела как книга без правок.
 */
import type { FastifyInstance } from 'fastify';
import { desc, getTableColumns, gte } from 'drizzle-orm';
import { dayNumberOf, floorToThursday, isoOfDayNumber } from '@aemr/shared';
import { DEPARTMENT_SPREADSHEETS, config } from '../config.js';
import { db, schema } from '../db/index.js';
import { logSourceProblem } from '../services/source-log.js';
import { productCalendarDay } from '../services/product-calendar.js';
import { readChangelogRows } from '../services/changelog-source.js';
import { changesSince, parseChangeLog, type ChangeRecord } from '../services/changelog.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; records: ChangeRecord[]; failedDepts: string[] } | null = null;

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
async function readAllChangeLogs(): Promise<{ records: ChangeRecord[]; failedDepts: string[]; fresh: boolean }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    // fresh=false: эти записи уже сохранялись при чтении, наполнившем кэш.
    // Гонять транзакцию на 37 тыс. записей ради нулевого прироста на каждый
    // рендер страницы незачем.
    return { records: cache.records, failedDepts: cache.failedDepts, fresh: false };
  }
  const entries = Object.entries(DEPARTMENT_SPREADSHEETS);
  const failedDepts: string[] = [];
  const parts = await Promise.all(entries.map(async ([dept, spreadsheetId]) => {
    try {
      const rows = await readChangelogRows(dept, spreadsheetId);
      return parseChangeLog(rows, dept);
    } catch {
      failedDepts.push(dept);
      return [];
    }
  }));
  const records = parts.flat();
  if (failedDepts.length === 0) cache = { at: Date.now(), records, failedDepts };
  return { records, failedDepts, fresh: true };
}

/**
 * Устойчивый ключ записи журнала. У правки в источнике нет собственного
 * номера, поэтому опознаём её адресом: книга ГРБС + лист + ячейка + отметка
 * времени + автор. Ячейка несёт и строку, и колонку — две правки одной строки
 * в одну секунду не сливаются в одну запись. Журнал append-only, значит
 * повторное чтение той же правки даёт тот же ключ, и дубли не заводятся.
 */
export function changeEntryKey(r: ChangeRecord): string {
  return `${r.dept}|${r.sheet}|${r.cell}|${r.atMs}|${r.author}`;
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
  for (const r of records) {
    byKey.set(changeEntryKey(r), {
      id: changeEntryKey(r),
      dept: r.dept,
      sheet: r.sheet,
      cell: r.cell,
      attribute: r.attribute,
      oldValue: r.oldValue,
      newValue: r.newValue,
      atMs: r.atMs,
      author: r.author,
      recordedAt,
    });
  }
  const values = [...byKey.values()];
  let written = 0;
  db.transaction((tx) => {
    for (let i = 0; i < values.length; i += ENTRIES_PER_BATCH) {
      const res = tx
        .insert(schema.changelogEntries)
        .values(values.slice(i, i + ENTRIES_PER_BATCH))
        .onConflictDoNothing()
        .run();
      written += res.changes;
    }
  });
  return written;
}

/** Правки из БД начиная с момента среза, свежие сверху (порядок как у changesSince). */
export function readChangeLogEntriesSince(sinceMs: number): ChangeRecord[] {
  return db
    .select()
    .from(schema.changelogEntries)
    .where(gte(schema.changelogEntries.atMs, sinceMs))
    .orderBy(desc(schema.changelogEntries.atMs))
    .all()
    .map((r) => ({
      dept: r.dept,
      sheet: r.sheet,
      cell: r.cell,
      attribute: r.attribute ?? '',
      oldValue: r.oldValue ?? '',
      newValue: r.newValue ?? '',
      atMs: r.atMs,
      author: r.author ?? '',
    }));
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
    } else {
      // Календарь ПРОДУКТА (+12), не машины: прод живёт в UTC, и в окне
      // среда 12:00 — четверг 00:00 UTC дефолт уезжал на неделю назад.
      // Та же ось недели, что у /api/report (currentProductThursday).
      sinceDay = floorToThursday(productCalendarDay(new Date(), config.weeklySnapshot.utcOffsetHours));
    }

    const sinceMs = sinceDay * 86400000;
    const { records: all, failedDepts, fresh } = await readAllChangeLogs();

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
      // Книги, которые не ответили: страница обязана сказать об этом вслух,
      // иначе «правок нет» неотличимо от «источник молчит». При source='db'
      // их правки в списке есть, но свежесть — на момент последнего удачного
      // чтения, а не «сейчас».
      ...(failedDepts.length > 0 ? { failedDepts } : {}),
    };
  });
}
