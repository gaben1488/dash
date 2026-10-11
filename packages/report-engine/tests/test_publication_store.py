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


def candidate(path, *, blocked=False, date='30.09.2026', cutoff='2026-09-29T15:00:00Z', year=2026, quarter=3, history=False):
    path.mkdir()
    class HistorySource(Source):
        source_id = 'HISTORICAL_RECOMMENDATIONS'
        role = 'historical_ledger'
        def read_payload(self):
            return SourcePayload(self.source_id, self.role, self.provider_id,
                [{'chain': i, 'original': 'Synthetic'} for i in range(159)], '0', 'schema1')
    bundle = capture_atomic_snapshot([Source(), *([HistorySource()] if history else [])], report_date=date, report_year=year,
        cutoff_at=cutoff, rules_version='rules1', renderer_version='renderer1')
    persist_atomic_bundle(bundle, path / 'snapshot_bundle')
    model = {'snapshot': {k: bundle.manifest[k] for k in (
        'snapshot_id', 'report_date', 'report_year', 'cutoff_at', 'rules_version', 'renderer_version')},
        'headline': {'synthetic_count': 1, 'current_quarter': quarter},
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


@pytest.mark.parametrize('observed, changed, missing, added', [
    ({'synthetic': 'revision2'}, {'synthetic': {'expected': 'revision1', 'observed': 'revision2'}}, [], []),
    ({'added': 'revision3'}, {}, ['synthetic'], ['added']),
    ({}, {}, ['synthetic'], []),
])
def test_source_revision_barrier_retains_exact_private_mismatch(tmp_path, observed, changed, missing, added):
    store = PublicationStore(tmp_path / 'published')
    with pytest.raises(PublicationError, match='^SOURCE_CHANGED_BEFORE_PUBLICATION$') as caught:
        store.publish(candidate(tmp_path / 'candidate'), read_revisions=lambda: observed)
    assert hasattr(caught.value, 'evidence'), 'provider mismatch evidence is lost at publication boundary'
    assert caught.value.evidence == {
        'expected_revisions': {'synthetic': 'revision1'},
        'observed_revisions': observed,
        'changed': changed, 'missing_keys': missing, 'added_keys': added,
    }
    assert str(caught.value) == 'SOURCE_CHANGED_BEFORE_PUBLICATION'
    assert store.history() == []


def test_compacted_publication_preserves_artifacts_and_context_without_replay(tmp_path):
    store = PublicationStore(tmp_path / 'state/published')
    old = store.publish(candidate(tmp_path / 'old', date='28.09.2026'), read_revisions=revisions)
    latest = store.publish(candidate(tmp_path / 'new', date='30.09.2026'), read_revisions=revisions)
    rid = old['release_id']
    assert hasattr(store, 'compact_publications'), 'published retention has no safe apply phase'
    # Synthetic fixture has no longitudinal identity DB. Real apply requires it.
    import sqlite3
    identity = tmp_path / 'state/identity.sqlite'
    with sqlite3.connect(identity) as db:
        db.execute('CREATE TABLE observations(snapshot_id TEXT, plan_signature TEXT, entity_signature TEXT)')
        db.execute('INSERT INTO observations VALUES (?, ?, ?)', (old['snapshot_id'], 'plan', 'entity'))
    # Protected roots are calculated by the planner, never caller-created.
    plan = store.plan_compaction()
    assert rid not in plan['retire_release_ids']  # current + previous protected
    assert store.latest() == latest


def _compaction_fixture(tmp_path):
    store = PublicationStore(tmp_path / 'state/published')
    receipts = []
    for i, day in enumerate(('28.09.2026', '29.09.2026', '30.09.2026', '01.10.2026', '02.10.2026', '03.10.2026', '04.10.2026')):
        receipts.append(store.publish(candidate(tmp_path / f'c{i}', date=day), read_revisions=revisions))
    with sqlite3.connect(tmp_path / 'state/identity.sqlite') as db:
        db.execute('CREATE TABLE observations(snapshot_id TEXT, plan_signature TEXT, entity_signature TEXT)')
        db.executemany('INSERT INTO observations VALUES (?, ?, ?)', [(r['snapshot_id'], 'plan', 'entity') for r in receipts])
    return store, receipts


def test_publication_compaction_keeps_weekly_current_previous_and_old_downloads(tmp_path):
    store, receipts = _compaction_fixture(tmp_path)
    assert hasattr(store, 'plan_compaction'), 'missing published compaction plan'
    plan = store.plan_compaction()
    assert set(plan['keep_release_ids']) == {receipts[i]['release_id'] for i in (4, 5, 6)}
    before = {r['release_id']: store.read_artifact(r['release_id'], 'main_report.docx') for r in receipts}
    result = store.compact_publications(expected_revision=plan['catalog_revision'])
    assert result['compacted'] == 4
    assert store.latest()['release_id'] == receipts[-1]['release_id']
    for r in receipts:
        assert store.read_artifact(r['release_id'], 'main_report.docx') == before[r['release_id']]
        assert store.select(r['report_date'][6:]+'-'+r['report_date'][3:5]+'-'+r['report_date'][:2], 2026, 3)
    compact = store.history()[-1]
    assert compact['replay_available'] is False
    assert not (store.releases / compact['release_id'] / 'snapshot_bundle').exists()
    assert store.recover_compaction()['status'] == 'COMMITTED'
    assert store.rollback_compaction()['status'] == 'ROLLED_BACK'
    assert all((store.releases / r['release_id'] / 'snapshot_bundle').exists() for r in receipts)


@pytest.mark.parametrize('problem', ['stale', 'identity', 'corrupt'])
def test_compaction_blocks_without_mutation(tmp_path, problem):
    store, receipts = _compaction_fixture(tmp_path)
    assert hasattr(store, 'plan_compaction'), 'missing safe planner'
    plan = store.plan_compaction()
    if problem == 'identity':
        with sqlite3.connect(tmp_path / 'state/identity.sqlite') as db:
            db.execute('UPDATE observations SET plan_signature=NULL')
    elif problem == 'corrupt':
        (store.releases / receipts[-1]['release_id'] / 'dashboard.json').write_text('corrupt')
    with pytest.raises((PublicationError, ValueError)):
        store.compact_publications(expected_revision='stale' if problem == 'stale' else plan['catalog_revision'])
    assert not (store.root / '.retirement/journal.json').exists()
    assert len(store.history()) == 7


@pytest.mark.parametrize('crash_at', [1, 2, 5, 8])
def test_compaction_crash_recovers_exact_originals_before_commit(tmp_path, monkeypatch, crash_at):
    import os
    store, receipts = _compaction_fixture(tmp_path)
    assert hasattr(store, 'plan_compaction'), 'missing crash-safe compaction'
    plan = store.plan_compaction()
    real = os.rename
    count = 0
    def crash(source, target):
        nonlocal count
        count += 1
        real(source, target)
        if count == crash_at:
            raise RuntimeError('simulated process death after rename')
    monkeypatch.setattr(os, 'rename', crash)
    with pytest.raises(RuntimeError):
        store.compact_publications(expected_revision=plan['catalog_revision'])
    monkeypatch.setattr(os, 'rename', real)
    assert store.recover_compaction()['status'] == 'ROLLED_BACK'
    assert len(store.history()) == 7
    assert all((store.releases / r['release_id'] / 'snapshot_bundle').exists() for r in receipts)
    assert store.latest()['release_id'] == receipts[-1]['release_id']


def test_compaction_repeat_finalize_and_republish_are_safe(tmp_path):
    store, _receipts = _compaction_fixture(tmp_path)
    plan = store.plan_compaction()
    store.compact_publications(expected_revision=plan['catalog_revision'])
    assert hasattr(store, 'finalize_compaction'), 'no verified quarantine disposal'
    assert store.finalize_compaction()['status'] == 'FINALIZED'
    assert store.finalize_compaction()['status'] == 'UNCHANGED'
    assert store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])['status'] == 'UNCHANGED'
    with pytest.raises(PublicationError, match='PUBLICATION_REPLAY_COMPACTED'):
        store.publish(tmp_path / 'c0', read_revisions=revisions)
    assert store.select('2026-09-28', 2026, 3)['replay_available'] is False


