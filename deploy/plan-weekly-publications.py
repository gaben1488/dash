"""Private read-only census before weekly retention; never removes files or rows.

Only aggregate output goes to Actions. The release IDs remain in memory so an
operator can later bind a tested retirement transaction to this exact plan.
This census is NOT a checksum validation or permission to execute deletion.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from contextlib import closing, contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

from procurement_engine.readonly_catalog import copied_catalog


def _read(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError('RETENTION_METADATA_UNSAFE')
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise TypeError('RETENTION_METADATA_INVALID')
    return data


@contextmanager
def _connect(path):
    # SQLite mode=ro can create -shm on a WAL source. Read DB+WAL from a
    # byte-stable scratch copy instead, using the existing rehearsal barrier.
    with copied_catalog(path) as copied, closing(sqlite3.connect(copied)) as db:
        yield db


def plan(state):
    state = Path(state)
    published = state / 'published'
    releases = published / 'releases'
    if published.is_symlink() or releases.is_symlink() or not releases.is_dir():
        raise ValueError('RETENTION_ROOT_UNSAFE')
    with _connect(published / 'publications.sqlite') as db:
        db.execute('BEGIN')
        records = db.execute('SELECT release_id, report_date, cutoff_at, receipt, files FROM publications ORDER BY report_date DESC, cutoff_at DESC, release_id DESC').fetchall()
    keep = set()
    weeks = {}
    live = []
    metadata = {}
    for rid, day_text, cutoff_text, receipt_text, files_text in records:
        if not isinstance(rid, str) or not re.fullmatch(r'REL-[a-f0-9]{64}', rid):
            raise ValueError('RETENTION_RELEASE_INVALID')
        receipt = json.loads(receipt_text)
        day = date.fromisoformat(day_text)
        cutoff = datetime.fromisoformat(cutoff_text.replace('Z', '+00:00'))
        if (not isinstance(receipt, dict) or receipt.get('release_id') != rid
                or receipt.get('report_date') != day.strftime('%d.%m.%Y')
                or receipt.get('cutoff_at') != cutoff_text or cutoff.tzinfo is None
                or not isinstance(json.loads(files_text), dict)):
            raise ValueError('RETENTION_RECEIPT_INVALID')
        folder = releases / rid
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError('RETENTION_RELEASE_MISSING')
        size = 0
        for path in folder.rglob('*'):
            if path.is_symlink() or not (path.is_dir() or path.is_file()):
                raise ValueError('RETENTION_PAYLOAD_UNSAFE')
            if path.is_file():
                size += path.stat().st_size
        metadata[rid] = {'bytes': size, 'snapshot_id': receipt.get('snapshot_id')}
        if 'archive_origin' in receipt:
            keep.add(rid)  # Archived contexts have a separate canonical input policy.
            continue
        live.append(rid)
        monday = (day - timedelta(days=day.weekday())).isoformat()
        # Match previous_weekly_model's Thursday/Friday selection. Other days
        # cannot displace a control release; if absent keep one weekly fallback.
        priority = (day.weekday() in {3, 4}, day_text, cutoff_text, rid)
        if monday not in weeks or priority > weeks[monday][0]:
            weeks[monday] = (priority, rid)
    keep.update(live[:2])
    keep.update(item[1] for item in weeks.values())
    status_path = state / 'status.json'
    if status_path.exists() or status_path.is_symlink():
        current = (_read(status_path).get('publication') or {}).get('release_id')
        if current:
            if current not in metadata:
                raise ValueError('RETENTION_CURRENT_RELEASE_MISSING')
            keep.add(current)
    retired = sorted(set(metadata) - keep)
    missing = missing_snapshots = None
    identity_path = state / 'identity.sqlite'
    if identity_path.exists():
        with _connect(identity_path) as db:
            db.execute('BEGIN')
            missing = missing_snapshots = 0
            targets = {metadata[rid]['snapshot_id'] for rid in retired}
            if any(not isinstance(sid, str) or not sid for sid in targets):
                raise ValueError('RETENTION_SNAPSHOT_INVALID')
            for sid in targets:
                if db.execute('SELECT COUNT(*) FROM observations WHERE snapshot_id=?', (sid,)).fetchone()[0] == 0:
                    missing_snapshots += 1
                missing += db.execute('SELECT COUNT(*) FROM observations WHERE snapshot_id=? AND (plan_signature IS NULL OR entity_signature IS NULL)', (sid,)).fetchone()[0]
    return {'status': 'READ_ONLY_PLAN', 'publication_count': len(records),
            'weekly_live_count': len(weeks), 'keep_count': len(keep),
            'retire_count': len(retired), 'bytes_reclaimable': sum(metadata[r]['bytes'] for r in retired),
            'identity_missing_signatures': missing, 'identity_missing_snapshots': missing_snapshots,
            'identity_ready': missing == 0 and missing_snapshots == 0,
            'keep_release_ids': sorted(keep), 'retire_release_ids': retired,
            'catalog_revision': hashlib.sha256(json.dumps(records, separators=(',', ':')).encode()).hexdigest()}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', required=True)
    args = parser.parse_args(argv)
    try:
        result = plan(args.state)
    except Exception:  # noqa: BLE001 — CLI boundary must never expose private paths or content.
        print(json.dumps({'status': 'CENSUS_BLOCKED', 'error_code': 'RETENTION_CENSUS_FAILED'}))
        return 2
    result.pop('keep_release_ids')
    result.pop('retire_release_ids')
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
