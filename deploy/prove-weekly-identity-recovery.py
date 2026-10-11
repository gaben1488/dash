"""Rehearse derived identity recovery on a verified private restore, never live DB."""
from __future__ import annotations

import argparse
import hashlib
import json
import runpy
import shutil
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from procurement_engine.identity_store import IdentityStore
from procurement_engine.readonly_catalog import _stamp, copied_catalog


def _frozen_digest(path):
    digest = hashlib.sha256()
    with closing(sqlite3.connect(path)) as db:
        for table in ('snapshots', 'observations', 'reviews'):
            columns = [r[1] for r in db.execute('PRAGMA table_info(' + table + ')')
                       if r[1] not in {'plan_signature', 'entity_signature'}]
            # Column names originate in the verified schema, not user input.
            query = 'SELECT ' + ','.join('"' + c.replace('"', '""') + '"' for c in columns) + ' FROM ' + table + ' ORDER BY rowid'
            for row in db.execute(query):
                digest.update(json.dumps([table, list(row)], ensure_ascii=False, separators=(',', ':')).encode())
                digest.update(b'\n')
    return digest.hexdigest()


def prove(state):
    state = Path(state)
    source = state / 'identity.sqlite'
    catalog = state / 'published/publications.sqlite'
    watched = [source, source.with_name(source.name + '-wal'), catalog,
               catalog.with_name(catalog.name + '-wal'), state / 'status.json']
    before = [_stamp(p) for p in watched]
    planner = runpy.run_path(str(Path(__file__).with_name('plan-weekly-publications.py')))['plan']
    plan = planner(state)
    with copied_catalog(catalog) as copied, closing(sqlite3.connect(copied)) as db:
        targets = {json.loads(receipt)['snapshot_id'] for rid, receipt in db.execute('SELECT release_id,receipt FROM publications') if rid in plan['retire_release_ids']}
    # Scratch needs one verified backup and one restore, plus SQLite working space.
    if shutil.disk_usage(tempfile.gettempdir()).free < source.stat().st_size * 3 + 128 * 1024**2:
        raise ValueError('IDENTITY_PROOF_SCRATCH_CAPACITY')
    with copied_catalog(source) as backup, tempfile.TemporaryDirectory(prefix='retention-proof-') as temporary:
        restored = Path(temporary) / 'identity.sqlite'
        shutil.copyfile(backup, restored)
        if _stamp(backup)[3] != _stamp(restored)[3]:
            raise ValueError('IDENTITY_RESTORE_HASH_MISMATCH')
        with closing(sqlite3.connect(restored)) as db:
            if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise ValueError('IDENTITY_RESTORE_CORRUPT')
        frozen = _frozen_digest(restored)
        store = IdentityStore(restored)
        diagnostics = {}
        updated = store.recover_latest_plan_signatures(
            sorted((state / 'published/releases').glob('*/snapshot_bundle')),
            required_snapshot_ids=targets, diagnostics=diagnostics)
        if _frozen_digest(restored) != frozen:
            raise ValueError('IDENTITY_FROZEN_STATE_CHANGED')
        missing = 0
        with closing(store.connect()) as db:
            for sid in targets:
                missing += db.execute('SELECT COUNT(*) FROM observations WHERE snapshot_id=? AND (plan_signature IS NULL OR entity_signature IS NULL)', (sid,)).fetchone()[0]
        result = {'status': 'SCRATCH_IDENTITY_PASS' if missing == 0 and diagnostics['unrecovered_snapshots'] == 0 else 'SCRATCH_IDENTITY_BLOCKED',
                  'restored_backup_verified': True, 'updated_derived_rows': updated,
                  'missing_signatures_after': missing, 'unrecovered_snapshots': diagnostics['unrecovered_snapshots'],
                  'catalog_revision': plan['catalog_revision'], 'frozen_state_unchanged': True}
    if before != [_stamp(p) for p in watched]:
        raise ValueError('IDENTITY_PROOF_SOURCE_CHANGED')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', required=True)
    args = parser.parse_args(argv)
    try:
        result = prove(args.state)
    except Exception as error:  # noqa: BLE001 — private evidence paths must not enter public Actions logs.
        known = {'IDENTITY_PROOF_SCRATCH_CAPACITY', 'IDENTITY_RESTORE_HASH_MISMATCH',
                 'IDENTITY_RESTORE_CORRUPT', 'IDENTITY_FROZEN_STATE_CHANGED',
                 'IDENTITY_PROOF_SOURCE_CHANGED', 'IDENTITY_BACKFILL_TARGET_MISSING',
                 'IDENTITY_BACKFILL_DONOR_INVALID', 'IDENTITY_BACKFILL_DONOR_NOT_SEALED',
                 'IDENTITY_BACKFILL_COVERAGE_INCOMPLETE', 'IDENTITY_BACKFILL_EVIDENCE_MISMATCH',
                 'IDENTITY_BACKFILL_SIGNATURE_CONFLICT'}
        code = str(error) if str(error) in known else 'IDENTITY_PROOF_FAILED'
        print(json.dumps({'status': 'SCRATCH_IDENTITY_BLOCKED', 'error_code': code}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0 if result['status'] == 'SCRATCH_IDENTITY_PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
