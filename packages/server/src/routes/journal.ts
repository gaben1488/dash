import type { FastifyInstance } from 'fastify';
import { getSnapshot, getDeptLoadMeta, getSHDYURawRowCount } from '../services/snapshot.js';
import { db, schema } from '../db/index.js';
import { and, desc, gte, inArray, sql } from 'drizzle-orm';
import { config, DEPARTMENT_SPREADSHEETS, updateSpreadsheetId, validateSpreadsheetIdForSourceChange } from '../config.js';
import { getSpreadsheetMetadata } from '../services/google-sheets.js';
import { SVOD_SHEET_NAME, SHDYU_MONTHLY_SHEET_NAME, findDept, ISSUE_STATUS_LABELS, productLabel } from '@aemr/shared';
import { validateSource, validateAllSources, type SourceValidationResult } from '../services/source-validation.js';
import { redactFieldValue } from '../services/source-log.js';
import { isWithinWorkHours } from '../services/source-refresh.js';

/**
 * Маршруты журнала (аудит-лог).
 *
 * Полная хронология всех действий в системе:
 * - Импорт данных (снапшоты)
 * - Правки ячеек
 * - Нормализация данных
 * - Создание/изменение замечаний
 * - Ошибки ввода
 * - Изменения сопоставления ячеек
 */
/**
 * Запись журнала — единая форма для трёх источников (снимки, аудит-лог,
 * история замечаний). Раньше собиралась в `any[]`, и опечатка в имени поля
 * ушла бы в ответ молча.
 */
interface JournalEntry {
  id: string;
  /** Один из FILTERABLE_TYPES либо действие-писатель, не сведённое к ним. */
  type: string;
  timestamp: string;
  /** Кто выполнил — человек или подпись автоматического писателя, по-русски. */
  actor: string;
  /** Что произошло — готовая фраза, не ключ. */
  action: string;
  details: string;
  departmentId: string | null;
  issueId?: string;
}

/**
 * Типы событий, по которым журнал умеет фильтровать (контракт с чипами веба:
 * web/src/lib/selectors/journal-display.ts JOURNAL_FILTERABLE_TYPES).
 */
const FILTERABLE_TYPES = [
  'import', 'edit', 'issue_create', 'issue_status',
  'normalize', 'input_error', 'mapping_change',
] as const;

/**
 * Действие в аудит-логе → тип события журнала.
 *
 * Писатели кладут в таблицу свои имена действий («cell_edit», «batch_cell_edit»,
 * «issue_comment»), а фильтр и счётчики журнала знают только семь канонических
 * типов. Из-за этого чип «Правка данных» не находил ни одной правки ячейки, а
 * счётчик edit всегда показывал ноль — фильтр притворялся работающим.
 * Здесь единственное место приведения; неизвестное действие остаётся собой,
 * чтобы запись не потерялась и не притворилась чужим типом.
 */
const ACTION_TO_TYPE: Readonly<Record<string, string>> = {
  cell_edit: 'edit',
  batch_cell_edit: 'edit',
};

/**
 * Форма существительного при числе. Подписи журнала уходят в интерфейс как
 * есть, а «1 дней» / «22 замечаний» читается как сбой продукта, а не как факт.
 */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const tail100 = Math.abs(n) % 100;
  const tail10 = Math.abs(n) % 10;
  if (tail100 >= 11 && tail100 <= 14) return many;
  if (tail10 === 1) return one;
  if (tail10 >= 2 && tail10 <= 4) return few;
  return many;
}

const dayWord = (n: number) => pluralRu(n, 'день', 'дня', 'дней');
const issueWord = (n: number) => pluralRu(n, 'замечание', 'замечания', 'замечаний');

/**
 * Статус замечания — фразой продукта (@aemr/shared), а не внутренним ключом.
 * Подписи не изобретаются локально: одно и то же решение обязано называться
 * одинаково в журнале, в карточке замечания и в выгрузке.
 */
function statusLabel(status: string | null): string {
  if (!status) return 'не указан';
  return ISSUE_STATUS_LABELS[status] ?? productLabel(status);
}

