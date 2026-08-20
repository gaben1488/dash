import type { FastifyInstance } from 'fastify';
import { getSnapshot } from '../services/snapshot.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import type { Issue } from '@aemr/shared';
import { ISSUE_STATUS_LABELS, productLabel } from '@aemr/shared';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';

/**
 * CRUD маршруты для жизненного цикла замечаний.
 *
 * Жизненный цикл: open → acknowledged → in_progress → resolved / wont_fix / false_positive
 * Uses canonical IssueStatus from shared/types.ts.
 */

/**
 * Статус — человеческой фразой из словаря продукта (@aemr/shared).
 * Локально подписи не изобретаются: одно и то же решение обязано называться
 * одинаково в бейдже, в кнопке, в журнале и в ответе сервера.
 */
function statusLabel(status: string): string {
  return ISSUE_STATUS_LABELS[status] ?? productLabel(status);
}

/** Допустимые переходы статусов (canonical IssueStatus values) */
/**
 * Ответ на недоступность снимка. Демо-политику реализует ЕДИНАЯ точка —
 * getSnapshot (демо-снимок только при ненастроенных кредах, иначе последний
 * сохранённый из SQL либо ошибка): здесь замечания из демо-генератора не
 * сочиняются никогда — выдуманные «нарушения» о реальных управлениях
 * неотличимы от настоящих ни в списке, ни в выгрузке.
 */
const SNAPSHOT_UNAVAILABLE = {
  error: 'Снимок недоступен: источник данных не отвечает. Повторите позже.',
} as const;

/** Замечания демо-генератора — не данные ГРБС: менять их статусы нельзя. */
const DEMO_ISSUE_PREFIX = 'demo-issue-';

const STATUS_TRANSITIONS: Record<string, string[]> = {
  'open':           ['acknowledged', 'in_progress', 'wont_fix', 'false_positive'],
  'acknowledged':   ['in_progress', 'wont_fix', 'false_positive'],
  'in_progress':    ['resolved', 'wont_fix', 'false_positive'],
  'resolved':       ['open'],           // переоткрытие
  'wont_fix':       ['open'],           // переоткрытие
  'false_positive': ['open'],           // переоткрытие
};

/**
 * Overlays the DB-persisted status on top of issues that are freshly rebuilt
 * from the snapshot on every call (the pipeline always assigns status:'open' —
 * see packages/core/src/pipeline/orchestrator.ts:479,621 — and so does the
 * demo generator). Without this merge, PUT /api/issues/:id/status never
 * changes what any GET/export caller sees. The DB is the source of truth for
 * status; every other field still comes from the snapshot as before.
 */
function overlayPersistedStatus(issues: Issue[]): Issue[] {
  if (issues.length === 0) return issues;
  const rows = db.select({ id: schema.issues.id, status: schema.issues.status }).from(schema.issues).all();
  if (rows.length === 0) return issues;
  const statusById = new Map(rows.map((r) => [r.id, r.status]));
  return issues.map((issue) => {
    const persisted = statusById.get(issue.id);
    return persisted ? { ...issue, status: persisted as Issue['status'] } : issue;
  });
}

/** Строка истории статуса — тип выводится из схемы, не описывается второй раз. */
type IssueHistoryRow = typeof schema.issueHistory.$inferSelect;

/**
 * История смен статуса замечания.
 * Единственное место чтения: карточка (/:id) и отдельный роут (/:id/history)
 * обязаны показывать одно и то же — иначе «история» зависит от того, откуда смотреть.
 */
