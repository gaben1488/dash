/**
 * Хранение: недельная история по области книги/расчётного года и последняя
 * текущая голова каждой области. Отдельного пула ежедневных версий нет
 * (последняя инструкция владельца). Недельный контроль предпочитает полный
 * контекст и строки, но не заменяет более свежую текущую голову.
 * Неизвестные legacy-области сохраняются до доказанной миграции.
 *
 * Чистое решение (retentionKeepIds) отделено от операционной обвязки
 * (pruneSnapshotsByRetention): первое тестируется без БД, второе — один
 * проход по метаданным + удаление в ОДНОЙ транзакции каскадом от внуков к
 * родителю (issue_history → issues → metric_history → procurement_rows →
 * snapshots), чтобы FK при foreign_keys=ON не бросал и не оставлял
 * частично удалённое состояние (блокер R2a №2б).
 */
import { and, inArray, sql } from 'drizzle-orm';
import { DAYS_PER_WEEK } from '@aemr/shared';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { logSnapshotChange, logSourceProblem } from './source-log.js';
import { productCalendarDay } from './product-calendar.js';

interface SnapshotRef {
  id: string;
  createdAt: string;
  spreadsheetId?: string;
  /** null — доказанные все годы; отсутствие/иной тип — неизвестная legacy-область. */
  targetYear?: unknown;
  /** Несёт ли data-JSON строки-атомы rowsByDept (SQL-маркер, JSON не разбирается). */
  hasRows: boolean;
  /** Завершён ли полный weekly table context. */
  hasWeeklyContext: boolean;
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
const beats = (a: SnapshotRef, b: SnapshotRef): boolean => {
  if (a.hasWeeklyContext !== b.hasWeeklyContext) return a.hasWeeklyContext;
  if (a.hasRows !== b.hasRows) return a.hasRows;
  return a.createdAt > b.createdAt;
};

/** Недельные победители и текущие головы; неизвестное не удаляется молча. */
export function retentionKeepIds(
  rows: ReadonlyArray<SnapshotRef>,
  _nowDay: number,
  utcOffsetHours: number,
): Set<string> {
  const keep = new Set<string>();
  const latestByScope = new Map<string, SnapshotRef>();
  const latestByWeek = new Map<string, SnapshotRef>();

  for (const row of rows) {
    const ms = Date.parse(row.createdAt);
    if (Number.isNaN(ms) || !row.spreadsheetId
        || (row.targetYear !== null && (typeof row.targetYear !== 'number'
          || !Number.isInteger(row.targetYear) || row.targetYear < 2020 || row.targetYear > 2100))) {
      keep.add(row.id);
      continue;
    }
    const scope = JSON.stringify([row.spreadsheetId, row.targetYear]);
    const head = latestByScope.get(scope);
    if (!head || row.createdAt > head.createdAt) latestByScope.set(scope, row);
    const week = JSON.stringify([scope, sliceThursdayOf(productCalendarDay(new Date(ms), utcOffsetHours))]);
    const byWeek = latestByWeek.get(week);
    if (!byWeek || beats(row, byWeek)) latestByWeek.set(week, row);
  }

  for (const row of latestByScope.values()) keep.add(row.id);
  for (const row of latestByWeek.values()) keep.add(row.id);
  return keep;
}

/**
 * SQL-маркер строконосности: подстрока "rowsByDept" в data-JSON. instr работает
 * по байтам колонки — многомегабайтные JSON не разбираются ради одного признака.
 */
const HAS_ROWS_SQL = sql<number>`instr(${schema.snapshots.data}, '"rowsByDept"') > 0`;
const HAS_WEEKLY_CONTEXT_SQL = sql<number>`instr(${schema.snapshots.data}, '"weeklyTableContext"') > 0`;

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
        id: sql<string>`${schema.snapshots.id}`,
        createdAt: sql<string>`${schema.snapshots.createdAt}`,
        spreadsheetId: sql<string>`${schema.snapshots.spreadsheetId}`,
        yearType: sql<string | null>`CASE WHEN json_valid(${schema.snapshots.data}) THEN json_type(${schema.snapshots.data}, '$.metadata.targetYear') END`,
        yearValue: sql<number | null>`CASE WHEN json_valid(${schema.snapshots.data}) THEN json_extract(${schema.snapshots.data}, '$.metadata.targetYear') END`,
        hasRows: HAS_ROWS_SQL,
        hasWeeklyContext: HAS_WEEKLY_CONTEXT_SQL,
      })
      .from(sql`${schema.snapshots} INDEXED BY idx_snapshots_retention_metadata`)
      // Tautology matches the partial index while preserving NULL legacy IDs.
      .where(sql`${schema.snapshots.id} IS ${schema.snapshots.id}`)
      // Preserve the former table scan's tie order; sort only scalar index entries.
      .orderBy(sql`${schema.snapshots}.rowid`)
      .all()
      // data NULL → instr даёт NULL → драйвер вернёт null: считаем бесстрочным.
      .map((r) => ({ id: r.id, createdAt: r.createdAt, spreadsheetId: r.spreadsheetId,
        targetYear: r.yearType === 'null' ? null : r.yearType === 'integer' ? r.yearValue : undefined,
        hasRows: r.hasRows === 1,
        hasWeeklyContext: r.hasWeeklyContext === 1 }));
    const offset = config.weeklySnapshot.utcOffsetHours;
    const keep = retentionKeepIds(rows, productCalendarDay(now, offset), offset);
    // Weekly heads/unknown scopes may already protect every row. No deletion
    // is possible, so case-history payload scans cannot change this result.
    const candidates = rows.filter(row => !keep.has(row.id)).map(row => row.id);
    if (candidates.length === 0) return 0;
    // A discarded daily version may be the only exact identity proof behind a
    // saved decision. Preserve its immutable raw rows and user history. This
    // intentionally retains extra snapshots; reviewed cases need an explicit
    // archival policy before their provenance can ever be removed.
    const reviewed = db.select({ id: schema.issues.id, snapshotId: schema.issues.snapshotId }).from(schema.issues).where(sql`
      ${schema.issues.status} <> 'open'
      OR length(trim(coalesce(${schema.issues.comment}, ''))) > 0
      OR EXISTS (SELECT 1 FROM issue_history WHERE issue_history.issue_id = ${schema.issues.id})
      OR EXISTS (SELECT 1 FROM audit_log WHERE audit_log.entity_id = ${schema.issues.id} AND audit_log.action = 'issue_comment')
    `).all();
    for (const issue of reviewed) {
      if (issue.snapshotId) keep.add(issue.snapshotId);
      // Keep earlier proofs as well: the old hash omitted organization C, and
      // deleting a conflicting version would manufacture a unique match later.
      // Already protected versions cannot affect deletion. Use their scalar
      // IDs to restrict blob reads, keeping <999 parameters on older SQLite.
      for (let start = 0; start < candidates.length; start += 900) {
        const batch = candidates.slice(start, start + 900).filter(id => !keep.has(id));
        if (batch.length === 0) continue;
        const versions = db.select({ id: schema.snapshots.id }).from(schema.snapshots)
          .where(and(inArray(schema.snapshots.id, batch),
            sql`instr(${schema.snapshots.data}, ${JSON.stringify(issue.id)}) > 0`)).all();
        for (const version of versions) keep.add(version.id);
      }
    }
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
