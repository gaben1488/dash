import { openDatabase } from './connection.js';
export { SQLITE_PRAGMAS } from './connection.js';
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

export const db = openDatabase(dbPath);
const sqlite = db.$client;

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
