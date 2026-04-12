import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const dbPath = config.database.url.replace('file:', '');

// Ensure data directory exists
const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// Auto-create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    spreadsheet_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    trust_overall INTEGER,
    trust_grade TEXT,
    issue_count INTEGER,
    critical_issue_count INTEGER,
    metrics_count INTEGER,
    row_count INTEGER,
    read_duration_ms INTEGER,
    pipeline_duration_ms INTEGER,
    data TEXT
  );

  CREATE TABLE IF NOT EXISTS metric_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id TEXT REFERENCES snapshots(id),
    metric_key TEXT NOT NULL,
    numeric_value REAL,
    display_value TEXT,
    confidence REAL,
    origin TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT REFERENCES snapshots(id),
    severity TEXT NOT NULL,
    origin TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    sheet TEXT,
    cell TEXT,
    row INTEGER,
    metric_key TEXT,
    department_id TEXT,
    recommendation TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    detected_at TEXT NOT NULL,
    detected_by TEXT,
    resolved_at TEXT,
    comment TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    department_id TEXT,
    row_index INTEGER,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    details TEXT,
    timestamp TEXT NOT NULL,
    user_id TEXT
  );

  CREATE TABLE IF NOT EXISTS issue_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    comment TEXT,
    reason TEXT,
    justification TEXT,
    responsible TEXT,
    deadline TEXT,
    user_id TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mapping_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_id TEXT NOT NULL UNIQUE,
    cell_ref TEXT NOT NULL,
    sheet_name TEXT,
    comment TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    user_id TEXT
  );

  CREATE TABLE IF NOT EXISTS procurement_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id TEXT REFERENCES snapshots(id),
    department_id TEXT NOT NULL,
    row_index INTEGER NOT NULL,
    cells_json TEXT NOT NULL,
    signals_json TEXT,
    row_state TEXT,
    procurement_type TEXT,
    subject TEXT,
    plan_amount REAL,
    fact_amount REAL,
    economy REAL,
    economy_percent REAL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS input_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id TEXT NOT NULL,
    row_index INTEGER NOT NULL,
    field TEXT NOT NULL,
    attempted_value TEXT,
    reason TEXT NOT NULL,
    user_id TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_metric_history_key ON metric_history(metric_key);
  CREATE INDEX IF NOT EXISTS idx_metric_history_snapshot ON metric_history(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_issues_severity ON issues(severity);
  CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
  CREATE INDEX IF NOT EXISTS idx_issues_snapshot ON issues(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_issue_history_issue ON issue_history(issue_id);
  CREATE INDEX IF NOT EXISTS idx_procurement_rows_snapshot ON procurement_rows(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_procurement_rows_dept ON procurement_rows(department_id);
  CREATE INDEX IF NOT EXISTS idx_input_errors_dept ON input_errors(department_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
`);

// ── Schema migrations for existing databases ──
// ALTER TABLE ADD COLUMN is safe: SQLite ignores if column already exists via try/catch
const migrations: string[] = [
  `ALTER TABLE audit_log ADD COLUMN entity TEXT`,
  `ALTER TABLE audit_log ADD COLUMN entity_id TEXT`,
  `ALTER TABLE audit_log ADD COLUMN department_id TEXT`,
  `ALTER TABLE audit_log ADD COLUMN row_index INTEGER`,
  `ALTER TABLE audit_log ADD COLUMN field TEXT`,
  `ALTER TABLE audit_log ADD COLUMN old_value TEXT`,
  `ALTER TABLE audit_log ADD COLUMN new_value TEXT`,
  // Issues table — columns added for subordinate hierarchy + signal tracking
  `ALTER TABLE issues ADD COLUMN subordinate_id TEXT`,
  `ALTER TABLE issues ADD COLUMN activity_type TEXT`,
  `ALTER TABLE issues ADD COLUMN signal TEXT`,
  `ALTER TABLE issues ADD COLUMN issue_group TEXT`,
  `ALTER TABLE issues ADD COLUMN check_id TEXT`,
  `ALTER TABLE issues ADD COLUMN kb_hint TEXT`,
];

for (const sql of migrations) {
  try {
    sqlite.exec(sql);
  } catch (e: any) {
    // "duplicate column name" is expected if migration already applied
    if (!e.message?.includes('duplicate column')) throw e;
  }
}

// Index that depends on migrated columns — must run after ALTER TABLE
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);`);

export { schema };
