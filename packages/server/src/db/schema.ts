import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/**
 * Снимки данных (snapshots)
 */
export const snapshots = sqliteTable('snapshots', {
  id: text('id').primaryKey(),
  spreadsheetId: text('spreadsheet_id').notNull(),
  createdAt: text('created_at').notNull(),
  trustOverall: integer('trust_overall'),
  trustGrade: text('trust_grade'),
  issueCount: integer('issue_count'),
  criticalIssueCount: integer('critical_issue_count'),
  metricsCount: integer('metrics_count'),
  rowCount: integer('row_count'),
  readDurationMs: integer('read_duration_ms'),
  pipelineDurationMs: integer('pipeline_duration_ms'),
  /** JSON-сериализованные данные (полный snapshot) */
  data: text('data'),
});

/**
 * Метрики — для быстрого доступа и исторических трендов
 */
export const metricHistory = sqliteTable('metric_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: text('snapshot_id').references(() => snapshots.id),
  metricKey: text('metric_key').notNull(),
  numericValue: real('numeric_value'),
  displayValue: text('display_value'),
  confidence: real('confidence'),
  origin: text('origin'),
  createdAt: text('created_at').notNull(),
});

/**
 * Проблемы — для отслеживания жизненного цикла
 */
export const issues = sqliteTable('issues', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').references(() => snapshots.id),
  severity: text('severity').notNull(),
  origin: text('origin').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  sheet: text('sheet'),
  cell: text('cell'),
  row: integer('row'),
  metricKey: text('metric_key'),
  departmentId: text('department_id'),
  subordinateId: text('subordinate_id'),
  activityType: text('activity_type'),
  signal: text('signal'),
  group: text('issue_group'),
  checkId: text('check_id'),
  kbHint: text('kb_hint'),
  recommendation: text('recommendation'),
  status: text('status').notNull().default('open'),
  detectedAt: text('detected_at').notNull(),
  detectedBy: text('detected_by'),
  resolvedAt: text('resolved_at'),
  comment: text('comment'),
});

/**
 * История изменений статуса замечаний
 */
export const issueHistory = sqliteTable('issue_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  issueId: text('issue_id').references(() => issues.id).notNull(),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  comment: text('comment'),
  /** Причина (для исключений/отклонений) */
  reason: text('reason'),
  /** Обоснование */
  justification: text('justification'),
  /** Ответственный */
  responsible: text('responsible'),
  /** Срок устранения */
  deadline: text('deadline'),
  userId: text('user_id'),
  timestamp: text('timestamp').notNull(),
});

/**
 * Аудит-лог — мощное журналирование всех действий
 */
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Тип: import | edit | issue_create | issue_status | normalize | input_error | mapping_change */
  action: text('action').notNull(),
  /** Сущность: row | issue | mapping | snapshot | system */
  entity: text('entity'),
  /** ID сущности */
  entityId: text('entity_id'),
  /** Отдел */
  departmentId: text('department_id'),
  /** Строка (для row-операций) */
  rowIndex: integer('row_index'),
  /** Поле */
  field: text('field'),
  /** Старое значение */
  oldValue: text('old_value'),
  /** Новое значение */
  newValue: text('new_value'),
  /** Детали (JSON или текст) */
  details: text('details'),
  timestamp: text('timestamp').notNull(),
  userId: text('user_id'),
});

// Таблица input_errors (лог попыток невалидного ввода) удалена из модели
// 20.08.2026 (зона В): за всё время в неё никто не писал и из неё никто не
// читал — фича «лог отвергнутого ввода» не была реализована. На базах,
// заведённых раньше, пустая таблица остаётся лежать — это безвредно
// (DDL её больше не создаёт, но и DROP не делаем: чужие данные не трогаем).

/**
 * Оверрайды маппинга — кастомные изменения ячеек
 */
export const mappingOverrides = sqliteTable('mapping_overrides', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  metricId: text('metric_id').notNull().unique(),
  /** Новая ссылка на ячейку (например "D15" вместо "D14") */
  cellRef: text('cell_ref').notNull(),
  /** Имя листа */
  sheetName: text('sheet_name'),
  /** Комментарий почему изменено */
  comment: text('comment'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
  userId: text('user_id'),
});

