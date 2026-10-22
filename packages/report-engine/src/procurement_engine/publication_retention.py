"""Discard intermediate publications, retaining weekly inputs separately (ADR-0013)."""
from __future__ import annotations

import json
import re
import shutil
import sqlite3
from contextlib import closing, nullcontext
from datetime import date
from pathlib import Path


def plan_publication_retention(state_dir):
    root = Path(state_dir) / 'published'
    database = root / 'publications.sqlite'
    releases = root / 'releases'
    if not database.exists():
        return {'keep': [], 'remove': []}
    if root.is_symlink() or database.is_symlink() or releases.is_symlink():
        raise ValueError('PUBLICATION_RETENTION_UNSAFE')
    live, identifiers, snapshots = [], set(), {}
    with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        for rid, day, receipt in db.execute('SELECT release_id, report_date, receipt FROM publications '
                'ORDER BY report_date DESC, cutoff_at DESC, release_id DESC'):
            record = json.loads(receipt)
            if record.get('release_id') != rid:
                raise ValueError('PUBLICATION_RETENTION_UNSAFE')
            identifiers.add(rid)
            snapshots[rid] = record.get('snapshot_id')
            if 'archive_origin' not in record and record.get('replay_available') is not False:
                live.append((rid, day))
    if not live:
        raise ValueError('PUBLICATION_RETENTION_LIVE_BASELINE_MISSING')
    keep = {rid for rid, _ in live[:2]}
    previous = next((rid for rid, day in live if day < live[0][1]), None)
    if previous:
        keep.add(previous)
    weeks = set()
    for rid, day in live:
        parsed = date.fromisoformat(day)
        week = parsed.isocalendar()[:2]
        if parsed.weekday() in (3, 4) and week not in weeks and len(weeks) < 2:
            keep.add(rid)
            weeks.add(week)
    status = root.parent / 'status.json'
    if status.is_symlink():
        raise ValueError('PUBLICATION_RETENTION_UNSAFE')
    if status.exists():
        current = (json.loads(status.read_text()).get('publication') or {}).get('release_id')
        if current:
            if current not in identifiers:
                raise ValueError('PUBLICATION_RETENTION_CURRENT_MISSING')
            keep.add(current)
    attempts = root.parent / 'attempts'
    if attempts.is_symlink():
        raise ValueError('PUBLICATION_RETENTION_UNSAFE')
    for journal in attempts.glob('*/status.json'):
        if journal.is_symlink() or journal.parent.is_symlink():
            raise ValueError('PUBLICATION_RETENTION_UNSAFE')
        attempt = json.loads(journal.read_text())
        if not isinstance(attempt, dict):
            raise TypeError('PUBLICATION_RETENTION_UNSAFE')
        if attempt.get('status') == 'RUNNING':
            if attempt.get('attempt_id') != journal.parent.name:
                raise ValueError('PUBLICATION_RETENTION_UNSAFE')
            pending = attempt.get('pending_release_id')
            if pending in identifiers:
                keep.add(pending)
    identifiers.update(p.name for p in releases.iterdir() if re.fullmatch(r'REL-[a-f0-9]{64}', p.name))
    for rid in identifiers:
        target = releases / rid
        if (not re.fullmatch(r'REL-[a-f0-9]{64}', rid) or target.is_symlink()
                or (target.exists() and not target.is_dir())):
            raise ValueError('PUBLICATION_RETENTION_UNSAFE')
    identity = root.parent / 'identity.sqlite'
    if identity.is_symlink():
        raise ValueError('PUBLICATION_RETENTION_UNSAFE')
    protected_identity = []
    connection = sqlite3.connect(identity.resolve().as_uri() + '?mode=ro', uri=True) if identity.exists() else None
    with closing(connection) if connection else nullcontext() as db:
        for rid in identifiers - keep:
            if not (releases / rid / 'identity.sqlite').exists():
                continue
            snapshot_id = snapshots.get(rid)
            if snapshot_id is None:
                # Catalog commit may precede an interrupted directory deletion.
                manifest = releases / rid / 'snapshot_bundle' / 'manifest.json'
                if manifest.is_symlink() or manifest.parent.is_symlink():
                    raise ValueError('PUBLICATION_RETENTION_UNSAFE')
                if manifest.is_file():
                    snapshot_id = json.loads(manifest.read_text())['snapshot_id']
            known = db and db.execute('SELECT 1 FROM snapshots WHERE snapshot_id=?',
                                      (snapshot_id,)).fetchone()
            ready = db and db.execute('SELECT COUNT(*), SUM(plan_signature IS NULL OR entity_signature IS NULL) '
                                      'FROM observations WHERE snapshot_id=?', (snapshot_id,)).fetchone()
            if not known or not ready or not ready[0] or ready[1]:
                keep.add(rid)
                protected_identity.append(rid)
    return {'keep': sorted(keep), 'remove': sorted(identifiers - keep),
            'identity_protected': sorted(protected_identity)}


