/**
 * Хранение атомов и журнала правок (пирамида агрегации, блок Е, пп. 20 и 23).
 *
 * Два диагноза, которые здесь закрываются:
 *   • таблица procurement_rows была объявлена, но пуста — строки-атомы лежали
 *     JSON-блобом внутри snapshots.data и SQL-ом были недоступны;
 *   • журнал правок источника _ChangeLog жил пятиминутным кэшем в памяти и
 *     умирал вместе с процессом.
 *
 * Оси, которые проверяются: популяция таблицы, идемпотентность повторной
 * записи, снимок без строк, и переживание рестарта журналом (файловая БД,
 * пересоздание модулей).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEPT_COLUMNS, DEPT_HEADER_ROWS } from '@aemr/shared';

// Книги ГРБС по сети в этих тестах не читаются: роут журнала импортируется
// только ради функций записи/чтения БД.
vi.mock('./google-sheets.js', () => ({
  getSheetDataFromSpreadsheet: vi.fn(async () => []),
}));

const ORIGINAL_ENV = { ...process.env };

/** Строка листа ГРБС из именованных колонок канона (остальные ячейки пусты). */
function sheetRow(cells: Partial<Record<keyof typeof DEPT_COLUMNS, unknown>>): unknown[] {
  const row: unknown[] = new Array(34).fill('');
  for (const [name, value] of Object.entries(cells)) {
    row[DEPT_COLUMNS[name as keyof typeof DEPT_COLUMNS]] = value;
  }
  return row;
}

/** Минимальный снимок; rowsByDept опционален — как у снимков до 24.07.2026. */
function snap(id: string, createdAt: string, rowsByDept?: Record<string, unknown[][]>) {
  return {
    id,
    spreadsheetId: 'test',
    createdAt,
    officialMetrics: {},
    calculatedMetrics: {},
    deltas: [],
    issues: [],
    trust: { overall: 100, components: [], grade: 'A' as const, computedAt: createdAt, basedOnSnapshot: id },
    rowCount: 0,
    ...(rowsByDept ? { rowsByDept } : {}),
    metadata: { sheetsRead: [], cellsRead: 0, readDurationMs: 0, pipelineDurationMs: 0 },
  };
}

/**
 * Три строки одной книги: конкурентная закупка с экономией, ЕП с нулевым
 * планом (знаменателя нет) и служебная строка «Итого» — та самая, которая не
 * должна притворяться закупкой.
 */
const UER_ROWS: unknown[][] = [
  sheetRow({
    ID: 1,
    SUBORDINATE: 'МБУ «Ромашка»',
    SUBJECT: 'Поставка бумаги',
    TOTAL_PLAN: 1000,
    METHOD: 'ЭА',
    TOTAL_FACT: 900,
    ECONOMY_KB: 100,
  }),
  sheetRow({
    ID: 2,
    SUBJECT: 'Услуги связи',
    TOTAL_PLAN: 0,
    METHOD: 'ЕП',
    TOTAL_FACT: 0,
  }),
  sheetRow({ SUBJECT: 'Итого по разделу', TOTAL_PLAN: 1000 }),
];

