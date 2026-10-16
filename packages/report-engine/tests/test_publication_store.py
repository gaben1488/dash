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


def test_catalog_reads_do_not_sort_large_receipts_into_temp_files(tmp_path):
    import os
    import subprocess
    import sys

    store = PublicationStore(tmp_path/'published')
    latest = store.publish(candidate(tmp_path/'candidate',date='02.10.2026',quarter=4,
        cutoff='2026-10-02T00:00:00Z'),read_revisions=revisions)
    with sqlite3.connect(store.database_path) as db:
        for index in range(32):
            release_id = 'REL-'+f'{index:064x}'
            receipt = {**latest,'release_id':release_id,'archive_origin':'SYNTHETIC',
                       'padding':'x'*1024**2}
            db.execute('INSERT INTO publications VALUES(?,?,?,?,?)',(release_id,'2026-10-02',
                '2026-10-01T00:00:00Z',json.dumps(receipt),'{}'))
    before = store.database_path.read_bytes()
    program = '''import resource,signal,sys
from procurement_engine.publication_store import PublicationStore
signal.signal(signal.SIGXFSZ,signal.SIG_IGN)
resource.setrlimit(resource.RLIMIT_FSIZE,(4*1024**2,4*1024**2))
store=PublicationStore(sys.argv[1],readonly=True);expected=sys.argv[2]
assert store.latest()['release_id']==expected
assert store.select('2026-10-02',2026,4)['release_id']==expected
assert store.latest_for_period('2026-10-03',2026,4)['release_id']==expected
assert store.previous_model('03.10.2026')['receipt']['release_id']==expected
assert store.previous_weekly_model('08.10.2026')['receipt']['release_id']==expected
history=store.history();assert len(history)==33 and history[0]['release_id']==expected
print('BOUNDED_CATALOG_READS_PASS')
'''
    result = subprocess.run([sys.executable,'-c',program,str(store.root),latest['release_id']],
        capture_output=True,text=True,timeout=30,check=False,env={**os.environ,'SQLITE_TMPDIR':str(tmp_path)})
    assert result.returncode==0,result.stderr
    assert result.stdout.strip()=='BOUNDED_CATALOG_READS_PASS'
    assert store.database_path.read_bytes()==before


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