def apply_publication_retention(state_dir, *, expected_remove=None):
    from .publication_store import PublicationStore
    from .retention import _payload_bytes

    state = Path(state_dir)
    root = state / 'published'
    if not (root / 'publications.sqlite').exists():
        return {'status': 'NO_PUBLICATIONS', 'removed': 0}
    if any(p.is_symlink() for p in (state, root, root / 'publications.sqlite')):
        raise ValueError('PUBLICATION_RETENTION_UNSAFE')
    store = PublicationStore(root, readonly=True)
    # Reuse acquisition -> EX reader lease -> publisher order, including live readers.
    with store._maintenance_locks():
        if (root / '.retirement').exists() or (root / '.retirement').is_symlink():
            raise ValueError('PUBLICATION_RETENTION_RECOVERY_REQUIRED')
        plan = plan_publication_retention(state)
        if expected_remove is not None and sorted(expected_remove) != plan['remove']:
            return {**plan, 'status': 'PLAN_CHANGED', 'removed': 0}
        pending = [p for p in (root / 'releases').iterdir()
                   if re.fullmatch(r'\.pending-[a-z0-9_]+', p.name)]
        pending_bytes = sum(_payload_bytes(p) for p in pending)
        if any(not p.is_dir() for p in pending):
            raise ValueError('PUBLICATION_RETENTION_UNSAFE')
        with closing(sqlite3.connect(root / 'publications.sqlite', timeout=30)) as db:
            for rid in plan['keep']:
                store._checked(db.execute('SELECT receipt, files FROM publications WHERE release_id=?',
                                          (rid,)).fetchone(), expected_release_id=rid)
            with db:
                db.executemany('DELETE FROM publications WHERE release_id=?', [(r,) for r in plan['remove']])
                db.executemany('DELETE FROM publication_contexts WHERE release_id=?', [(r,) for r in plan['remove']])
            # A crash after commit leaves invisible directories, picked up by the next plan.
            for rid in plan['remove']:
                target = root / 'releases' / rid
                if target.exists():
                    shutil.rmtree(target)
            # Publisher lock proves these uncommitted staging copies have no writer.
            for target in pending:
                shutil.rmtree(target)
            if plan['remove']:
                db.execute('VACUUM')
        return {**plan, 'status': 'COMPACTED', 'removed': len(plan['remove']),
                'pending_removed': len(pending), 'pending_bytes_reclaimed': pending_bytes}


def main(argv=None):
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args(argv)
    if args.apply:
        from .retention import safe_compact_transient_attempts
        from .runtime import _write

        result = safe_compact_transient_attempts(args.state)
        result = {k: v for k, v in result.items() if k != 'compact_attempts'}
        _write(Path(args.state) / 'storage-maintenance-status.json', result)
    else:
        result = plan_publication_retention(args.state)
    print(json.dumps(result, ensure_ascii=False))
    return 1 if result.get('status') == 'FAILED' else 0


if __name__ == '__main__':
    raise SystemExit(main())