def test_finalize_rejects_corrupt_quarantine_and_keeps_recovery(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    plan = store.plan_compaction()
    store.compact_publications(expected_revision=plan['catalog_revision'])
    assert hasattr(store, 'finalize_compaction'), 'missing finalize preflight'
    first = next((store.root / '.retirement/original').iterdir())
    (first / 'report_model.json').write_text('tampered')
    with pytest.raises(PublicationError, match='QUARANTINE_CORRUPT'):
        store.finalize_compaction()
    assert (store.root / '.retirement/journal.json').exists()


def test_rollback_crash_resumes_without_losing_originals(tmp_path, monkeypatch):
    import os
    store, receipts = _compaction_fixture(tmp_path)
    store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    real = os.rename
    def crash(source, target):
        real(source, target)
        raise RuntimeError('death during rollback')
    monkeypatch.setattr(os, 'rename', crash)
    with pytest.raises(RuntimeError):
        store.rollback_compaction()
    monkeypatch.setattr(os, 'rename', real)
    assert store.recover_compaction()['status'] == 'ROLLED_BACK'
    assert all((store.releases / r['release_id'] / 'snapshot_bundle').exists() for r in receipts)



def test_compaction_preserves_all_historical_ledger_chain_bytes(tmp_path):
    store, _receipts = _compaction_fixture(tmp_path)
    r = store.publish(candidate(tmp_path / 'hist', date='28.09.2026', history=True), read_revisions=lambda: {'synthetic': 'revision1', 'HISTORICAL_RECOMMENDATIONS': 'revision1'})
    with sqlite3.connect(tmp_path / 'state/identity.sqlite') as db:
        db.execute('INSERT INTO observations VALUES (?, ?, ?)', (r['snapshot_id'], 'plan', 'entity'))
    plan = store.plan_compaction()
    assert r['release_id'] in plan['retire_release_ids']
    root = store.releases / r['release_id']
    before = (root / 'snapshot_bundle/payloads/HISTORICAL_RECOMMENDATIONS.json').read_bytes()
    store.compact_publications(expected_revision=plan['catalog_revision'])
    evidence = root / 'retained_evidence/payloads/HISTORICAL_RECOMMENDATIONS.json'
    assert evidence.is_file(), 'retirement loses historical ledger proof'
    assert evidence.read_bytes() == before
    assert len(json.loads(before)['semantic_values']) == 159


def test_compaction_blocks_symlinked_release_parent(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    real = store.root / 'outside'
    store.releases.rename(real)
    store.releases.symlink_to(real, target_is_directory=True)
    with pytest.raises((PublicationError, ValueError), match='UNSAFE'):
        store.plan_compaction()
    assert not (store.root / '.retirement').exists()


def test_finalization_crash_can_resume_but_cannot_rollback_deleted_quarantine(tmp_path, monkeypatch):
    import shutil
    store, _ = _compaction_fixture(tmp_path)
    store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    real = shutil.rmtree
    def crash(path, *args, **kwargs):
        real(path, *args, **kwargs)
        if str(path).endswith('.retirement/original'):
            raise RuntimeError('death after quarantine disposal')
    monkeypatch.setattr(shutil, 'rmtree', crash)
    with pytest.raises(RuntimeError):
        store.finalize_compaction()
    monkeypatch.setattr(shutil, 'rmtree', real)
    assert store.recover_compaction()['status'] == 'FINALIZING'
    with pytest.raises(PublicationError, match='ROLLBACK_EXPIRED'):
        store.rollback_compaction()
    assert store.finalize_compaction()['status'] == 'FINALIZED'
    assert len(store.history()) == 7


def test_existing_readonly_census_shares_apply_policy_after_compaction(tmp_path):
    import runpy
    from pathlib import Path
    census = runpy.run_path(str(Path(__file__).parents[3] / 'deploy/plan-weekly-publications.py'))['plan']
    store, _ = _compaction_fixture(tmp_path)
    expected = store.plan_compaction()
    before = census(store.root.parent)
    assert before['retire_release_ids'] == expected['retire_release_ids']
    store.compact_publications(expected_revision=expected['catalog_revision'])
    after = census(store.root.parent)
    assert after['retire_count'] == 0
    assert after['publication_count'] == 7  # exact old links still catalogued


def test_interrupted_rollback_never_overwrites_changed_catalog(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    path = store.root / '.retirement/journal.json'
    journal = json.loads(path.read_text())
    journal['rollback_requested'] = True
    path.write_text(json.dumps(journal))
    rid = journal['entries'][0]['release_id']
    with sqlite3.connect(store.database_path) as db:
        record = json.loads(db.execute('SELECT receipt FROM publications WHERE release_id=?', (rid,)).fetchone()[0])
        record['external_decision'] = 'new'
        db.execute('UPDATE publications SET receipt=? WHERE release_id=?', (json.dumps(record), rid))
    with pytest.raises(PublicationError, match='CATALOG_CHANGED'):
        store.recover_compaction()
    assert not (store.releases / rid / 'snapshot_bundle').exists()


def test_compaction_rejects_malformed_current_status_before_planning(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    (store.root.parent / 'status.json').write_text('[]')
    with pytest.raises((PublicationError, ValueError), match='STATUS_INVALID'):
        store.plan_compaction()
    assert not (store.root / '.retirement').exists()


def test_compaction_stale_plan_cannot_retire_changed_current_pointer(tmp_path):
    store, receipts = _compaction_fixture(tmp_path)
    status = store.root.parent / 'status.json'
    status.write_text(json.dumps({'publication': receipts[0]}))
    plan = store.plan_compaction()
    status.write_text(json.dumps({'publication': receipts[1]}))
    with pytest.raises(PublicationError, match='PLAN_CHANGED'):
        store.compact_publications(expected_revision=plan['catalog_revision'])
    assert not (store.root / '.retirement').exists()


def test_compacted_documents_remain_available_to_exact_period_fallback(tmp_path):
    store, receipts = _compaction_fixture(tmp_path)
    store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    result = store.latest_for_period('2026-09-28', 2026, 3)
    assert result is not None, 'read-only Word fallback lost retained artifact links'
    assert result['release_id'] == receipts[0]['release_id']
    assert result['replay_available'] is False
    assert store.latest_for_period('2026-09-28', 2027, 3) is None


def test_finalize_preserves_quarantine_if_current_pointer_now_needs_retired_replay(tmp_path):
    store, receipts = _compaction_fixture(tmp_path)
    store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    (store.root.parent / 'status.json').write_text(json.dumps({'publication': receipts[0]}))
    with pytest.raises((PublicationError, ValueError), match='CURRENT_COMPACTED'):
        store.finalize_compaction()
    assert (store.root / '.retirement/original' / receipts[0]['release_id'] / 'snapshot_bundle').exists()
