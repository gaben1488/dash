/**
 * Read-only G1 identity reconciliation for frozen, already classified inputs.
 * No generated ID, no numeric coercion of A, and no write to source systems.
 *
 * A source-row position is an observation locator, never an entity identity.
 */
export function observationKey(row) {
  return JSON.stringify([row.snapshotId, row.sourceFileId, row.sheetId, row.sourceRow]);
}

function naturalNumberKey(row) {
  return row.displayNumber.trim()
    ? JSON.stringify([row.sourceFileId, row.sheetId, row.displayNumber.trim()])
    : null;
}

function validate(rows, name) {
  if (!Array.isArray(rows)) throw new TypeError(name + ' must be an array');
  const seen = new Set();
  return rows
    .filter(row => {
      if (!row || typeof row !== 'object') throw new TypeError(name + ': bad observation');
      if (!['data', 'service', 'meta'].includes(row.rowClass)) throw new TypeError(name + ': rowClass is mandatory');
      return row.rowClass === 'data';
    })
    .map(row => {
      for (const field of ['snapshotId', 'sourceFileId', 'displayNumber', 'organizationId', 'subject', 'payloadHash']) {
        if (typeof row[field] !== 'string') throw new TypeError(name + ': ' + field + ' must be a string');
      }
      if (!Number.isSafeInteger(row.sheetId) || row.sheetId < 0 ||
          !Number.isSafeInteger(row.sourceRow) || row.sourceRow < 1) {
        throw new TypeError(name + ': invalid source sheet/row position');
      }
      if (!/^[0-9a-f]{64}$/i.test(row.payloadHash)) {
        throw new TypeError(name + ': payloadHash must be SHA-256 of the frozen full source row');
      }
      if (row.entityId != null && (typeof row.entityId !== 'string' || !row.entityId.trim())) {
        throw new TypeError(name + ': invalid authoritative entityId');
      }
      const key = observationKey(row);
      if (seen.has(key)) throw new Error(name + ': duplicate observation locator');
      seen.add(key);
      return { ...row, key };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

const sorted = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/**
 * @param {{older: object[], newer: object[], decisions?: object[]}} input
 * decisions: {from,to,fromHash,toHash,entityId} signed/approved elsewhere
 * (the tool validates scope and exact frozen payload but cannot authenticate a person).
 */
export function reconcileSnapshots({ older, newer, decisions = [] }) {
  const oldRows = validate(older, 'older');
  const newRows = validate(newer, 'newer');
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const oldByKey = new Map(oldRows.map(row => [row.key, row]));
  const newByKey = new Map(newRows.map(row => [row.key, row]));
  const oldById = groupBy(oldRows, row => row.entityId ?? null);
  const newById = groupBy(newRows, row => row.entityId ?? null);
  const oldByNumber = groupBy(oldRows, naturalNumberKey);
  const newByNumber = groupBy(newRows, naturalNumberKey);
  const usedOld = new Set();
  const usedNew = new Set();
  const matched = [];
  const candidates = [];
  const conflicts = [];
  const corruptIds = new Set();

  for (const [side, groups] of [['older', oldById], ['newer', newById]]) {
    for (const [id, group] of groups) {
      if (group.length > 1) {
        corruptIds.add(id);
        conflicts.push({ kind: 'duplicate_authoritative_id', side, entityId: id, observations: group.map(r => r.key) });
      }
    }
  }
  for (const [side, groups] of [['older', oldByNumber], ['newer', newByNumber]]) {
    for (const [key, group] of groups) {
      if (group.length > 1) {
        conflicts.push({ kind: 'duplicate_display_number', side, numberScope: key, observations: group.map(r => r.key) });
      }
    }
  }

  function bind(from, to, kind, id) {
    if (usedOld.has(from.key) || usedNew.has(to.key)) return false;
    usedOld.add(from.key);
    usedNew.add(to.key);
    matched.push({ from: from.key, to: to.key, entityId: id, evidence: kind });
    return true;
  }

  // Trusted, already persisted immutable identity: a change of row position,
  // subject or organization display name cannot change the entity identity.
  for (const [id, oldGroup] of oldById) {
    const nextGroup = newById.get(id);
    if (corruptIds.has(id) || oldGroup.length !== 1 || nextGroup?.length !== 1) continue;
    bind(oldGroup[0], nextGroup[0], 'authoritative_entity_id', id);
  }

  // Explicit human decisions must target the exact frozen observations;
  // a decision from a stale snapshot/content is rejected rather than replayed.
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object') {
      conflicts.push({ kind: 'malformed_decision' });
      continue;
    }
    const { from, to, fromHash, toHash, entityId } = decision;
    const a = oldByKey.get(from), b = newByKey.get(to);
    if (!a || !b || a.payloadHash !== fromHash || b.payloadHash !== toHash ||
        typeof entityId !== 'string' || !entityId.trim()) {
      conflicts.push({ kind: 'stale_or_unknown_decision', from, to });
      continue;
    }
    if (corruptIds.has(entityId) || (a.entityId && a.entityId !== entityId) ||
        (b.entityId && b.entityId !== entityId)) {
      conflicts.push({ kind: 'identity_conflict', from, to, entityId });
      continue;
    }
    if (!bind(a, b, 'approved_human_decision', entityId)) {
      conflicts.push({ kind: 'decision_reuses_observation', from, to });
    }
  }

  // Same displayed number is only a search clue. Even the EXACT same subject
  // and organization ID produce a review candidate, NEVER an automatic match.
  for (const [numberScope, previous] of oldByNumber) {
    const current = newByNumber.get(numberScope);
    if (!current) continue;
    const a = previous.filter(r => !usedOld.has(r.key));
    const b = current.filter(r => !usedNew.has(r.key));
    if (!a.length || !b.length) continue;
    if (previous.length !== 1 || current.length !== 1) {
      conflicts.push({
        kind: 'ambiguous_number_across_snapshots',
        numberScope, older: a.map(r => r.key), newer: b.map(r => r.key),
      });
      continue;
    }
    const exactDetails = !!(a[0].organizationId && a[0].subject &&
      a[0].organizationId === b[0].organizationId && a[0].subject === b[0].subject);
    candidates.push({
      from: a[0].key, to: b[0].key, numberScope,
      kind: exactDetails ? 'same_number_and_details_needs_review' : 'number_reused_or_details_changed_needs_review',
    });
  }

  const unresolvedOld = oldRows.filter(row => !usedOld.has(row.key)).map(row => row.key);
  const unresolvedNew = newRows.filter(row => !usedNew.has(row.key)).map(row => row.key);
  return {
    summary: {
      oldDataRows: oldRows.length, newDataRows: newRows.length,
      confirmedLinks: matched.length, reviewCandidates: candidates.length,
      conflicts: conflicts.length, unresolvedOld: unresolvedOld.length, unresolvedNew: unresolvedNew.length,
    },
    matched: sorted(matched),
    candidates: sorted(candidates),
    conflicts: sorted(conflicts),
    unresolvedOld, unresolvedNew,
  };
}
