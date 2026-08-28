/**
 * ddl.ts — как выглядит пустая база: таблицы, индексы, доращивание колонок.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ. Раньше эти строки жили внутри `db/index.ts`, а тот
 * при первом же импорте открывает НАСТОЯЩУЮ базу по адресу из настроек. Из-за
 * этого на схему нельзя было посмотреть, не заведя рабочую базу, — и она
 * молча разошлась с моделью: таблица `changelog_entries` объявлена в
 * `schema.ts` (журнал правок книг, блок Е п.23), а команды на её создание тут
 * не было НИ ОДНОЙ. Записи журнала правок падали при вставке, роут ловил отказ
 * («в том числе ещё не созданная таблица» — routes/changes.ts), отвечал живым
 * чтением книг, и всё выглядело работающим: история просто не переживала
 * рестарт, ради чего таблицу и заводили. Схема, вынесенная в отдельный модуль
 * без побочных действий, проверяется стражем на пустой базе (ddl.test.ts):
 * каждая таблица модели обязана создаваться, иначе следующая разойдётся так же.
 *
 * ПОРЯДОК ПРИМЕНЕНИЯ ВАЖЕН: сперва `SCHEMA_DDL` (таблицы и индексы, которым
 * хватает объявленных колонок), затем `COLUMN_MIGRATIONS` (доращивание старых
 * баз), и только после них `POST_MIGRATION_DDL` — индексы по колонкам, которых
 * на старой базе до миграции ещё нет.
 */

/**
 * Таблицы и индексы пустой базы. `IF NOT EXISTS` везде: команда выполняется на
 * каждом запуске, а не один раз при установке.
 *
 * Индексы заведены под РЕАЛЬНЫЕ запросы продукта, а не «на всякий случай»:
 * каждый ниже назван вместе с тем, что без него читалось перебором всей
 * таблицы.
 */
export const SCHEMA_DDL = `
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

  CREATE TABLE IF NOT EXISTS yearlong_kind_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dept TEXT NOT NULL,
    pp_num TEXT NOT NULL,
    kind TEXT NOT NULL,
    provisional INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    user_id TEXT,
    UNIQUE(dept, pp_num)
  );

  CREATE TABLE IF NOT EXISTS changelog_entries (
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
  );

  CREATE TABLE IF NOT EXISTS webhook_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book TEXT NOT NULL,
    file_id TEXT,
    message_number INTEGER,
    channel_id TEXT,
    resource_state TEXT,
    received_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    done_at TEXT
  );

  CREATE TABLE IF NOT EXISTS book_watermarks (
    book TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    parsed_at TEXT NOT NULL,
    drive_version TEXT,
    drive_modified_time TEXT
  );

  CREATE TABLE IF NOT EXISTS journal_gaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book TEXT NOT NULL,
    file_modified_time TEXT,
    noted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS drive_comments (
    id TEXT PRIMARY KEY,
    book TEXT NOT NULL,
    comment_id TEXT NOT NULL,
    author TEXT,
    content TEXT,
    quoted TEXT,
    created_at_ms INTEGER,
    modified_at_ms INTEGER,
    resolved INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    replies INTEGER NOT NULL DEFAULT 0,
    recorded_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_metric_history_key ON metric_history(metric_key);
  CREATE INDEX IF NOT EXISTS idx_metric_history_snapshot ON metric_history(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_issues_severity ON issues(severity);
  CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
  CREATE INDEX IF NOT EXISTS idx_issues_snapshot ON issues(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_issue_history_issue ON issue_history(issue_id);
  CREATE INDEX IF NOT EXISTS idx_procurement_rows_snapshot ON procurement_rows(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_procurement_rows_dept ON procurement_rows(department_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

  -- Снимок ищут ТОЛЬКО по времени: «последний целый» (loadLatestSavedSnapshot),
  -- «на день среза или раньше» (getSnapshotAtOrBefore), история для журнала.
  -- Без индекса каждый такой запрос перебирал таблицу целиком и сортировал её —
  -- а в строке снимка лежит многомегабайтный data-JSON, поэтому перебор здесь
  -- стоит дороже, чем где-либо ещё в базе.
  CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at);

  -- Журнал и его статистика читают аудит-лог и историю замечаний окном по
  -- времени («последние 100», «за 30 дней»). Индекс по действию (выше) на этих
  -- запросах не применялся: сортировка и отсечка идут по отметке времени.
  CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_issue_history_timestamp ON issue_history(timestamp);

  -- Правки книг отдаются окном «с момента среза, свежие сверху», а страница
  -- управления спрашивает их же по одной книге.
  CREATE INDEX IF NOT EXISTS idx_changelog_entries_at ON changelog_entries(at_ms);
  CREATE INDEX IF NOT EXISTS idx_changelog_entries_dept ON changelog_entries(dept, at_ms);

  -- Обработчик очереди берёт только невыполненные — их всегда единицы, но
  -- перебирать ради них выполненные за месяцы было бы платой за каждую правку.
  CREATE INDEX IF NOT EXISTS idx_webhook_queue_state ON webhook_queue(state, id);

  -- Один и тот же пропуск (книга + отметка времени файла) не пишется дважды:
  -- повторная перечитка того же немого изменения — не второй пропуск.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_gaps_unique
    ON journal_gaps(book, IFNULL(file_modified_time, ''));

  -- Комментарии спрашивают по книге; повторное чтение обновляет запись по
  -- паре книга+идентификатор, а не плодит дубли.
  CREATE INDEX IF NOT EXISTS idx_drive_comments_book ON drive_comments(book, created_at_ms);
`;

/**
 * Доращивание колонок на базах, заведённых раньше. `ALTER TABLE ADD COLUMN`
 * не знает `IF NOT EXISTS`, поэтому повторное применение ловится по тексту
 * отказа («duplicate column name») — см. `db/index.ts`.
 */
export const COLUMN_MIGRATIONS: readonly string[] = [
  `ALTER TABLE audit_log ADD COLUMN entity TEXT`,
  `ALTER TABLE audit_log ADD COLUMN entity_id TEXT`,
  `ALTER TABLE audit_log ADD COLUMN department_id TEXT`,
  `ALTER TABLE audit_log ADD COLUMN row_index INTEGER`,
  `ALTER TABLE audit_log ADD COLUMN field TEXT`,
  `ALTER TABLE audit_log ADD COLUMN old_value TEXT`,
  `ALTER TABLE audit_log ADD COLUMN new_value TEXT`,
  // Замечания — колонки подведомственной иерархии и следа сигнала.
  `ALTER TABLE issues ADD COLUMN subordinate_id TEXT`,
  `ALTER TABLE issues ADD COLUMN activity_type TEXT`,
  `ALTER TABLE issues ADD COLUMN signal TEXT`,
  `ALTER TABLE issues ADD COLUMN issue_group TEXT`,
  `ALTER TABLE issues ADD COLUMN check_id TEXT`,
  `ALTER TABLE issues ADD COLUMN kb_hint TEXT`,
];

/** Индексы по колонкам, которых до доращивания на старой базе не существует. */
export const POST_MIGRATION_DDL = `
  CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);
`;
