"""Seal one complete Thursday report-engine input for exact historical replay.

The live worker already performs the expensive atomic Google acquisition and builds a
self-contained snapshot bundle plus an SQLite identity backup.  This module promotes
that frozen evidence into long-lived weekly storage.  It never rereads Google, never
turns a blocked report into a successful release and never substitutes a nearby date.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import shutil
import tempfile
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

from .archive_runtime import _frozen_fingerprint, load_frozen_input
from .normalize import parse_date
from .snapshot_bundle_io import verify_persisted_bundle

WEEKLY_ARCHIVE_STATUS = 'weekly_archive_status.json'


def _write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _sync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _sync_tree(root: Path) -> None:
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('WEEKLY_ARCHIVE_UNSAFE_FILE')
        if path.is_file():
            os.chmod(path, 0o600)
            with path.open('rb') as stream:
                os.fsync(stream.fileno())
    directories = [path for path in root.rglob('*') if path.is_dir()] + [root]
    for directory in sorted(directories, key=lambda item: len(item.parts), reverse=True):
        _sync_directory(directory)


def _read_manifest(root: Path) -> dict:
    try:
        manifest = json.loads((root / 'snapshot_bundle/manifest.json').read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        raise ValueError('WEEKLY_ARCHIVE_MANIFEST_INVALID') from error
    if not isinstance(manifest, dict):
        raise TypeError('WEEKLY_ARCHIVE_MANIFEST_INVALID')
    return manifest


def _ready_root(root: Path, *, snapshot_id: str, day: str, strict: bool) -> bool:
    """Return whether a candidate is a complete immutable replay input.

    A half-written attempt is retryable and therefore not corruption. A published
    release, however, is immutable and must never silently lose replay evidence.
    """
    if not root.is_dir() or root.is_symlink():
        return False
    identity = root / 'identity.sqlite'
    manifest_path = root / 'snapshot_bundle/manifest.json'
    if not identity.is_file() or identity.is_symlink() or not manifest_path.is_file():
        if strict and manifest_path.exists():
            raise ValueError('WEEKLY_ARCHIVE_SOURCE_INCOMPLETE')
        return False
    manifest = _read_manifest(root)
    if manifest.get('snapshot_id') != snapshot_id or parse_date(manifest.get('report_date')) != day:
        return False
    errors = verify_persisted_bundle(root / 'snapshot_bundle')
    if errors:
        if strict:
            raise ValueError('WEEKLY_ARCHIVE_SOURCE_CORRUPT')
        return False
    # Also validates the source contract, historical ledger and identity backup.
    quarter = (int(day[5:7]) - 1) // 3 + 1
    load_frozen_input(root, day=day, year=int(day[:4]), quarter=quarter)
    return True


def _source_for_status(state: Path, status: dict, *, snapshot_id: str, day: str):
    attempt_id = status.get('attempt_id')
    if isinstance(attempt_id, str) and attempt_id:
        root = state / 'attempts' / attempt_id / 'bundle'
        if _ready_root(root, snapshot_id=snapshot_id, day=day, strict=False):
            return 'attempt', attempt_id, root

    publication = status.get('publication')
    release_id = publication.get('release_id') if isinstance(publication, dict) else None
    if isinstance(release_id, str) and release_id:
        root = state / 'published' / 'releases' / release_id
        if _ready_root(root, snapshot_id=snapshot_id, day=day, strict=True):
            return 'publication', release_id, root
    return None


def seal_weekly_archive(state_dir, status):
    """Persist the first complete report-engine capture for a Kamchatka Thursday.

    The date comes from the canonical capture itself, not the host clock. A later
    attempt on the same Thursday cannot replace an already sealed archive.
    """
    if not isinstance(status, dict):
        return {'status': 'NOT_READY', 'code': 'WEEKLY_ARCHIVE_STATUS_INVALID'}
    day = parse_date(status.get('report_date'))
    snapshot_id = status.get('snapshot_id')
    if not day or not isinstance(snapshot_id, str) or not snapshot_id:
        return {'status': 'NOT_READY', 'code': 'WEEKLY_ARCHIVE_CAPTURE_INCOMPLETE'}
    if date.fromisoformat(day).weekday() != 3:
        return {'status': 'NOT_APPLICABLE', 'report_date': day}

    state = Path(state_dir)
    archives = state / 'archives'
    archives.mkdir(parents=True, exist_ok=True, mode=0o700)
    archive_id = f'WEEKLY-{day}'
    target = archives / archive_id
    with (archives / '.weekly.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)

        if target.exists():
            quarter = (int(day[5:7]) - 1) // 3 + 1
            capture, _, _, _ = load_frozen_input(target, day=day, year=int(day[:4]), quarter=quarter)
            return {
                'status': 'ALREADY_SEALED',
                'archive_id': archive_id,
                'report_date': day,
                'snapshot_id': capture['archive_origin']['snapshot_id'],
            }

        source_info = _source_for_status(state, status, snapshot_id=snapshot_id, day=day)
        if source_info is None:
            return {
                'status': 'NOT_READY',
                'code': 'WEEKLY_ARCHIVE_REPLAY_INPUT_INCOMPLETE',
                'report_date': day,
                'snapshot_id': snapshot_id,
            }
        source_kind, source_ref, source = source_info
        before = _frozen_fingerprint(source)
        stage = Path(tempfile.mkdtemp(prefix='.weekly-', dir=archives))
        try:
            shutil.copytree(source / 'snapshot_bundle', stage / 'snapshot_bundle')
            shutil.copyfile(source / 'identity.sqlite', stage / 'identity.sqlite')
            identity_sha256 = hashlib.sha256((stage / 'identity.sqlite').read_bytes()).hexdigest()
            _write_json(stage / 'import.json', {
                'archive_id': archive_id,
                'report_date': day,
                'snapshot_id': snapshot_id,
                'sealed_at': datetime.now(timezone.utc).isoformat(),
                'source_kind': source_kind,
                'source_ref': source_ref,
                'identity_sha256': identity_sha256,
                'publication_created': False,
                'contract': 'canonical-weekly-report-input-v1',
            })
            if before != _frozen_fingerprint(source):
                raise ValueError('WEEKLY_ARCHIVE_SOURCE_CHANGED')
            quarter = (int(day[5:7]) - 1) // 3 + 1
            capture, _, _, _ = load_frozen_input(stage, day=day, year=int(day[:4]), quarter=quarter)
            if capture['archive_origin']['snapshot_id'] != snapshot_id:
                raise ValueError('WEEKLY_ARCHIVE_SNAPSHOT_MISMATCH')
            _sync_tree(stage)
            os.rename(stage, target)
            _sync_directory(archives)
        finally:
            if stage.exists():
                shutil.rmtree(stage)

    return {
        'status': 'SEALED',
        'archive_id': archive_id,
        'report_date': day,
        'snapshot_id': snapshot_id,
        'source_kind': source_kind,
        'source_ref': source_ref,
    }


def recover_weekly_archives(state_dir):
    """Backfill retained complete Thursday attempts without inventing missing history."""
    state = Path(state_dir)
    attempts = state / 'attempts'
    if not attempts.is_dir():
        return []
    candidates = []
    for path in attempts.glob('*/status.json'):
        try:
            status = json.loads(path.read_text(encoding='utf-8'))
            if status.get('attempt_id') != path.parent.name:
                continue
            day = parse_date(status.get('report_date'))
            if not day or date.fromisoformat(day).weekday() != 3 or not status.get('snapshot_id'):
                continue
            candidates.append((day, status.get('finished_at') or '', path.parent.name, status))
        except (OSError, ValueError, TypeError):
            continue
    results = []
    completed_days = set()
    for day, _, _, status in sorted(candidates):
        if day in completed_days:
            continue
        result = maybe_seal_weekly_archive(state, status)
        results.append(result)
        if result.get('status') in {'SEALED', 'ALREADY_SEALED'}:
            completed_days.add(day)
    return results


def maybe_seal_weekly_archive(state_dir, status):
    """Worker boundary: archive failure is recorded but never kills live polling."""
    try:
        result = seal_weekly_archive(state_dir, status)
    except Exception as error:  # noqa: BLE001 - process boundary returns a fixed public code.
        result = {
            'status': 'FAILED',
            'code': 'WEEKLY_ARCHIVE_SEAL_FAILED',
            'error_type': type(error).__name__,
        }
        day = parse_date(status.get('report_date')) if isinstance(status, dict) else None
        if day:
            result['report_date'] = day
        if isinstance(status, dict) and status.get('snapshot_id'):
            result['snapshot_id'] = status['snapshot_id']
    if result.get('status') not in {'NOT_APPLICABLE'} and (
            result.get('report_date') or result.get('status') == 'FAILED'):
        try:
            _write_json(Path(state_dir) / WEEKLY_ARCHIVE_STATUS, result)
        except OSError:
            pass
    return result
