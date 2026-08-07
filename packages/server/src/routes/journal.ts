import type { FastifyInstance } from 'fastify';
import { getSnapshot, getDeptLoadMeta, getSHDYURawRowCount } from '../services/snapshot.js';
import { db, schema } from '../db/index.js';
import { desc } from 'drizzle-orm';
import { config, DEPARTMENT_SPREADSHEETS, updateSpreadsheetId, validateSpreadsheetIdForSourceChange } from '../config.js';
import { getSpreadsheetMetadata } from '../google-sheets.js';
import { SVOD_SHEET_NAME, SHDYU_MONTHLY_SHEET_NAME, findDept } from '@aemr/shared';
import { validateSource, validateAllSources } from '../services/source-validation.js';

/**
 * Маршруты журнала (аудит-лог).
 *
 * Полная хронология всех действий в системе:
 * - Импорт данных (снапшоты)
 * - Правки ячеек
 * - Нормализация данных
 * - Создание/изменение замечаний
 * - Ошибки ввода
 * - Изменения маппинга
 */
/**
 * Возвращает русскоязычную метку для типа действия аудит-лога.
 */
function formatAuditAction(action: string | null, _entity: string | null): string {
  switch (action) {
    case 'import':        return 'Импорт данных';
    case 'edit':          return 'Правка данных';
    case 'issue_create':  return 'Создание замечания';
    case 'issue_status':  return 'Изменение статуса';
    case 'normalize':     return 'Нормализация';
    case 'input_error':   return 'Ошибка ввода';
    case 'mapping_change': return 'Изменение маппинга';
    default:              return action ?? 'Действие';
  }
}