function readIssueHistory(app: FastifyInstance, issueId: string): IssueHistoryRow[] {
  try {
    return db.select().from(schema.issueHistory).where(eq(schema.issueHistory.issueId, issueId)).all();
  } catch (err) {
    app.log.warn({ err, issueId }, 'issues/history: failed to read issue_history');
    return [];
  }
}

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
      app.log.warn({ err }, 'issues: failed to get snapshot');
      return reply.status(503).send(SNAPSHOT_UNAVAILABLE);
    }

    const allIssues: Issue[] = overlayPersistedStatus(snapshot.issues ?? []);
    let issues: Issue[] = allIssues;

    // Apply filters
    if (query.severity) issues = issues.filter(i => i.severity === query.severity);
    if (query.status) issues = issues.filter(i => i.status === query.status);
    if (query.deptId) issues = issues.filter(i => i.departmentId === query.deptId || i.sheet === query.deptId);
    if (query.category) issues = issues.filter(i => i.category === query.category);

    const total = issues.length;
    const totalPages = Math.ceil(total / limit);
    const paged = issues.slice((page - 1) * limit, page * limit);

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
      app.log.warn({ err }, 'issues/:id: failed to get snapshot');
      return reply.status(503).send(SNAPSHOT_UNAVAILABLE);
    }

    const issue = overlayPersistedStatus(snapshot.issues ?? []).find((i: Issue) => i.id === id);
    if (!issue) {
      return reply.status(404).send({ error: `Замечание «${id}» не найдено` });
    }

    // История отдавалась пустым массивом-заглушкой, хотя таблица issue_history
    // заполняется каждой сменой статуса: карточка замечания показывала «истории
    // нет» там, где история есть. Читаем тот же источник, что и /:id/history.
    return reply.send({
      issue,
      history: readIssueHistory(app, id),
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
    status: z.string().min(1, 'Не указан новый статус замечания'),
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

    // Фикции демо-генератора в реальную таблицу issues не персистятся.
    if (id.startsWith(DEMO_ISSUE_PREFIX)) {
      return reply.status(400).send({
        error: 'Это демонстрационное замечание, а не данные управлений — статус ему не ставится',
      });
    }

    // Ищем текущий статус в DB, иначе в snapshot
    let currentStatus = 'open';
    let snapshotIssue: Issue | undefined;
    const dbIssue = db.select({ status: schema.issues.status }).from(schema.issues).where(eq(schema.issues.id, id)).get();
    if (dbIssue) {
      currentStatus = dbIssue.status;
    } else {
      // Ищем в snapshot
      let snapshot;
      try {
        snapshot = await getSnapshot();
      } catch (err) {
        app.log.warn({ err }, 'issues/status: failed to get snapshot');
        return reply.status(503).send(SNAPSHOT_UNAVAILABLE);
      }
      snapshotIssue = (snapshot.issues ?? []).find((i: Issue) => i.id === id);
      // Замечания нет ни в таблице, ни в снимке. Прежде такой запрос заводил
      // пустую запись с заголовком «Issue <id>» — продукт сам сочинял замечание,
      // которого никто не находил, и показывал латиницу в журнале.
      if (!snapshotIssue) {
        return reply.status(404).send({ error: `Замечание «${id}» не найдено` });
      }
      if (snapshotIssue.status) currentStatus = snapshotIssue.status;
    }

    // Проверка допустимости перехода. Текст — фразами продукта: сырые ключи
    // («open → resolved») веб был вынужден прятать за общей заглушкой,
    // потому что показывать их пользователю нельзя.
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus];
    if (!allowedTransitions?.includes(body.status)) {
      const allowedNames = (allowedTransitions ?? []).map(statusLabel);
      return reply.status(400).send({
        error: allowedNames.length > 0
          ? `Из состояния «${statusLabel(currentStatus)}» нельзя перейти в «${statusLabel(body.status)}». Доступно: ${allowedNames.join(', ')}`
          : `Из состояния «${statusLabel(currentStatus)}» переходов не предусмотрено`,
        // Машинный список ключей остаётся для клиента — он рисует по нему кнопки.
        allowed: allowedTransitions || [],
        allowedLabels: allowedNames,
      });
    }

    // Для wont_fix и false_positive — требуется причина
    if ((body.status === 'wont_fix' || body.status === 'false_positive') && !body.reason) {
      return reply.status(400).send({
        error: `Чтобы поставить «${statusLabel(body.status)}», нужно назвать причину`,
      });
    }

    const now = new Date().toISOString();

    // Both writes are now atomic. Previously the INSERT and the issueHistory
    // insert were each wrapped in a try/catch that only logged a warning and
    // never changed the response: on failure (e.g. the FK on snapshot_id had
    // nothing to point at) the server still answered success:true even though
    // nothing landed in the DB. Errors are no longer swallowed — roll back and
    // answer honestly.
    try {
      db.transaction((tx) => {
        // Upsert issue status in DB
        if (dbIssue) {
          tx.update(schema.issues).set({ status: body.status, comment: body.comment ?? null, resolvedAt: body.status === 'resolved' ? now : null }).where(eq(schema.issues.id, id)).run();
        } else {
          // Insert minimal issue record for tracking. snapshotId: null, not the
          // literal 'manual' — no such row ever exists in snapshots, and with
          // foreign_keys=ON (db/index.ts:18) the INSERT was guaranteed to fail
          // its FK constraint. The snapshot_id column is not NOT NULL, so null
          // passes.
          // Реквизиты берутся у замечания из снимка (оно найдено выше, иначе
          // был бы 404): подставлять «info»/«status_change»/«Issue <id>» значило
          // подменять настоящую строгость и заголовок выдуманными.
          tx.insert(schema.issues).values({
            id,
            snapshotId: null,
            severity: snapshotIssue?.severity ?? 'info',
            origin: 'user',
            category: snapshotIssue?.category ?? 'status_change',
            title: snapshotIssue?.title ?? `Замечание ${id}`,
            status: body.status,
            detectedAt: now,
          }).run();
        }

        // Create issueHistory record — same transaction: if the issue insert
        // above didn't happen (or fails), the history row rolls back with it.
        tx.insert(schema.issueHistory).values({
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
      });
    } catch (err) {
      app.log.error({ err, issueId: id }, 'issues/status: failed to persist status change');
      return reply.status(500).send({
        success: false,
        error: 'Смена статуса не сохранена — повторите; если повторяется, сообщите администратору',
      });
    }

    return reply.send({
      success: true,
      issueId: id,
      fromStatus: currentStatus,
      toStatus: body.status,
      message: `Статус замечания изменён: «${statusLabel(currentStatus)}» → «${statusLabel(body.status)}»`,
    });
  });

  /**
   * PUT /api/issues/:id/comment
   * Добавить комментарий к замечанию.
   *
   * Body: { comment: string }
   */
  const IssueCommentSchema = z.object({
    comment: z.string().trim().min(1, 'Комментарий не может быть пустым'),
  });

  app.put('/api/issues/:id/comment', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseBody(IssueCommentSchema, request, reply);
    if (!body) return;

    // Фикции демо-генератора в реальную таблицу issues не персистятся.
    if (id.startsWith(DEMO_ISSUE_PREFIX)) {
      return reply.status(400).send({
        error: 'Это демонстрационное замечание, а не данные управлений — комментарий к нему не сохраняется',
      });
    }

    // Замечание живёт в двух местах: снимок пересобирается на каждый запрос,
    // а таблица issues хранит только те, которых уже касался человек. Комментарий
    // к замечанию «только из снимка» уходил в UPDATE по несуществующей строке:
    // 0 изменённых записей, ответ «Комментарий добавлен», текста нигде нет.
    const dbIssue = db.select({ id: schema.issues.id }).from(schema.issues).where(eq(schema.issues.id, id)).get();
    let snapshotIssue: Issue | undefined;
    if (!dbIssue) {
      let snapshot;
      try {
        snapshot = await getSnapshot();
      } catch (err) {
        app.log.warn({ err }, 'issues/comment: failed to get snapshot');
        return reply.status(503).send(SNAPSHOT_UNAVAILABLE);
      }
      snapshotIssue = (snapshot.issues ?? []).find((i: Issue) => i.id === id);
      if (!snapshotIssue) {
        return reply.status(404).send({ error: `Замечание «${id}» не найдено` });
      }
    }

    const now = new Date().toISOString();
    try {
      db.transaction((tx) => {
        if (dbIssue) {
          tx.update(schema.issues).set({ comment: body.comment }).where(eq(schema.issues.id, id)).run();
        } else {
          // Минимальная запись отслеживания — как в смене статуса; snapshotId
          // остаётся null (внешнего ключа на несуществующий снимок быть не должно).
          tx.insert(schema.issues).values({
            id,
            snapshotId: null,
            severity: snapshotIssue?.severity ?? 'info',
            origin: 'user',
            category: snapshotIssue?.category ?? 'comment',
            title: snapshotIssue?.title ?? `Замечание ${id}`,
            status: snapshotIssue?.status ?? 'open',
            comment: body.comment,
            detectedAt: now,
          }).run();
        }

        tx.insert(schema.auditLog).values({
          action: 'issue_comment',
          entity: 'issue',
          entityId: id,
          details: body.comment,
          timestamp: now,
        }).run();
      });
    } catch (err) {
      // Раньше обе ошибки глотались, а ответ всё равно был success:true —
      // худший вид неправды: человек уверен, что комментарий сохранён.
      app.log.error({ err, issueId: id }, 'issues/comment: failed to persist comment');
      return reply.status(500).send({
        success: false,
        error: 'Комментарий не сохранён — повторите; если повторяется, сообщите администратору',
      });
    }

    return reply.send({
      success: true,
      issueId: id,
      message: 'Комментарий сохранён',
    });
  });

  /**
   * GET /api/issues/:id/history
   * История изменений статуса замечания.
   */
  app.get('/api/issues/:id/history', async (request, reply) => {
    const { id } = request.params as { id: string };

    return reply.send({
      issueId: id,
      history: readIssueHistory(app, id),
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
   *   - category: фильтр по виду замечания
   */
  app.get('/api/export/issues', async (request, reply) => {
    const query = request.query as Record<string, string>;

    let snapshot;
    try {
      snapshot = await getSnapshot();
    } catch (err) {
      app.log.warn({ err }, 'export/issues: failed to get snapshot');
      return reply.status(503).send({
        error: 'Google Таблицы недоступны — выгрузка замечаний невозможна. Повторите позже.',
      });
    }

    // Скачанный файл живёт дольше любого баннера «Демо» в шапке: CSV с
    // сочинёнными замечаниями о реальных ГРБС неотличим от настоящего.
    // Демо-снимок (префикс id 'demo-') в выгрузку не попадает никогда.
    if (snapshot.id.startsWith('demo-')) {
      return reply.status(503).send({
        error: 'Google Таблицы недоступны — выгрузка замечаний невозможна. Повторите позже.',
      });
    }

    let issues: Issue[] = overlayPersistedStatus(snapshot.issues ?? []);

    if (query.severity) issues = issues.filter(i => i.severity === query.severity);
    if (query.status) issues = issues.filter(i => i.status === query.status);
    if (query.deptId) issues = issues.filter(i => i.departmentId === query.deptId || i.sheet === query.deptId);
    // Отбор по виду замечания был у списка (GET /api/issues), но не у выгрузки:
    // человек сужал список до одного вида, нажимал «Выгрузить» — и получал файл
    // со ВСЕМИ замечаниями (реестр 09.07.2026, PLAUSIBLE «экспорт замечаний
    // игнорирует фильтры»). Набор отборов выгрузки обязан совпадать со списком.
    if (query.category) issues = issues.filter(i => i.category === query.category);

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
      // Выгрузку открывают в Excel — «wont_fix» в колонке «Статус» там читать некому.
      statusLabel(i.status ?? 'open'),
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
