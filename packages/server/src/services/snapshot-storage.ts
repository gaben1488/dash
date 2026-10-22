import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { DAYS_PER_WEEK, buildCellDict, findDept, METHOD_FAMILY_MAP, type DataSnapshot, type NormalizedMetric } from '@aemr/shared';
import * as schema from '../db/schema.js';
import { openDatabase, type SnapshotDatabase } from '../db/connection.js';
import { buildRowDto, isDataRow } from './rows-dto.js';
import { logSnapshotChange, logSourceProblem, setSourceLogger } from './source-log.js';
import { productCalendarDay } from './product-calendar.js';
import { parentPort } from 'node:worker_threads';

/**
 * Тип закупки по способу из колонки L. ЕП — единственный поставщик, ЭА/ЭК/ЭЗК —
 * конкурентная процедура (канон семейств METHOD_FAMILY_MAP). Мусор оператора в
 * L типом не притворяется: null честнее догадки, а SQL-фильтр по типу тогда
 * честно не находит такую строку, вместо того чтобы приписать её к семейству.
 */
function procurementTypeOf(method: string): 'competitive' | 'single_provider' | null {
  const code = method.trim().toUpperCase();
  if ((METHOD_FAMILY_MAP.EP as readonly string[]).includes(code)) return 'single_provider';
  if ((METHOD_FAMILY_MAP.COMPETITIVE as readonly string[]).includes(code)) return 'competitive';
  return null;
}

/**
 * Процент экономии одной строки. Нулевого (или нечислового) плана нет как
 * знаменателя — отношение не существует и выдаётся как null, а не как ноль:
 * ноль здесь читался бы «экономии не было», хотя её просто не от чего считать.
 */
function economyPercentOf(economy: number, plan: number): number | null {
  if (!Number.isFinite(plan) || plan === 0) return null;
  return (economy / plan) * 100;
}

/** Полностью пустая строка листа — добивка диапазона, а не атом. */
function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => String(cell ?? '').trim() === '');
}

/**
 * Атом-запись `procurement_rows` для каждой строки книг ГРБС снимка.
 *
 * Семантика строки (сигналы, состояние, суммы, способ) берётся из
 * ЕДИНСТВЕННОГО билдера `buildRowDto` — того же, которым живёт реестр
 * `/api/rows`. Вторая семантика атома завела бы расхождение «SQL против
 * реестра» на ровном месте (пирамида §4: одна свёртка — одно место).
 *
 * Служебные строки листа (итоги, разделы, шапки) не выбрасываются, а
 * помечаются состоянием `non-data`: популяция таблицы остаётся точной копией
 * листа, а потребитель отсекает служебное явным условием, а не догадкой о том,
 * какие строки мы по дороге потеряли.
 */
export function buildProcurementRowValues(
  snapshot: DataSnapshot,
  today: Date = new Date(),
): Array<typeof schema.procurementRows.$inferInsert> {
  const out: Array<typeof schema.procurementRows.$inferInsert> = [];
  for (const [sheetName, rows] of Object.entries(snapshot.rowsByDept ?? {})) {
    // Ось ГРБС в SQL — латинский id (как у issues.department_id): один язык
    // ключа на всю базу. Лист, которого реестр ГРБС не знает, не выдумываем —
    // кладём имя как есть, чтобы строки не пропали молча.
    const departmentId = findDept(sheetName)?.latinId ?? sheetName;
    rows.forEach((row, idx) => {
      if (!Array.isArray(row) || isBlankRow(row)) return;
      const dto = buildRowDto(row, idx, { deptId: departmentId, today });
      const isData = isDataRow(dto);
      out.push({
        snapshotId: snapshot.id,
        departmentId,
        // 1-based номер строки листа (шапка в DEPT_HEADER_ROWS строк уже срезана
        // в rowsByDept) — адрес, по которому правку видно в самой книге.
        rowIndex: dto.rowIndex,
        cellsJson: JSON.stringify(buildCellDict(row)),
        // Активные сигналы строки; ложные не пишем — они восстановимы по канону
        // сигналов, а в тысячах строк удваивали бы объём ничем.
        signalsJson: JSON.stringify(dto.signals),
        rowState: isData ? dto.state : 'non-data',
        procurementType: isData ? procurementTypeOf(dto.method) : null,
        subject: String(dto.subject ?? '').trim(),
        planAmount: dto.planSum,
        factAmount: dto.factSum,
        economy: dto.economy,
        economyPercent: economyPercentOf(dto.economy, dto.planSum),
        createdAt: snapshot.createdAt,
      });
    });
  }
  return out;
}

