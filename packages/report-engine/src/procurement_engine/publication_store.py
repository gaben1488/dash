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
import stat
import tempfile
from collections.abc import Callable
from contextlib import closing, contextmanager, nullcontext
from datetime import datetime, timezone
from pathlib import Path

from .projections import project_dashboard
from .snapshot_bundle_io import verify_persisted_bundle


def _revisions_equivalent(stage, expected, observed, proofs):
    """Validate reread proof against the immutable manifest, never substitute tokens."""
    if not isinstance(observed, dict) or set(observed) != set(expected):
        return False
    changed = {key for key in expected if expected[key] != observed[key]}
    if not changed:
        return not proofs
    if set(proofs) != changed:
        return False
    from .google_adapter import source_semantic_metadata
    from .snapshot import canonical_semantic_hash
    manifest = _json(stage / 'snapshot_bundle/manifest.json')
    sources = {source['source_id']: source for source in manifest['sources']}
    contract_entries = [item for item in manifest.get('payload_index', []) if item['source_id'] == 'SOURCE_CONTRACT']
    if len(contract_entries) != 1:
        return False
    frozen_contract = _json(stage / 'snapshot_bundle' / contract_entries[0]['path'])['semantic_values']
    registered = {item['source_id']: item for item in frozen_contract['sources']}
    for key in changed:
        source, proof = sources.get(key, {}), proofs.get(key, {})
        contract = registered.get(key)
        if not contract or any(source.get(field) != contract.get(field)
                               for field in ('provider_id', 'role', 'schema_fingerprint')):
            return False
        if str(source.get('sheet_or_tab_id')) != str(contract.get('sheet_id')):
            return False
        try:
            metadata_hash = canonical_semantic_hash(source_semantic_metadata(source['payload_metadata']))
            if not (proof['provider_id'] == source['provider_id']
                    and proof['sheet_id'] == str(source['sheet_or_tab_id'])
                    and proof['captured_revision'] == expected[key]
                    and proof['observed_revision_before'] == proof['observed_revision_after'] == observed[key]
                    and observed[key]
                    and proof['captured_values_hash'] == proof['observed_values_hash'] == source['canonical_semantic_hash']
                    and proof['captured_metadata_hash'] == proof['observed_metadata_hash'] == metadata_hash
                    and proof['captured_content_hash'] == source['content_hash']
                    and proof['schema_fingerprint'] == source['schema_fingerprint']):
                return False
        except (KeyError, TypeError, ValueError):
            return False
    return True

class PublicationError(ValueError):
    pass


def _assurance_hash(value):
    digest = hashlib.sha256()
    for chunk in json.JSONEncoder(ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).iterencode(value):
        digest.update(chunk.encode())
    return digest.hexdigest()


def _document_artifacts(model):
    """Older verified releases are immutable two-Word publications."""
    items = [('main_report.docx', 'main'), ('management_report.docx', 'management')]
    if (model.get('contract') or {}).get('operational_document_contract') == 'operational-report-v1':
        items.append(('operational_report.docx', 'operational'))
    return items



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


def _validate_retirement_entry(entry):
    if (not isinstance(entry, dict)
            or not isinstance(entry.get('release_id'), str)
            or not re.fullmatch(r'REL-[a-f0-9]{64}', entry['release_id'])
            or any(not isinstance(entry.get(key), list) or len(entry[key]) != 2
                   or not all(isinstance(value, str) for value in entry[key]) for key in ('original', 'compact'))):
        raise PublicationError('PUBLICATION_RETENTION_JOURNAL_INVALID')
    for key in ('original', 'compact'):
        record, files = map(json.loads, entry[key])
        if not isinstance(record, dict) or record.get('release_id') != entry['release_id'] or not isinstance(files, dict):
            raise PublicationError('PUBLICATION_RETENTION_JOURNAL_INVALID')


class _RetirementEntries:
    """Repeatable recovery records, bounded to one receipt pair instead of all pairs."""
    def __init__(self, work, journal):
        self.path = work / 'entries.sqlite'
        self.count = journal.get('entry_count')
        if (type(self.count) is not int or self.count <= 0 or self.path.is_symlink()
                or not self.path.is_file() or self.path.stat().st_nlink != 1
                or any(os.path.lexists(str(self.path) + suffix) for suffix in ('-wal', '-shm', '-journal'))
                or _hash(self.path) != journal.get('entries_sha256')):
            raise PublicationError('PUBLICATION_RETENTION_JOURNAL_INVALID')
        with closing(self._connect()) as db:
            counts = db.execute('SELECT count(*),count(distinct release_id) FROM entries').fetchone()
            if counts != (self.count, self.count) or db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise PublicationError('PUBLICATION_RETENTION_JOURNAL_INVALID')
        for _ in self:
            pass  # Validate every pair before any rename/update, without retaining payloads.

    def _connect(self):
        db = sqlite3.connect(self.path.absolute().as_uri() + '?mode=ro', uri=True)
        db.execute('PRAGMA query_only=ON')
        return db

    def __len__(self):
        return self.count

    def __iter__(self):
        with closing(self._connect()) as db:
            for rid, payload in db.execute('SELECT release_id,payload FROM entries ORDER BY ordinal'):
                entry = json.loads(payload)
                _validate_retirement_entry(entry)
                if entry['release_id'] != rid:
                    raise PublicationError('PUBLICATION_RETENTION_JOURNAL_INVALID')
                yield entry


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
    for name, view in _document_artifacts(model):
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
        capture = {'report_date': snapshot['report_date'], 'report_year': snapshot['report_year'], 'sources': []}
        for key in ('report_scope', 'archive_origin'):
            if key in snapshot:
                capture[key] = snapshot[key]
        for payload in payloads:
            if payload['role'] == 'archived_file_evidence':
                capture['archived_file_evidence'] = payload['semantic_values']
            if payload['role'] == 'historical_report_evidence':
                capture['recommendation_history_evidence'] = payload['semantic_values']
            if payload['role'] == 'weekly_baseline':
                capture['weekly_baseline'] = payload['semantic_values']
            meta = payload.get('metadata') or {}
            if 'sheet_title' not in meta:
                continue
            capture['sources'].append({'source_id': payload['source_id'], 'role': payload['role'],
                'provider_id': payload['provider_id'], 'sheet': meta['sheet_title'],
                'sheet_id': int(payload['sheet_or_tab_id']), 'grbs': meta.get('grbs'),
                'rows': meta['row_count'], 'columns': meta['column_count'], 'header_rows': meta.get('header_rows', 3),
                'values': payload['semantic_values'], 'formula_evidence': meta.get('formula_evidence'),
                **{key: meta[key] for key in ('capture_method', 'archive_file_sha256') if key in meta}})
        from .recommendation_links import primary_budget_years

        if len(ledgers) != 1 or validate_recorded_state_model(model, ledger=ledgers[0], documents=documents,
                budget_years=primary_budget_years(capture['sources'])):
            raise PublicationError('DOMAIN_RELEASE_CONTRACT_FAILED')
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
            for name, view in _document_artifacts(model):
                validate_document_content(root / name, plans[view])
        except ValueError as exc:
            raise PublicationError(str(exc)) from exc
    return model, model_hash, report_date, cutoff.astimezone(timezone.utc).isoformat(), expected