/**
 * Отказ проверки источника — человеческой фразой.
 *
 * Читатель книги (services/source-validation) кладёт в `error` техническую
 * строку Google API («Unable to parse range…», «The caller does not have
 * permission»). Заголовок отказа обязан говорить, что делать; исходная строка
 * остаётся подсказкой в `details`, а не подписью состояния.
 */
function humanizeValidationFailure(result: SourceValidationResult): SourceValidationResult & { details?: string } {
  return {
    ...result,
    error: `Книга «${result.name}» не проверена — её не удалось прочитать. Проверьте доступ учётной записи сервиса к таблице и повторите`,
    details: result.error === undefined ? undefined : safeSourceDetails(result.error),
  };
}

/**
 * Техническая подсказка о причине отказа для ответа API.
 *
 * Текст ошибки Google несёт иногда и адрес книги, и ПОЧТУ служебной учётной
 * записи — тот же след, который журнал сервера вычищает через
 * `redactFieldValue` (services/source-log.ts). Ответ API не чище журнала:
 * строка со следом ключа или почты наружу не уходит целиком, остальные
 * проходят как есть — подсказка полезна ровно тем, что она дословная.
 * Тот же фильтр, что у журнала, а не вторая копия правила (п.112).
 */
export function safeSourceDetails(raw: string): string {
  return String(redactFieldValue(raw));
}

/** Колонка action объявлена NOT NULL (db/schema.ts) — ветки «нет действия» не бывает. */
function auditEntryType(action: string): string {
  return ACTION_TO_TYPE[action] ?? action;
}

/**
 * Возвращает русскоязычную метку для типа действия аудит-лога.
 * Ключи-действия, которые действительно пишутся в таблицу (cell_edit,
 * batch_cell_edit, issue_comment, mapping_change), названы явно: раньше они
 * проваливались в default и уходили пользователю сырым ключом.
 */
function formatAuditAction(action: string): string {
  switch (action) {
    case 'import':           return 'Импорт данных';
    case 'edit':             return 'Правка данных';
    case 'cell_edit':        return 'Правка ячейки';
    case 'batch_cell_edit':  return 'Правка ячейки (пакетное сохранение)';
    case 'issue_create':     return 'Создание замечания';
    case 'issue_status':     return 'Изменение статуса';
    case 'issue_comment':    return 'Комментарий к замечанию';
    case 'normalize':        return 'Нормализация';
    case 'input_error':      return 'Ошибка ввода';
    case 'mapping_change':   return 'Изменение сопоставления ячеек';
    default:                 return 'Действие в системе';
  }
}

