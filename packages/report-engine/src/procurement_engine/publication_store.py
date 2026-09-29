"""Atomic release visibility on one local Linux filesystem (ADR-001).

Only committed SQLite records are visible. A directory left by a crash before
commit is not a publication; an identical retry can finish that transaction.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
from collections.abc import Callable
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from .projections import project_dashboard
from .snapshot_bundle_io import verify_persisted_bundle


class PublicationError(ValueError):
    pass


def _json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise PublicationError('BUNDLE_JSON_INVALID:' + Path(path).name) from exc


def _hash(path):
    with Path(path).open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def _files(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise PublicationError('BUNDLE_UNSAFE_FILE')
        if path.is_file():
            result[str(path.relative_to(root))] = _hash(path)
    return result


def _sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _validate(root):
    _files(root)  # Reject symlinks before reading any input through them.
    model = _json(root / 'report_model.json')
    release = model.get('release') or {}
    if release.get('official_release_allowed') is not True or release.get('blockers') != []:
        raise PublicationError('RELEASE_BLOCKED')
    audit = model.get('independent_audit') or {}
    if audit.get('pass') is not True:
        raise PublicationError('INDEPENDENT_AUDIT_FAILED')
    snapshot = model.get('snapshot') or {}
    if any(not snapshot.get(k) for k in ('snapshot_id', 'report_date', 'cutoff_at', 'rules_version', 'renderer_version')):
        raise PublicationError('REPORT_METADATA_MISSING')
    try:
        report_date = datetime.strptime(snapshot['report_date'], '%d.%m.%Y').date().isoformat()  # noqa: DTZ007 — civil report date, not an instant.
        cutoff = datetime.fromisoformat(snapshot['cutoff_at'].replace('Z', '+00:00'))
        if cutoff.tzinfo is None:
            raise ValueError('timezone required')
    except (TypeError, ValueError) as exc:
        raise PublicationError('REPORT_DATE_INVALID') from exc
    model_hash = hashlib.sha256(json.dumps(model, ensure_ascii=False, sort_keys=True,
                               separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    if _json(root / 'dashboard.json') != project_dashboard(model):
        raise PublicationError('DASHBOARD_MODEL_MISMATCH')
    for name, view in [('main_report.docx', 'main'), ('management_report.docx', 'management')]:
        artifact = root / name
        meta = _json(root / (name + '.manifest.json'))
        if not artifact.is_file() or meta.get('artifact_sha256') != _hash(artifact):
            raise PublicationError('DOCUMENT_HASH_MISMATCH:' + name)
        if meta.get('artifact') != name or meta.get('view') != view or meta.get('report_model_sha256') != model_hash:
            raise PublicationError('DOCUMENT_MODEL_MISMATCH:' + name)
        if any(meta.get(k) != snapshot[k] for k in ('snapshot_id', 'cutoff_at', 'rules_version', 'renderer_version')):
            raise PublicationError('DOCUMENT_SNAPSHOT_MISMATCH:' + name)
    manifest = _json(root / 'snapshot_bundle/manifest.json')
    index = manifest.get('payload_index') or []
    if not index:
        raise PublicationError('SNAPSHOT_EMPTY')
    for item in index:
        path = Path(item['path'])
        if path.is_absolute() or '..' in path.parts:
            raise PublicationError('SNAPSHOT_PATH_INVALID')
    if verify_persisted_bundle(root / 'snapshot_bundle'):
        raise PublicationError('SNAPSHOT_CORRUPT')
    if any(manifest.get(k) != snapshot[k] for k in ('snapshot_id', 'report_date', 'cutoff_at', 'rules_version', 'renderer_version')):
        raise PublicationError('SNAPSHOT_MODEL_MISMATCH')
    bundle = _json(root / 'snapshot_bundle/bundle.json')
    expected = bundle.get('after') or {}
    if not expected or any(not x for x in expected.values()) or bundle.get('before') != expected:
        raise PublicationError('SOURCE_CHANGED_DURING_CAPTURE')
    if set(expected) != {p['source_id'] for p in index}:
        raise PublicationError('SOURCE_COVERAGE_MISMATCH')
    return model, model_hash, report_date, cutoff.astimezone(timezone.utc).isoformat(), expected


class PublicationStore:
    def __init__(self, root: str | Path, *, readonly=False):
        self.root = Path(root).resolve()
        self.releases = self.root / 'releases'
        self.database_path = self.root / 'publications.sqlite'
        if readonly:
            return
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.releases.mkdir(exist_ok=True, mode=0o700)
        with closing(sqlite3.connect(self.database_path, timeout=30)) as db, db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('''CREATE TABLE IF NOT EXISTS publications (
                release_id TEXT PRIMARY KEY, report_date TEXT NOT NULL,
                cutoff_at TEXT NOT NULL, receipt TEXT NOT NULL, files TEXT NOT NULL
            )''')

    def _checked(self, row):
        if row is None:
            return None
        receipt, files = row
        record = json.loads(receipt)
        root = self.releases / record['release_id']
        if not root.is_dir() or root.is_symlink() or _files(root) != json.loads(files):
            raise PublicationError('PUBLISHED_BUNDLE_CORRUPT')
        return record

    def latest(self):
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            return self._checked(db.execute('''SELECT receipt, files FROM publications
                ORDER BY report_date DESC, cutoff_at DESC, release_id DESC LIMIT 1''').fetchone())

    def history(self):
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            return [json.loads(row[0]) for row in db.execute('''SELECT receipt FROM publications
                ORDER BY report_date DESC, cutoff_at DESC, release_id DESC''')]

    def read_artifact(self, release_id, name):
        if not re.fullmatch(r'REL-[a-f0-9]{64}', release_id or ''):
            raise PublicationError('PUBLICATION_ID_INVALID')
        if name not in {'dashboard.json', 'main_report.docx', 'management_report.docx'}:
            raise PublicationError('PUBLICATION_VIEW_INVALID')
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            row = db.execute('SELECT receipt, files FROM publications WHERE release_id=?', (release_id,)).fetchone()
            if self._checked(row) is None:
                raise PublicationError('PUBLICATION_NOT_FOUND')
            data = (self.releases / release_id / name).read_bytes()
            if hashlib.sha256(data).hexdigest() != json.loads(row[1]).get(name):
                raise PublicationError('PUBLISHED_BUNDLE_CORRUPT')
            return data

    def publish(self, candidate: str | Path, *, read_revisions: Callable[[], dict]):
        source = Path(candidate)
        if not source.is_dir() or source.is_symlink():
            raise PublicationError('CANDIDATE_DIRECTORY_INVALID')
        _files(source)
        # ponytail: one publisher on a local Linux volume. Use a DB/distributed
        # lease before supporting multiple hosts or network storage.
        with (self.root / 'publication.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            stage = Path(tempfile.mkdtemp(prefix='.pending-', dir=self.releases))
            try:
                shutil.copytree(source, stage, dirs_exist_ok=True, symlinks=True)
                model, model_hash, report_date, cutoff, expected = _validate(stage)
                release_id = 'REL-' + model_hash
                with closing(sqlite3.connect(self.database_path, timeout=30)) as db, db:
                    db.execute('PRAGMA synchronous=FULL')
                    previous = db.execute('SELECT receipt, files FROM publications WHERE release_id=?', (release_id,)).fetchone()
                    if previous:
                        return self._checked(previous)
                    observed = read_revisions()
                    if not observed or observed != expected:
                        raise PublicationError('SOURCE_CHANGED_BEFORE_PUBLICATION')
                    files = _files(stage)
                    for name in files:
                        with (stage / name).open('rb') as file:
                            os.fsync(file.fileno())
                    for directory in sorted((p for p in stage.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
                        _sync_directory(directory)
                    _sync_directory(stage)
                    destination = self.releases / release_id
                    if destination.exists():
                        if destination.is_symlink() or _files(destination) != files:
                            raise PublicationError('ORPHAN_RELEASE_CONFLICT')
                    else:
                        os.rename(stage, destination)
                    _sync_directory(self.releases)
                    record = {'release_id': release_id, 'snapshot_id': model['snapshot']['snapshot_id'],
                              'report_date': model['snapshot']['report_date'], 'cutoff_at': cutoff,
                              'model_sha256': model_hash, 'rules_version': model['snapshot']['rules_version'],
                              'renderer_version': model['snapshot']['renderer_version'],
                              'published_at': datetime.now(timezone.utc).isoformat(),
                              'source_revisions_at_publish': observed,
                              'status': 'VERIFIED_WITH_WARNINGS' if model.get('issues') else 'VERIFIED'}
                    db.execute('INSERT INTO publications VALUES (?, ?, ?, ?, ?)',
                        (release_id, report_date, cutoff, json.dumps(record, ensure_ascii=False), json.dumps(files)))
                _sync_directory(self.root)
                return record
            finally:
                if stage.exists():
                    shutil.rmtree(stage)