def initialize_publication_readers(state_dir):
    """Explicit pre-listen rollout/writer bootstrap, never called by GET.

    Old runtime/readers must be stopped before rollout; this does not retrofit
    leases into old code. Repeated bootstrap opens the same empty owned inode.
    """
    state = Path(state_dir)
    if state.is_symlink() or (state / 'published').is_symlink():
        raise PublicationError('PUBLICATION_RETENTION_UNSAFE')
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    if any(path.exists() and path.stat().st_uid != os.geteuid()
           for path in (state, state / 'published')):
        raise PublicationError('PUBLICATION_DATA_OWNER_MISMATCH')
    path = state / 'publication-readers.lock'
    created = False
    try:
        try:
            descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            created = True
        except FileExistsError:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'rb') as lease:
            info, visible = os.fstat(lease.fileno()), path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                    or info.st_size != 0 or info.st_nlink != 1
                    or (info.st_dev, info.st_ino) != (visible.st_dev, visible.st_ino)):
                raise PublicationError('PUBLICATION_RETENTION_UNSAFE')
            if created:
                os.fsync(lease.fileno())
                _sync_directory(state)
    except OSError as error:
        raise PublicationError('PUBLICATION_READER_BOOTSTRAP_FAILED') from error


def _ordered_publication_rows(db, where='', parameters=(), *, cutoff_only=False):
    """Sort small immutable IDs, then fetch payloads without spilling receipt JSON.

    Predicates are module-owned SQL; caller values stay bound. Read-only legacy
    catalogs need no index migration. Retention also reuses this ordered view.
    """
    order = 'cutoff_at DESC, release_id DESC' if cutoff_only else 'report_date DESC, cutoff_at DESC, release_id DESC'
    for (release_id,) in db.execute(f'SELECT release_id FROM publications {where} ORDER BY {order}',parameters):
        yield db.execute('SELECT release_id,report_date,cutoff_at,receipt,files FROM publications WHERE release_id=?',
                         (release_id,)).fetchone()


def _leased_read(method):
    from functools import wraps

    @wraps(method)
    def leased(self, *args, **kwargs):
        with self.reader_lease():
            return method(self, *args, **kwargs)
    return leased