/**
 * Потолок связываемых параметров одного SQL-запроса. SQLite современных сборок
 * держит 32 766, но исторический предел — 999; считаем по нижнему, чтобы размер
 * пакета не стал сюрпризом на чужой сборке. Число колонок берётся из самой
 * схемы, а не переписывается сюда руками: блок Е п.21 добавит колонки осей, и
 * пакет ужмётся сам, вместо того чтобы разъехаться с таблицей.
 */
const MAX_BIND_PARAMS = 900;
const ATOM_ROWS_PER_BATCH = Math.floor(
  MAX_BIND_PARAMS / Object.keys(getTableColumns(schema.procurementRows)).length,
);

/**
 * Кладёт строки-атомы снимка в `procurement_rows` — ОДНОЙ транзакцией
 * пакетами: снимок несёт тысячи строк, и построчная вставка вне транзакции
 * означала бы тысячи отдельных фиксаций на диск.
 *
 * Идемпотентна: сначала сносит уже записанные строки этого снимка. Своего
 * бизнес-ключа у атома нет (пирамида §1: строка живёт без идентификатора,
 * только с позицией на листе), поэтому единственный честный способ не удвоить
 * популяцию при повторной записи — переписать её целиком.
 *
 * Возвращает число записанных строк. Снимок без `rowsByDept` (формат до
 * 24.07.2026) даёт 0 и не падает.
 */
export function saveSnapshotRowsToDb(snapshot: DataSnapshot, db: SnapshotDatabase, today: Date = new Date()): number {
  const values = buildProcurementRowValues(snapshot, today);
  db.transaction((tx) => {
    tx.delete(schema.procurementRows)
      .where(eq(schema.procurementRows.snapshotId, snapshot.id))
      .run();
    for (let i = 0; i < values.length; i += ATOM_ROWS_PER_BATCH) {
      tx.insert(schema.procurementRows).values(values.slice(i, i + ATOM_ROWS_PER_BATCH)).run();
    }
  });
  return values.length;
}


