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
    if 'report_content' in model:
        from .diagnostics import project_diagnostics

        if _json(root / 'diagnostic_protocol.json') != project_diagnostics(model):
            raise PublicationError('DIAGNOSTIC_PROTOCOL_MISMATCH')
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
    for key in ('report_year', 'report_scope', 'archive_origin'):
        if manifest.get(key) != snapshot.get(key):
            raise PublicationError('SNAPSHOT_MODEL_MISMATCH')
    bundle = _json(root / 'snapshot_bundle/bundle.json')
    expected = bundle.get('after') or {}
    if not expected or any(not x for x in expected.values()) or bundle.get('before') != expected:
        raise PublicationError('SOURCE_CHANGED_DURING_CAPTURE')
    if set(expected) != {p['source_id'] for p in index}:
        raise PublicationError('SOURCE_COVERAGE_MISMATCH')
    # A production matrix cannot opt out of domain gates by deleting the
    # model contract or merely changing a renderer patch version.
    modern = any(source.get('role') == 'master' for source in manifest.get('sources', []))
    modern = modern or str(snapshot.get('renderer_version', '')).startswith('renderer-v')
    has_domain_contract = str((model.get('contract') or {}).get('report_model_version', '')).startswith('report-model-')
    if modern and not has_domain_contract:
        raise PublicationError('DOMAIN_RELEASE_CONTRACT_FAILED')
    if has_domain_contract:
        from .formula_dependencies import audit_formula_dependencies
        from .independent_audit import audit_model
        from .release_gates import validate_recorded_state_model
        from .section_audit import audit_source_sections

        if release.get('policy') != 'recorded-state-v1':
            raise PublicationError('DOMAIN_RELEASE_POLICY_MISSING')
        payloads = [_json(root / 'snapshot_bundle' / item['path']) for item in index]
        ledgers = [p['semantic_values'] for p in payloads if p['role'] == 'historical_ledger']
        for key in ('report_scope', 'archive_origin'):
            evidence = [p['semantic_values'] for p in payloads if p['role'] == key]
            if evidence != ([snapshot[key]] if key in snapshot else []):
                raise PublicationError('ARCHIVE_SCOPE_EVIDENCE_MISMATCH')
        documents = {}
        history = [p['semantic_values'] for p in payloads if p['role'] == 'historical_report_evidence']
        if history and len(ledgers) == 1:
            from .recommendation_history import enroll_history_package

            _, documents = enroll_history_package(history[0]['package'], ledgers[0])
        if len(ledgers) != 1 or validate_recorded_state_model(model, ledger=ledgers[0], documents=documents):
            raise PublicationError('DOMAIN_RELEASE_CONTRACT_FAILED')
        capture = {'report_date': snapshot['report_date'], 'report_year': snapshot['report_year'], 'sources': []}
        for key in ('report_scope', 'archive_origin'):
            if key in snapshot:
                capture[key] = snapshot[key]
        for payload in payloads:
            if payload['role'] == 'archived_file_evidence':
                capture['archived_file_evidence'] = payload['semantic_values']
            if payload['role'] == 'historical_report_evidence':
                capture['recommendation_history_evidence'] = payload['semantic_values']
            meta = payload.get('metadata') or {}
            if 'sheet_title' not in meta:
                continue
            capture['sources'].append({'source_id': payload['source_id'], 'role': payload['role'],
                'provider_id': payload['provider_id'], 'sheet': meta['sheet_title'],
                'sheet_id': int(payload['sheet_or_tab_id']), 'grbs': meta.get('grbs'),
                'rows': meta['row_count'], 'columns': meta['column_count'], 'header_rows': meta.get('header_rows', 3),
                'values': payload['semantic_values'], 'formula_evidence': meta.get('formula_evidence'),
                **{key: meta[key] for key in ('capture_method', 'archive_file_sha256') if key in meta}})
        if capture.get('archived_file_evidence') is not None:
            from .archived_evidence import verify_archived_values
            saved_contracts = [p['semantic_values'] for p in payloads if p['role'] == 'rule_contract']
            if len(saved_contracts) != 1:
                raise PublicationError('ARCHIVE_FILE_REGISTRY_MISMATCH')
            verify_archived_values(capture, registry=saved_contracts[0], ledger=ledgers[0])
        from .identity_store import read_identity_result

        try:
            frozen_identity = read_identity_result(root / 'identity.sqlite', snapshot['snapshot_id'], snapshot['cutoff_at'])
        except (OSError, ValueError, sqlite3.DatabaseError) as exc:
            raise PublicationError('IDENTITY_BACKUP_INVALID') from exc
        if frozen_identity != model.get('identity_observations'):
            raise PublicationError('IDENTITY_BACKUP_MODEL_MISMATCH')
        identity_proofs = [p['semantic_values'] for p in payloads if p['role'] == 'identity_reviews']
        proof = identity_proofs[0] if len(identity_proofs) == 1 else []
        if proof != model.get('identity_review_evidence', []):
            raise PublicationError('IDENTITY_REVIEW_EVIDENCE_MISMATCH')
        if model.get('contract', {}).get('recommendation_link_contract'):
            from .identity_store import read_saved_identity

            try:
                identity = read_saved_identity(root / 'identity.sqlite', snapshot['snapshot_id'], as_of=snapshot['cutoff_at'])
            except (ValueError, KeyError, sqlite3.DatabaseError) as exc:
                raise PublicationError('SAVED_IDENTITY_RECHECK_FAILED') from exc
            if identity != model.get('identity_observations'):
                raise PublicationError('SAVED_IDENTITY_RECHECK_FAILED')
            capture['identity_evidence'] = identity
        formula = audit_formula_dependencies(capture)
        arithmetic = audit_model(capture, model)
        sections = audit_source_sections(capture, model, ledger=ledgers[0], identity_evidence=proof)
        if not formula['closed'] or not arithmetic['pass'] or sections:
            error = PublicationError('SAVED_SOURCE_RECHECK_FAILED')
            error.evidence = {'formula_closed': formula['closed'], 'arithmetic_pass': arithmetic['pass'],
                              'section_errors': sections}
            raise error
    if model.get('contract', {}).get('document_content_contract') == 'document-plan-v1':
        from .document_content import (
            validate_document_content,
            validate_document_plans,
        )
        try:
            # The domain gate above already reconstructed and checked these
            # plans. Avoid rebuilding the full document twice per HTTP read.
            if not has_domain_contract and not validate_document_plans(model):
                raise ValueError('DOCUMENT_CONTENT_PLAN_MISMATCH')
            plans = model['document_plans']
            for name, view in [('main_report.docx', 'main'), ('management_report.docx', 'management')]:
                validate_document_content(root / name, plans[view])
        except ValueError as exc:
            raise PublicationError(str(exc)) from exc
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

    def _first_live(self, rows):
        """Archive recomputation never replaces the live worker's baseline.

        History/context selectors still expose archives explicitly. Presence of
        archive_origin (including an invalid null) is not a live publication.
        """
        for row in rows:
            if 'archive_origin' not in json.loads(row[0]):
                return self._checked(row)
        return None

    def latest(self):
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            return self._first_live(db.execute('''SELECT receipt, files FROM publications
                ORDER BY report_date DESC, cutoff_at DESC, release_id DESC'''))

    def history(self):
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            return [json.loads(row[0]) for row in db.execute('''SELECT receipt FROM publications
                ORDER BY report_date DESC, cutoff_at DESC, release_id DESC''')]

    def select(self, report_date, report_year, quarter):
        """Exact context only; a nearby date is not an historical release."""
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            rows = db.execute('''SELECT receipt, files FROM publications WHERE report_date = ?
                ORDER BY cutoff_at DESC, release_id DESC''', (report_date,))
            for row in rows:
                receipt = self._checked(row)
                model = _json(self.releases / receipt['release_id'] / 'report_model.json')
                year = (model.get('snapshot') or {}).get('report_year')
                selected_quarter = (model.get('headline') or {}).get('current_quarter')
                if year == report_year and selected_quarter == quarter:
                    return {**receipt, 'report_year': year, 'quarter': selected_quarter}
        return None

    def previous_model(self, report_date):
        day = datetime.strptime(report_date, '%d.%m.%Y').date().isoformat()  # noqa: DTZ007 — civil date.
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            rows = db.execute('''SELECT receipt, files FROM publications WHERE report_date < ?
                ORDER BY report_date DESC, cutoff_at DESC, release_id DESC''', (day,))
            receipt = self._first_live(rows)
            if receipt is None:
                return None
            return {'receipt': receipt, 'model': _json(self.releases / receipt['release_id'] / 'report_model.json')}

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
                    if (model.get('contract', {}).get('document_content_contract') == 'document-plan-v1'
                            and not model['snapshot'].get('archive_origin')):
                        from .semantic_headers import assert_header_continuity
                        prior_rows = db.execute('''SELECT receipt, files FROM publications WHERE cutoff_at <= ?
                            ORDER BY cutoff_at DESC, release_id DESC''', (cutoff,))
                        prior = self._first_live(prior_rows)
                        if prior is not None:
                            try:
                                assert_header_continuity(self.releases / prior['release_id'], stage)
                            except ValueError as exc:
                                raise PublicationError(str(exc)) from exc
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
                              'status': 'VERIFIED_WITH_WARNINGS' if model.get('issues') or (model.get('automation_assurance') or {}).get('actions') else 'VERIFIED'}
                    if model['snapshot'].get('archive_origin'):
                        record['archive_origin'] = model['snapshot']['archive_origin']
                        record['source_verification'] = 'FROZEN_ARCHIVE_HASHES'
                        record['source_revisions_at_capture'] = record.pop('source_revisions_at_publish')
                    if model.get('automation_assurance') is not None:
                        record['automation_assurance'] = model['automation_assurance']
                    db.execute('INSERT INTO publications VALUES (?, ?, ?, ?, ?)',
                        (release_id, report_date, cutoff, json.dumps(record, ensure_ascii=False), json.dumps(files)))
                _sync_directory(self.root)
                return record
            finally:
                if stage.exists():
                    shutil.rmtree(stage)
