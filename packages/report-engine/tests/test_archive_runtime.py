"""Offline archived selection exercises the real model, audits, Word and publisher."""
import hashlib
import json
import shutil
import sqlite3

import pytest
from procurement_engine.archive_runtime import (
    ArchiveError,
    build_archived_release,
    ensure_archive_release,
    legacy_coverage,
    load_frozen_input,
)
from procurement_engine.google_adapter import capture_google
from procurement_engine.identity_store import IdentityStore
from procurement_engine.publication_reader import read_publication
from procurement_engine.publication_store import PublicationStore, _validate
from procurement_engine.raw_pipeline import build_from_capture
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


def hashes(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file() and not p.name.endswith(('-wal', '-shm'))}


@pytest.fixture(scope='module')
def original(tmp_path_factory):
    root = tmp_path_factory.mktemp('original-week')
    registry, _ = inputs(root)
    contract = json.loads(registry.read_text())
    synthetic_rows = []
    for month, year, amount in ((5, 2034, 40), (8, 2034, 70), (3, 2033, 20)):
        row = [''] * 34
        row[:7] = ['', 'УЭР', 'Synthetic', '', '', 'Поставка', f'Synthetic {month} {year}']
        row[7:16] = [0, 0, amount, amount, 'ЕП', 'Основание из архива', f'01.{month:02d}.{year}', (month - 1) // 3 + 1, year]
        row[21:30] = [0, 0, 0, 0, 0, 0, 0, 0, 'нет']
        row[31] = 'Комментарий архивной недели'
        synthetic_rows.append(row)
    class Frozen(CompleteGoogle):
        def grid(self, provider, sheet_id):
            grid = super().grid(provider, sheet_id)
            if provider == 'master-0':
                grid['gridProperties']['rowCount'] = 6
            return grid

        def values(self, provider, title, start, end, columns):
            values = [[], [], ['Synthetic header']] + (synthetic_rows if provider == 'master-0' else [])
            return values[start - 1:end]
    capture = capture_google(contract, Frozen())
    # Deliberate synthetic frozen input, not relabelled live business data.
    capture.update(captured_at='2034-09-28T12:00:00+12:00', report_date='28.09.2034', report_year=2034)
    output = root / 'frozen'
    model = build_from_capture(capture, contract, [], output, identity_store=IdentityStore(root / 'identity.sqlite'))
    assert model['release']['official_release_allowed']
    _validate(output)
    return output


@pytest.mark.parametrize('year,quarter,count,amount', [(2034, 2, 1, 40), (2034, 3, 1, 70), (2033, 1, 1, 20)])
def test_arbitrary_plan_period_keeps_original_cutoff_and_never_reads_current_data(original, tmp_path, monkeypatch, year, quarter, count, amount):
    import procurement_engine.google_adapter as adapter
    def no_google(*args, **kwargs):
        raise AssertionError('Archive attempted a live request')
    monkeypatch.setattr(adapter.GoogleReadClient, '__init__', no_google)
    before = hashes(original)
    state = tmp_path / 'state'
    # These later inputs must not be opened or repaired during archive replay.
    (state / 'inputs').mkdir(parents=True)
    (state / 'inputs/ledger.json').write_text('NOT JSON: current, irrelevant')
    (state / 'identity.sqlite').write_bytes(b'NOT SQLITE: current, irrelevant')
    (state / 'status.json').write_text('{"status":"RUNNING"}')
    result = build_archived_release(original, state, day='2034-09-28', year=year, quarter=quarter)
    assert result['source_verification'] == 'FROZEN_ARCHIVE_HASHES'
    model = json.loads((state / 'published/releases' / result['release_id'] / 'report_model.json').read_text())
    block = model['headline']['single_supplier']['quarter']
    assert block['plan_count'] == count and block['plan_amount'] == amount and block['fact_count'] == 0
    assert model['snapshot']['cutoff_at'] == '2034-09-28T12:00:00+12:00'
    assert model['independent_audit']['pass']
    assert model['snapshot']['report_scope'] == {'year': year, 'quarter': quarter}
    for view in ('main', 'supplement'):
        assert read_publication(state, view, result['release_id']).startswith(b'PK')
    assert hashes(original) == before
    assert (state / 'identity.sqlite').read_bytes().startswith(b'NOT SQLITE')
    assert json.loads((state / 'status.json').read_text()) == {'status': 'RUNNING'}


def test_no_fallback_to_another_week_or_newer_ledger(original, tmp_path):
    state = tmp_path / 'state'
    shutil.copytree(original, state / 'archives/week')
    result = ensure_archive_release(state, day='2034-09-21', year=2034, quarter=3)
    assert result['selected'] is None
    assert result['archive']['code'] == 'ARCHIVE_NOT_FOUND'
    assert not (state / 'published/publications.sqlite').exists()


def test_missing_legacy_sections_are_not_fabricated(tmp_path):
    db = tmp_path / 'legacy.sqlite'
    with sqlite3.connect(db) as cx:
        cx.execute('CREATE TABLE snapshots (created_at TEXT, data TEXT)')
        cx.execute('INSERT INTO snapshots VALUES (?,?)', ('2034-09-27T13:00:00Z', json.dumps({'rowsByDept': {'УЭР': [['old']]}})))
    before = hashes(tmp_path)
    assert legacy_coverage(db, '2034-09-28')['rows'] == 1
    result = ensure_archive_release(tmp_path / 'state', day='2034-09-28', year=2034, quarter=3, legacy_database=db)
    assert result['archive']['code'] == 'ARCHIVE_INPUT_INCOMPLETE'
    assert len(result['archive']['coverage']['missing_sections']) == 3
    assert hashes(tmp_path)['legacy.sqlite'] == before['legacy.sqlite']
    assert result['selected'] is None


def test_repeat_archive_selection_reuses_the_same_immutable_pair(original, tmp_path):
    state = tmp_path / 'state'
    shutil.copytree(original, state / 'archives/week')
    first = ensure_archive_release(state, day='2034-09-28', year=2034, quarter=2)
    assert first['selected'] is not None, first
    second = ensure_archive_release(state, day='2034-09-28', year=2034, quarter=2)
    assert first['selected']['release_id'] == second['selected']['release_id']
    assert len(PublicationStore(state / 'published', readonly=True).history()) == 1


def test_missing_identity_and_damaged_payload_never_publish(original, tmp_path):
    copy = tmp_path / 'copy'; shutil.copytree(original, copy)
    (copy / 'identity.sqlite').unlink()
    with pytest.raises(ArchiveError, match='ARCHIVE_INPUT_INCOMPLETE'):
        load_frozen_input(copy, day='2034-09-28', year=2034, quarter=3)
    shutil.copyfile(original / 'identity.sqlite', copy / 'identity.sqlite')
    next((copy / 'snapshot_bundle/payloads').glob('*.json')).write_text('{}')
    with pytest.raises(ArchiveError, match='ARCHIVE_CORRUPT'):
        load_frozen_input(copy, day='2034-09-28', year=2034, quarter=3)


@pytest.mark.parametrize('day,year,quarter', [('2034-02-30', 2034, 1), ('2034-09-28', True, 3), ('2034-09-28', 2034, 0)])
def test_bad_selection_never_creates_an_attempt(tmp_path, day, year, quarter):
    with pytest.raises(ArchiveError, match='PUBLICATION_CONTEXT_INVALID'):
        ensure_archive_release(tmp_path / 'state', day=day, year=year, quarter=quarter)
    assert not (tmp_path / 'state').exists()


def test_final_archive_barrier_rejects_changed_original(original, tmp_path, monkeypatch):
    from procurement_engine import archive_runtime as runtime
    source = tmp_path / 'original'
    shutil.copytree(original, source)
    build = runtime.build_from_capture
    def change_source(*args, **kwargs):
        result = build(*args, **kwargs)
        (source / 'identity.sqlite').write_bytes(b'changed after model calculation')
        return result
    monkeypatch.setattr(runtime, 'build_from_capture', change_source)
    with pytest.raises(ArchiveError, match='ARCHIVE_CHANGED'):
        build_archived_release(source, tmp_path / 'state', day='2034-09-28', year=2034, quarter=2)
    assert PublicationStore(tmp_path / 'state/published', readonly=True).latest() is None


def test_archive_cli_and_status_use_same_exact_context(original, tmp_path, capsys):
    from procurement_engine.cli import main
    state = tmp_path / 'state'
    shutil.copytree(original, state / 'archives/week')
    assert main(['run-archive', '--state', str(state), '--report-date', '2034-09-28',
                 '--report-year', '2034', '--quarter', '2']) == 0
    result = json.loads(capsys.readouterr().out)
    assert result['archive']['status'] == 'READY'
    status = json.loads(read_publication(state, 'status', selection=('2034-09-28', 2034, 2)))
    assert status['selected']['release_id'] == result['selected']['release_id']
    assert status['archive']['status'] == 'READY'
    assert not (state / 'status.json').exists()


def test_interrupted_build_cannot_remain_running_forever(tmp_path):
    folder = tmp_path / 'archive_attempts/2034-09-28-2034-q2'
    folder.mkdir(parents=True)
    (folder / 'run.lock').touch()
    (folder / 'status.json').write_text(json.dumps({'archive': {
        'status': 'RUNNING', 'code': 'ARCHIVE_BUSY', 'message': 'running'}}))
    result = json.loads(read_publication(tmp_path, 'status', selection=('2034-09-28', 2034, 2)))
    assert result['archive']['status'] == 'NOT_ISSUED'
    assert result['archive']['code'] == 'ARCHIVE_BUILD_FAILED'


def test_same_context_lock_prevents_duplicate_build(tmp_path):
    import fcntl
    folder = tmp_path / 'archive_attempts/2034-09-28-2034-q2'
    folder.mkdir(parents=True)
    with (folder / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = ensure_archive_release(tmp_path, day='2034-09-28', year=2034, quarter=2)
    assert result['archive']['code'] == 'ARCHIVE_BUSY'
    assert not (tmp_path / 'published/publications.sqlite').exists()


def test_archive_rebuild_does_not_replace_latest_live_or_comparison_baseline(original, tmp_path):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    expected = json.loads((original / 'snapshot_bundle/bundle.json').read_text())['after']
    live = store.publish(original, read_revisions=lambda: expected)
    archived = build_archived_release(original, state, day='2034-09-28', year=2033, quarter=1)
    assert archived['release_id'] != live['release_id']
    # A new archive receipt must not feed the live worker or its delta baseline.
    assert store.latest()['release_id'] == live['release_id']
    assert store.previous_model('29.09.2034')['receipt']['release_id'] == live['release_id']
    assert store.select('2034-09-28', 2033, 1)['release_id'] == archived['release_id']
    assert len(store.history()) == 2


def test_archive_only_catalog_has_no_live_latest_or_live_baseline(original, tmp_path):
    state = tmp_path / 'state'
    archived = build_archived_release(original, state, day='2034-09-28', year=2033, quarter=1)
    store = PublicationStore(state / 'published')
    assert store.latest() is None
    assert store.previous_model('29.09.2034') is None
    assert store.select('2034-09-28', 2033, 1)['release_id'] == archived['release_id']


def test_native_archive_selection_never_imports_old_xlsx_inbox(tmp_path, monkeypatch):
    import archive_tools.file_archive as intake
    monkeypatch.setattr(intake, 'import_inbox_week', lambda *a: pytest.fail('runtime accessed historical XLSX inbox'))
    result = ensure_archive_release(tmp_path, day='2034-09-28', year=2034, quarter=3)
    assert result['archive']['code'] == 'ARCHIVE_NOT_FOUND'
    assert result['selected'] is None
