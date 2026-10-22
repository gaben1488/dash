import { and, eq } from 'drizzle-orm';
import { ISSUE_STATUS_LABELS, productLabel, type IssueHistoryEvent } from '@aemr/shared';
import { db, schema } from '../db/index.js';

/** Проекция существующих записей, без переписывания истории и новых таблиц. */
export function issueDecisionEvent(row: typeof schema.issueHistory.$inferSelect): IssueHistoryEvent {
  return { ...row, eventId: `issue-history:${row.id}`, issueId: row.issueId,
    type: 'status_change', source: 'dash_decision', at: row.timestamp, author: row.userId,
    from: row.fromStatus, to: row.toStatus, text: row.comment };
}

export function issueCommentEvent(row: typeof schema.auditLog.$inferSelect): IssueHistoryEvent {
  return { ...row, eventId: `audit-log:${row.id}`, issueId: row.entityId!,
    type: 'comment', source: 'dash_comment', at: row.timestamp, author: row.userId,
    text: row.details };
}

export function issueEventDetails(event: IssueHistoryEvent): string {
  if (event.type === 'comment') return event.text ?? '';
  return [
    `${ISSUE_STATUS_LABELS[event.from ?? ''] ?? productLabel(event.from ?? '')} → ${ISSUE_STATUS_LABELS[event.to ?? ''] ?? productLabel(event.to ?? '')}`,
    event.reason && `Причина: ${event.reason}`,
    event.justification && `Обоснование: ${event.justification}`,
    event.text,
    event.responsible && `Ответственный: ${event.responsible}`,
    event.deadline && `Срок: ${event.deadline}`,
  ].filter(Boolean).join('. ');
}

/** Оба чтения относятся к одному DB-снимку; отказ не превращается в пустую историю. */
export function readIssueHistory(issueId: string): IssueHistoryEvent[] {
  return db.transaction(tx => {
    const decisions = tx.select().from(schema.issueHistory)
      .where(eq(schema.issueHistory.issueId, issueId)).all().map(issueDecisionEvent);
    const comments = tx.select().from(schema.auditLog).where(and(
      eq(schema.auditLog.action, 'issue_comment'), eq(schema.auditLog.entity, 'issue'),
      eq(schema.auditLog.entityId, issueId),
    )).all().map(issueCommentEvent);
    return [...decisions, ...comments].sort((a, b) => a.at.localeCompare(b.at)
      || a.eventId.localeCompare(b.eventId, 'en', { numeric: true }));
  });
}