def test_compaction_reader_marker_stays_small_with_large_catalog_receipts(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    with sqlite3.connect(store.database_path) as db:
        for rid, receipt in db.execute('SELECT release_id,receipt FROM publications').fetchall():
            value=json.loads(receipt);value['retained_diagnostic']='x'*(2*1024*1024)
            db.execute('UPDATE publications SET receipt=? WHERE release_id=?',(json.dumps(value),rid))
    store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    work=store.root/'.retirement'
    assert (work/'journal.json').stat().st_size<64*1024, 'Native GET must not parse every recovery receipt'
    _, entries=store._retirement_entries()
    assert len(list(entries))==len(list(entries))==4
    assert store.recover_compaction()['status']=='COMMITTED'
    assert store.rollback_compaction()['status']=='ROLLED_BACK'
    with sqlite3.connect(store.database_path) as db:
        assert all(json.loads(row[0])['retained_diagnostic']=='x'*(2*1024*1024) for row in db.execute('SELECT receipt FROM publications'))


def test_compaction_staging_shares_only_immutable_retained_artifacts(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    plan=store.plan_compaction();rid=plan['retire_release_ids'][0]
    original=store.releases/rid/'main_report.docx';inode=original.stat().st_ino
    primary=store.root.parent/'identity.sqlite';primary_before=primary.read_bytes()
    store.compact_publications(expected_revision=plan['catalog_revision'])
    quarantine=store.root/'.retirement/original'/rid/'main_report.docx'
    assert original.stat().st_ino==quarantine.stat().st_ino==inode
    assert primary.read_bytes()==primary_before
    store.rollback_compaction()
    assert original.stat().st_ino==inode


def test_finalization_counts_only_blocks_with_no_retained_inode_alias(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    quarantine=store.root/'.retirement/original'
    records={}
    logical=0
    for path in quarantine.rglob('*'):
        if path.is_file():
            info=path.stat();key=(info.st_dev,info.st_ino)
            records.setdefault(key,[info.st_nlink,info.st_blocks*512,0])[2]+=1
            logical+=info.st_size
    expected=sum(blocks for links,blocks,aliases in records.values() if links==aliases)
    result=store.finalize_compaction()
    assert result['quarantine_bytes_reclaimed']==expected
    assert result['quarantine_logical_bytes_retired']==logical


def test_compaction_additionally_retains_unbacked_roots_in_the_revision(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    default=store.plan_compaction();protected=default['retire_release_ids'][:1]
    plan=store.plan_compaction(protected_release_ids=protected)
    assert set(protected)<=set(plan['keep_release_ids'])
    assert not set(protected)&set(plan['retire_release_ids'])
    assert plan['retire_count']==default['retire_count']-1
    assert plan['catalog_revision']!=default['catalog_revision']
    with pytest.raises(PublicationError,match='PLAN_CHANGED'):
        store.compact_publications(expected_revision=default['catalog_revision'],protected_release_ids=protected)
    store.compact_publications(expected_revision=plan['catalog_revision'],protected_release_ids=protected)
    store.finalize_compaction()
    assert all((store.releases/rid/'snapshot_bundle').is_dir() for rid in protected)
    assert all(rid in {item['release_id'] for item in store.history()} for rid in protected)


def test_legacy_recovery_payload_remains_readable_without_rewriting_it(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    work, entries=store._retirement_entries()
    marker=work/'journal.json';journal=json.loads(marker.read_text())
    legacy={'contract':'publication-compaction-v1','entries':list(entries),
            'plan_revision':journal['plan_revision'],'readers_ready':True}
    marker.write_text(json.dumps(legacy));(work/'entries.sqlite').unlink()
    assert store.recover_compaction()['status']=='COMMITTED'
    assert store.rollback_compaction()['status']=='ROLLED_BACK'


def test_changed_recovery_payload_is_rejected_before_rollback_renames(tmp_path,monkeypatch):
    import os
    store, _ = _compaction_fixture(tmp_path)
    store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    path=store.root/'.retirement/entries.sqlite'
    with path.open('ab') as file:file.write(b'changed recovery payload')
    def forbidden(*args,**kwargs):
        pytest.fail('Changed payload reached a filesystem rename')
    monkeypatch.setattr(os,'rename',forbidden)
    with pytest.raises(PublicationError,match='JOURNAL_INVALID'):
        store.rollback_compaction()


def test_compaction_validates_backup_against_its_one_locked_plan(tmp_path,monkeypatch):
    store, _ = _compaction_fixture(tmp_path)
    plan=store.plan_compaction();native=store.plan_compaction;seen=[]
    def counted(**kwargs):
        seen.append('plan');return native(**kwargs)
    def gate(locked,captured):
        assert locked is store and captured['catalog_revision']==plan['catalog_revision']
        assert captured['retire_release_ids']==plan['retire_release_ids']
        seen.append('backup')
    monkeypatch.setattr(store,'plan_compaction',counted)
    store.compact_publications(expected_revision=plan['catalog_revision'],plan_preflight=gate)
    assert seen==['plan','backup']


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
    rid = next(iter(store._retirement_entries()[1]))['release_id']
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


@pytest.mark.parametrize('operation', ['apply', 'rollback'])
def test_every_retirement_rename_syncs_both_parent_directories(tmp_path, monkeypatch, operation):
    import os

    import procurement_engine.publication_store as module
    store, _ = _compaction_fixture(tmp_path)
    if operation == 'rollback':
        store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    events = []
    rename, sync = os.rename, module._sync_directory
    def observed_rename(source, target):
        events.append(('rename', source.parent, target.parent))
        return rename(source, target)
    def observed_sync(path):
        events.append(('sync', path))
        return sync(path)
    monkeypatch.setattr(os, 'rename', observed_rename)
    monkeypatch.setattr(module, '_sync_directory', observed_sync)
    if operation == 'apply':
        store.compact_publications(expected_revision=store.plan_compaction()['catalog_revision'])
    else:
        store.rollback_compaction()
    for i, event in enumerate(events):
        if event[0] != 'rename':
            continue
        following = []
        for later in events[i+1:]:
            if later[0] == 'rename':
                break
            following.append(later[1])
        assert event[1] in following, f'unsynced source parent {event[1]}'
        assert event[2] in following, f'unsynced destination parent {event[2]}'


def test_recovery_discards_partial_prepare_only_when_catalog_sources_are_intact(tmp_path):
    store, receipts = _compaction_fixture(tmp_path)
    before = store.history()
    work = store.root / '.retirement'
    staged = work / 'staged' / receipts[0]['release_id']
    staged.mkdir(parents=True)
    # A killed copy can have incomplete bytes; it is never a committed source.
    (staged / 'main_report.docx').write_bytes(b'partial copy')
    assert store.recover_compaction()['status'] == 'PREPARE_DISCARDED'
    assert not work.exists()
    assert store.history() == before
    assert all((store.releases / r['release_id'] / 'snapshot_bundle').is_dir() for r in receipts)
    assert store.latest() == receipts[-1]


@pytest.mark.parametrize('problem', ['unknown', 'symlink', 'original', 'source_corrupt'])
def test_prepare_only_recovery_rejects_unknown_or_unproven_state(tmp_path, problem):
    store, receipts = _compaction_fixture(tmp_path)
    work = store.root / '.retirement'
    staged = work / 'staged' / receipts[0]['release_id']
    staged.mkdir(parents=True)
    (staged / 'main_report.docx').write_bytes(b'partial copy')
    if problem == 'unknown':
        (staged / 'human-note.txt').write_text('unknown')
    elif problem == 'symlink':
        (staged / 'main_report.docx').unlink()
        (staged / 'main_report.docx').symlink_to(store.releases / receipts[0]['release_id'] / 'main_report.docx')
    elif problem == 'original':
        (work / 'original').mkdir()
    else:
        (store.releases / receipts[0]['release_id'] / 'dashboard.json').write_text('corrupt')
    with pytest.raises((PublicationError, ValueError)):
        store.recover_compaction()
    assert work.exists()


def test_prepare_only_recovery_rejects_broken_work_symlink(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    work = store.root / '.retirement'
    work.symlink_to(tmp_path / 'missing')
    with pytest.raises(PublicationError, match='UNSAFE'):
        store.recover_compaction()
    assert work.is_symlink()


def test_prepare_only_recovery_rejects_unknown_empty_directory(tmp_path):
    store, receipts = _compaction_fixture(tmp_path)
    work = store.root / '.retirement'
    (work / 'staged' / receipts[0]['release_id'] / 'unknown-human-directory').mkdir(parents=True)
    with pytest.raises(PublicationError, match='UNSAFE'):
        store.recover_compaction()
    assert work.exists()


@pytest.mark.parametrize('partial_marker', [False, True])
def test_actual_process_death_before_journal_recovers_only_staging(tmp_path, partial_marker):
    import multiprocessing
    import os

    from procurement_engine import runtime
    store, receipts = _compaction_fixture(tmp_path)
    plan = store.plan_compaction()
    def die_before_journal():
        original = runtime._write
        def write(path, value):
            if path.name == 'journal.json':
                if not partial_marker:
                    os._exit(71)
                real_dump = runtime.json.dump
                def interrupted_dump(value, file, **kwargs):
                    file.write('{"contract":');file.flush();os.fsync(file.fileno())
                    os._exit(71)
                runtime.json.dump = interrupted_dump
                try:
                    return original(path, value)
                finally:
                    runtime.json.dump = real_dump
            return original(path, value)
        runtime._write = write
        store.compact_publications(expected_revision=plan['catalog_revision'])
    child = multiprocessing.get_context('fork').Process(target=die_before_journal)
    child.start()
    child.join(timeout=10)
    if child.is_alive():
        child.kill()
        child.join()
    assert child.exitcode == 71
    assert not (store.root / '.retirement/journal.json').exists()
    assert not (store.root / '.retirement/original').exists()
    if partial_marker:
        assert len(list((store.root/'.retirement').glob('journal.json.*.tmp')))==1
    assert store.recover_compaction()['status'] == 'PREPARE_DISCARDED'
    assert store.latest() == receipts[-1]
    assert all((store.releases / r['release_id'] / 'snapshot_bundle').is_dir() for r in receipts)


@pytest.mark.parametrize('kind', ['foreign_name','hardlink','symlink'])
def test_unsealed_cleanup_does_not_remove_foreign_or_aliased_files(tmp_path,kind):
    import os
    store, _ = _compaction_fixture(tmp_path)
    work=store.root/'.retirement';work.mkdir()
    external=tmp_path/'external';external.write_text('preserve')
    path=work/('journal.json.'+'a'*32+'.tmp')
    if kind=='foreign_name':
        path=work/'journal.json.unknown.tmp';path.write_text('preserve')
    elif kind=='hardlink':os.link(external,path)
    else:path.symlink_to(external)
    with pytest.raises(PublicationError,match='PREPARE_UNSAFE'):
        store.recover_compaction()
    assert external.read_text()=='preserve' and path.exists()


def test_reader_lease_drains_before_maintenance_and_blocks_prepared_crash(tmp_path):
    import multiprocessing
    import time
    store, _ = _compaction_fixture(tmp_path)
    assert hasattr(store, 'reader_lease'), 'Missing native reader lease'
    context = multiprocessing.get_context('fork')
    entered, release, maintenance = context.Event(), context.Event(), context.Event()

    def read():
        with PublicationStore(store.root, readonly=True).reader_lease():
            entered.set()
            assert release.wait(10)

    def maintain():
        with PublicationStore(store.root)._maintenance_locks():
            maintenance.set()

    reader = context.Process(target=read)
    writer = context.Process(target=maintain)
    reader.start()
    assert entered.wait(5)
    writer.start()
    time.sleep(0.1)
    assert not maintenance.is_set()
    release.set()
    reader.join(5)
    writer.join(5)
    assert reader.exitcode == writer.exitcode == 0
    assert maintenance.is_set()
    (store.root / '.retirement').mkdir()
    with pytest.raises(PublicationError, match='PUBLICATION_RETENTION_RECOVERY_REQUIRED'):
        store.latest()


def test_readonly_reader_never_bootstraps_missing_lease(tmp_path):
    store, _ = _compaction_fixture(tmp_path)
    path = store.root.parent / 'publication-readers.lock'
    if path.exists():
        path.unlink()
    with pytest.raises(PublicationError, match='PUBLICATION_READER_LEASE_UNINITIALIZED'):
        PublicationStore(store.root, readonly=True).latest()
    assert not path.exists()


def _operator_fixture(tmp_path):
    import importlib.util
    import shutil
    import subprocess
    from pathlib import Path

    import procurement_engine.publication_store as native
    repo = Path(__file__).resolve().parents[3]
    spec = importlib.util.spec_from_file_location('weekly_operator', repo / 'deploy/plan-weekly-publications.py')
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    fake = tmp_path / 'candidate-repo'
    source = Path(native.__file__).parent
    shutil.copytree(source, fake / 'packages/report-engine/src/procurement_engine', ignore=shutil.ignore_patterns('__pycache__'))
    (fake / 'deploy').mkdir()
    for name in ('plan-weekly-publications.py', 'stateful_backup.py'):
        shutil.copy2(repo / 'deploy' / name, fake / 'deploy' / name)
    (fake / '.github/ci').mkdir(parents=True)
    shutil.copy2(repo / '.github/ci/source_ci_gate.py', fake / '.github/ci/source_ci_gate.py')
    for args in (['init', '-q'], ['add', '.'], ['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','synthetic candidate']):
        subprocess.run(['git','-C',str(fake),*args],check=True,capture_output=True)
    sha = subprocess.run(['git','-C',str(fake),'rev-parse','HEAD'],check=True,capture_output=True,text=True).stdout.strip()
    tool.__file__ = str(fake / 'deploy/plan-weekly-publications.py')
    store, receipts = _compaction_fixture(tmp_path)
    backup = tmp_path / 'trusted-backup'
    shutil.copytree(store.root.parent, backup / 'state/reports')
    (backup / 'state/aemr.db').write_bytes(b'synthetic backup database')
    (backup / 'state/reports/inputs').mkdir()
    for name in ('registry.json','ledger.json'):
        (backup / 'state/reports/inputs' / name).write_text('{}')
    backup_spec = importlib.util.spec_from_file_location('backup_fixture', repo / 'deploy/stateful_backup.py')
    module = importlib.util.module_from_spec(backup_spec)
    backup_spec.loader.exec_module(module)
    files = module.inventory(backup / 'state')
    (backup / 'manifest.json').write_text(json.dumps({'format':1,'files':files,'bytes':sum(x['bytes'] for x in files.values())}))
    options = {'candidate':sha,'ci':{'id':1001,'name':'CI','head_sha':sha,'status':'completed','conclusion':'success',
        'head_repository':{'full_name':'gaben1488/dash'}},'reader_package':source,
        'expected_revision':store.plan_compaction()['catalog_revision'],'backup':backup}
    return tool, store, receipts, options


@pytest.mark.parametrize('problem', ['ci','runtime','stale','identity','backup','ownership'])
def test_operator_rejects_unproved_gate_without_publication_mutation(tmp_path, problem):
    tool, store, _, options = _operator_fixture(tmp_path)
    if problem == 'ci':
        options['ci']['conclusion'] = 'failure'
    elif problem == 'runtime':
        options['reader_package'] = tmp_path / 'old-installed-reader'
        options['reader_package'].mkdir()
    elif problem == 'stale':
        options['expected_revision'] = 'stale'
    elif problem == 'identity':
        with sqlite3.connect(store.root.parent / 'identity.sqlite') as db:
            db.execute('UPDATE observations SET plan_signature=NULL')
    elif problem == 'backup':
        # Valid backup, but an original root has different ownership/mode proof.
        manifest = json.loads((options['backup'] / 'manifest.json').read_text())
        key = next(k for k in manifest['files'] if '/releases/' in k and k.endswith('dashboard.json'))
        manifest['files'][key]['mode'] ^= 1
        (options['backup'] / 'state' / key).chmod(manifest['files'][key]['mode'])
        (options['backup'] / 'manifest.json').write_text(json.dumps(manifest))
    else:
        options['candidate'] = 'f' * 40
        options['ci']['head_sha'] = options['candidate']
    before = (store.database_path).read_bytes()
    with pytest.raises(ValueError):
        tool.operate(store.root.parent, operation='apply', **options)
    assert store.database_path.read_bytes() == before
    assert not (store.root / '.retirement').exists()


def test_operator_apply_preserves_quarantine_and_requires_separate_finalize_gate(tmp_path):
    tool, store, receipts, options = _operator_fixture(tmp_path)
    before = {r['release_id']: store.read_artifact(r['release_id'],'main_report.docx') for r in receipts}
    result = tool.operate(store.root.parent, operation='apply', **options)
    assert result['status'] == 'COMPACTED'
    assert (store.root / '.retirement/original').is_dir()
    for rid, content in before.items():
        assert store.read_artifact(rid, 'main_report.docx') == content
    with pytest.raises(ValueError, match='INDEPENDENT_FINALIZE_REVIEW_REQUIRED'):
        tool.operate(store.root.parent, operation='finalize', **options)
    assert tool.operate(store.root.parent, operation='recover', **options)['status'] == 'COMMITTED'
    assert tool.operate(store.root.parent, operation='rollback', **options)['status'] == 'ROLLED_BACK'
    assert not (store.root / '.retirement').exists()


def test_native_operator_uses_one_plan_for_preview_and_one_for_locked_apply(tmp_path,monkeypatch):
    tool, store, _, options = _operator_fixture(tmp_path)
    original=PublicationStore.plan_compaction;calls=[]
    def counted(self,**kwargs):
        calls.append(self.root);return original(self,**kwargs)
    monkeypatch.setattr(PublicationStore,'plan_compaction',counted)
    preview=tool.operator_preflight(store.root.parent,operation='apply',store=store,
                                   **{**options,'expected_revision':'live'})
    assert preview['plan']['catalog_revision']==options['expected_revision']
    assert 'records' not in preview['plan'] and len(calls)==1
    calls.clear()
    assert tool.operate(store.root.parent,operation='apply',**options)['status']=='COMPACTED'
    assert len(calls)==1


def test_source_qualified_native_operator_preserves_failed_live_observation(tmp_path):
    tool, store, _, options = _operator_fixture(tmp_path)
    ci=options['ci'];ci.update(conclusion='failure',event='pull_request',path='.github/workflows/ci.yml')
    ci['source_jobs']=[{'run_id':ci['id'],'name':name,'status':'completed','conclusion':'success'} for name in (
        'Lint, TypeScript, Tests, Build, Audit','Report engine, publication and runtime','Production image with report runtime')]
    assert tool.operate(store.root.parent,operation='apply',**options)['status']=='COMPACTED'
    assert ci['conclusion']=='failure'
    assert tool.operate(store.root.parent,operation='rollback',**options)['status']=='ROLLED_BACK'


def test_installed_reader_behavior_probe_requires_compacted_word_context(tmp_path):
    tool, _, _, options = _operator_fixture(tmp_path)
    assert hasattr(tool, 'verify_reader_compatibility'), 'Missing behavioral compatibility gate'
    tool.verify_reader_compatibility(options['reader_package'])
    old = tmp_path / 'old-reader/procurement_engine'
    old.mkdir(parents=True)
    (old / '__init__.py').write_text('')
    (old / 'publication_store.py').write_text('class PublicationStore:\n def __init__(self,*args,**kwargs): pass\n def select(self,*args): raise FileNotFoundError("report_model.json")\n')
    with pytest.raises(ValueError, match='READER_RUNTIME_COMPATIBILITY_REQUIRED'):
        tool.verify_reader_compatibility(old)


def test_operator_exception_recovers_owned_fence_without_global_state_restore(tmp_path, monkeypatch):
    import procurement_engine.publication_store as native
    tool, store, _, options = _operator_fixture(tmp_path)
    marker = store.root.parent / 'mutable-after-backup.txt'
    marker.write_text('must survive')
    original = native.os.rename
    failed = False
    def fail_once(source, target):
        nonlocal failed
        if not failed and '.retirement' in str(target):
            failed = True
            raise OSError('synthetic rename interruption')
        return original(source, target)
    monkeypatch.setattr(native.os, 'rename', fail_once)
    with pytest.raises(OSError):
        tool.operate(store.root.parent, operation='apply', **options)
    assert not (store.root / '.retirement').exists()
    assert store.latest()
    assert marker.read_text() == 'must survive'


def test_report_reader_fails_fast_while_maintenance_owns_exclusive_lease(tmp_path):
    import multiprocessing
    store, _ = _compaction_fixture(tmp_path)
    context = multiprocessing.get_context('fork')
    ready, release = context.Event(), context.Event()
    def hold():
        with PublicationStore(store.root)._maintenance_locks():
            ready.set()
            assert release.wait(5)
    child = context.Process(target=hold)
    child.start()
    assert ready.wait(5)
    try:
        with pytest.raises(PublicationError, match='PUBLICATION_MAINTENANCE_ACTIVE'):
            store.latest()
    finally:
        release.set()
        child.join(6)
    assert child.exitcode == 0


def test_independent_watchdog_recovers_sigkilled_owner_and_preserves_mutable_state(tmp_path):
    import multiprocessing
    import os
    import signal

    import procurement_engine.publication_store as native
    tool, store, _, options = _operator_fixture(tmp_path)
    assert hasattr(tool, 'watch_owner_then_recover'), 'Missing independent native recovery watchdog'
    context = multiprocessing.get_context('fork')
    ready, start, moved = context.Event(), context.Event(), context.Event()
    def owner():
        ready.set()
        assert start.wait(5)
        original = native.os.rename
        def die_after_move(source, target):
            original(source, target)
            if '.retirement/original/' in str(target):
                moved.set()
                os.kill(os.getpid(), signal.SIGKILL)
        native.os.rename = die_after_move
        store.compact_publications(expected_revision=options['expected_revision'])
    process = context.Process(target=owner)
    process.start()
    assert ready.wait(5)
    birth = tool.owner_start_token(process.pid)
    recovered = context.Queue()
    def watchdog():
        recovered.put(tool.watch_owner_then_recover(process.pid, birth, store.root.parent, **options))
    watcher = context.Process(target=watchdog)
    watcher.start()
    (store.root.parent / 'mutable-after-backup.txt').write_text('preserve')
    start.set()
    assert moved.wait(5)
    process.join(5)
    assert process.exitcode == -signal.SIGKILL
    watcher.join(10)
    assert watcher.exitcode == 0
    assert recovered.get(timeout=1)['status'] == 'ROLLED_BACK'
    assert not (store.root / '.retirement').exists()
    assert store.latest()
    assert (store.root.parent / 'mutable-after-backup.txt').read_text() == 'preserve'


def test_archive_prepare_holds_reader_lease_for_entire_native_call(tmp_path, monkeypatch):
    import multiprocessing
    import time

    import procurement_engine.archive_runtime as archive
    store, _ = _compaction_fixture(tmp_path)
    context = multiprocessing.get_context('fork')
    inside, release, maintenance = context.Event(), context.Event(), context.Event()
    def existing_archive(*args, **kwargs):
        inside.set()
        assert release.wait(5)
        return {'synthetic': True}
    monkeypatch.setattr(archive, '_ensure_archive_release', existing_archive)
    def prepare():
        archive.ensure_archive_release(store.root.parent, day='2026-10-01',year=2026,quarter=3)
    def compact():
        with PublicationStore(store.root)._maintenance_locks():
            maintenance.set()
    reader = context.Process(target=prepare)
    writer = context.Process(target=compact)
    reader.start()
    assert inside.wait(5)
    writer.start()
    time.sleep(0.1)
    assert not maintenance.is_set()
    release.set()
    reader.join(5)
    writer.join(5)
    assert reader.exitcode == writer.exitcode == 0
    assert maintenance.is_set()


def test_finalize_review_is_bound_to_the_actual_journal_plan(tmp_path):
    tool, store, receipts, options = _operator_fixture(tmp_path)
    tool.operate(store.root.parent, operation='apply', **options)
    wrong = {**options, 'expected_revision':'wrong-reviewed-plan'}
    with pytest.raises(ValueError, match='INDEPENDENT_FINALIZE_REVIEW_REQUIRED'):
        tool.operate(store.root.parent, operation='finalize',
                     finalize_review=options['candidate']+':wrong-reviewed-plan', **wrong)
    assert (store.root / '.retirement/original').is_dir()
    # Independent reader performs all exact artifact readbacks before this
    # synthetic explicit acceptance; this never stands in for live acceptance.
    for receipt in receipts:
        assert store.read_artifact(receipt['release_id'], 'main_report.docx').startswith(b'PK')
    result = tool.operate(store.root.parent, operation='finalize',
                         finalize_review=options['candidate']+':'+options['expected_revision'], **options)
    assert result['status'] == 'FINALIZED'
    assert not (store.root / '.retirement').exists()


def test_cli_does_not_start_watchdog_or_create_log_without_ci(tmp_path, monkeypatch, capsys):
    import subprocess
    tool, store, _, options = _operator_fixture(tmp_path)
    ci = tmp_path / 'failed-ci.json'
    ci.write_text('{}')
    started = []
    def forbidden(*args, **kwargs):
        started.append(args)
        raise AssertionError('watchdog before CI gate')
    monkeypatch.setattr(subprocess, 'Popen', forbidden)
    assert tool.main(['--state',str(store.root.parent),'--operation','apply','--candidate',options['candidate'],
        '--ci-evidence',str(ci),'--reader-package',str(options['reader_package']),
        '--expected-revision',options['expected_revision'],'--backup',str(options['backup'])]) == 2
    assert not started
    assert not (store.root.parent / 'compaction-watchdog.log').exists()
    assert not (store.root / '.retirement').exists()
    assert json.loads(capsys.readouterr().out)['error_code'] == 'EXACT_CANDIDATE_CI_REQUIRED'


def test_archive_before_first_publication_still_drains_before_maintenance(tmp_path, monkeypatch):
    import multiprocessing
    import time

    import procurement_engine.archive_runtime as archive
    state = tmp_path / 'empty-report-state'
    context = multiprocessing.get_context('fork')
    entered, release, maintained = context.Event(), context.Event(), context.Event()
    def initial_archive(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return {'synthetic': True}
    monkeypatch.setattr(archive, '_ensure_archive_release', initial_archive)
    def prepare():
        archive.ensure_archive_release(state,day='2026-10-01',year=2026,quarter=3)
    def maintain():
        with PublicationStore(state / 'published')._maintenance_locks():
            maintained.set()
    reader = context.Process(target=prepare)
    writer = context.Process(target=maintain)
    reader.start()
    assert entered.wait(5)
    writer.start()
    time.sleep(0.15)
    try:
        assert not maintained.is_set()
    finally:
        release.set()
        reader.join(5)
        writer.join(5)
    assert reader.exitcode == writer.exitcode == 0


def test_exact_candidate_transport_runs_without_git_in_image_and_binds_tool_bytes(tmp_path):
    tool, store, _, options = _operator_fixture(tmp_path)
    assert hasattr(tool, 'candidate_source_receipt'), 'Missing authenticated exact-candidate transport'
    options['ci']['id'] = 1001
    from pathlib import Path
    fake = Path(tool.__file__).parents[1]
    receipt = tool.candidate_source_receipt(fake, options['candidate'], options['ci'], derivation_run_id=2002)
    (fake / '.git').rename(fake / '.git-not-mounted')
    result = tool.operate(store.root.parent, operation='apply', source_receipt=receipt, **options)
    assert result['status'] == 'COMPACTED'
    assert tool.operate(store.root.parent, operation='rollback', source_receipt=receipt, **options)['status'] == 'ROLLED_BACK'
    (fake / 'deploy/plan-weekly-publications.py').write_text('foreign transported tool')
    with pytest.raises(ValueError, match='EXACT_CANDIDATE_SOURCE_REQUIRED'):
        tool.operate(store.root.parent, operation='apply', source_receipt=receipt, **options)
    assert not (store.root / '.retirement').exists()


def test_operator_refuses_foreign_data_owner_before_creating_retirement(tmp_path, monkeypatch):
    import os
    tool, store, _, options = _operator_fixture(tmp_path)
    monkeypatch.setattr(os, 'geteuid', lambda: store.root.stat().st_uid + 1)
    with pytest.raises(ValueError, match='PUBLICATION_DATA_OWNER_MISMATCH'):
        tool.operate(store.root.parent, operation='apply', **options)
    assert not (store.root / '.retirement').exists()


def test_cli_refuses_pid1_applier_with_container_bound_watchdog(tmp_path, monkeypatch, capsys):
    import os
    tool, store, _, options = _operator_fixture(tmp_path)
    ci = tmp_path / 'successful-ci.json'
    ci.write_text(json.dumps(options['ci']))
    monkeypatch.setattr(os, 'getpid', lambda: 1)
    assert tool.main(['--state',str(store.root.parent),'--operation','apply','--candidate',options['candidate'],
        '--ci-evidence',str(ci),'--reader-package',str(options['reader_package']),
        '--expected-revision',options['expected_revision'],'--backup',str(options['backup'])]) == 2
    assert json.loads(capsys.readouterr().out)['error_code'] == 'WATCHDOG_LIFECYCLE_UNPROVEN'
    assert not (store.root / '.retirement').exists()


def test_explicit_bootstrap_makes_legacy_catalog_readable_without_worker_or_get_writes(tmp_path):
    import procurement_engine.publication_store as native
    store, _ = _compaction_fixture(tmp_path)
    lease = store.root.parent / 'publication-readers.lock'
    lease.unlink()
    before = store.database_path.read_bytes()
    assert hasattr(native, 'initialize_publication_readers'), 'Missing explicit rollout bootstrap'
    from procurement_engine.cli import main
    assert main(['initialize-publication-readers', '--state', str(store.root.parent)]) == 0
    inode = lease.stat().st_ino
    assert PublicationStore(store.root, readonly=True).latest()
    assert store.database_path.read_bytes() == before
    native.initialize_publication_readers(store.root.parent)
    assert lease.stat().st_ino == inode
    assert store.database_path.read_bytes() == before


def test_explicit_bootstrap_rejects_unsafe_existing_lease_without_replacement(tmp_path):
    import procurement_engine.publication_store as native
    store, _ = _compaction_fixture(tmp_path)
    lease = store.root.parent / 'publication-readers.lock'
    lease.unlink()
    foreign = tmp_path / 'foreign'
    foreign.write_text('do not change')
    lease.symlink_to(foreign)
    assert hasattr(native, 'initialize_publication_readers'), 'Missing explicit rollout bootstrap'
    with pytest.raises(PublicationError):
        native.initialize_publication_readers(store.root.parent)
    assert lease.is_symlink()
    assert foreign.read_text() == 'do not change'