export async function journalRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/journal
   * Получить записи журнала с фильтрами.
   *
   * Query params:
   *   - action: 'import' | 'edit' | 'issue_create' | 'issue_status' | 'normalize' | 'input_error' | 'mapping_change'
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
    let entries: any[] = [];

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
          actor: 'Pipeline',
          action: 'Импорт данных',
          details: `Прочитано ${snap.rowCount ?? '?'} строк. ${snap.issueCount ?? 0} замечаний (${snap.criticalIssueCount ?? 0} критич.). Обработка: ${snap.pipelineDurationMs ?? '?'} мс.`,
          departmentId: null,
        });
        if ((snap.issueCount ?? 0) > 0) {
          entries.push({
            id: `J-iss-${snap.id.slice(0, 8)}`,
            type: 'issue_create',
            timestamp: snap.createdAt,
            actor: 'Валидатор',
            action: `Обнаружено ${snap.issueCount} замечаний`,
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
          type: entry.action ?? 'edit',
          timestamp: entry.timestamp,
          actor: entry.userId ?? 'Система',
          action: formatAuditAction(entry.action, entry.entity),
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
          details: `${entry.fromStatus} → ${entry.toStatus}${entry.comment ? ': ' + entry.comment : ''}`,
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
    // Параметр entity документировался, но никогда не применялся (пирамида
    // §6, п.15): из описания убран — обещать фильтр, которого нет, хуже,
    // чем не обещать ничего. Понадобится — вводить вместе с фильтрацией.
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

    return reply.send({
      entries: paged,
      pagination: { page, limit, total, totalPages },
      counts: {
        total,
        byAction: {
          import: entries.filter(e => e.type === 'import').length,
          edit: entries.filter(e => e.type === 'edit').length,
          issue_create: entries.filter(e => e.type === 'issue_create').length,
          issue_status: entries.filter(e => e.type === 'issue_status').length,
          normalize: entries.filter(e => e.type === 'normalize').length,
          input_error: entries.filter(e => e.type === 'input_error').length,
          mapping_change: entries.filter(e => e.type === 'mapping_change').length,
        },
      },
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

    // Считаем из audit_log
    try {
      const allEntries = db.select().from(schema.auditLog).all();
      for (const e of allEntries) {
        if (e.timestamp < cutoff) continue;
        totalActions++;
        if (e.userId) userSet.add(e.userId);
        switch (e.action) {
          case 'import':        snapshotCount++; break;
          case 'edit':          editCount++; break;
          case 'input_error':   errorCount++; break;
          case 'issue_create':  issueCreated++; break;
          case 'issue_status':  issueResolved++; break;
        }
      }
    } catch (err) { app.log.warn({ err }, 'journal/stats: failed to read audit_log'); }

    // Дополняем из снапшотов (если audit_log пуст)
    if (snapshotCount === 0) {
      try {
        const snaps = db.select({ createdAt: schema.snapshots.createdAt })
          .from(schema.snapshots).all();
        for (const s of snaps) {
          if (s.createdAt >= cutoff) {
            snapshotCount++;
            totalActions++;
          }
        }
      } catch (err) { app.log.warn({ err }, 'journal/stats: failed to read snapshots'); }
    }

    // Дополняем из issue_history
    try {
      const hist = db.select().from(schema.issueHistory).all();
      for (const h of hist) {
        if (h.timestamp < cutoff) continue;
        if (h.userId) userSet.add(h.userId);
        if (h.toStatus === 'resolved' || h.toStatus === 'closed') issueResolved++;
      }
    } catch (err) { app.log.warn({ err }, 'journal/stats: failed to read issue_history'); }

    return reply.send({
      period: `${days} дней`,
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
      lastSuccess: string | null;
      rowCount: number | null;
    }> = [
      {
        name: SVOD_SHEET_NAME,
        type: 'summary',
        spreadsheetId: config.google.spreadsheetId,
        status: isDemo ? 'warning' : (sheetsRead.includes(SVOD_SHEET_NAME) ? 'ok' : 'error'),
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
      let lastSuccessTime: string | null = null;
      let rowCount: number | null = null;

      if (isDemo) {
        status = 'warning';
        statusLabel = 'Демо';
      } else if (meta && !meta.error) {
        status = 'ok';
        statusLabel = 'Активна';
        lastSuccessTime = meta.loadedAt;
        rowCount = meta.rowCount;
      } else if (meta?.error) {
        status = 'error';
        statusLabel = `Ошибка: ${meta.error}`;
        lastSuccessTime = meta.loadedAt;
      } else if (isRead) {
        status = 'ok';
        statusLabel = 'Активна';
        lastSuccessTime = lastSuccess;
      } else {
        status = 'warning';
        statusLabel = 'Не загружена';
      }

      sourceList.push({
        name: deptName,
        type: 'department',
        spreadsheetId: sheetId,
        status,
        statusLabel,
        lastSuccess: lastSuccessTime,
        rowCount,
      });
    }

    // ШДЮ — лист внутри СВОД_для_Google (та же таблица что и СВОД ТД-ПМ)
    const { SHDYU_SPREADSHEET_ID } = await import('../config.js');
    let shdyuRows = 0;
    let shdyuTimestamp: string | null = null;
    try {
      const snap = await getSnapshot();
      // Use actual sheet row count (from Google Sheets API), not parsed block count
      shdyuRows = getSHDYURawRowCount();
      if (shdyuRows === 0 && snap?.shdyuData) {
        // Fallback: count parsed ГРБС blocks if raw count unavailable
        shdyuRows = Object.keys(snap.shdyuData).length;
      }
      shdyuTimestamp = (snap?.metadata as any)?.timestamp ?? new Date().toISOString();
    } catch { /* snapshot not ready yet */ }
    sourceList.push({
      // Легаси-имя «ШДЮ» ушло: источник — лист «СВОД с месяцами» (та же книга, что СВОД).
      name: SHDYU_MONTHLY_SHEET_NAME,
      type: 'sheet',
      spreadsheetId: SHDYU_SPREADSHEET_ID,
      status: shdyuRows > 0 ? 'ok' : 'warning',
      statusLabel: shdyuRows > 0 ? 'Активна' : 'Нет данных',
      lastSuccess: shdyuTimestamp,
      rowCount: shdyuRows > 0 ? shdyuRows : null,
    });

    const onlineCount = sourceList.filter(s => s.status === 'ok').length;
    const errorCount = sourceList.filter(s => s.status === 'error').length;

    return reply.send({
      sources: sourceList,
      totalSources: sourceList.length,
      onlineCount,
      errorCount,
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
      return reply.status(404).send({ error: `Источник "${name}" не найден` });
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
      return reply.send({
        success: false,
        name,
        spreadsheetId,
        error: (err as Error).message,
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
      return reply.status(400).send({ error: validation.error });
    }
    const nextSpreadsheetId = validation.spreadsheetId;

    // Validate: source must exist
    if (name === SVOD_SHEET_NAME) {
      // Update main spreadsheet ID in config (runtime only; .env update is separate)
      config.google.spreadsheetId = nextSpreadsheetId;
      return reply.send({ success: true, name, spreadsheetId: nextSpreadsheetId });
    }

    if (!(name in DEPARTMENT_SPREADSHEETS)) {
      return reply.status(404).send({ error: `Источник "${name}" не найден` });
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
    return reply.status(result.success ? 200 : 503).send(result);
  });

  /**
   * POST /api/sources/validate-all
   * Все источники разом (СВОД + 8 ГРБС + «СВОД с месяцами»), последовательно.
   */
  app.post('/api/sources/validate-all', async (_request, reply) => {
    const results = await validateAllSources();
    return reply.send({
      results,
      totalIssues: results.reduce((s, r) => s + r.summary.total, 0),
      failedSources: results.filter(r => !r.success).map(r => r.name),
    });
  });
}