export function saveSnapshotToDb(snapshot: DataSnapshot, db: SnapshotDatabase, today: Date): void {
  const dataJson = JSON.stringify(snapshot);
  // Замер прироста от атомов истории (строки книг + сетка СВОД): поля добавлены
  // 2026-07-24, снимок потяжелел — держим цифру на виду, а не узнаём по раздутой БД.
  const mb = (n: number): string => (n / 1048576).toFixed(2);
  const atomsBytes = Buffer.byteLength(
    JSON.stringify({ rowsByDept: snapshot.rowsByDept, svodGrid: snapshot.svodGrid }),
    'utf8',
  );
  logSnapshotChange(
    `Снимок сохраняется: данные ${mb(Buffer.byteLength(dataJson, 'utf8'))} МБ`
    + ` (строки-атомы и сетка СВОД: ${mb(atomsBytes)} МБ), строк ${snapshot.rowCount},`
    + ` замечаний ${snapshot.issues.length}`,
    {
      snapshotId: snapshot.id,
      bytes: Buffer.byteLength(dataJson, 'utf8'),
      atomBytes: atomsBytes,
      rows: snapshot.rowCount,
      issues: snapshot.issues.length,
    },
  );

  const savedRows = db.transaction((tx) => {
    tx.insert(schema.snapshots).values({
      id: snapshot.id,
      spreadsheetId: snapshot.spreadsheetId,
      createdAt: snapshot.createdAt,
      trustOverall: snapshot.trust.overall,
      trustGrade: snapshot.trust.grade,
      issueCount: snapshot.issues.length,
      criticalIssueCount: snapshot.issues.filter(i => i.severity === 'critical').length,
      metricsCount: Object.keys(snapshot.officialMetrics).length,
      rowCount: snapshot.rowCount,
      readDurationMs: snapshot.metadata.readDurationMs,
      pipelineDurationMs: snapshot.metadata.pipelineDurationMs,
      data: dataJson,
    }).run();

    for (const [key, metric] of Object.entries(snapshot.officialMetrics) as [string, NormalizedMetric][]) {
      tx.insert(schema.metricHistory).values({
        snapshotId: snapshot.id,
        metricKey: key,
        numericValue: metric.numericValue,
        displayValue: metric.displayValue,
        confidence: metric.confidence,
        origin: metric.origin,
        createdAt: snapshot.createdAt,
      }).run();
    }

    for (const issue of snapshot.issues) {
      // Совпавший id — то же замечание в новом снимке: перевешиваем ТОЛЬКО
      // snapshot_id на свежий снимок. Прочие поля не трогаем (статус/комментарий
      // ставит человек через PUT — затирать их снимком нельзя). Без перевешивания
      // строка оставалась приписанной к ПЕРВОМУ снимку, ретеншен его прунил и
      // каскадом удалял живое замечание (страж: snapshot-rows.test.ts, БАГ #8).
      tx.insert(schema.issues).values({
        ...issue,
        snapshotId: snapshot.id,
      }).onConflictDoUpdate({
        target: schema.issues.id,
        set: { snapshotId: snapshot.id },
      }).run();
    }

    // Строки-атомы в SQL (пирамида, блок Е п.20). До этого атомы жили только
    // JSON-блобом внутри snapshots.data: ни колонки, ни индекса, ни группировки.
    // Теперь часть единой транзакции снимка (см. БАГ #8 выше) — сбой здесь
    // откатывает всё, а не оставляет снимок без строк.
    return saveSnapshotRowsToDb(snapshot, db, today);
  });
  if (savedRows > 0) {
    logSnapshotChange(`Строки-атомы снимка записаны: ${savedRows}`, { snapshotId: snapshot.id, rows: savedRows });
  }

}

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
export function pruneSnapshotsInDb(db: SnapshotDatabase, offset: number, now: Date = new Date()): number {
  try {
    // Selection and deletion must see the same decisions. This used to be
    // implicit in the single HTTP thread; a separate writer needs a real lock.
    return db.transaction(() => {
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
    }, { behavior: 'immediate' });
  } catch (error) {
    logSourceProblem('Чистка снимков по сроку хранения не выполнена (сохранение снимка не пострадало)', {
      reason: (error as Error)?.message ?? String(error),
    });
    return 0;
  }
}

export interface SnapshotStorageInput {
  snapshot: DataSnapshot;
  path: string;
  offset: number;
  today: Date;
  operation: 'insert' | 'weekly';
}

export async function persistSnapshotInWorker(input: SnapshotStorageInput): Promise<true> {
  if (!parentPort) throw new Error('SNAPSHOT_STORAGE_WORKER_REQUIRED');
  const port = parentPort;
  setSourceLogger({
    info: (fields, msg) => port.postMessage({ log: 'info', fields, msg }),
    warn: (fields, msg) => port.postMessage({ log: 'warn', fields, msg }),
    error: (fields, msg) => port.postMessage({ log: 'error', fields, msg }),
  });
  const db = openDatabase(input.path, true);
  try {
    if (input.operation === 'weekly') {
      const updated = db.update(schema.snapshots).set({ data: JSON.stringify(input.snapshot) })
        .where(eq(schema.snapshots.id, input.snapshot.id)).run();
      if (updated.changes !== 1) throw new Error('WEEKLY_SNAPSHOT_NOT_UNIQUE');
    } else saveSnapshotToDb(input.snapshot, db, input.today);
    // The commit exists independently of the transport. Readers get a turn
    // before maintenance; the parent acknowledges only after that turn.
    const resumed = new Promise<void>(resolve => port.once('message', () => resolve()));
    port.postMessage({ committed: true });
    await resumed;
    pruneSnapshotsInDb(db, input.offset, input.today);
    return true;
  } finally {
    db.$client.close();
  }
}