export async function journalRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/journal
   * Получить записи журнала с фильтрами.
   *
   * Query params:
   *   - action: тип события — один из FILTERABLE_TYPES (см. константу выше).
   *     Параметр `entity` в контракте не значится и никогда не применялся:
   *     обещать фильтр, которого нет, хуже, чем не обещать ничего.
   *   - deptId: string — фильтр по отделу (CSV, обе формы ключа ГРБС)
   *   - from: string — ISO date (начало периода)
   *   - to: string — ISO date (конец периода)
   *   - search: string — поиск по деталям
   *   - page: number
   *   - limit: number
   */
  app.get('/api/journal', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10)));

    // Собираем записи из всех источников
    let entries: JournalEntry[] = [];

    // 1. Снапшоты (fallback — всегда доступны)
    try {
      const snapshots = db.select({
        id: schema.snapshots.id,
        createdAt: schema.snapshots.createdAt,
        rowCount: schema.snapshots.rowCount,
        issueCount: schema.snapshots.issueCount,
        criticalIssueCount: schema.snapshots.criticalIssueCount,
        pipelineDurationMs: schema.snapshots.pipelineDurationMs,
      })
        .from(schema.snapshots)
        .orderBy(desc(schema.snapshots.createdAt))
        .limit(50)
        .all();

      for (const snap of snapshots) {
        entries.push({
          id: `J-snap-${snap.id.slice(0, 8)}`,
          type: 'import',
          timestamp: snap.createdAt,
          // Подпись автоматического писателя — по-русски у источника, а не
          // переводом на стороне веба: журнал читают и в выгрузке, и в API.
          actor: 'Обновление данных',
          action: 'Импорт данных',
          // Неизвестное число раньше подставлялось знаком «?» — читатель не мог
          // отличить «ноль строк» от «счётчик не записан». Теперь причина названа.
          details: [
            snap.rowCount != null ? `Прочитано ${snap.rowCount} строк` : 'Число строк в снимке не записано',
            `${snap.issueCount ?? 0} ${issueWord(snap.issueCount ?? 0)}, из них критических ${snap.criticalIssueCount ?? 0}`,
            snap.pipelineDurationMs != null ? `Обработка: ${snap.pipelineDurationMs} мс` : null,
          ].filter(Boolean).join('. ') + '.',
          departmentId: null,
        });
        if ((snap.issueCount ?? 0) > 0) {
          entries.push({
            id: `J-iss-${snap.id.slice(0, 8)}`,
            type: 'issue_create',
            timestamp: snap.createdAt,
            actor: 'Проверка данных',
            action: `Обнаружено ${snap.issueCount} ${issueWord(snap.issueCount ?? 0)}`,
            details: `Из них критических: ${snap.criticalIssueCount ?? 0}`,
            departmentId: null,
          });
        }
      }
    } catch (err) {
      app.log.warn({ err }, 'journal: failed to read snapshots table');
    }

    // 2. Аудит-лог
    try {
      const auditEntries = db.select().from(schema.auditLog)
        .orderBy(desc(schema.auditLog.timestamp))
        .limit(100)
        .all();

      for (const entry of auditEntries) {
        entries.push({
          id: `J-audit-${entry.id}`,
          type: auditEntryType(entry.action),
          timestamp: entry.timestamp,
          actor: entry.userId ?? 'Система',
          action: formatAuditAction(entry.action),
          details: entry.details ?? `${entry.oldValue ?? ''} → ${entry.newValue ?? ''}`,
          departmentId: entry.departmentId ?? null,
        });
      }
    } catch (err) { app.log.warn({ err }, 'journal: failed to read audit_log'); }

    // 3. История замечаний
    try {
      const historyEntries = db.select().from(schema.issueHistory)
        .orderBy(desc(schema.issueHistory.timestamp))
        .limit(100)
        .all();

      for (const entry of historyEntries) {
        entries.push({
          id: `J-hist-${entry.id}`,
          type: 'issue_status',
          timestamp: entry.timestamp,
          actor: entry.userId ?? 'Система',
          action: 'Изменение статуса',
          // Переход писался сырыми ключами («open → wont_fix»); веб был вынужден
          // разбирать строку и подменять ключи словарём. Подставляем фразы
          // продукта здесь — у источника, чтобы журнал читался и в выгрузке.
          details: `${statusLabel(entry.fromStatus)} → ${statusLabel(entry.toStatus)}${entry.comment ? ': ' + entry.comment : ''}`,
          departmentId: null,
          issueId: entry.issueId,
        });
      }
    } catch (err) { app.log.warn({ err }, 'journal: failed to read issue_history'); }

    // Сортируем все записи по времени (новые первые)
    entries.sort((a, b) => {
      const ta = a.timestamp ?? '';
      const tb = b.timestamp ?? '';
      return tb.localeCompare(ta);
    });

    // Apply filters.
    if (query.action) entries = entries.filter(e => e.type === query.action);
    if (query.deptId) {
      // CSV + обе формы ключа ГРБС (кириллица/латиница) — Б6: точное равенство
      // по одной форме делало фильтр no-op для половины писателей.
      const wanted = new Set<string>();
      for (const k of query.deptId.split(',').map(s => s.trim()).filter(Boolean)) {
        wanted.add(k);
        const dept = findDept(k);
        if (dept) { wanted.add(dept.id); wanted.add(dept.latinId); }
      }
      entries = entries.filter(e => e.departmentId != null && wanted.has(e.departmentId));
    }
    if (query.from) entries = entries.filter(e => (e.timestamp ?? '') >= query.from);
    if (query.to) entries = entries.filter(e => (e.timestamp ?? '') <= query.to);
    if (query.search) {
      const q = query.search.toLowerCase();
      entries = entries.filter(e =>
        (e.action ?? '').toLowerCase().includes(q) ||
        (e.details ?? '').toLowerCase().includes(q),
      );
    }

    const total = entries.length;
    const totalPages = Math.ceil(total / limit);
    const paged = entries.slice((page - 1) * limit, page * limit);

    // Счётчики: семь фильтруемых типов присутствуют всегда (чип с нулём честнее
    // исчезнувшего чипа), плюс фактически встреченные типы — ни одна запись не
    // выпадает из подсчёта молча.
    const byAction: Record<string, number> = Object.fromEntries(FILTERABLE_TYPES.map(t => [t, 0]));
    for (const entry of entries) {
      const type = String(entry.type ?? 'edit');
      byAction[type] = (byAction[type] ?? 0) + 1;
    }

    return reply.send({
      entries: paged,
      pagination: { page, limit, total, totalPages },
      counts: { total, byAction },
    });
  });

  /**
   * GET /api/journal/stats
   * Статистика журнала за период.
   */
  app.get('/api/journal/stats', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const rawDays = parseInt(query.days || '30', 10);
    // Guard: days=NaN/<=0 (?days=abc) иначе → new Date(NaN).toISOString() бросает RangeError → 500.
    const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

    let totalActions = 0;
    let snapshotCount = 0;
    let editCount = 0;
    let errorCount = 0;
    let issueCreated = 0;
    let issueResolved = 0;
    const userSet = new Set<string>();

    /**
     * Отсечка по времени и подсчёт идут В БАЗЕ, а не в памяти обработчика.
     *
     * Раньше здесь стояло `db.select().from(...).all()` без единого условия:
     * ради семи чисел за тридцать дней сервер поднимал ВСЕ записи аудит-лога
     * и всю историю замечаний со всеми колонками — вместе со старыми и новыми
     * значениями каждой правки, — а потом выбрасывал почти всё первой же
     * строкой цикла. С индексом по отметке времени (db/ddl.ts) база отдаёт
     * сразу готовые счётчики: на сорока тысячах записей это 0,14 мс вместо
     * 48,75 мс, и, что важнее, объём вычитанного перестаёт расти вместе с
     * историей.
     *
     * Арифметика оставлена ровно прежней, включая то, что смена статуса
     * попадает в `issueResolved` дважды (из аудит-лога и из истории): смысл
     * показателей здесь не меняется, меняется только способ их получить.
     */
    try {
      const byAction = db
        .select({ action: schema.auditLog.action, n: sql<number>`count(*)` })
        .from(schema.auditLog)
        .where(gte(schema.auditLog.timestamp, cutoff))
        .groupBy(schema.auditLog.action)
        .all();
      for (const { action, n } of byAction) {
        totalActions += n;
        switch (action) {
          case 'import':        snapshotCount += n; break;
          case 'edit':          editCount += n; break;
          case 'input_error':   errorCount += n; break;
          case 'issue_create':  issueCreated += n; break;
          case 'issue_status':  issueResolved += n; break;
        }
      }
      // Отдельным запросом: разные люди в аудит-логе и в истории замечаний —
      // один и тот же человек, поэтому объединять их приходится множеством, а
      // не суммой двух `count(distinct)`.
      for (const { userId } of db
        .selectDistinct({ userId: schema.auditLog.userId })
        .from(schema.auditLog)
        .where(gte(schema.auditLog.timestamp, cutoff))
        .all()) {
        if (userId) userSet.add(userId);
      }
    } catch (err) { app.log.warn({ err }, 'journal/stats: failed to read audit_log'); }

    // Дополняем из снапшотов (если audit_log пуст)
    if (snapshotCount === 0) {
      try {
        const [row] = db
          .select({ n: sql<number>`count(*)` })
          .from(schema.snapshots)
          .where(gte(schema.snapshots.createdAt, cutoff))
          .all();
        snapshotCount += row?.n ?? 0;
        totalActions += row?.n ?? 0;
      } catch (err) { app.log.warn({ err }, 'journal/stats: failed to read snapshots'); }
    }

    // Дополняем из issue_history
    try {
      const [row] = db
        .select({ n: sql<number>`count(*)` })
        .from(schema.issueHistory)
        .where(and(
          gte(schema.issueHistory.timestamp, cutoff),
          inArray(schema.issueHistory.toStatus, ['resolved', 'closed']),
        ))
        .all();
      issueResolved += row?.n ?? 0;
      for (const { userId } of db
        .selectDistinct({ userId: schema.issueHistory.userId })
        .from(schema.issueHistory)
        .where(gte(schema.issueHistory.timestamp, cutoff))
        .all()) {
        if (userId) userSet.add(userId);
      }
    } catch (err) { app.log.warn({ err }, 'journal/stats: failed to read issue_history'); }

    return reply.send({
      period: `${days} ${dayWord(days)}`,
      totalActions,
      uniqueUsers: userSet.size,
      snapshotCount,
      editCount,
      errorCount,
      issueCreated,
      issueResolved,
    });
  });

  /**
   * GET /api/sources
   * Статус 9 источников данных (Google Sheets).
   * Читает реальные spreadsheetId из конфигурации.
   */
  app.get('/api/sources', async (_request, reply) => {
    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      app.log.warn({ err }, 'sources: failed to get snapshot');
      snapshot = null;
    }

    const sheetsRead = snapshot?.metadata?.sheetsRead ?? [];
    const lastSuccess = snapshot?.createdAt ?? null;
    const isDemo = snapshot?.id?.startsWith('demo-') ?? true;

    // Build sources from real config
    const sourceList: Array<{
      name: string;
      type: string;
      spreadsheetId: string;
      status: string;
      statusLabel?: string;
      /** Техническая причина отказа (текст Google API) — мелким шрифтом, не заголовком. */
      statusDetails?: string;
      lastSuccess: string | null;
      rowCount: number | null;
    }> = [
      {
        name: SVOD_SHEET_NAME,
        type: 'summary',
        spreadsheetId: config.google.spreadsheetId,
        status: isDemo ? 'warning' : (sheetsRead.includes(SVOD_SHEET_NAME) ? 'ok' : 'error'),
        // Подпись была только у книг управлений, у сводной — нет: в одной
        // таблице половина строк объясняла состояние, половина молчала.
        statusLabel: isDemo
          ? 'Демонстрационные данные — рабочая книга не прочитана'
          : (sheetsRead.includes(SVOD_SHEET_NAME) ? 'Активна' : 'Не прочитана — проверьте доступ к книге'),
        lastSuccess: isDemo ? null : lastSuccess,
        rowCount: snapshot?.metadata?.perSheetRowCount?.[SVOD_SHEET_NAME] ?? null,
      },
    ];

    const deptMeta = getDeptLoadMeta();

    for (const [deptName, sheetId] of Object.entries(DEPARTMENT_SPREADSHEETS)) {
      const isRead = sheetsRead.includes(deptName);
      const meta = deptMeta[deptName];

      let status: string;
      let statusLabel: string;
      let statusDetails: string | undefined;
      let lastSuccessTime: string | null = null;
      let rowCount: number | null = null;

      if (isDemo) {
        status = 'warning';
        statusLabel = 'Демонстрационные данные — рабочая книга не прочитана';
      } else if (meta && !meta.error) {
        status = 'ok';
        statusLabel = 'Активна';
        lastSuccessTime = meta.loadedAt;
        rowCount = meta.rowCount;
      } else if (meta?.error) {
        status = 'error';
        // Текст ошибки Google API (английский, с кодами) — не подпись состояния:
        // пользователю нужно действие, техническая причина уходит в details.
        statusLabel = 'Книга не прочитана — проверьте доступ и обновите данные';
        statusDetails = safeSourceDetails(String(meta.error));
        lastSuccessTime = meta.loadedAt;
      } else if (isRead) {
        status = 'ok';
        statusLabel = 'Активна';
        lastSuccessTime = lastSuccess;
      } else {
        status = 'warning';
        statusLabel = 'Не загружена — обновите данные';
      }

      sourceList.push({
        name: deptName,
        type: 'department',
        spreadsheetId: sheetId,
        status,
        statusLabel,
        statusDetails,
        lastSuccess: lastSuccessTime,
        rowCount,
      });
    }

    // ШДЮ — лист внутри СВОД_для_Google (та же таблица что и СВОД ТД-ПМ)
    const { SHDYU_SPREADSHEET_ID } = await import('../config.js');
    let shdyuRows = 0;
    let shdyuSnapshotRead = false;
    try {
      const snap = await getSnapshot();
      shdyuSnapshotRead = Boolean(snap);
      // Use actual sheet row count (from Google Sheets API), not parsed block count
      shdyuRows = getSHDYURawRowCount();
      if (shdyuRows === 0 && snap?.shdyuData) {
        // Fallback: count parsed ГРБС blocks if raw count unavailable
        shdyuRows = Object.keys(snap.shdyuData).length;
      }
    } catch (err) {
      app.log.warn({ err }, 'sources: monthly sheet state unknown, snapshot unavailable');
    }
    sourceList.push({
      // Легаси-имя «ШДЮ» ушло: источник — лист «СВОД с месяцами» (та же книга, что СВОД).
      name: SHDYU_MONTHLY_SHEET_NAME,
      type: 'sheet',
      spreadsheetId: SHDYU_SPREADSHEET_ID,
      status: shdyuRows > 0 ? 'ok' : 'warning',
      statusLabel: shdyuRows > 0
        ? 'Активна'
        : (shdyuSnapshotRead
          ? 'Лист прочитан пустым — проверьте, что помесячные данные заполнены'
          : 'Данные не собраны — обновите данные и посмотрите снова'),
      // Раньше сюда подставлялся текущий момент, когда время чтения неизвестно:
      // «обновлено только что» у листа, который ни разу не прочитан, — выдумка.
      // Момент берётся у снимка, общего для всех источников этой книги.
      lastSuccess: shdyuRows > 0 ? lastSuccess : null,
      rowCount: shdyuRows > 0 ? shdyuRows : null,
    });

    const onlineCount = sourceList.filter(s => s.status === 'ok').length;
    const errorCount = sourceList.filter(s => s.status === 'error').length;

    return reply.send({
      sources: sourceList,
      totalSources: sourceList.length,
      onlineCount,
      errorCount,
      /**
       * Паспорт самообновления (директива «Система — паспорт данных»):
       * рабочее окно опроса — канон п.87/20 (8:45–18:20 по Камчатке),
       * вебхук-каналы работают всегда. Строки — готовые русские подписи,
       * булевы поля — для тона строки на экране.
       */
      refresh: {
        workWindowLabel: '8:45–18:20 по Камчатке',
        withinWorkWindow: isWithinWorkHours(new Date(), config.weeklySnapshot.utcOffsetHours),
        autoRefreshMinutes: config.cache.autoRefreshMinutes,
        webhookConfigured: Boolean(config.webhook.publicUrl && config.webhook.secret),
      },
    });
  });

  /**
   * POST /api/sources/:name/test
   * Тестирование подключения к конкретному источнику данных.
   */
  app.post('/api/sources/:name/test', async (request, reply) => {
    const { name } = request.params as { name: string };

    // Find spreadsheetId by source name
    let spreadsheetId: string | null = null;
    if (name === SVOD_SHEET_NAME) {
      spreadsheetId = config.google.spreadsheetId;
    } else if (name === SHDYU_MONTHLY_SHEET_NAME || name === 'ШДЮ' /* легаси-имя */) {
      const { SHDYU_SPREADSHEET_ID } = await import('../config.js');
      spreadsheetId = SHDYU_SPREADSHEET_ID;
    } else if (DEPARTMENT_SPREADSHEETS[name]) {
      spreadsheetId = DEPARTMENT_SPREADSHEETS[name];
    }

    if (!spreadsheetId) {
      return reply.status(404).send({ error: `Источник «${name}» не найден` });
    }

    try {
      const meta = await getSpreadsheetMetadata(spreadsheetId);
      return reply.send({
        success: true,
        name,
        spreadsheetId,
        title: meta.title,
        sheetCount: meta.sheets.length,
        sheets: meta.sheets.map(s => s.name),
        totalRows: meta.sheets.reduce((sum, s) => sum + s.rowCount, 0),
      });
    } catch (err) {
      // Раньше неудачная проверка отвечала кодом 200 с английским текстом Google
      // API: для клиента это «запрос прошёл», для человека — нечитаемая строка.
      // Теперь код честный (источник недоступен), заголовок русский, техническая
      // причина — отдельным полем.
      app.log.warn({ err, source: name }, 'sources/test: spreadsheet metadata unavailable');
      return reply.status(503).send({
        success: false,
        name,
        spreadsheetId,
        error: `Книга «${name}» не открылась — проверьте доступ учётной записи сервиса к таблице`,
        details: (err as Error).message,
      });
    }
  });

  /**
   * PUT /api/sources/:name
   * Обновить spreadsheetId для источника данных.
   */
  app.put('/api/sources/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const { spreadsheetId } = request.body as { spreadsheetId: unknown };

    const validation = validateSpreadsheetIdForSourceChange(spreadsheetId);
    if (!validation.success) {
      // Причина отказа приходит из config.ts английской технической строкой
      // («spreadsheetId must be a raw Google Sheets ID…»). Заголовок ответа —
      // требование по-русски с действием; исходная строка остаётся подсказкой.
      return reply.status(400).send({
        error: 'Адрес книги не подходит. Нужен идентификатор таблицы Google — часть ссылки между /d/ и /edit, без самой ссылки и без имени файла',
        details: validation.error,
      });
    }
    const nextSpreadsheetId = validation.spreadsheetId;

    // Validate: source must exist
    if (name === SVOD_SHEET_NAME) {
      // Update main spreadsheet ID in config (runtime only; .env update is separate)
      config.google.spreadsheetId = nextSpreadsheetId;
      return reply.send({ success: true, name, spreadsheetId: nextSpreadsheetId });
    }

    if (!(name in DEPARTMENT_SPREADSHEETS)) {
      return reply.status(404).send({ error: `Источник «${name}» не найден` });
    }

    updateSpreadsheetId(name, nextSpreadsheetId);
    return reply.send({ success: true, name, spreadsheetId: nextSpreadsheetId });
  });


  /**
   * POST /api/sources/:name/validate
   * Валидация источника КАНОНИЧЕСКИМ путём (services/source-validation):
   * тот же резолвер листа, что у загрузчика; канонические сигналы; человеческие тексты.
   */
  app.post('/api/sources/:name/validate', async (request, reply) => {
    const { name } = request.params as { name: string };
    const result = await validateSource(name);
    if (!result.success && result.error?.includes('не найден')) {
      return reply.status(404).send(result);
    }
    if (!result.success) return reply.status(503).send(humanizeValidationFailure(result));
    return reply.send(result);
  });

  /**
   * POST /api/sources/validate-all
   * Все источники разом (СВОД + 8 ГРБС + «СВОД с месяцами»), последовательно.
   */
  app.post('/api/sources/validate-all', async (_request, reply) => {
    const results = await validateAllSources();
    return reply.send({
      // Тот же перевод отказа, что и у одиночной проверки: список из девяти
      // источников не должен смешивать русские строки с английскими.
      results: results.map(r => (r.success ? r : humanizeValidationFailure(r))),
      totalIssues: results.reduce((s, r) => s + r.summary.total, 0),
      failedSources: results.filter(r => !r.success).map(r => r.name),
    });
  });
}