describe('строки-атомы снимка → procurement_rows (блок Е п.20)', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
    };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('сохранение снимка кладёт строку-атом на каждую строку книги — с осями, суммами и честным процентом', async () => {
    const { db, schema } = await import('../db/index.js');
    const { saveSnapshot } = await import('./snapshot.js');
    const { eq } = await import('drizzle-orm');

    expect(await saveSnapshot(snap('s-atoms', '2026-08-06T08:00:00.000Z', { УЭР: UER_ROWS }))).toBe(true);

    // Выборка по своему снимку, а не по всей таблице: соседний тест не должен
    // уметь испортить или подпереть этот.
    const rows = db.select().from(schema.procurementRows)
      .where(eq(schema.procurementRows.snapshotId, 's-atoms')).all();
    expect(rows).toHaveLength(3);

    // Ось ГРБС в SQL — латинский id, как у issues.department_id.
    expect(new Set(rows.map((r) => r.departmentId))).toEqual(new Set(['uer']));
    // Номер строки — 1-based адрес в книге: шапка в DEPT_HEADER_ROWS уже срезана.
    expect(rows.map((r) => r.rowIndex)).toEqual([
      DEPT_HEADER_ROWS + 1,
      DEPT_HEADER_ROWS + 2,
      DEPT_HEADER_ROWS + 3,
    ]);

    const first = rows[0];
    expect(first.procurementType).toBe('competitive');
    expect(first.planAmount).toBe(1000);
    expect(first.factAmount).toBe(900);
    expect(first.economy).toBe(100);
    expect(first.economyPercent).toBe(10);
    expect(first.subject).toBe('Поставка бумаги');
    // Ячейки строки доступны целиком: субатом не потерян при нормализации.
    expect(JSON.parse(first.cellsJson).C).toBe('МБУ «Ромашка»');
    expect(Array.isArray(JSON.parse(first.signalsJson ?? 'null'))).toBe(true);

    // ЕП с нулевым планом: тип честный, а процента экономии не существует —
    // null, а не ноль (ноль читался бы «экономии не было»).
    const ep = rows[1];
    expect(ep.procurementType).toBe('single_provider');
    expect(ep.economyPercent).toBeNull();

    // Служебная строка листа сохранена, но помечена — она не закупка.
    const meta = rows[2];
    expect(meta.rowState).toBe('non-data');
    expect(meta.procurementType).toBeNull();
    // Первая загрузка тянет весь @aemr/core: ассерты к латентности нечувствительны.
  }, 60000);

  it('повторная запись строк того же снимка не удваивает популяцию', async () => {
    const { db, schema } = await import('../db/index.js');
    const { saveSnapshotRows } = await import('./snapshot.js');
    const { eq } = await import('drizzle-orm');

    const snapshot = snap('s-idem', '2026-08-06T08:00:00.000Z', { УЭР: UER_ROWS });
    db.insert(schema.snapshots).values({
      id: snapshot.id,
      spreadsheetId: 'test',
      createdAt: snapshot.createdAt,
    }).run();

    expect(saveSnapshotRows(snapshot as never)).toBe(3);
    expect(saveSnapshotRows(snapshot as never)).toBe(3);
    const rows = db.select().from(schema.procurementRows)
      .where(eq(schema.procurementRows.snapshotId, 's-idem')).all();
    expect(rows).toHaveLength(3);
  }, 60000);

  it('снимок без строк (формат до 24.07.2026) не падает и ничего не пишет', async () => {
    const { db, schema } = await import('../db/index.js');
    const { saveSnapshot } = await import('./snapshot.js');
    const { eq } = await import('drizzle-orm');

    expect(await saveSnapshot(snap('s-empty', '2026-08-06T08:00:00.000Z'))).toBe(true);
    const rows = db.select().from(schema.procurementRows)
      .where(eq(schema.procurementRows.snapshotId, 's-empty')).all();
    expect(rows).toEqual([]);
  }, 60000);

  it('строки снимка уходят вместе со снимком: каскад ретеншна их уже чистит', async () => {
    const { db, schema } = await import('../db/index.js');
    const { saveSnapshot } = await import('./snapshot.js');

    // Два снимка одной недели среза, оба вне дневного окна: понедельник
    // проигрывает четвергу. Ретеншн гоняет сам saveSnapshot — отдельно его
    // звать не нужно, и именно это делает тест проверкой боевого пути.
    const THU = 20657; // четверг 2026-07-23 (день 0 эпохи — четверг)
    const oldThu = THU - 7 * 2;
    const iso = (day: number): string => new Date(day * 86400000 + 10 * 3600000).toISOString();
    await saveSnapshot(snap('drop-mon', iso(oldThu - 3), { УЭР: UER_ROWS }));
    await saveSnapshot(snap('keep-thu', iso(oldThu), { УЭР: UER_ROWS }));

    const { inArray } = await import('drizzle-orm');
    const pair = ['drop-mon', 'keep-thu'];
    const ids = db.select({ id: schema.snapshots.id }).from(schema.snapshots)
      .where(inArray(schema.snapshots.id, pair)).all().map((r) => r.id);
    expect(ids).toEqual(['keep-thu']);
    // Строки проигравшего снимка ушли вместе с ним — сирот в таблице атомов нет.
    const left = db.select().from(schema.procurementRows)
      .where(inArray(schema.procurementRows.snapshotId, pair)).all();
    expect(new Set(left.map((r) => r.snapshotId))).toEqual(new Set(['keep-thu']));
    expect(left).toHaveLength(3);
  }, 60000);
});

/**
 * DDL таблицы журнала. Миграции проекта ad-hoc и живут в db/index.ts, который
 * этот поток не правит: до появления там этой же DDL тестовая БД создаёт
 * таблицу сама (в проде до того же момента роут честно откатывается на живое
 * чтение и говорит об этом в лог).
 */
