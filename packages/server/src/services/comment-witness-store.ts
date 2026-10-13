import { classifyCellNote } from '@aemr/shared';
import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, like, notLike, sql } from 'drizzle-orm';
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
  )).orderBy(desc(schema.driveCommentObservations.readAt), desc(sql`rowid`)).limit(1).get();
  if (previous?.fingerprint === fingerprint) return;
  db.insert(schema.driveCommentObservations).values({ id: hash(`${book}\0legacy\0${content.commentId}\0${recordedAt}\0${fingerprint}\0${previous?.id ?? ''}`),
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
      .orderBy(desc(schema.driveCommentObservations.readAt), desc(sql`rowid`)).limit(1).get();
    if (latest?.fingerprint === fingerprint) return false;
    const inserted = tx.insert(schema.driveCommentObservations).values({
      id: hash([witness.fileId, witness.kind, witness.sourceId, readAt, fingerprint, latest?.id ?? ''].join('\0')),
      book, fileId: witness.fileId, kind: witness.kind, sourceId: witness.sourceId,
      fingerprint, payload: JSON.stringify(witness), readAt,
    }).onConflictDoNothing().run();
    return inserted.changes > 0;
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
export function listCommentWitnesses(book?: string, limit = 100, originalsOnly = false) {
  const rows = db.select().from(schema.driveCommentObservations)
    .where(and(book ? eq(schema.driveCommentObservations.book, book) : undefined,
      originalsOnly ? notLike(schema.driveCommentObservations.kind, 'reading:%') : undefined))
    .orderBy(desc(schema.driveCommentObservations.readAt), desc(sql`rowid`)).limit(Math.max(1, Math.min(limit, 200))).all();
  return rows.map(row => {
    const parsed = JSON.parse(row.payload) as Record<string, unknown>;
    // The source file ID remains in the private database, as in the legacy API.
    const { fileId: _fileId, ...evidence } = parsed;
    return { id: row.id, book: row.book, kind: row.kind, readAt: row.readAt, evidence };
  });
}

/** Latest channel outcome per source; diagnostics never consume the comment limit. */
export function listCommentReadings(book?: string) {
  const table = schema.driveCommentObservations;
  const ranked = db.select({ id: table.id, book: table.book, kind: table.kind,
    readAt: table.readAt, payload: table.payload,
    position: sql<number>`row_number() over (partition by ${table.fileId}, ${table.book}, ${table.kind}
      order by ${table.readAt} desc, rowid desc)`.as('position'),
  }).from(table).where(and(like(table.kind, 'reading:%'), book ? eq(table.book, book) : undefined)).as('readings');
  return db.select({ id: ranked.id, book: ranked.book, kind: ranked.kind, readAt: ranked.readAt, payload: ranked.payload })
    .from(ranked).where(eq(ranked.position, 1)).all()
    .map(row => ({ id: row.id, book: row.book, kind: row.kind, readAt: row.readAt,
      evidence: JSON.parse(row.payload) as Record<string, unknown> }));
}

export function countCommentWitnesses(book?: string): number {
  return db.select({ total: sql<number>`count(*)` }).from(schema.driveCommentObservations)
    .where(book ? eq(schema.driveCommentObservations.book, book) : undefined).get()?.total ?? 0;
}

type WitnessRow = Pick<typeof schema.driveCommentObservations.$inferSelect,'id'|'book'|'kind'|'readAt'|'payload'>;
const witnessFields = { id:schema.driveCommentObservations.id, book:schema.driveCommentObservations.book,
  kind:schema.driveCommentObservations.kind, readAt:sql<string>`${schema.driveCommentObservations.readAt}`.as('readAt'), payload:schema.driveCommentObservations.payload };

/** One ordered SQLite execution; iterator bounds JS memory without repeated
 * OFFSET sorts. Exact classification precedes the visible window; counts are
 * witness VERSIONS, never unique discussions or edits. */
export function listDiscussionWitnesses(book?: string, limit = 20) {
  const witnesses: ReturnType<typeof listCommentWitnesses> = [];
  const counts = { eligible: 0, shown: 0, historyNotes: 0, legacyProjections: 0 };
  const requested = Math.max(1, Math.min(limit, 200));
  const query = db.select(witnessFields).from(schema.driveCommentObservations)
    .where(and(book ? eq(schema.driveCommentObservations.book, book) : undefined, notLike(schema.driveCommentObservations.kind, 'reading:%')))
    .orderBy(sql`CASE WHEN ${schema.driveCommentObservations.kind} = 'legacy_cache' THEN 1 ELSE 0 END`, desc(schema.driveCommentObservations.readAt), desc(sql`rowid`)).toSQL();
  for (const raw of db.$client.prepare(query.sql).iterate(...query.params)) {
    const row = raw as WitnessRow;
    if (row.kind === 'legacy_cache') counts.legacyProjections++;
    const parsed = JSON.parse(row.payload) as Record<string, unknown>;
    const note = row.kind === 'cell_note' && typeof parsed.content === 'string' ? classifyCellNote(parsed.content) : null;
    if (note?.historyOnly) { counts.historyNotes++; continue; }
    counts.eligible++;
    if (witnesses.length < requested) {
      const { fileId: _fileId, ...evidence } = parsed;
      witnesses.push({ id: row.id, book: row.book, kind: row.kind, readAt: row.readAt, evidence: note ? { ...evidence, discussionText: note.discussionText } : evidence });
    }
  }
  counts.shown = witnesses.length;
  return { witnesses, counts };
}

/** Original notes at a physical address; never a purchase-identity assertion. */
export function listCellNoteMetadata(fileId: string, sheet: string, rowNumber: number, column?: string) {
  const table = schema.driveCommentObservations;
  const outcome = db.select().from(table).where(and(eq(table.fileId, fileId), eq(table.kind, 'reading:notes')))
    .orderBy(desc(table.readAt), desc(sql`rowid`)).limit(1).get();
  const reading = outcome ? JSON.parse(outcome.payload) as Record<string, unknown> : null;
  const prefix = `'${sheet.replace(/'/g, "''")}'!`;
  const covered = Array.isArray(reading?.scope) && reading.scope.some(range => {
    if (typeof range !== 'string' || !range.startsWith(prefix)) return false;
    const rows = /^(\d+):(\d+)$/.exec(range.slice(prefix.length));
    return rows !== null && Number(rows[1]) <= rowNumber && Number(rows[2]) >= rowNumber;
  });
  const available = reading?.status === 'read' && covered;
  const notes: ReturnType<typeof listCommentWitnesses> = [];
  let total = 0;
  const query = db.select(witnessFields).from(table).where(and(eq(table.fileId,fileId),eq(table.kind,'cell_note')))
    .orderBy(desc(table.readAt),desc(sql`rowid`)).toSQL();
  for (const raw of db.$client.prepare(query.sql).iterate(...query.params)) {
    const row = raw as WitnessRow;
    const parsed = JSON.parse(row.payload) as Record<string, unknown>;
    if (parsed.fileId !== fileId || parsed.sheet !== sheet || typeof parsed.cell !== 'string' ||
        !new RegExp(`^${column ?? '[A-Z]{1,2}'}${rowNumber}$`).test(parsed.cell) || !Number.isInteger(parsed.sheetId)) continue;
    total++;
    if (notes.length < 200) {
      const { fileId: _fileId, ...evidence } = parsed;
      notes.push({ id: row.id, book: row.book, kind: row.kind, readAt: row.readAt, evidence });
    }
  }
  return { status: available ? 'read' as const : 'unavailable' as const,
    reason: available ? null : reading?.reason ?? 'Чтение заметок запрошенного адреса не подтверждено.',
    readAt: outcome?.readAt ?? null, identity: 'physical-address-only' as const,
    notes, total, shown: notes.length, truncated: total > notes.length };
}