class PublicationStore:
    def __init__(self, root: str | Path, *, readonly=False):
        if Path(root).is_symlink():
            raise ValueError('PUBLICATION_RETENTION_ROOT_UNSAFE')
        self.root = Path(root).resolve()
        self.releases = self.root / 'releases'
        self.database_path = self.root / 'publications.sqlite'
        if readonly:
            return
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.releases.mkdir(exist_ok=True, mode=0o700)
        initialize_publication_readers(self.root.parent)
        with closing(sqlite3.connect(self.database_path, timeout=30)) as db, db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('''CREATE TABLE IF NOT EXISTS publications (
                release_id TEXT PRIMARY KEY, report_date TEXT NOT NULL,
                cutoff_at TEXT NOT NULL, receipt TEXT NOT NULL, files TEXT NOT NULL
            )''')
            db.execute('''CREATE TABLE IF NOT EXISTS publication_contexts (
                release_id TEXT PRIMARY KEY, report_date TEXT NOT NULL, cutoff_at TEXT NOT NULL,
                report_year INTEGER NOT NULL, quarter INTEGER NOT NULL
            )''')
            db.execute('''CREATE INDEX IF NOT EXISTS idx_publication_context_period
                ON publication_contexts(report_year, quarter, report_date DESC, cutoff_at DESC, release_id DESC)''')
            db.execute('''CREATE INDEX IF NOT EXISTS idx_publication_catalog_date
                ON publications(report_date DESC, cutoff_at DESC, release_id DESC)''')

    def _checked(self, row, *, expected_release_id=None):
        if row is None:
            return None
        receipt, files = row
        record = json.loads(receipt)
        if expected_release_id is not None and (not isinstance(record, dict) or record.get('release_id') != expected_release_id):
            raise PublicationError('ATTEMPT_PROOF_INVALID')
        root = self.releases / record['release_id']
        if not root.is_dir() or root.is_symlink() or _files(root) != json.loads(files):
            raise PublicationError('PUBLISHED_BUNDLE_CORRUPT')
        return record

    def read_attempt(self, attempt_id):
        """Complete original observation; metadata scans deliberately do not hydrate."""
        existing_publication_state = (os.path.lexists(self.database_path)
                                      or os.path.lexists(self.root.parent / 'publication-readers.lock'))
        with self.reader_lease() if existing_publication_state else nullcontext():
            return self._read_attempt(attempt_id)

    def _read_attempt(self, attempt_id):
        if not isinstance(attempt_id, str) or not re.fullmatch(r'[a-f0-9]{32}', attempt_id):
            raise PublicationError('ATTEMPT_PROOF_INVALID')
        directory = self.root.parent / 'attempts'
        path = directory / attempt_id / 'status.json'
        if any(item.is_symlink() for item in (directory, path.parent, path)):
            raise PublicationError('ATTEMPT_PROOF_INVALID')
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'r', encoding='utf-8') as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise PublicationError('ATTEMPT_PROOF_INVALID')
                status = json.load(stream)
        except (OSError, ValueError) as error:
            raise PublicationError('ATTEMPT_PROOF_INVALID') from error
        if not isinstance(status, dict) or status.get('attempt_id') != attempt_id:
            raise PublicationError('ATTEMPT_PROOF_INVALID')
        publication = status.get('publication')
        if not isinstance(publication, dict) or 'automation_assurance_ref' not in publication:
            return status  # Historical inline bytes and their interpretation stay unchanged.
        reference = publication['automation_assurance_ref']
        if (not isinstance(reference, dict) or set(reference) != {'release_id', 'content_sha256'}
                or not isinstance(reference.get('content_sha256'), str)
                or not re.fullmatch(r'[a-f0-9]{64}', reference['content_sha256'])
                or not isinstance(reference.get('release_id'), str)
                or not re.fullmatch(r'REL-[a-f0-9]{64}', reference['release_id'])
                or reference['release_id'] != publication.get('release_id')
                or publication.get('model_sha256') != reference['release_id'][4:]
                or 'automation_assurance' in status
                or 'automation_assurance' in publication or status.get('reused_publication') is not True
                or status.get('status') not in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}
                or publication.get('status') != status['status']
                or not status.get('snapshot_id') or status['snapshot_id'] != publication.get('snapshot_id')):
            raise PublicationError('ATTEMPT_PROOF_INVALID')
        try:
            with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
                row = db.execute('SELECT receipt, files FROM publications WHERE release_id=?', (reference['release_id'],)).fetchone()
                record = self._checked(row, expected_release_id=reference['release_id'])
            if (record is None or any(record.get(key) != publication.get(key)
                                      for key in ('release_id', 'snapshot_id', 'model_sha256'))
                    or not isinstance(record.get('automation_assurance'), dict)
                    or _assurance_hash(record['automation_assurance']) != reference['content_sha256']):
                raise PublicationError('ATTEMPT_PROOF_INVALID')
        except PublicationError:
            raise
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            raise PublicationError('ATTEMPT_PROOF_INVALID') from error
        restored = {key: value for key, value in publication.items() if key != 'automation_assurance_ref'}
        return {**status, 'publication': {**restored, 'automation_assurance': record['automation_assurance']}}

    def _first_live(self, rows):
        """Archive recomputation never replaces the live worker's baseline.

        History/context selectors still expose archives explicitly. Presence of
        archive_origin (including an invalid null) is not a live publication.
        """
        for row in rows:
            payload = row[-2:]
            receipt = json.loads(payload[0])
            if 'archive_origin' not in receipt and receipt.get('replay_available') is not False:
                return self._checked(payload)
        return None

    @_leased_read
    def receipt(self, release_id):
        """Exact committed receipt; missing IDs never fall through to latest."""
        if not re.fullmatch(r'REL-[a-f0-9]{64}', release_id or ''):
            raise PublicationError('PUBLICATION_ID_INVALID')
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            row = db.execute('SELECT receipt, files FROM publications WHERE release_id=?', (release_id,)).fetchone()
            receipt = self._checked(row, expected_release_id=release_id)
            if receipt is None:
                raise PublicationError('PUBLICATION_NOT_FOUND')
            year, quarter = self._context(db, receipt)
            return {**receipt, 'report_year': year, 'quarter': quarter}

    @_leased_read
    def latest(self):
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            return self._first_live(_ordered_publication_rows(db))

    @_leased_read
    def history(self):
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            return [json.loads(row[-2]) for row in _ordered_publication_rows(db)]

    @_leased_read
    def history_summaries(self, *, limit=50, before=None):
        """Bounded metadata only; old rows remain visible with an unknown period."""
        if type(limit) is not int or not 1 <= limit <= 500:
            raise PublicationError('PUBLICATION_CONTEXT_INVALID')
        if before is not None and not re.fullmatch(r'REL-[a-f0-9]{64}', before):
            raise PublicationError('PUBLICATION_ID_INVALID')
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            has_context = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publication_contexts'").fetchone()
            join = 'LEFT JOIN publication_contexts c ON c.release_id=p.release_id' if has_context else ''
            period = 'c.report_year,c.quarter' if has_context else 'NULL,NULL'
            where, parameters = '', []
            if before is not None:
                anchor = db.execute('SELECT report_date,cutoff_at,release_id FROM publications WHERE release_id=?', (before,)).fetchone()
                if anchor is None:
                    raise PublicationError('PUBLICATION_NOT_FOUND')
                where = 'WHERE (p.report_date,p.cutoff_at,p.release_id) < (?,?,?)'
                parameters.extend(anchor)
            rows = db.execute(f'SELECT p.release_id,p.report_date,p.cutoff_at,{period} FROM publications p {join} {where} '
                              'ORDER BY p.report_date DESC,p.cutoff_at DESC,p.release_id DESC LIMIT ?', (*parameters,limit))
            return [dict(zip(('release_id','report_date','cutoff_at','report_year','quarter'), row, strict=True)) for row in rows]

    def _period_filter(self, db, year, quarter):
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publication_contexts'").fetchone():
            return '', ()
        # Filter small indexed IDs before fetching any large receipt/evidence JSON.
        return ((" AND (release_id NOT IN (SELECT release_id FROM publication_contexts) OR release_id IN "
                 "(SELECT release_id FROM publication_contexts WHERE report_year=? AND quarter=?))"), (year,quarter))

    def _context(self, db, receipt):
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publication_contexts'").fetchone():
            result = db.execute('SELECT report_year,quarter FROM publication_contexts WHERE release_id=?', (receipt['release_id'],)).fetchone()
            if result is not None:
                return tuple(result)
        if receipt.get('replay_available') is False:
            return receipt.get('report_year'), receipt.get('quarter')
        model = _json(self.releases / receipt['release_id'] / 'report_model.json')
        return (model.get('snapshot') or {}).get('report_year'), (model.get('headline') or {}).get('current_quarter')

    @_leased_read
    def select(self, report_date, report_year, quarter):
        """Exact context only; a nearby date is not an historical release."""
        return self._select(report_date, report_year, quarter, self._checked)

    def _select(self, report_date, report_year, quarter, checked, contexts=None):
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            period_filter, values = self._period_filter(db, report_year, quarter)
            rows = _ordered_publication_rows(db,'WHERE report_date = ?'+period_filter, (report_date,*values),cutoff_only=True)
            for row in rows:
                receipt = json.loads(row[-2])
                cache = contexts if contexts is not None else {}
                if receipt['release_id'] not in cache:
                    cache[receipt['release_id']] = self._context(db, receipt)
                year, selected_quarter = cache[receipt['release_id']]
                if year == report_year and selected_quarter == quarter:
                    receipt = checked(row[-2:])
                    return {**receipt, 'report_year': year, 'quarter': selected_quarter}
        return None

    @_leased_read
    def latest_for_period(self, report_date, report_year, quarter):
        """Last intact LIVE Word publication for the exact year and quarter.

        This is a fallback for the live dashboard only, not an archival
        selector. A release dated after the requested day or reconstructed
        from an archive is never silently substituted. Match the sealed
        report model, not the receipt date's calendar quarter.
        """
        return self._latest_for_period(report_date, report_year, quarter, self._checked)

    def _latest_for_period(self, report_date, report_year, quarter, checked, contexts=None):
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            period_filter, values = self._period_filter(db, report_year, quarter)
            rows = _ordered_publication_rows(db,'WHERE report_date <= ?'+period_filter, (report_date,*values))
            for row in rows:
                receipt = json.loads(row[-2])
                if 'archive_origin' in receipt:
                    continue
                cache = contexts if contexts is not None else {}
                if receipt['release_id'] not in cache:
                    cache[receipt['release_id']] = self._context(db, receipt)
                year, selected_quarter = cache[receipt['release_id']]
                if year != report_year or selected_quarter != quarter:
                    continue
                verified = checked(row[-2:])
                return {**verified, 'report_year': year, 'quarter': selected_quarter}
        return None

    @_leased_read
    def select_status(self, report_date, report_year, quarter):
        """Keep both selectors, reusing one unchanged bundle proof in this read only."""
        last_payload = last_receipt = None

        def checked(payload):
            nonlocal last_payload, last_receipt
            if payload != last_payload:
                receipt = self._checked(payload)
                last_payload, last_receipt = payload, receipt
            return last_receipt

        contexts = {}
        return {'selected': self._select(report_date, report_year, quarter, checked, contexts),
                'latest_matching': self._latest_for_period(report_date, report_year, quarter, checked, contexts)}

    @_leased_read
    def previous_model(self, report_date):
        day = datetime.strptime(report_date, '%d.%m.%Y').date().isoformat()  # noqa: DTZ007 — civil date.
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            rows = _ordered_publication_rows(db,'WHERE report_date < ?', (day,))
            receipt = self._first_live(rows)
            if receipt is None:
                return None
            return {'receipt': receipt, 'model': _json(self.releases / receipt['release_id'] / 'report_model.json')}

    @_leased_read
    def previous_weekly_model(self, report_date):
        """Latest verified Thursday/Friday publication of the *preceding* week.

        Ordinary daily reports are never silently used as the weekly baseline.
        """
        from .weekly_evidence import previous_week_window

        start, end = previous_week_window(report_date)
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            rows = _ordered_publication_rows(db,'WHERE report_date BETWEEN ? AND ?', (start,end))
            receipt = self._first_live(rows)
            if receipt is None:
                return None
            if receipt.get('status') not in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}:
                return None
            return {'receipt': receipt,
                    'model': _json(self.releases / receipt['release_id'] / 'report_model.json')}

    @_leased_read
    def read_artifact(self, release_id, name):
        if not re.fullmatch(r'REL-[a-f0-9]{64}', release_id or ''):
            raise PublicationError('PUBLICATION_ID_INVALID')
        if name not in {'dashboard.json', 'main_report.docx', 'management_report.docx', 'operational_report.docx'}:
            raise PublicationError('PUBLICATION_VIEW_INVALID')
        with closing(sqlite3.connect(self.database_path.as_uri() + '?mode=ro', uri=True)) as db:
            row = db.execute('SELECT receipt, files FROM publications WHERE release_id=?', (release_id,)).fetchone()
            if self._checked(row) is None:
                raise PublicationError('PUBLICATION_NOT_FOUND')
            if name not in json.loads(row[1]):
                raise PublicationError('PUBLICATION_VIEW_NOT_AVAILABLE')
            data = (self.releases / release_id / name).read_bytes()
            if hashlib.sha256(data).hexdigest() != json.loads(row[1]).get(name):
                raise PublicationError('PUBLISHED_BUNDLE_CORRUPT')
            return data

    def publish(self, candidate: str | Path, *, read_revisions: Callable[[], dict], source_equivalence=None):
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
                        record = self._checked(previous)
                        if record.get('replay_available') is False:
                            raise PublicationError('PUBLICATION_REPLAY_COMPACTED')
                        return record
                    if (model.get('contract', {}).get('document_content_contract') == 'document-plan-v1'
                            and not model['snapshot'].get('archive_origin')):
                        from .semantic_headers import assert_header_continuity
                        prior_rows = _ordered_publication_rows(db,'WHERE cutoff_at <= ?', (cutoff,),cutoff_only=True)
                        prior = self._first_live(prior_rows)
                        if prior is not None:
                            try:
                                assert_header_continuity(self.releases / prior['release_id'], stage)
                            except ValueError as exc:
                                raise PublicationError(str(exc)) from exc
                    observed = read_revisions()
                    proof = source_equivalence or {}
                    if not observed or not _revisions_equivalent(stage, expected, observed, proof):
                        error = PublicationError('SOURCE_CHANGED_BEFORE_PUBLICATION')
                        # Runtime stores evidence only in private error.json.
                        # Provider identities/revision tokens must never enter
                        # the public error string, status or logs.
                        actual = observed if isinstance(observed, dict) else {}
                        error.evidence = {
                            'expected_revisions': expected,
                            'observed_revisions': observed,
                            'changed': {key: {'expected': expected[key], 'observed': actual[key]}
                                        for key in sorted(expected.keys() & actual.keys())
                                        if expected[key] != actual[key]},
                            'missing_keys': sorted(expected.keys() - actual.keys()),
                            'added_keys': sorted(actual.keys() - expected.keys()),
                        }
                        raise error
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
                              'operational_available': 'operational' in (model.get('document_plans') or {}),
                              'source_revisions_at_publish': observed,
                              'status': 'VERIFIED_WITH_WARNINGS' if model.get('issues') or (model.get('automation_assurance') or {}).get('actions') else 'VERIFIED'}
                    if proof:
                        record['source_equivalence_at_publish'] = proof
                    if model['snapshot'].get('archive_origin'):
                        record['archive_origin'] = model['snapshot']['archive_origin']
                        record['source_verification'] = 'FROZEN_ARCHIVE_HASHES'
                        record['source_revisions_at_capture'] = record.pop('source_revisions_at_publish')
                    if model.get('automation_assurance') is not None:
                        record['automation_assurance'] = model['automation_assurance']
                    if model.get('weekly_evidence') is not None:
                        from .weekly_evidence import public_weekly_summary

                        record['weekly_summary'] = public_weekly_summary(model['weekly_evidence'])
                    db.execute('INSERT INTO publications VALUES (?, ?, ?, ?, ?)',
                        (release_id, report_date, cutoff, json.dumps(record, ensure_ascii=False), json.dumps(files)))
                    db.execute('INSERT INTO publication_contexts VALUES (?, ?, ?, ?, ?)',
                        (release_id, report_date, cutoff, model['snapshot']['report_year'], model['headline']['current_quarter']))
                _sync_directory(self.root)
                return record
            finally:
                if stage.exists():
                    shutil.rmtree(stage)

    @contextmanager
    def reader_lease(self, *, create=False):
        """Read-only shared lease. Maintenance drains it before renaming roots."""
        path = self.root.parent / 'publication-readers.lock'
        if create:
            initialize_publication_readers(self.root.parent)
        if path.is_symlink() or not path.is_file():
            raise PublicationError('PUBLICATION_READER_LEASE_UNINITIALIZED')
        with path.open('r') as lease:
            try:
                fcntl.flock(lease, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise PublicationError('PUBLICATION_MAINTENANCE_ACTIVE') from error
            work = self.root / '.retirement'
            if (work.exists() or work.is_symlink()) and (work.is_symlink() or not (work / 'journal.json').is_file()
                        or (work / 'journal.json').is_symlink()
                        or _json(work / 'journal.json').get('readers_ready') is not True):
                raise PublicationError('PUBLICATION_RETENTION_RECOVERY_REQUIRED')
            yield

    def plan_compaction(self, *, protected_release_ids=()):
        from .retention import plan_publication_compaction
        return plan_publication_compaction(self, protected_release_ids=protected_release_ids)

    def _maintenance_locks(self, preflight=None):
        """Same lock order as runtime: acquisition, then publication.

        Dedicated EX reader lease drains native report/archive consumers.
        Filesystem renames and SQLite cannot commit atomically; explicit recovery
        must run before readers restart after process death. GET never repairs.
        """
        from contextlib import ExitStack
        stack = ExitStack()
        try:
            for path in (self.root.parent / 'run.lock', self.root.parent / 'publication-readers.lock', self.root / 'publication.lock'):
                if path.is_symlink():
                    raise PublicationError('PUBLICATION_RETENTION_UNSAFE')
                lock = stack.enter_context(path.open('a'))
                fcntl.flock(lock, fcntl.LOCK_EX)
            if preflight is not None:
                preflight(self)
            return stack
        except BaseException:
            stack.close()
            raise

    def compact_publications(self, *, expected_revision, preflight=None, protected_release_ids=(), plan_preflight=None):
        """Prepare reversible compact artifacts; never delete quarantine here."""
        from .runtime import _write
        with self._maintenance_locks(preflight):
            work = self.root / '.retirement'
            if work.exists() or work.is_symlink():
                raise PublicationError('PUBLICATION_RETENTION_RECOVERY_REQUIRED')
            plan = self.plan_compaction(protected_release_ids=protected_release_ids)
            if plan['catalog_revision'] != expected_revision:
                raise PublicationError('PUBLICATION_RETENTION_PLAN_CHANGED')
            if not plan['identity_ready']:
                raise PublicationError('PUBLICATION_RETENTION_IDENTITY_MISSING')
            if plan_preflight is not None:
                plan_preflight(self, plan)  # Same locked source proof, not another full scan.
            selected = set(plan['retire_release_ids'])
            if not selected:
                return {'status': 'UNCHANGED', 'compacted': 0}
            work.mkdir(mode=0o700)
            _sync_directory(self.root)
            records = sqlite3.connect(work / 'entries.sqlite')
            count = 0
            try:
                records.execute('PRAGMA synchronous=FULL')
                records.execute('CREATE TABLE entries(ordinal INTEGER PRIMARY KEY,release_id TEXT UNIQUE NOT NULL,payload TEXT NOT NULL)')
                for rid, day, cutoff, receipt, files in plan['records']:
                    if rid not in selected:
                        continue
                    root = self.releases / rid
                    dashboard = _json(root / 'dashboard.json')
                    compact = work / 'staged' / rid
                    compact.mkdir(parents=True, mode=0o700)
                    for name in ('dashboard.json', 'main_report.docx', 'management_report.docx', 'operational_report.docx'):
                        if (root / name).is_file():
                            os.link(root / name, compact / name, follow_symlinks=False)
                            with (compact / name).open('rb') as file:
                                os.fsync(file.fileno())
                    # Preserve exact minimal decision/ledger proofs, not a fake
                    # partially valid snapshot_bundle. Replay is explicitly off.
                    evidence = compact / 'retained_evidence'
                    manifest = _json(root / 'snapshot_bundle/manifest.json')
                    roles = {source['source_id']: source.get('role') for source in manifest.get('sources', [])}
                    for item in manifest.get('payload_index', []):
                        relative = Path(item['path'])
                        if relative.is_absolute() or '..' in relative.parts:
                            raise PublicationError('PUBLICATION_RETENTION_UNSAFE')
                        if roles.get(item['source_id']) in {'historical_ledger', 'historical_report_evidence', 'identity_reviews', 'rule_contract'}:
                            target = evidence / relative
                            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                            os.link(root / 'snapshot_bundle' / relative, target, follow_symlinks=False)
                    if evidence.exists():
                        os.link(root / 'snapshot_bundle/manifest.json', evidence / 'source_manifest.json', follow_symlinks=False)
                    if (root / 'identity.sqlite').is_file():
                        os.link(root / 'identity.sqlite', compact / 'identity.sqlite', follow_symlinks=False)
                    for item in compact.rglob('*'):
                        if item.is_file():
                            with item.open('rb') as file:
                                os.fsync(file.fileno())
                    for directory in sorted((p for p in compact.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
                        _sync_directory(directory)
                    reduced = _files(compact)
                    original = json.loads(files)
                    if any(original.get(k.replace('retained_evidence/source_manifest.json', 'snapshot_bundle/manifest.json').replace('retained_evidence/', 'snapshot_bundle/')) != v for k, v in reduced.items()):
                        raise PublicationError('PUBLICATION_RETENTION_ARTIFACT_CHANGED')
                    record = json.loads(receipt)
                    record.update(replay_available=False,
                                  report_year=manifest['report_year'],
                                  quarter=dashboard['headline']['current_quarter'])
                    entry = {'release_id': rid, 'original': [receipt, files],
                             'compact': [json.dumps(record, ensure_ascii=False), json.dumps(reduced)]}
                    records.execute('INSERT INTO entries VALUES (?,?,?)', (count, rid, json.dumps(entry)))
                    count += 1
                    _sync_directory(compact)
                records.commit()
                records.close()
                with (work / 'entries.sqlite').open('rb') as file:
                    os.fsync(file.fileno())
                _sync_directory(work / 'staged')
                _write(work / 'journal.json', {'contract': 'publication-compaction-v2', 'entry_count': count,
                       'entries_sha256': _hash(work / 'entries.sqlite'), 'plan_revision': expected_revision})
            except BaseException:
                records.close()
                shutil.rmtree(work)
                raise
            del plan  # Large catalog rows are no longer needed during commit/recovery.
            _, entries = self._retirement_entries()
            (work / 'original').mkdir(mode=0o700)
            _sync_directory(work)
            # Once journal exists, all failure paths are recoverable; never clean
            # it in a finally block and never guess whether a DB commit occurred.
            for entry in entries:
                rid = entry['release_id']
                os.rename(self.releases / rid, work / 'original' / rid)
                _sync_directory(self.releases)
                _sync_directory(work / 'original')
                os.rename(work / 'staged' / rid, self.releases / rid)
                _sync_directory(work / 'staged')
                _sync_directory(self.releases)
            with closing(sqlite3.connect(self.database_path, timeout=30)) as db, db:
                db.execute('PRAGMA synchronous=FULL')
                db.execute('BEGIN IMMEDIATE')
                for entry in entries:
                    db.execute('UPDATE publications SET receipt=?,files=? WHERE release_id=? AND receipt=? AND files=?',
                               (*entry['compact'], entry['release_id'], *entry['original']))
                    if db.execute('SELECT changes()').fetchone()[0] != 1:
                        raise PublicationError('PUBLICATION_RETENTION_CATALOG_CHANGED')
            _write(work / 'journal.json', {**_json(work / 'journal.json'), 'readers_ready': True})
            return {'status': 'COMPACTED', 'compacted': len(entries), 'quarantine_retained': True}

    def _retirement_entries(self):
        work = self.root / '.retirement'
        if work.is_symlink() or (work / 'journal.json').is_symlink():
            raise PublicationError('PUBLICATION_RETENTION_UNSAFE')
        if any((work / name).is_symlink() for name in ('original', 'staged')):
            raise PublicationError('PUBLICATION_RETENTION_UNSAFE')
        journal = _json(work / 'journal.json')
        if journal.get('contract') == 'publication-compaction-v2':
            return work, _RetirementEntries(work, journal)
        if journal.get('contract') != 'publication-compaction-v1' or not isinstance(journal.get('entries'), list):
            raise PublicationError('PUBLICATION_RETENTION_JOURNAL_INVALID')
        entries = journal['entries']
        if not entries:
            raise PublicationError('PUBLICATION_RETENTION_JOURNAL_INVALID')
        for entry in entries:
            _validate_retirement_entry(entry)
        ids = [e.get('release_id') for e in entries]
        if len(set(ids)) != len(ids) or any(not isinstance(r, str) or not re.fullmatch(r'REL-[a-f0-9]{64}', r) for r in ids):
            raise PublicationError('PUBLICATION_RETENTION_JOURNAL_INVALID')
        return work, entries

    def recover_compaction(self, *, preflight=None):
        """Catalog is the commit marker. Partial/mismatched commits fail closed."""
        with self._maintenance_locks(preflight):
            if not (self.root / '.retirement').exists() and not (self.root / '.retirement').is_symlink():
                return {'status': 'UNCHANGED'}
            work = self.root / '.retirement'
            if not (work / 'journal.json').exists():
                # No originals directory/move is ever created before a durable
                # journal. A killed preparation can therefore discard only known
                # staging copies, after every catalog source is checksum proven.
                if (work.is_symlink() or not work.is_dir()
                        or any(p.name not in {'staged', 'entries.sqlite', 'entries.sqlite-journal'}
                               and not re.fullmatch(r'journal\.json\.[a-f0-9]{32}\.tmp', p.name) for p in work.iterdir())
                        or any(p.is_symlink() or not p.is_file() or p.stat().st_nlink != 1 or p.stat().st_uid != work.stat().st_uid
                               for p in work.iterdir() if p.name != 'staged')):
                    raise PublicationError('PUBLICATION_RETENTION_PREPARE_UNSAFE')
                records = {r[0]: json.loads(r[4]) for r in self.plan_compaction()['records']}
                staged = work / 'staged'
                if staged.exists() or staged.is_symlink():
                    if staged.is_symlink() or not staged.is_dir():
                        raise PublicationError('PUBLICATION_RETENTION_PREPARE_UNSAFE')
                    for root in staged.iterdir():
                        if root.is_symlink() or not root.is_dir() or root.name not in records:
                            raise PublicationError('PUBLICATION_RETENTION_PREPARE_UNSAFE')
                        for item in root.rglob('*'):
                            if item.is_dir() and not item.is_symlink():
                                name = str(item.relative_to(root)).replace('retained_evidence/', 'snapshot_bundle/')
                                if name == 'retained_evidence':
                                    name = 'snapshot_bundle'
                                if not any(path.startswith(name + '/') for path in records[root.name]):
                                    raise PublicationError('PUBLICATION_RETENTION_PREPARE_UNSAFE')
                        for name in _files(root):
                            original = name.replace('retained_evidence/source_manifest.json', 'snapshot_bundle/manifest.json').replace('retained_evidence/', 'snapshot_bundle/')
                            if name not in {'dashboard.json', 'main_report.docx', 'management_report.docx', 'operational_report.docx', 'identity.sqlite'} and not name.startswith('retained_evidence/'):
                                raise PublicationError('PUBLICATION_RETENTION_PREPARE_UNSAFE')
                            if original not in records[root.name]:
                                raise PublicationError('PUBLICATION_RETENTION_PREPARE_UNSAFE')
                shutil.rmtree(work)
                _sync_directory(self.root)
                return {'status': 'PREPARE_DISCARDED'}
            work, entries = self._retirement_entries()
            with closing(sqlite3.connect(self.database_path)) as db:
                states = set()
                for entry in entries:
                    row = list(db.execute('SELECT receipt,files FROM publications WHERE release_id=?', (entry['release_id'],)).fetchone() or ())
                    if row == entry['compact']:
                        states.add('compact')
                    elif row == entry['original']:
                        states.add('original')
                    else:
                        raise PublicationError('PUBLICATION_RETENTION_CATALOG_CHANGED')
            journal = _json(work / 'journal.json')
            if journal.get('rollback_requested'):
                return self._rollback_compaction(work, entries)
            if journal.get('finalizing'):
                return {'status': 'FINALIZING'}
            if states == {'compact'}:
                for entry in entries:
                    self._checked(entry['compact'])
                    if _files(work / 'original' / entry['release_id']) != json.loads(entry['original'][1]):
                        raise PublicationError('PUBLICATION_RETENTION_QUARANTINE_CORRUPT')
                from .runtime import _write
                _write(work / 'journal.json', {**_json(work / 'journal.json'), 'readers_ready': True})
                return {'status': 'COMMITTED', 'quarantine_retained': True}
            if states != {'original'}:
                raise PublicationError('PUBLICATION_RETENTION_CATALOG_CHANGED')
            return self._rollback_compaction(work, entries)

    def _rollback_compaction(self, work, entries):
        from .runtime import _write
        journal = _json(work / 'journal.json')
        if journal.get('finalizing'):
            raise PublicationError('PUBLICATION_RETENTION_ROLLBACK_EXPIRED')
        # Preflight every source before changing any file; never overwrite a
        # republished or externally changed release with old quarantine data.
        for entry in entries:
            rid = entry['release_id']
            original, root = work / 'original' / rid, self.releases / rid
            if original.exists():
                if original.is_symlink() or _files(original) != json.loads(entry['original'][1]):
                    raise PublicationError('PUBLICATION_RETENTION_QUARANTINE_CORRUPT')
                if root.exists() and (root.is_symlink() or _files(root) != json.loads(entry['compact'][1])):
                    raise PublicationError('PUBLICATION_RETENTION_RELEASE_CHANGED')
            elif root.is_symlink() or not root.is_dir() or _files(root) != json.loads(entry['original'][1]):
                raise PublicationError('PUBLICATION_RETENTION_QUARANTINE_MISSING')
        journal['rollback_requested'] = True
        journal['readers_ready'] = False
        _write(work / 'journal.json', journal)
        for entry in entries:
            original, root = work / 'original' / entry['release_id'], self.releases / entry['release_id']
            if original.exists():
                if root.exists():
                    shutil.rmtree(root)
                os.rename(original, root)
                _sync_directory(work / 'original')
                _sync_directory(self.releases)
        with closing(sqlite3.connect(self.database_path, timeout=30)) as db, db:
            db.execute('PRAGMA synchronous=FULL')
            db.execute('BEGIN IMMEDIATE')
            for entry in entries:
                db.execute('UPDATE publications SET receipt=?,files=? WHERE release_id=?', (*entry['original'], entry['release_id']))
        shutil.rmtree(work)
        _sync_directory(self.root)
        return {'status': 'ROLLED_BACK'}

    def rollback_compaction(self, *, preflight=None):
        with self._maintenance_locks(preflight):
            if not (self.root / '.retirement').exists() and not (self.root / '.retirement').is_symlink():
                return {'status': 'UNCHANGED'}
            work, entries = self._retirement_entries()
            with closing(sqlite3.connect(self.database_path)) as db:
                for entry in entries:
                    row = db.execute('SELECT receipt,files FROM publications WHERE release_id=?', (entry['release_id'],)).fetchone()
                    if list(row or ()) not in (entry['original'], entry['compact']):
                        raise PublicationError('PUBLICATION_RETENTION_CATALOG_CHANGED')
            return self._rollback_compaction(work, entries)


    def finalize_compaction(self, *, preflight=None):
        """Explicit irreversible disposal after retained-state/readback acceptance.

        The caller must have independently restored a full private backup and
        stopped readers/writers. No worker or GET invokes this operation.
        """
        from .runtime import _write
        with self._maintenance_locks(preflight):
            if not (self.root / '.retirement').exists() and not (self.root / '.retirement').is_symlink():
                return {'status': 'UNCHANGED'}
            work, entries = self._retirement_entries()
            journal = _json(work / 'journal.json')
            if journal.get('rollback_requested'):
                raise PublicationError('PUBLICATION_RETENTION_ROLLBACK_REQUIRED')
            with closing(sqlite3.connect(self.database_path)) as db:
                for entry in entries:
                    row = db.execute('SELECT receipt,files FROM publications WHERE release_id=?', (entry['release_id'],)).fetchone()
                    if list(row or ()) != entry['compact']:
                        raise PublicationError('PUBLICATION_RETENTION_CATALOG_CHANGED')
                    self._checked(row)
                    if not journal.get('finalizing') and _files(work / 'original' / entry['release_id']) != json.loads(entry['original'][1]):
                        raise PublicationError('PUBLICATION_RETENTION_QUARANTINE_CORRUPT')
            # Validate every retained root too; a zero-warning current release
            # alone does not prove the previous/weekly replay evidence survived.
            self.plan_compaction()
            journal['finalizing'] = True
            journal['readers_ready'] = False
            _write(work / 'journal.json', journal)
            # Keep the journal until all disposable trees have been removed.
            # Interrupted finalization resumes, but cannot roll back without the
            # independently verified full backup required by the caller gate.
            aliases = {}
            logical = 0
            for name in ('original', 'staged'):
                for path in (work / name).rglob('*'):
                    if path.is_file():
                        info = path.stat()
                        logical += info.st_size
                        aliases.setdefault((info.st_dev, info.st_ino), [info.st_nlink, info.st_blocks * 512, 0])[2] += 1
            reclaimed = sum(blocks for links, blocks, names in aliases.values() if links == names)
            for name in ('original', 'staged'):
                target = work / name
                if target.exists():
                    shutil.rmtree(target)
                    _sync_directory(work)
            (work / 'journal.json').unlink()
            _sync_directory(work)
            if (work / 'entries.sqlite').exists():
                (work / 'entries.sqlite').unlink()
            work.rmdir()
            _sync_directory(self.root)
            return {'status': 'FINALIZED', 'quarantine_bytes_reclaimed': reclaimed,
                    'quarantine_logical_bytes_retired': logical,
                    'quarantine_reclaim_basis': 'unlinked_exclusive_file_blocks'}