/**
 * Строки закупок — импортированные и нормализованные
 */
export const procurementRows = sqliteTable('procurement_rows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotId: text('snapshot_id').references(() => snapshots.id),
  departmentId: text('department_id').notNull(),
  rowIndex: integer('row_index').notNull(),
  /** Нормализованные данные всех колонок (JSON: {A: ..., B: ..., ...AG: ...}) */
  cellsJson: text('cells_json').notNull(),
  /** Активные сигналы строки (JSON-массив ключей: ["signed","overdue"]) */
  signalsJson: text('signals_json'),
  /** Итоговое состояние строки: signed | overdue | planning | ... */
  rowState: text('row_state'),
  /** Тип закупки: competitive | single_provider */
  procurementType: text('procurement_type'),
  /** Предмет закупки (нормализованный) */
  subject: text('subject'),
  /** План сумма */
  planAmount: real('plan_amount'),
  /** Факт сумма */
  factAmount: real('fact_amount'),
  /** Экономия */
  economy: real('economy'),
  /** % экономии */
  economyPercent: real('economy_percent'),
  createdAt: text('created_at').notNull(),
});

/**
 * Пользовательская разметка видов строк стадии «Закупки, проводимые в течение
 * года» (канон п.83 интервью 14.08.2026: размечает владелец кликом, продукт
 * запоминает; подстраховочная разметка агента несёт пометку «предварительная»).
 *
 * Ключ строки — КНИГА + № п/п (колонка A), а не номер строки листа: строки
 * сдвигаются при правках, порядковый номер закупки — нет. Стартовая разметка
 * 46 строк живёт данными в @aemr/shared (YEARLONG_START_ROWS); здесь — только
 * оверрайды поверх неё, поэтому пустая таблица = «всё по стартовой разметке».
 */
export const yearlongKindOverrides = sqliteTable('yearlong_kind_overrides', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Книга ГРБС — кириллический канон («УКСиМП»). */
  dept: text('dept').notNull(),
  /** № п/п закупки — колонка A листа (текстом: лист хранит и «15», и «б/н»). */
  ppNum: text('pp_num').notNull(),
  /** Вид — один из девяти id YEARLONG_KIND_IDS (@aemr/shared). */
  kind: text('kind').notNull(),
  /**
   * 1 — «разметка предварительная» (подстраховка агента, п.83б);
   * 0 — разметка владельца, окончательная до его же правки.
   */
  provisional: integer('provisional').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
  userId: text('user_id'),
});

/**
 * Журнал правок источника — вкладка «_ChangeLog» книг ГРБС, которую ведёт
 * Apps Script: кто, когда и что поменял. Раньше он жил пятиминутным кэшем в
 * памяти процесса и умирал вместе с ним; здесь история переживает рестарт и
 * молчание книги (пирамида, блок Е п.23).
 */
export const changelogEntries = sqliteTable('changelog_entries', {
  /**
   * Устойчивый ключ записи: у правки источника нет собственного номера,
   * поэтому опознаём её адресом — книга ГРБС, лист, ячейка, момент, автор.
   * Журнал append-only, поэтому повторное чтение даёт тот же ключ и дублей
   * не плодит.
   */
  id: text('id').primaryKey(),
  /** Короткое имя ГРБС, чью книгу правили («УО»). */
  dept: text('dept').notNull(),
  /** Лист книги («ВСЕ»). */
  sheet: text('sheet').notNull(),
  /** Адрес ячейки как в книге («L178»). */
  cell: text('cell').notNull(),
  /** Название атрибута по живой шапке; пусто, если буква вне канона колонок. */
  attribute: text('attribute'),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  /** Момент правки (мс эпохи) — из отметки времени журнала. */
  atMs: integer('at_ms').notNull(),
  /** Почта автора, как её записал источник. */
  author: text('author'),
  /** Когда запись прочитана нами: момент правки и момент чтения — не одно и то же. */
  recordedAt: text('recorded_at').notNull(),
});
