/**
 * C06.03 editorial application boundary. The source data, classifiers,
 * applicability and legal thresholds belong to @aemr/shared and the frozen
 * calculation context; only an operator's explanatory wording is persisted.
 *
 * The same saved revision is read by Settings, Registry and guide exports.
 * SQL and audit are deliberately in one place, never in a screen or rule.
 */
import {
  PROCUREMENT_GUIDANCE_VERSION, procurementEditableGuidance,
  type SavedProcurementGuidance,
} from '@aemr/shared';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const originals = procurementEditableGuidance();
const byKey = new Map(originals.map(item => [item.key, item]));

export function knownDomainGuidanceKey(key: string): boolean {
  return byKey.has(key);
}

export function readDomainGuidance(): SavedProcurementGuidance {
  const saved = new Map(
    db.select().from(schema.domainGuidanceEdits).all().map(item => [item.key, item]),
  );
  return {
    version: PROCUREMENT_GUIDANCE_VERSION,
    calculationRulesChanged: false,
    entries: originals.map(item => {
      const edit = saved.get(item.key);
      return {
        ...item,
        text: edit?.editorialText ?? item.defaultText,
        overridden: edit?.editorialText !== null && edit?.editorialText !== undefined,
        revision: edit?.revision ?? 0,
        updatedAt: edit?.updatedAt ?? null,
      };
    }),
  };
}

/**
 * Caller validates text/comment/revision at the API trust boundary.
 * A stale expectedRevision never mutates state; audit insert failure rolls
 * back the same SQLite transaction. Reset is a revision, not data deletion.
 */
export function changeDomainGuidance(
  key: string, input: { text: string; comment: string; expectedRevision: number },
): { conflict: true; revision: number } | {
  conflict: false; revision: number; updatedAt: string;
  text: string; overridden: boolean;
} {
  const original = byKey.get(key);
  if (!original) throw new Error('Unknown domain guidance key');
  const now = new Date().toISOString();

  return db.transaction(tx => {
    const previous = tx.select().from(schema.domainGuidanceEdits)
      .where(eq(schema.domainGuidanceEdits.key, key)).get();
    const revision = previous?.revision ?? 0;
    if (revision !== input.expectedRevision) return { conflict: true, revision } as const;

    const editorialText = input.text === original.defaultText ? null : input.text;
    const nextRevision = revision + 1;
    if (previous) {
      tx.update(schema.domainGuidanceEdits).set({
        editorialText, comment: input.comment, revision: nextRevision, updatedAt: now,
      }).where(eq(schema.domainGuidanceEdits.key, key)).run();
    } else {
      tx.insert(schema.domainGuidanceEdits).values({
        key, editorialText, comment: input.comment, revision: nextRevision, updatedAt: now,
      }).run();
    }
    tx.insert(schema.auditLog).values({
      action: 'domain_guidance_edit', entity: 'domain_dictionary', entityId: key,
      oldValue: previous?.editorialText ?? original.defaultText,
      newValue: editorialText ?? original.defaultText,
      details: JSON.stringify({
        comment: input.comment, revision: nextRevision, reset: editorialText === null,
      }),
      timestamp: now,
    }).run();
    return {
      conflict: false, revision: nextRevision, updatedAt: now,
      text: editorialText ?? original.defaultText, overridden: editorialText !== null,
    } as const;
  });
}
