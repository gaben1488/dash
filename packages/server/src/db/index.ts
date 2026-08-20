import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config.js';
import { SCHEMA_DDL, COLUMN_MIGRATIONS, POST_MIGRATION_DDL } from './ddl.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const dbPath = config.database.url.replace('file:', '');

// Ensure data directory exists
const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(dbPath);

/**
 * Настройки базы. WAL стоял и раньше — читатели не ждут писателя. Двух вещей
 * не хватало, и обе видны только под нагрузкой:
 *
 * • `busy_timeout` — сколько ждать, если база занята. Без него SQLite бросает
 *   SQLITE_BUSY МГНОВЕННО, и запись, наложившаяся на четверговый срез или на
 *   чистку старых снимков, падает вместо того, чтобы подождать сотую долю
 *   секунды. Читатель видит «внутренняя ошибка сервера» на ровном месте.
 *   При WAL параллельная запись всё равно одна, так что ожидание короткое.
 *
 * • `synchronous = NORMAL` — рекомендованный режим именно для WAL: fsync на
 *   каждую запись не делается, но контрольная точка защищена. Риск сводится к
 *   потере последних сделок при внезапном пропадании питания хоста; поломки
 *   файла базы этот режим не допускает. Для журнала правок и снимков цена
 *   приемлемая, а полный fsync на каждую вставку — это десятки миллисекунд на
 *   строку при заливке недельного среза.
 */
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('foreign_keys = ON');

/** Настройки соединения — наружу для проверки в тестах. */
export const SQLITE_PRAGMAS = {
  journalMode: 'wal',
  busyTimeoutMs: 5000,
  synchronous: 1,
  foreignKeys: 1,
} as const;

export const db = drizzle(sqlite, { schema });

// Схема пустой базы живёт в db/ddl.ts — там же объяснено, почему отдельно
// (страж ddl.test.ts проверяет её на пустой базе, не заводя рабочей).
sqlite.exec(SCHEMA_DDL);

// Доращивание колонок на базах, заведённых раньше: ALTER TABLE ADD COLUMN не
// знает IF NOT EXISTS, поэтому повтор ловится по тексту отказа.
for (const statement of COLUMN_MIGRATIONS) {
  try {
    sqlite.exec(statement);
  } catch (e: any) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
}

// Индексы по доращенным колонкам — только после ALTER TABLE.
sqlite.exec(POST_MIGRATION_DDL);

export { schema };
