import test from 'node:test';
import assert from 'node:assert/strict';
import { observationKey, reconcileSnapshots } from '../identity-crosswalk.mjs';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
function row(snapshotId, sourceRow, displayNumber, changes = {}) {
  return {
    snapshotId, sourceFileId: 'FILE-UD', sheetId: 42, sourceRow,
    rowClass: 'data', displayNumber,
    organizationId: 'ORG-1', subject: 'Закупка A', payloadHash: A,
    ...changes,
  };
}
const result = (older, newer, decisions = []) => reconcileSnapshots({ older, newer, decisions });

test('trusted UUID links despite row movement, rename, and changed content', () => {
  const a = row('before', 53, '173/1', { entityId: 'UUID-1' });
  const b = row('after', 100, '173/1', { entityId: 'UUID-1', subject: 'Новый предмет', payloadHash: B, organizationId: 'ORG-2' });
  const out = result([a], [b]);
  assert.equal(out.summary.confirmedLinks, 1);
  assert.equal(out.summary.reviewCandidates, 0);
  assert.equal(out.matched[0].evidence, 'authoritative_entity_id');
  assert.equal(out.matched[0].entityId, 'UUID-1');
});

test('173 != 173/1 != 173/18: no numeric coercion and no auto binding', () => {
  const out = result([row('before', 1, '173/1')], [
    row('after', 1, '173'), row('after', 2, '173/1'), row('after', 3, '173/18'),
  ]);
  assert.equal(out.summary.confirmedLinks, 0);
  assert.equal(out.summary.reviewCandidates, 1);
  assert.equal(out.candidates[0].kind, 'same_number_and_details_needs_review');
  assert.equal(out.summary.unresolvedNew, 3);
});

test('duplicate 173/18 is not silently disambiguated by position or subject', () => {
  const out = result([row('before', 5, '173/18')], [
    row('after', 6, '173/18'), row('after', 7, '173/18', { subject: 'Другая закупка' }),
  ]);
  assert.equal(out.summary.confirmedLinks, 0);
  assert.equal(out.summary.reviewCandidates, 0);
  assert.ok(out.conflicts.some(c => c.kind === 'duplicate_display_number'));
  assert.ok(out.conflicts.some(c => c.kind === 'ambiguous_number_across_snapshots'));
});

test('displayed A=23/1 from DATE-formatted numeric source is not A=46045', () => {
  const out = result([row('before', 174, '23/1')], [
    row('after', 175, '46045'), row('after', 176, '23/1'),
  ]);
  assert.equal(out.candidates.length, 1);
  assert.deepEqual(out.summary, {
    oldDataRows: 1, newDataRows: 2, confirmedLinks: 0,
    reviewCandidates: 1, conflicts: 0, unresolvedOld: 1, unresolvedNew: 2,
  });
});

test('same label in another workbook is never an implicit link', () => {
  const out = result([row('before', 1, '17')], [row('after', 5, '17', { sourceFileId: 'OTHER-GRBS' })]);
  assert.equal(out.candidates.length, 0);
});

test('exact human approval links snapshots and remains independent of row position', () => {
  const a = row('before', 1, '173/1');
  const b = row('after', 200, '173/1', { subject: 'Переработанный предмет', payloadHash: B });
  const out = result([a], [b], [
    { from: observationKey(a), to: observationKey(b), fromHash: A, toHash: B, entityId: 'UUID-APPROVED' },
  ]);
  assert.equal(out.summary.confirmedLinks, 1);
  assert.equal(out.matched[0].evidence, 'approved_human_decision');
  assert.equal(out.summary.unresolvedOld, 0);
});

test('stale human approval is rejected rather than applied to changed source', () => {
  const a = row('before', 1, '173/1');
  const b = row('after', 2, '173/1', { payloadHash: B });
  const out = result([a], [b], [
    { from: observationKey(a), to: observationKey(b), fromHash: A, toHash: A, entityId: 'UUID-1' },
  ]);
  assert.equal(out.summary.confirmedLinks, 0);
  assert.ok(out.conflicts.some(c => c.kind === 'stale_or_unknown_decision'));
});

