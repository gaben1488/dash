import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

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
/** Настройки соединения — наружу для проверки в тестах. */
export const SQLITE_PRAGMAS = {
  journalMode: 'wal',
  busyTimeoutMs: 5000,
  synchronous: 1,
  foreignKeys: 1,
} as const;

export function openDatabase(path: string, fileMustExist = false) {
  const sqlite = new Database(path, { fileMustExist });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}
export type SnapshotDatabase = ReturnType<typeof openDatabase>;
