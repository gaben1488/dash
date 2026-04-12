import type { FastifyInstance } from 'fastify';
import { getSnapshot } from '../services/snapshot.js';
import { createDemoSnapshot } from '../services/demo-data.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import type { Issue } from '@aemr/shared';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';

/**
 * CRUD маршруты для жизненного цикла замечаний.
 *
 * Жизненный цикл: open → acknowledged → in_progress → resolved / wont_fix / false_positive
 * Uses canonical IssueStatus from shared/types.ts.
 */

/** Допустимые переходы статусов (canonical IssueStatus values) */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  'open':           ['acknowledged', 'in_progress', 'wont_fix', 'false_positive'],
  'acknowledged':   ['in_progress', 'wont_fix', 'false_positive'],
  'in_progress':    ['resolved', 'wont_fix', 'false_positive'],
  'resolved':       ['open'],           // переоткрытие
  'wont_fix':       ['open'],           // переоткрытие
  'false_positive': ['open'],           // переоткрытие
};

export async function issuesRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/issues
   * Список замечаний с фильтрами.
   *
   * Query params:
   *   - severity: 'critical' | 'significant' | 'warning' | 'info'
   *   - status: string
   *   - deptId: string — фильтр по отделу
   *   - category: string
   *   - page: number
   *   - limit: number
   */
  app.get('/api/issues', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));

    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      app.log.warn({ err }, 'issues: failed to get snapshot, using demo');
      snapshot = createDemoSnapshot();
    }

    let issues: Issue[] = snapshot.issues ?? [];

    // Apply filters
    if (query.severity) issues = issues.filter(i => i.severity === query.severity);
    if (query.status) issues = issues.filter(i => i.status === query.status);
    if (query.deptId) issues = issues.filter(i => i.departmentId === query.deptId || i.sheet === query.deptId);
    if (query.category) issues = issues.filter(i => i.category === query.category);

    const total = issues.length;
    const totalPages = Math.ceil(total / limit);
    const paged = issues.slice((page - 1) * limit, page * limit);

    const allIssues = snapshot.issues ?? [];
    return reply.send({
      issues: paged,
      pagination: { page, limit, total, totalPages },
      counts: {
        total: allIssues.length,
        byStatus: {
          open: allIssues.filter((i: Issue) => !i.status || i.status === 'open').length,
          acknowledged: allIssues.filter((i: Issue) => i.status === 'acknowledged').length,
          in_progress: allIssues.filter((i: Issue) => i.status === 'in_progress').length,
          resolved: allIssues.filter((i: Issue) => i.status === 'resolved').length,
          wont_fix: allIssues.filter((i: Issue) => i.status === 'wont_fix').length,
          false_positive: allIssues.filter((i: Issue) => i.status === 'false_positive').length,
        },
        bySeverity: {
          critical: allIssues.filter((i: Issue) => i.severity === 'critical').length,
          significant: allIssues.filter((i: Issue) => i.severity === 'significant').length,
          warning: allIssues.filter((i: Issue) => i.severity === 'warning').length,
          info: allIssues.filter((i: Issue) => i.severity === 'info').length,
        },
      },
    });
  });

  /**
   * GET /api/issues/:id
   * Детали замечания включая историю.
   */
  app.get('/api/issues/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      app.log.warn({ err }, 'issues/:id: failed to get snapshot, using demo');
      snapshot = createDemoSnapshot();
    }

    const issue = (snapshot.issues ?? []).find((i: Issue) => i.id === id);
    if (!issue) {
      return reply.status(404).send({ error: `Замечание "${id}" не найдено` });
    }

    return reply.send({
      issue,
      history: [],
    });
  });

  /**
   * PUT /api/issues/:id/status
   * Изменить статус замечания.
   *
   * Body: {
   *   status: string,          — новый статус
   *   comment?: string,        — комментарий
   *   reason?: string,         — причина (для исключений/отклонений)
   *   justification?: string,  — обоснование
   *   responsible?: string,    — ответственный
   *   deadline?: string,       — срок устранения (ISO date)
   * }
   */
  const IssueStatusUpdateSchema = z.object({
    status: z.string().min(1, 'Поле "status" обязательно'),
    comment: z.string().optional(),
    reason: z.string().optional(),
    justification: z.string().optional(),
    responsible: z.string().optional(),
    deadline: z.string().optional(),
  });

  app.put('/api/issues/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseBody(IssueStatusUpdateSchema, request, reply);
    if (!body) return;

    // Ищем текущий статус в DB, иначе в snapshot
    let currentStatus = 'open';
    const dbIssue = db.select({ status: schema.issues.status }).from(schema.issues).where(eq(schema.issues.id, id)).get();
    if (dbIssue) {
      currentStatus = dbIssue.status;
    } else {
      // Ищем в snapshot
      let snapshot;
      try { snapshot = await getSnapshot(); } catch (err) { app.log.warn({ err }, 'issues/status: failed to get snapshot'); snapshot = createDemoSnapshot(); }
      const snapshotIssue = (snapshot.issues ?? []).find((i: Issue) => i.id === id);
      if (snapshotIssue?.status) currentStatus = snapshotIssue.status;
    }

    // Проверка допустимости перехода
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus];
    if (!allowedTransitions?.includes(body.status)) {
      return reply.status(400).send({
        error: `Переход "${currentStatus}" → "${body.status}" недопустим`,
        allowed: allowedTransitions || [],
      });
    }

    // Для wont_fix и false_positive — требуется причина
    if ((body.status === 'wont_fix' || body.status === 'false_positive') && !body.reason) {
      return reply.status(400).send({
        error: `Для статуса "${body.status}" необходимо указать причину`,
      });
    }

    const now = new Date().toISOString();

    // Upsert issue status in DB
    if (dbIssue) {
      db.update(schema.issues).set({ status: body.status, comment: body.comment ?? null, resolvedAt: body.status === 'resolved' ? now : null }).where(eq(schema.issues.id, id)).run();
    } else {
      // Insert minimal issue record for tracking
      try {
        db.insert(schema.issues).values({
          id,
          snapshotId: 'manual',
          severity: 'info',
          origin: 'user',
          category: 'status_change',
          title: `Issue ${id}`,
          status: body.status,
          detectedAt: now,
        }).run();
      } catch (err) { app.log.warn({ err }, 'issues/status: insert conflict'); }
    }

    // Create issueHistory record
    try {
      db.insert(schema.issueHistory).values({
        issueId: id,
        fromStatus: currentStatus,
        toStatus: body.status,
        comment: body.comment ?? null,
        reason: body.reason ?? null,
        justification: body.justification ?? null,
        responsible: body.responsible ?? null,
        deadline: body.deadline ?? null,
        timestamp: now,
      }).run();
    } catch (err) { app.log.warn({ err }, 'issues/status: failed to write issue_history'); }

    return reply.send({
      success: true,
      issueId: id,
      fromStatus: currentStatus,
      toStatus: body.status,
      message: `Статус замечания изменён: ${currentStatus} → ${body.status}`,
    });
  });

  /**
   * PUT /api/issues/:id/comment
   * Добавить комментарий к замечанию.
   *
   * Body: { comment: string }
   */
  const IssueCommentSchema = z.object({
    comment: z.string().min(1, 'Поле "comment" обязательно'),
  });

  app.put('/api/issues/:id/comment', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseBody(IssueCommentSchema, request, reply);
    if (!body) return;

    const now = new Date().toISOString();
    try {
      db.update(schema.issues).set({ comment: body.comment }).where(eq(schema.issues.id, id)).run();
    } catch (err) { app.log.warn({ err }, 'issues/comment: failed to update issue'); }

    try {
      db.insert(schema.auditLog).values({
        action: 'issue_comment',
        entity: 'issue',
        entityId: id,
        details: body.comment,
        timestamp: now,
      }).run();
    } catch (err) { app.log.warn({ err }, 'issues/comment: failed to write audit_log'); }

    return reply.send({
      success: true,
      issueId: id,
      message: 'Комментарий добавлен',
    });
  });

  /**
   * GET /api/issues/:id/history
   * История изменений статуса замечания.
   */
  app.get('/api/issues/:id/history', async (request, reply) => {
    const { id } = request.params as { id: string };

    let history: any[] = [];
    try {
      history = db.select().from(schema.issueHistory).where(eq(schema.issueHistory.issueId, id)).all();
    } catch (err) { app.log.warn({ err }, 'issues/history: failed to read issue_history'); }

    return reply.send({
      issueId: id,
      history,
    });
  });

  /**
   * GET /api/export/issues
   * Экспорт замечаний в CSV (UTF-8 с BOM для Excel).
   *
   * Query params:
   *   - severity: фильтр по серьёзности
   *   - status: фильтр по статусу
   *   - deptId: фильтр по отделу
   */
  app.get('/api/export/issues', async (request, reply) => {
    const query = request.query as Record<string, string>;

    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      app.log.warn({ err }, 'export/issues: failed to get snapshot, using demo');
      snapshot = createDemoSnapshot();
    }

    let issues: Issue[] = snapshot.issues ?? [];

    if (query.severity) issues = issues.filter(i => i.severity === query.severity);
    if (query.status) issues = issues.filter(i => i.status === query.status);
    if (query.deptId) issues = issues.filter(i => i.departmentId === query.deptId || i.sheet === query.deptId);

    // CSV header
    const SEVERITY_RU: Record<string, string> = {
      critical: 'Критично', significant: 'Значительно', warning: 'Предупреждение', info: 'Информация', error: 'Ошибка',
    };
    const headers = ['Отдел', 'Серьёзность', 'Категория', 'Описание', 'Рекомендация', 'Статус', 'Лист', 'Ячейка'];
    const rows = issues.map(i => [
      i.departmentId ?? i.sheet ?? '',
      SEVERITY_RU[i.severity] ?? i.severity,
      i.category ?? '',
      (i.title ?? '') + (i.description ? ': ' + i.description : ''),
      i.recommendation ?? '',
      i.status ?? 'open',
      i.sheet ?? '',
      i.cell ?? '',
    ]);

    const escapeCsv = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    };

    const csvContent = [
      headers.map(escapeCsv).join(','),
      ...rows.map(row => row.map(escapeCsv).join(',')),
    ].join('\r\n');

    // UTF-8 BOM for correct Cyrillic display in Excel
    const BOM = '\uFEFF';

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="issues_${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(BOM + csvContent);
  });
}