const CHANGELOG_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS changelog_entries (
    id TEXT PRIMARY KEY,
    dept TEXT NOT NULL,
    sheet TEXT NOT NULL,
    cell TEXT NOT NULL,
    attribute TEXT,
    old_value TEXT,
    new_value TEXT,
    at_ms INTEGER NOT NULL,
    author TEXT,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_changelog_entries_at ON changelog_entries(at_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_changelog_entries_dept ON changelog_entries(dept, at_ms)`,
];

/** Применить DDL журнала к тестовой БД (по одному запросу: драйвер не берёт пачку). */
async function createChangelogTable(): Promise<void> {
  const { db } = await import('../db/index.js');
  const { sql } = await import('drizzle-orm');
  for (const statement of CHANGELOG_DDL) db.run(sql.raw(statement));
}

const change = (over: Partial<{ dept: string; sheet: string; cell: string; attribute: string; oldValue: string; newValue: string; atMs: number; author: string }> = {}) => ({
  dept: 'УО',
  sheet: 'ВСЕ',
  cell: 'L178',
  attribute: 'Способ определения поставщика (ЭА и аналоги/ЕП)',
  oldValue: 'ЭА',
  newValue: 'ЕП',
  atMs: Date.UTC(2026, 7, 5, 12, 0, 0),
  author: 'ivanov@example.ru',
  ...over,
});

describe('журнал правок источника → changelog_entries (блок Е п.23)', () => {
  let dir: string;

  beforeEach(() => {
    // Файловая БД, а не :memory: — иначе «рестарт» терял бы данные не потому,
    // что персист сломан, а потому что база жила в памяти умершего модуля.
    dir = mkdtempSync(join(tmpdir(), 'aemr-changelog-'));
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      AEMR_API_KEY: '',
      SQLITE_PATH: join(dir, 'test.db'),
      LOG_LEVEL: 'silent',
    };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows держит файл БД открытым, пока живо соединение better-sqlite3,
      // а закрыть его извне модуль db не даёт. Временный каталог подчистит
      // система — падать из-за уборки тест не должен.
    }
  });

  it('запись → чтение из БД: журнал переживает рестарт процесса', async () => {
    await createChangelogTable();
    const before = (await import('../db/index.js')).db;

    const { saveChangeLogEntries } = await import('../routes/changes.js');
    const older = change({ cell: 'K12', atMs: Date.UTC(2026, 7, 3, 9, 0, 0) });
    const newer = change({ cell: 'L178' });
    expect(saveChangeLogEntries([older, newer])).toBe(2);

    // Рестарт: модули и соединение с БД пересоздаются с нуля, файл остаётся.
    vi.resetModules();
    const { readChangeLogEntriesSince } = await import('../routes/changes.js');
    // Соединение и правда новое — иначе «переживает рестарт» доказывалось бы
    // тем же живым соединением, то есть ничем.
    expect((await import('../db/index.js')).db).not.toBe(before);
    const back = readChangeLogEntriesSince(Date.UTC(2026, 7, 1));
    expect(back).toHaveLength(2);
    // Свежие сверху — тот же порядок, что у живого чтения (changesSince).
    expect(back[0].cell).toBe('L178');
    expect(back[0].author).toBe('ivanov@example.ru');
    expect(back[0].attribute).toBe('Способ определения поставщика (ЭА и аналоги/ЕП)');
    // Момент среза — граница окна: правка старше него в ответ не попадает.
    expect(readChangeLogEntriesSince(Date.UTC(2026, 7, 4)).map((r) => r.cell)).toEqual(['L178']);
  }, 60000);

  it('повторное чтение того же журнала не плодит дублей, новая правка добавляется', async () => {
    await createChangelogTable();

    const { saveChangeLogEntries, readChangeLogEntriesSince } = await import('../routes/changes.js');
    const first = change();
    expect(saveChangeLogEntries([first])).toBe(1);
    // Тот же журнал прочитан снова (кэш истёк) — записей не прибавилось.
    expect(saveChangeLogEntries([first])).toBe(0);
    // Дубль внутри одной пачки тоже не запись, а тот же ключ.
    expect(saveChangeLogEntries([first, first])).toBe(0);
    expect(readChangeLogEntriesSince(0)).toHaveLength(1);

    // Правка той же ячейки другим моментом — уже другая запись.
    expect(saveChangeLogEntries([change({ atMs: Date.UTC(2026, 7, 6, 12, 0, 0) })])).toBe(1);
    expect(readChangeLogEntriesSince(0)).toHaveLength(2);
  }, 60000);

  it('ключ различает правки, отличающиеся только книгой, ячейкой или автором', async () => {
    const { changeEntryKey } = await import('../routes/changes.js');
    const base = change();
    expect(changeEntryKey(base)).toBe(changeEntryKey({ ...base, oldValue: 'иное', newValue: 'иное' }));
    expect(changeEntryKey(base)).not.toBe(changeEntryKey({ ...base, dept: 'УД' }));
    expect(changeEntryKey(base)).not.toBe(changeEntryKey({ ...base, cell: 'L179' }));
    expect(changeEntryKey(base)).not.toBe(changeEntryKey({ ...base, author: 'petrov@example.ru' }));
  });
});
