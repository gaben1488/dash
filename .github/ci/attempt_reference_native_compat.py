"""Offline synthetic compatibility only; never mount production state here."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import stat
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

CANDIDATE_SHA = 'b96e169d024bd0da218288506b678a3adc27bd58'
PREVIOUS_IMAGE = 'sha256:694f6553c4d8135a9b5344eb98982f2844173b9e75b04f4a5d8a701c47bcc580'
ATTEMPT = 'a' * 32


class ContractTests(unittest.TestCase):
    def test_reference_restores_only_assurance(self):
        full = {'attempt_id': ATTEMPT, 'publication': {'release_id': 'REL-' + 'b'*64,
                'automation_assurance': {'private': 'synthetic only'}, 'observed': [False, None]}}
        thin = json.loads(json.dumps(full))
        evidence = thin['publication'].pop('automation_assurance')
        thin['publication']['automation_assurance_ref'] = {
            'release_id': full['publication']['release_id'], 'content_sha256': digest(evidence)}
        validate_pair(thin, full)
        for field in ('release_id', 'content_sha256'):
            bad = json.loads(json.dumps(thin))
            bad['publication']['automation_assurance_ref'][field] = 'private mismatch'
            with self.assertRaises(ValueError):
                validate_pair(bad, full)
        thin['publication']['observed'] = [True]
        with self.assertRaises(ValueError):
            validate_pair(thin, full)

    def test_inventory_rejects_symlinks_and_bounds(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'file').write_text('synthetic')
            before = inventory(root)
            (root / 'new-directory').mkdir()
            self.assertNotEqual(inventory(root), before)
            (root / 'alias').symlink_to(root / 'file')
            with self.assertRaises(ValueError):
                inventory(root)
            (root / 'alias').unlink()
            with self.assertRaises(ValueError):
                inventory(root, byte_limit=1)

    def test_offline_catalog_requires_delete_mode_and_no_sidecars(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            directory = state / 'published'; directory.mkdir()
            database = directory / 'publications.sqlite'
            connection = sqlite3.connect(database)
            connection.execute('CREATE TABLE synthetic(id)')
            connection.execute('PRAGMA journal_mode=WAL')
            connection.close()
            with self.assertRaises(ValueError):
                require_offline_catalog(state)
            connection = sqlite3.connect(database)
            connection.execute('PRAGMA journal_mode=DELETE')
            connection.close()
            require_offline_catalog(state)
            for suffix in ('-wal', '-shm', '-journal'):
                sidecar = Path(str(database) + suffix); sidecar.write_bytes(b'synthetic')
                with self.assertRaises(ValueError):
                    require_offline_catalog(state)
                sidecar.unlink()

    def test_clock_projection_keeps_business_fields(self):
        a = {'operations': {'checked_at': 'one', 'last_success_age_seconds': 1,
                           'running_duration_seconds': None, 'last_failure_code': None}, 'selected': {'x': 1}}
        b = json.loads(json.dumps(a)); b['operations']['checked_at'] = 'two'
        self.assertEqual(without_clock(a), without_clock(b))
        b['selected']['x'] = 2
        self.assertNotEqual(without_clock(a), without_clock(b))


def digest(value):
    result = hashlib.sha256()
    for part in json.JSONEncoder(ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).iterencode(value):
        result.update(part.encode())
    return result.hexdigest()


def inventory(root, *, byte_limit=64*1024*1024):
    if root.is_symlink() or not root.is_dir():
        raise ValueError('FIXTURE_UNSAFE')
    result, total = {}, 0
    for path in sorted(root.rglob('*')):
        info = path.lstat()
        if len(result) >= 1024 or not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
            raise ValueError('FIXTURE_UNSAFE')
        if path.is_dir():
            result[str(path.relative_to(root))] = None
        else:
            total += info.st_size
            if total > byte_limit:
                raise ValueError('FIXTURE_TOO_LARGE')
            with path.open('rb') as stream:
                result[str(path.relative_to(root))] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return result


def require_offline_catalog(state):
    database = state / 'published' / 'publications.sqlite'
    if any(os.path.lexists(str(database) + suffix) for suffix in ('-wal', '-shm', '-journal')):
        raise ValueError('FIXTURE_CATALOG_SIDECAR')
    with database.open('rb') as stream:
        header = stream.read(20)
    # SQLite's file-format read/write versions must both be rollback-journal (1), not WAL (2).
    if header[:16] != b'SQLite format 3\x00' or header[18:20] != b'\x01\x01':
        raise ValueError('FIXTURE_CATALOG_NOT_OFFLINE')


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding='utf-8')


def validate_pair(thin, full):
    publication = thin['publication']
    reference = publication['automation_assurance_ref']
    original = full['publication']
    if (set(reference) != {'release_id', 'content_sha256'}
            or reference['release_id'] != original['release_id']
            or reference['content_sha256'] != digest(original['automation_assurance'])
            or 'automation_assurance' in publication):
        raise ValueError('FIXTURE_REFERENCE_INVALID')
    hydrated = {**thin, 'publication': {
        **{key: value for key, value in publication.items() if key != 'automation_assurance_ref'},
        'automation_assurance': original['automation_assurance']}}
    if hydrated != full:
        raise ValueError('FIXTURE_METADATA_DIFFERENT')


def without_clock(value):
    result = {**value, 'operations': dict(value['operations'])}
    # Both independent native calls observe the host clock; do not compare it as immutable evidence.
    for field in ('checked_at', 'last_success_age_seconds', 'running_duration_seconds'):
        result['operations'].pop(field, None)
    return result


def generate(root, source):
    if root.exists() or os.path.lexists(root):
        raise ValueError('FIXTURE_EXISTS')
    if source.is_symlink() or not source.is_dir():
        raise ValueError('SOURCE_UNSAFE')
    sys.path.insert(0, str(source.resolve()))
    import procurement_engine
    if Path(procurement_engine.__file__).resolve().parent != source.resolve() / 'procurement_engine':
        raise ValueError('CANDIDATE_IMPORT_MISMATCH')
    from docx import Document
    from procurement_engine.atomic_snapshot import (
        SourcePayload,
        capture_atomic_snapshot,
    )
    from procurement_engine.docx_renderer import _save_with_manifest
    from procurement_engine.projections import project_dashboard
    from procurement_engine.publication_store import PublicationStore
    from procurement_engine.runtime import _finish_attempt
    from procurement_engine.snapshot_bundle_io import persist_atomic_bundle

    class SyntheticSource:
        source_id, role, provider_id = 'synthetic', 'MASTER', 'synthetic-book'
        allowed_schema_fingerprints = ('schema1',)

        def revision_token(self):
            return 'revision1'

        def read_payload(self):
            return SourcePayload(self.source_id, self.role, self.provider_id, [['Synthetic']], '0', 'schema1')

    root.mkdir(mode=0o700)
    candidate = root / 'candidate'; candidate.mkdir(mode=0o700)
    bundle = capture_atomic_snapshot([SyntheticSource()], report_date='30.09.2026', report_year=2026,
        cutoff_at='2026-09-29T15:00:00Z', rules_version='rules1', renderer_version='renderer1')
    persist_atomic_bundle(bundle, candidate / 'snapshot_bundle')
    model = {'snapshot': {key: bundle.manifest[key] for key in (
        'snapshot_id', 'report_date', 'report_year', 'cutoff_at', 'rules_version', 'renderer_version')},
        'headline': {'synthetic_count': 1, 'current_quarter': 3},
        'independent_audit': {'pass': True, 'checks': [{'name': 'synthetic', 'pass': True}]},
        'release': {'official_release_allowed': True, 'blockers': []},
        'contract': {'report_model_version': 'model1'},
        'automation_assurance': {'synthetic_evidence': 'x'*(1024*1024), 'fully_automated': True}}
    write_json(candidate / 'report_model.json', model)
    write_json(candidate / 'dashboard.json', project_dashboard(model))
    for name, view in [('main_report.docx', 'main'), ('management_report.docx', 'management')]:
        document = Document(); document.add_paragraph('Synthetic compatibility report')
        _save_with_manifest(document, model, candidate / name, view=view, narrative_mode='GENERIC_TEMPLATE')
    state = root / 'thin'
    store = PublicationStore(state / 'published')
    receipt = store.publish(candidate, read_revisions=lambda: {'synthetic': 'revision1'})
    attempt = state / 'attempts' / ATTEMPT; attempt.mkdir(parents=True)
    full = _finish_attempt(state, attempt, {'attempt_id': ATTEMPT, 'status': receipt['status'],
        'snapshot_id': receipt['snapshot_id'], 'report_date': receipt['report_date'],
        'publication': receipt, 'reused_publication': True, 'started_at': '2026-09-30T00:00:00Z',
        'synthetic_observed_metadata': {'preserved': [False, None]}})
    thin_path = attempt / 'status.json'
    thin = json.loads(thin_path.read_text())
    validate_pair(thin, full)
    if store.read_attempt(ATTEMPT) != full or thin_path.stat().st_size > 16*1024:
        raise ValueError('CANDIDATE_PROOF_READ_FAILED')
    connection = sqlite3.connect(store.database_path)
    try:
        if connection.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0] != 0:
            raise ValueError('FIXTURE_CHECKPOINT_BUSY')
        if connection.execute('PRAGMA journal_mode=DELETE').fetchone() != ('delete',):
            raise ValueError('FIXTURE_JOURNAL_MODE_INVALID')
    finally:
        connection.close()
    require_offline_catalog(state)
    shutil.copytree(state, root / 'inline')
    require_offline_catalog(root / 'inline')
    write_json(root / 'inline' / 'attempts' / ATTEMPT / 'status.json', full)
    # No legacy inline attempt is rewritten; this control is separately copied into both states.
    legacy = {**full, 'attempt_id': 'c'*32}
    for name in ('thin', 'inline'):
        target = root / name / 'attempts' / ('c'*32); target.mkdir()
        write_json(target / 'status.json', legacy)
    write_json(root / 'expected.json', {'candidate_source': CANDIDATE_SHA,
        'new_complete_proof_sha256': digest(full), 'thin_bytes': thin_path.stat().st_size,
        'inline_bytes': (root / 'inline' / 'attempts' / ATTEMPT / 'status.json').stat().st_size})
    inventory(root)
    return {'scope': 'OFFLINE_SYNTHETIC_ONLY', 'generated': True,
            'candidate_proof_read': True, 'assurance_bytes': 1024*1024,
            'thin_bytes': thin_path.stat().st_size, 'weekly': 'NOT_RUN'}


def compare(root):
    from procurement_engine.publication_reader import read_publication
    from procurement_engine.report_health import _fold, report_health
    from procurement_engine.retention import plan_transient_attempt_retention

    for name in ('thin', 'inline'):
        require_offline_catalog(root / name)
    before = inventory(root)
    expected = json.loads((root / 'expected.json').read_text())
    if expected['candidate_source'] != CANDIDATE_SHA:
        raise ValueError('FIXTURE_SOURCE_MISMATCH')
    states = [root / name for name in ('thin', 'inline')]
    full = json.loads((states[0] / 'status.json').read_text())
    thin = json.loads((states[0] / 'attempts' / ATTEMPT / 'status.json').read_text())
    validate_pair(thin, full)
    if digest(full) != expected['new_complete_proof_sha256']:
        raise ValueError('FIXTURE_PROOF_CHANGED')
    fixed_now = datetime(2030, 1, 1, tzinfo=timezone.utc)
    health = [report_health(state, full, full['publication'], now=fixed_now) for state in states]
    first, second = {}, {}
    _fold(first, thin, fixed_now); _fold(second, full, fixed_now)
    plans = [plan_transient_attempt_retention(state, keep_full=2) for state in states]
    payloads = []
    for selection in (None, ('2026-09-30', 2026, 3)):
        pair = [without_clock(json.loads(read_publication(state, 'status', selection=selection))) for state in states]
        if pair[0] != pair[1]:
            raise ValueError('PUBLIC_READ_DIFFERENT')
        payloads.append(digest(pair[0]))
    if health[0] != health[1] or first != second or plans[0] != plans[1]:
        raise ValueError('METADATA_READ_DIFFERENT')
    for state in states:
        require_offline_catalog(state)
    if inventory(root) != before:
        raise ValueError('FIXTURE_MUTATED')
    return {'scope': 'OFFLINE_SYNTHETIC_ONLY', 'old_managed_readers_equal': True,
            'status_reads': 4, 'public_payload_hashes': payloads, 'health_metadata_equal': True,
            'retention_metadata_equal': True, 'attempt_count': plans[0]['attempt_count'],
            'fixture_unchanged': True, 'full_proof_sha256': digest(full), 'weekly': 'NOT_RUN'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('generate', 'check', 'selftest'))
    parser.add_argument('--root', type=Path)
    parser.add_argument('--candidate-source', type=Path)
    args = parser.parse_args()
    if args.mode == 'selftest':
        # unittest details stay private; public mode outputs only fixed aggregate counts.
        result = unittest.TestResult()
        unittest.defaultTestLoader.loadTestsFromTestCase(ContractTests).run(result)
        print(json.dumps({'scope': 'SYNTHETIC_CONTRACT_TESTS', 'tests': result.testsRun,
                          'passed': result.wasSuccessful()}))
        return 0 if result.wasSuccessful() else 1
    try:
        if args.root is None or (args.mode == 'generate' and args.candidate_source is None):
            raise ValueError('ARGUMENTS_REQUIRED')
        if args.root.is_symlink() or not args.root.is_dir():
            raise ValueError('FIXTURE_ROOT_UNSAFE')
        if args.mode == 'generate' and any(args.root.iterdir()):
            raise ValueError('FIXTURE_ROOT_NOT_EMPTY')
        fixture = args.root / 'attempt-reference'
        result = generate(fixture, args.candidate_source) if args.mode == 'generate' else compare(fixture)
        print(json.dumps(result, allow_nan=False))
        return 0
    except Exception:  # noqa: BLE001 — fixed privacy boundary, never emit native errors or payloads
        print(json.dumps({'scope': 'OFFLINE_SYNTHETIC_ONLY', 'code': 'ATTEMPT_NATIVE_COMPAT_FAILED'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
