"""Synthetic acceptance cases; no live source records belong in this repository."""
import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from docx import Document
from procurement_engine.atomic_snapshot import SourcePayload, capture_atomic_snapshot
from procurement_engine.docx_renderer import _save_with_manifest
from procurement_engine.projections import project_dashboard
from procurement_engine.publication_store import PublicationError, PublicationStore
from procurement_engine.snapshot_bundle_io import persist_atomic_bundle


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


class Source:
    source_id = 'synthetic'
    role = 'MASTER'
    provider_id = 'synthetic-book'
    allowed_schema_fingerprints = ('schema1',)

    def revision_token(self):
        return 'revision1'

    def read_payload(self):
        return SourcePayload(self.source_id, self.role, self.provider_id, [['Synthetic']],
                             '0', 'schema1')


def candidate(path, *, blocked=False, date='30.09.2026', cutoff='2026-09-29T15:00:00Z'):
    path.mkdir()
    bundle = capture_atomic_snapshot([Source()], report_date=date, report_year=2026,
        cutoff_at=cutoff, rules_version='rules1', renderer_version='renderer1')
    persist_atomic_bundle(bundle, path / 'snapshot_bundle')
    model = {'snapshot': {k: bundle.manifest[k] for k in (
        'snapshot_id', 'report_date', 'cutoff_at', 'rules_version', 'renderer_version')},
        'headline': {'synthetic_count': 1},
        'independent_audit': {'pass': True, 'checks': [{'name': 'synthetic', 'pass': True}]},
        'release': {'official_release_allowed': not blocked,
                    'blockers': [{'code': 'UNPROVEN'}] if blocked else []},
        'contract': {'report_model_version': 'model1'}}
    write_json(path / 'report_model.json', model)
    write_json(path / 'dashboard.json', project_dashboard(model))
    for name, view in [('main_report.docx', 'main'), ('management_report.docx', 'management')]:
        document = Document()
        document.add_paragraph('Synthetic report')
        _save_with_manifest(document, model, path / name, view=view, narrative_mode='GENERIC_TEMPLATE')
    return path


def revisions():
    return {'synthetic': 'revision1'}


def test_renderer_manifest_binds_actual_document_bytes(tmp_path):
    path = candidate(tmp_path / 'candidate')
    for name in ('main_report.docx', 'management_report.docx'):
        meta = json.loads((path / (name + '.manifest.json')).read_text())
        assert meta.get('artifact_sha256') == hashlib.sha256((path / name).read_bytes()).hexdigest()


def test_complete_bundle_publishes_once_and_survives_reopen(tmp_path):
    path = candidate(tmp_path / 'candidate')
    store = PublicationStore(tmp_path / 'published')
    first = store.publish(path, read_revisions=revisions)
    assert first['report_date'] == '30.09.2026'
    assert store.publish(path, read_revisions=revisions) == first
    reopened = PublicationStore(tmp_path / 'published')
    assert reopened.latest() == first
    assert len(reopened.history()) == 1
    assert (tmp_path / 'published' / 'releases' / first['release_id'] / 'main_report.docx').is_file()


def test_blocked_candidate_preserves_previous_date(tmp_path):
    store = PublicationStore(tmp_path / 'published')
    first = store.publish(candidate(tmp_path / 'good'), read_revisions=revisions)
    with pytest.raises(PublicationError, match='RELEASE_BLOCKED'):
        store.publish(candidate(tmp_path / 'blocked', blocked=True, date='01.10.2026'), read_revisions=revisions)
    assert store.latest() == first
    assert len(store.history()) == 1


def test_previous_model_uses_only_committed_earlier_report_dates(tmp_path):
    store = PublicationStore(tmp_path / 'published')
    first = store.publish(candidate(tmp_path / 'first', date='29.09.2026'), read_revisions=revisions)
    store.publish(candidate(tmp_path / 'same-day', date='30.09.2026'), read_revisions=revisions)
    candidate(tmp_path / 'unpublished', date='28.09.2026')
    previous = store.previous_model('30.09.2026')
    assert previous['receipt'] == first
    assert previous['model']['snapshot']['report_date'] == '29.09.2026'
    assert store.previous_model('29.09.2026') is None


@pytest.mark.parametrize('damage', ['docx', 'dashboard', 'audit', 'missing', 'symlink', 'snapshot'])
def test_inconsistent_or_incomplete_bundle_never_becomes_visible(tmp_path, damage):
    path = candidate(tmp_path / 'candidate')
    if damage == 'docx':
        with (path / 'main_report.docx').open('ab') as file:
            file.write(b'changed')
    elif damage == 'dashboard':
        p = path / 'dashboard.json'
        data = json.loads(p.read_text()); data['headline']['synthetic_count'] = 99
        write_json(p, data)
    elif damage == 'audit':
        p = path / 'report_model.json'
        data = json.loads(p.read_text()); data['independent_audit']['pass'] = False
        write_json(p, data)
    elif damage == 'missing':
        (path / 'management_report.docx').unlink()
    elif damage == 'symlink':
        (path / 'link').symlink_to(path / 'report_model.json')
    else:
        (path / 'snapshot_bundle/payloads/synthetic.json').write_text('{}')
    store = PublicationStore(tmp_path / 'published')
    with pytest.raises(PublicationError):
        store.publish(path, read_revisions=revisions)
    assert store.latest() is None
    assert store.history() == []


@pytest.mark.parametrize('observed', [{}, {'synthetic': None}, {'synthetic': 'revision2'}])
def test_changed_or_unknown_final_revision_blocks_publication(tmp_path, observed):
    store = PublicationStore(tmp_path / 'published')
    with pytest.raises(PublicationError, match='SOURCE_CHANGED'):
        store.publish(candidate(tmp_path / 'candidate'), read_revisions=lambda: observed)
    assert store.latest() is None


def test_failure_between_directory_rename_and_commit_is_recoverable(tmp_path):
    store = PublicationStore(tmp_path / 'published')
    path = candidate(tmp_path / 'candidate')
    with sqlite3.connect(store.database_path) as db:
        db.execute("CREATE TRIGGER fail_insert BEFORE INSERT ON publications BEGIN SELECT RAISE(ABORT, 'disk simulation'); END")
    with pytest.raises(sqlite3.IntegrityError):
        store.publish(path, read_revisions=revisions)
    assert store.latest() is None
    with sqlite3.connect(store.database_path) as db:
        db.execute('DROP TRIGGER fail_insert')
    result = store.publish(path, read_revisions=revisions)
    assert store.latest() == result
    assert len(store.history()) == 1


def test_parallel_retries_do_not_duplicate_release(tmp_path):
    store = PublicationStore(tmp_path / 'published')
    path = candidate(tmp_path / 'candidate')
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: store.publish(path, read_revisions=revisions), range(2)))
    assert results[0] == results[1]
    assert len(store.history()) == 1


def test_older_report_cannot_replace_latest_and_damage_is_detected(tmp_path):
    store = PublicationStore(tmp_path / 'published')
    current = store.publish(candidate(tmp_path / 'current'), read_revisions=revisions)
    store.publish(candidate(tmp_path / 'old', date='29.09.2026', cutoff='2026-09-28T15:00:00Z'), read_revisions=revisions)
    assert store.latest() == current
    (tmp_path / 'published/releases' / current['release_id'] / 'main_report.docx').write_bytes(b'corrupt')
    with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT'):
        store.latest()
