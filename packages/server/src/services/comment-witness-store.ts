import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { CommentWitness } from './google-comment-witnesses.js';
import type { NativeCommentReading } from './native-comment-read.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Upgrade preserves the existing projection before the normal legacy upsert. */
export function archiveLegacyComment(book: string, original: Record<string, unknown>): void {
  const { recordedAt, ...content } = original;
  if (typeof content.commentId !== 'string' || typeof recordedAt !== 'string') return;
  const fingerprint = hash(JSON.stringify(content));
  const previous = db.select().from(schema.driveCommentObservations).where(and(
    eq(schema.driveCommentObservations.book, book), isNull(schema.driveCommentObservations.fileId),
    eq(schema.driveCommentObservations.kind, 'legacy_cache'), eq(schema.driveCommentObservations.sourceId, content.commentId),
  )).orderBy(desc(schema.driveCommentObservations.readAt)).limit(1).get();
  if (previous?.fingerprint === fingerprint) return;
  db.insert(schema.driveCommentObservations).values({ id: hash(`${book}\0legacy\0${content.commentId}\0${recordedAt}\0${fingerprint}`),
    book, fileId: null, kind: 'legacy_cache', sourceId: content.commentId, fingerprint,
    readAt: recordedAt, payload: JSON.stringify({ origin: 'LEGACY_LOCAL_PROJECTION', sourceFileId: null, original }),
  }).onConflictDoNothing().run();
}

/** A repeated read is idempotent; changed and reverted evidence both survive. */
export function storeCommentWitness(book: string, witness: CommentWitness): boolean {
  const { readAt, ...evidence } = witness;
  const fingerprint = hash(JSON.stringify(evidence));
  const where = and(eq(schema.driveCommentObservations.fileId, witness.fileId),
    eq(schema.driveCommentObservations.kind, witness.kind), eq(schema.driveCommentObservations.sourceId, witness.sourceId));
  return db.transaction(tx => {
    const latest = tx.select().from(schema.driveCommentObservations).where(where)
      .orderBy(desc(schema.driveCommentObservations.readAt)).limit(1).get();
    if (latest?.fingerprint === fingerprint) return false;
    tx.insert(schema.driveCommentObservations).values({
      id: hash([witness.fileId, witness.kind, witness.sourceId, readAt, fingerprint].join('\0')),
      book, fileId: witness.fileId, kind: witness.kind, sourceId: witness.sourceId,
      fingerprint, payload: JSON.stringify(witness), readAt,
    }).onConflictDoNothing().run();
    return true;
  });
}

export function storeWitnessReading(book: string, fileId: string, kind: string,
  reading: NativeCommentReading, readAt: string): void {
  for (const witness of reading.records) storeCommentWitness(book, witness);
  const summary = { status: reading.status, reason: reading.reason, scope: reading.scope,
    count: reading.status === 'read' ? reading.records.length : null };
  const payload = JSON.stringify(summary), fingerprint = hash(payload);
  db.insert(schema.driveCommentObservations).values({ id: hash(`${fileId}\0${kind}\0${readAt}\0${fingerprint}`),
    book, fileId, kind: `reading:${kind}`, sourceId: 'reading', fingerprint, payload, readAt,
  }).onConflictDoNothing().run();
}

/** Historical raw witnesses are bounded and labelled; they are not current edits. */
export function listCommentWitnesses(book?: string, limit = 100) {
  const rows = db.select().from(schema.driveCommentObservations)
    .where(book ? eq(schema.driveCommentObservations.book, book) : undefined)
    .orderBy(desc(schema.driveCommentObservations.readAt)).limit(Math.max(1, Math.min(limit, 200))).all();
  return rows.map(row => {
    const parsed = JSON.parse(row.payload) as Record<string, unknown>;
    // The source file ID remains in the private database, as in the legacy API.
    const { fileId: _fileId, ...evidence } = parsed;
    return { id: row.id, book: row.book, kind: row.kind, readAt: row.readAt, evidence };
  });
}

export function countCommentWitnesses(book?: string): number {
  return db.select({ total: sql<number>`count(*)` }).from(schema.driveCommentObservations)
    .where(book ? eq(schema.driveCommentObservations.book, book) : undefined).get()?.total ?? 0;
}