test('duplicate authoritative IDs block auto matching and are reported', () => {
  const out = result([
    row('before', 1, '11', { entityId: 'UUID-X' }),
    row('before', 2, '12', { entityId: 'UUID-X' }),
  ], [row('after', 1, '11', { entityId: 'UUID-X' })]);
  assert.equal(out.summary.confirmedLinks, 0);
  assert.ok(out.conflicts.some(c => c.kind === 'duplicate_authoritative_id'));
});

test('empty A, formula tail, and service/meta rows never become ID matches', () => {
  const out = result([
    row('before', 1, ''),
    row('before', 2, '14', { rowClass: 'service' }),
    row('before', 3, '15', { rowClass: 'meta' }),
  ], [row('after', 44, ''), row('after', 45, '14')]);
  assert.equal(out.summary.oldDataRows, 1);
  assert.equal(out.summary.newDataRows, 2);
  assert.equal(out.summary.reviewCandidates, 0);
  assert.equal(out.summary.confirmedLinks, 0);
});

test('human decision cannot contradict an authoritative UUID', () => {
  const a = row('before', 1, '173/1', { entityId: 'UUID-A' });
  const b = row('after', 2, '173/1', { entityId: 'UUID-B' });
  const out = result([a], [b], [
    { from: observationKey(a), to: observationKey(b), fromHash: A, toHash: A, entityId: 'UUID-A' },
  ]);
  assert.equal(out.summary.confirmedLinks, 0);
  assert.ok(out.conflicts.some(c => c.kind === 'identity_conflict'));
});

test('same field content but a different organization is a review, not a match', () => {
  const out = result([row('before', 1, '10')], [row('after', 11, '10', { organizationId: 'ORG-OTHER' })]);
  assert.equal(out.summary.confirmedLinks, 0);
  assert.equal(out.candidates[0].kind, 'number_reused_or_details_changed_needs_review');
});

test('duplicate observation locator fails closed; no silent overwrite', () => {
  assert.throws(() => result([row('before', 1, '10'), row('before', 1, '11')], []), /duplicate observation locator/);
});

test('order of source input does not change audit result', () => {
  const older = [row('before', 19, '19'), row('before', 10, '10')];
  const newer = [row('after', 8, '10'), row('after', 22, '19')];
  assert.deepEqual(result(older, newer), result([...older].reverse(), [...newer].reverse()));
});

test('two approved decisions cannot assign one UUID to distinct entities', () => {
  const a = row('before', 1, '1'), b = row('before', 2, '2');
  const c = row('after', 1, '1'), d = row('after', 2, '2');
  const decision = (from, to) => ({
    from: observationKey(from), to: observationKey(to),
    fromHash: A, toHash: A, entityId: 'UUID-SAME',
  });
  const out = result([a, b], [c, d], [decision(a, c), decision(b, d)]);
  assert.equal(out.summary.confirmedLinks, 1);
  assert.ok(out.conflicts.some(x => x.kind === 'decision_reuses_identity'));
});

test('mixed source snapshots on one side fail closed', () => {
  assert.throws(() => result(
    [row('before', 1, '1'), row('another-old', 2, '2')],
    [row('after', 3, '3')],
  ), /mixed snapshotIds/);
  assert.throws(() => result([row('same', 1, '1')], [row('same', 2, '1')]), /different snapshotIds/);
});

test('human decision cannot hijack a stable ID already assigned to another observation', () => {
  const owned = row('before', 1, '10', { entityId: 'UUID-TAKEN' });
  const unrelated = row('before', 2, '11');
  const newUnrelated = row('after', 2, '11');
  const out = result([owned, unrelated], [newUnrelated], [
    { from: observationKey(unrelated), to: observationKey(newUnrelated),
      fromHash: A, toHash: A, entityId: 'UUID-TAKEN' },
  ]);
  assert.equal(out.summary.confirmedLinks, 0);
  assert.ok(out.conflicts.some(x => x.kind === 'identity_conflict'));
});
