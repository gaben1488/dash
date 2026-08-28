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
 * Очередь уведомлений вебхука (проект «служба, а не снимок», §2.3).
 *
 * Вебхук НЕ обрабатывает уведомление — он кладёт запись сюда и отвечает
 * Google мгновенно. Обработчик берёт из очереди и помечает выполненным ТОЛЬКО
 * после успешного чтения; упавшее чтение остаётся в очереди и повторяется.
 * Таблица, а не память процесса: уведомление, принятое за секунду до падения
 * сервера, переживает рестарт и дочитывается.
 */
export const webhookQueue = sqliteTable('webhook_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Человеческое название книги («УО», «Сводная книга»). */
  book: text('book').notNull(),
  /** Идентификатор файла Drive — по нему строится цель перечитки. */
  fileId: text('file_id'),
  /** Номер сообщения в канале — след дедупликации для разбора инцидентов. */
  messageNumber: integer('message_number'),
  channelId: text('channel_id'),
  /** Состояние ресурса из уведомления (update/change/trash/…). */
  resourceState: text('resource_state'),
  /** Момент приёма уведомления (ISO). */
  receivedAt: text('received_at').notNull(),
  /** pending — ждёт чтения; done — чтение состоялось. */
  state: text('state').notNull().default('pending'),
  /** Сколько раз чтение по этой записи падало. */
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  doneAt: text('done_at'),
});

/**
 * Водяной знак книги (проект §2.4): момент последнего успешно разобранного
 * состояния и отпечаток содержимого — в базе, а не в памяти процесса. После
 * рестарта первое чтение сравнивается с довалочным состоянием, а не с пустотой.
 */
export const bookWatermarks = sqliteTable('book_watermarks', {
  /** Человеческое название книги; лист СВОД живёт под собственным ключом. */
  book: text('book').primaryKey(),
  /** Отпечаток содержимого (sheet-fingerprint) последнего успешного разбора. */
  fingerprint: text('fingerprint').notNull(),
  /** Момент последнего успешно разобранного состояния (ISO). */
  parsedAt: text('parsed_at').notNull(),
  /** Отметка версии файла Drive на момент разбора — чтобы ворота по отметке
   *  времени переживали рестарт вместе с отпечатком. */
  driveVersion: text('drive_version'),
  driveModifiedTime: text('drive_modified_time'),
});

/**
 * Честные пропуски журнала (правило полноты, проект §2.2): отметка времени
 * файла сказала «менялся», а все содержательные свидетели молчат — пишется
 * запись «изменение было, содержание не установлено». Пропуск фиксируется как
 * пропуск, а не замалчивается.
 */
export const journalGaps = sqliteTable('journal_gaps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  book: text('book').notNull(),
  /** Отметка времени файла, из-за которой признан пропуск (ISO или null). */
  fileModifiedTime: text('file_modified_time'),
  /** Когда пропуск замечен (ISO). */
  notedAt: text('noted_at').notNull(),
});

/**
 * Комментарии-облачка книг (решение §17.2 и разбор
 * docs/superpowers/audits/2026-08-22-google-api-provenance.md §4): «зачем»
 * поменяли — причинный слой, которого нет ни в журнале правок, ни в заметках.
 * Привязка к ячейке публичными средствами не разворачивается, поэтому здесь
 * честно хранится цитата содержимого ячейки, а не адрес.
 */
export const driveComments = sqliteTable('drive_comments', {
  /** «книга#идентификатор комментария» — идентификаторы уникальны в файле. */
  id: text('id').primaryKey(),
  book: text('book').notNull(),
  commentId: text('comment_id').notNull(),
  /** Имя автора, как его отдаёт Диск; у удалённых стёрто самим Google. */
  author: text('author'),
  content: text('content'),
  /** Цитата содержимого ячейки на момент написания — единственная привязка. */
  quoted: text('quoted'),
  createdAtMs: integer('created_at_ms'),
  modifiedAtMs: integer('modified_at_ms'),
  resolved: integer('resolved').notNull().default(0),
  deleted: integer('deleted').notNull().default(0),
  /** Сколько ответов в ветке. */
  replies: integer('replies').notNull().default(0),
  /** Когда запись прочитана нами (ISO). */
  recordedAt: text('recorded_at').notNull(),
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
