/**
 * Retention снимков — канон пользователя (24.07.2026): храним ЕЖЕДНЕВНЫЕ снимки
 * за последнюю неделю (последний снимок каждого календарного дня продукта) и
 * ЕЖЕНЕДЕЛЬНЫЕ по срезам — последний снимок к каждому ЧЕТВЕРГУ за всю историю;
 * остальное удаляется автоматически при каждом сохранении. Ручные чистки
 * (878 МБ, затем 353 МБ / 74 снимка) этим упраздняются.
 *
 * Победитель дня/недели выбирается с приоритетом СТРОКОНОСНОСТИ: снимок со
 * строками-атомами rowsByDept (источник честного отчёта прошлой недели) не
 * должен вытесняться более поздним бесстрочным (блокер ponytail-ревью R2a №2а).
 *
 * Чистое решение (retentionKeepIds) отделено от операционной обвязки
 * (pruneSnapshotsByRetention): первое тестируется без БД, второе — один
 * проход по метаданным + удаление в ОДНОЙ транзакции каскадом от внуков к
 * родителю (issue_history → issues → metric_history → procurement_rows →
 * snapshots), чтобы FK при foreign_keys=ON не бросал и не оставлял
 * частично удалённое состояние (блокер R2a №2б).
 */
import { inArray, sql } from 'drizzle-orm';
import { DAYS_PER_WEEK } from '@aemr/shared';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { logSnapshotChange, logSourceProblem } from './source-log.js';
import { productCalendarDay } from './product-calendar.js';

const DAILY_WINDOW_DAYS = 7;

interface SnapshotRef {
  id: string;
  createdAt: string;
  /** Несёт ли data-JSON строки-атомы rowsByDept (SQL-маркер, JSON не разбирается). */
  hasRows: boolean;
}

/**
 * Четверг, которому снимок дня `day` служит срезом: сам четверг — себе,
 * пятница..среда — СЛЕДУЮЩЕМУ (их неделя среза ещё впереди). День 0 эпохи —
 * четверг ⇒ ceil: day + ((7 − day % 7) % 7).
 */
const sliceThursdayOf = (day: number): number => day + ((DAYS_PER_WEEK - (day % DAYS_PER_WEEK)) % DAYS_PER_WEEK);

/**
 * Побеждает ли `a` текущего лидера `b` в борьбе за день/неделю: строконосный
 * поздний > строконосный ранний > бесстрочный поздний. createdAt — toISOString
 * одного формата, лексикографика = хронология.
 */
const beats = (a: SnapshotRef, b: SnapshotRef): boolean =>
  a.hasRows !== b.hasRows ? a.hasRows : a.createdAt > b.createdAt;

/**
 * Какие снимки выживают. Держим: (а) победителя каждого календарного дня
 * из последних DAILY_WINDOW_DAYS дней; (б) победителя каждой недели среза
 * (группировка по sliceThursdayOf) — за всю историю. Снимок с нечитаемым
 * createdAt не удаляется молча (страховка: keep) — разбор руками, не автоматом.
 */
export function retentionKeepIds(
  rows: ReadonlyArray<SnapshotRef>,
  nowDay: number,
  utcOffsetHours: number,
): Set<string> {
  const keep = new Set<string>();
  const latestByDay = new Map<number, SnapshotRef>();
  const latestByWeek = new Map<number, SnapshotRef>();

  for (const row of rows) {
    const ms = Date.parse(row.createdAt);
    if (Number.isNaN(ms)) {
      keep.add(row.id);
      continue;
    }
    const day = productCalendarDay(new Date(ms), utcOffsetHours);
    const byDay = latestByDay.get(day);
    if (!byDay || beats(row, byDay)) latestByDay.set(day, row);
    const week = sliceThursdayOf(day);
    const byWeek = latestByWeek.get(week);
    if (!byWeek || beats(row, byWeek)) latestByWeek.set(week, row);
  }

  for (const [day, row] of latestByDay) {
    if (day > nowDay - DAILY_WINDOW_DAYS) keep.add(row.id);
  }
  for (const row of latestByWeek.values()) keep.add(row.id);
  return keep;
}

/**
 * SQL-маркер строконосности: подстрока "rowsByDept" в data-JSON. instr работает
 * по байтам колонки — многомегабайтные JSON не разбираются ради одного признака.
 */
const HAS_ROWS_SQL = sql<number>`instr(${schema.snapshots.data}, '"rowsByDept"') > 0`;

/**
 * Применить retention к БД: метаданные всех снимков → решение → удаление
 * лишних одной транзакцией, каскадом от внуков к родителю. Возвращает число
 * удалённых. Никогда не бросает: сбой retention не должен ломать сохранение
 * снимка, которое его вызвало (транзакция при сбое откатывается целиком —
 * частично удалённого состояния не остаётся).
 */
export function pruneSnapshotsByRetention(now: Date = new Date()): number {
  try {
    const rows = db
      .select({
        id: schema.snapshots.id,
        createdAt: schema.snapshots.createdAt,
        hasRows: HAS_ROWS_SQL,
      })
      .from(schema.snapshots)
      .all()
      // data NULL → instr даёт NULL → драйвер вернёт null: считаем бесстрочным.
      .map((r) => ({ id: r.id, createdAt: r.createdAt, hasRows: r.hasRows === 1 }));
    const offset = config.weeklySnapshot.utcOffsetHours;
    const keep = retentionKeepIds(rows, productCalendarDay(now, offset), offset);
    const drop = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (drop.length === 0) return 0;

    db.transaction((tx) => {
      // issue_history ссылается на issues.id (NOT NULL FK): сперва найти issues
      // дроп-снапшотов, снести их историю, затем сами issues — и дальше вверх.
      const issueIds = tx
        .select({ id: schema.issues.id })
        .from(schema.issues)
        .where(inArray(schema.issues.snapshotId, drop))
        .all()
        .map((r) => r.id);
      if (issueIds.length > 0) {
        tx.delete(schema.issueHistory).where(inArray(schema.issueHistory.issueId, issueIds)).run();
      }
      tx.delete(schema.issues).where(inArray(schema.issues.snapshotId, drop)).run();
      tx.delete(schema.metricHistory).where(inArray(schema.metricHistory.snapshotId, drop)).run();
      tx.delete(schema.procurementRows).where(inArray(schema.procurementRows.snapshotId, drop)).run();
      tx.delete(schema.snapshots).where(inArray(schema.snapshots.id, drop)).run();
    });
    logSnapshotChange(
      `Чистка снимков по сроку хранения: удалено ${drop.length}, осталось ${rows.length - drop.length}`,
      { removed: drop.length, kept: rows.length - drop.length },
    );
    return drop.length;
  } catch (error) {
    logSourceProblem('Чистка снимков по сроку хранения не выполнена (сохранение снимка не пострадало)', {
      reason: (error as Error)?.message ?? String(error),
    });
    return 0;
  }
}
