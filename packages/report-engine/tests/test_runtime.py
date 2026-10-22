import fcntl
import json

import pytest
from procurement_engine.constants import GRBS_ORDER
from procurement_engine.google_adapter import APPROVED_PRIMARY_TITLE_ALIASES
from procurement_engine.raw_pipeline import header_hash
from procurement_engine.runtime import run_once
from test_publication_store import PublicationStore, candidate, revisions


class Google:
    def _get(self, url, params):
        return {'files': []}

    def revision(self, provider):
        return 'revision1'

    def grid(self, provider, sheet_id):
        return {'title': 'ВСЕ' if provider.startswith('master-') else provider,
                'gridProperties': {'rowCount': 3, 'columnCount': 34}}

    def values(self, provider, title, start, end, columns):
        return [[], [], ['Synthetic header']][start - 1:end]


def inputs(root):
    sources = []
    for number, grbs in enumerate(GRBS_ORDER):
        sources.append({'source_id': f'master-{number}', 'provider_id': f'master-{number}',
                        'sheet': 'ВСЕ', 'sheet_id': 0, 'role': 'master', 'grbs': grbs,
                        'columns': 34, 'header_rows': 3, 'units': 'тыс. руб.',
                        'schema_fingerprint': header_hash([[], [], ['Synthetic header']], 3)})
    for sheet in ['Рабочий реестр процедур', 'Процедуры в работе']:
        sources.append({'source_id': sheet, 'provider_id': sheet, 'sheet': sheet,
                        'sheet_id': 0, 'role': 'procedure', 'grbs': None,
                        'columns': 34, 'header_rows': 3, 'units': 'руб.',
                        'schema_fingerprint': header_hash([[], [], ['Synthetic header']], 3)})
    registry = root / 'registry.json'; registry.write_text(json.dumps({'sources': sources}))
    ledger = root / 'ledger.json'; ledger.write_text('[]')
    return registry, ledger


def test_interrupted_attempt_has_durable_stage_and_is_closed_before_next_run(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'

    class Interrupted(Google):
        def revision(self, provider):
            raise KeyboardInterrupt('simulated process death')

    with pytest.raises(KeyboardInterrupt):
        run_once(registry, ledger, state, client=Interrupted())
    current = json.loads((state / 'status.json').read_text())
    path = state / 'attempts' / current['attempt_id'] / 'status.json'
    assert json.loads(path.read_text())['stage'] == 'acquisition'
    run_once(tmp_path / 'missing.json', ledger, state, client=Google())
    recovered = json.loads(path.read_text())
    assert recovered['status'] == 'NOT_ISSUED'
    assert recovered['error_code'] == 'REPORT_ATTEMPT_INTERRUPTED'
    assert recovered['failure_stage'] == 'acquisition'
    assert recovered['interrupted_detected_at']
    assert recovered['finished_at'] is None
    before = path.read_bytes()
    run_once(tmp_path / 'missing.json', ledger, state, client=Google())
    assert path.read_bytes() == before


def test_interruption_after_publication_commit_recovers_exact_receipt(tmp_path, monkeypatch):
    from test_weekly_archive import FormulaGoogle

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    publish = PublicationStore.publish
    committed = []
    def interrupted(self, *args, **kwargs):
        committed.append(publish(self, *args, **kwargs))
        raise KeyboardInterrupt('commit succeeded; response was lost')
    with monkeypatch.context() as patch:
        patch.setattr(PublicationStore, 'publish', interrupted)
        with pytest.raises(KeyboardInterrupt):
            run_once(registry, ledger, state, client=FormulaGoogle())
    current = json.loads((state / 'status.json').read_text())
    assert current['pending_release_id'] == committed[0]['release_id']
    run_once(tmp_path / 'missing.json', ledger, state, client=Google())
    recovered = json.loads((state / 'attempts' / current['attempt_id'] / 'status.json').read_text())
    assert recovered['status'] == committed[0]['status']
    assert recovered['publication']['release_id'] == committed[0]['release_id']
    assert recovered['recovered_publication'] is True
    assert recovered['finished_at'] == committed[0]['published_at']
    assert recovered['recovered_at'] >= recovered['finished_at']
    health = json.loads((state / 'report-health.json').read_text())
    assert health['last_success_at'] == committed[0]['published_at']
    assert PublicationStore(state / 'published').latest()['release_id'] == committed[0]['release_id']


def test_ordinary_error_after_commit_preserves_verified_publication(tmp_path, monkeypatch):
    from test_weekly_archive import FormulaGoogle

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    publish = PublicationStore.publish
    committed = []
    def failed_response(self, *args, **kwargs):
        committed.append(publish(self, *args, **kwargs))
        raise OSError('commit succeeded; response failed')
    monkeypatch.setattr(PublicationStore, 'publish', failed_response)
    status = run_once(registry, ledger, state, client=FormulaGoogle())
    assert status['status'] == committed[0]['status']
    assert status['publication']['release_id'] == committed[0]['release_id']
    assert status['finished_at'] == committed[0]['published_at']
    assert status['recovered_publication'] is True
    assert status['post_commit_error_code']
    assert status['private_error_saved'] is True


def test_terminal_journal_survives_failure_to_update_global_pointer(tmp_path, monkeypatch):
    from procurement_engine import runtime
    from test_weekly_archive import FormulaGoogle

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    write = runtime._write
    def failed_pointer(path, value):
        if path == state / 'status.json' and value.get('status') != 'RUNNING':
            raise OSError('global pointer write failed')
        return write(path, value)
    with monkeypatch.context() as patch:
        patch.setattr(runtime, '_write', failed_pointer)
        with pytest.raises(OSError):
            run_once(registry, ledger, state, client=FormulaGoogle())
    current = json.loads((state / 'status.json').read_text())
    journal = state / 'attempts' / current['attempt_id'] / 'status.json'
    before = journal.read_bytes()
    saved = json.loads(before)
    run_once(tmp_path / 'missing.json', ledger, state, client=Google())
    assert journal.read_bytes() == before
    health = json.loads((state / 'report-health.json').read_text())
    assert health['last_success_at'] == saved['finished_at']


def test_recovery_does_not_turn_corrupt_committed_publication_into_failed_attempt(tmp_path, monkeypatch):
    from procurement_engine.publication_store import PublicationError
    from test_weekly_archive import FormulaGoogle

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    publish = PublicationStore.publish
    def interrupted(self, *args, **kwargs):
        receipt = publish(self, *args, **kwargs)
        (self.releases / receipt['release_id'] / 'main_report.docx').write_bytes(b'corrupt')
        raise KeyboardInterrupt
    with monkeypatch.context() as patch:
        patch.setattr(PublicationStore, 'publish', interrupted)
        with pytest.raises(KeyboardInterrupt):
            run_once(registry, ledger, state, client=FormulaGoogle())
    before = (state / 'status.json').read_bytes()
    with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT'):
        run_once(tmp_path / 'missing.json', ledger, state, client=Google())
    assert (state / 'status.json').read_bytes() == before
    assert len(list((state / 'attempts').iterdir())) == 1


def test_sigkill_releases_writer_lock_and_next_run_recovers_journal(tmp_path):
    import multiprocessing
    import signal

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    context = multiprocessing.get_context('fork')
    ready = context.Event()
    class Paused(Google):
        def revision(self, provider):
            ready.set()
            signal.pause()
    process = context.Process(target=run_once, args=(registry, ledger, state), kwargs={'client': Paused()})
    process.start()
    try:
        assert ready.wait(15), f'Writer did not reach acquisition: {process.exitcode}'
        identifier = json.loads((state / 'status.json').read_text())['attempt_id']
        process.kill()
        process.join(15)
        assert process.exitcode == -signal.SIGKILL
        run_once(tmp_path / 'missing.json', ledger, state, client=Google())
        recovered = json.loads((state / 'attempts' / identifier / 'status.json').read_text())
        assert recovered['error_code'] == 'REPORT_ATTEMPT_INTERRUPTED'
    finally:
        if process.is_alive():
            process.kill()
        process.join(15)


@pytest.mark.parametrize('size', [1024*1024, 2*1024*1024])
def test_reused_attempt_storage_is_bounded_but_global_and_full_proof_remain_exact(tmp_path, size):
    import hashlib

    from test_publication_store import attempt_receipt
    store = PublicationStore(tmp_path / 'state/published')
    assurance = {'contract': 'actionable-assurance-v1', 'fully_automated': True,
                 'user_action_count': 0, 'engine_action_count': 0, 'active_recommendations': 0,
                 'link_status_counts': {}, 'action_status_counts': {}, 'actions': [], 'meaning': 'ёж ' + 'x'*size}
    if size > 1024*1024:
        assurance.update(contract='actionable-assurance-v2', source_observations=[], nonprocurement_identity_observations=0)
    receipt = store.publish(candidate(tmp_path / 'candidate', assurance=assurance), read_revisions=revisions)
    before = json.dumps(receipt)
    for attempt_id in ('a'*32, 'b'*32):
        original, path = attempt_receipt(store, receipt, attempt_id=attempt_id)
        assert path.stat().st_size < 16384, 'Repeated immutable assurance is copied into every observation'
        stored = json.loads(path.read_text())
        expected_hash = hashlib.sha256(json.dumps(assurance, ensure_ascii=False, sort_keys=True,
                                                  separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        assert stored['publication']['automation_assurance_ref'] == {'release_id': receipt['release_id'], 'content_sha256': expected_hash}
        assert json.loads((store.root.parent / 'status.json').read_text()) == original
        assert original['publication']['automation_assurance'] == assurance
        assert store.read_attempt(attempt_id) == original
    assert json.dumps(receipt) == before


@pytest.mark.parametrize('change', [
    {'status': 'NOT_ISSUED'}, {'reused_publication': False}, {'reused_publication': 1},
    {'snapshot_id': 'different'}, {'automation_assurance': {'meaning': 'Own different evidence'}},
])
def test_ineligible_attempt_retains_its_complete_evidence(tmp_path, change):
    from procurement_engine.runtime import _finish_attempt
    store = PublicationStore(tmp_path / 'state/published')
    receipt = store.publish(candidate(tmp_path / 'candidate', assurance={'meaning': 'Immutable evidence'}), read_revisions=revisions)
    attempt = store.root.parent / 'attempts' / ('a'*32); attempt.mkdir(parents=True)
    status = {'attempt_id': attempt.name, 'status': receipt['status'], 'publication': receipt,
              'snapshot_id': receipt['snapshot_id'], 'reused_publication': True, **change}
    _finish_attempt(store.root.parent, attempt, status)
    before = (attempt / 'status.json').read_bytes()
    assert json.loads((attempt / 'status.json').read_text()) == status
    assert store.read_attempt(attempt.name) == status
    assert (attempt / 'status.json').read_bytes() == before


@pytest.mark.parametrize('invalid', [float('nan'), float('inf'), object()])
@pytest.mark.parametrize('where', ['assurance', 'other'])
def test_compact_attempt_does_not_hide_original_nonfinite_serialization_error(tmp_path, where, invalid):
    from procurement_engine.runtime import _finish_attempt
    store = PublicationStore(tmp_path / 'state/published')
    receipt = {'release_id': 'REL-' + 'a'*64, 'model_sha256': 'a'*64, 'snapshot_id': 'snapshot',
               'status': 'VERIFIED', 'automation_assurance': {'meaning': invalid if where == 'assurance' else 'Normal'}}
    attempt = store.root.parent / 'attempts' / ('a'*32); attempt.mkdir(parents=True)
    status = {'attempt_id': attempt.name, 'status': 'VERIFIED', 'publication': receipt,
              'snapshot_id': 'snapshot', 'reused_publication': True}
    if where == 'other': status['unknown_field'] = invalid
    with pytest.raises((ValueError, TypeError)): _finish_attempt(store.root.parent, attempt, status)
    assert not (attempt / 'status.json').exists()
    assert not (store.root.parent / 'status.json').exists()


def test_real_capture_build_and_block_leave_previous_publication_available(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    previous = store.publish(candidate(tmp_path / 'old'), read_revisions=revisions)
    status = run_once(registry, ledger, state, client=Google())
    assert status['status'] == 'NOT_ISSUED'
    assert status['blockers']
    assert store.latest() == previous
    attempt = state / 'attempts' / status['attempt_id']
    assert (attempt / 'capture.json').is_file()
    assert (attempt / 'bundle/main_report.docx').is_file()
    assert (attempt / 'bundle/management_report.docx').is_file()
    assert (attempt / 'bundle/dashboard.json').is_file()
    assert json.loads((state / 'status.json').read_text()) == status


def test_access_failure_is_recorded_without_masking_it_as_empty_report(tmp_path):
    registry, ledger = inputs(tmp_path)

    class Unavailable(Google):
        def revision(self, provider):
            raise OSError('private network response')

    state = tmp_path / 'state'
    status = run_once(registry, ledger, state, client=Unavailable())
    assert status['status'] == 'NOT_ISSUED'
    assert status['error_code'] == 'GENERATION_FAILED'
    assert 'private network response' not in json.dumps(status)
    assert PublicationStore(state / 'published').latest() is None


def test_concurrent_command_does_not_overwrite_running_attempt_status(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'; state.mkdir()
    (state / 'status.json').write_text('{"status":"RUNNING"}')
    with (state / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = run_once(registry, ledger, state, client=Google())
    assert result['status'] == 'ALREADY_RUNNING'
    assert json.loads((state / 'status.json').read_text()) == {'status': 'RUNNING'}


def test_cli_failed_run_returns_nonzero_and_writes_readable_status(tmp_path, capsys):
    from procurement_engine.cli import main

    code = main(['run-google', '--registry', str(tmp_path / 'missing.json'),
                 '--ledger', str(tmp_path / 'ledger.json'), '--state', str(tmp_path / 'state')])
    assert code == 2
    result = json.loads(capsys.readouterr().out)
    assert result['status'] == 'NOT_ISSUED'
    assert (tmp_path / 'state/status.json').is_file()


def test_formula_proof_reaches_saved_snapshot_and_all_required_gates_pass(tmp_path):
    registry, ledger = inputs(tmp_path)

    class FormulaGoogle(Google):
        def formula_context(self, provider):
            return {'sheets': [{'sheetId': 0, 'title': self.grid(provider, 0)['title']}], 'named_ranges': []}

        def formulas(self, provider, title, start, end, columns):
            return self.values(provider, title, start, end, columns)

    state = tmp_path / 'state'
    status = run_once(registry, ledger, state, client=FormulaGoogle())
    assert status['status'] == 'VERIFIED'
    bundle = state / 'attempts' / status['attempt_id'] / 'bundle'
    model = json.loads((bundle / 'report_model.json').read_text())
    assert model['formula_dependencies']['closed']
    payload = json.loads((bundle / 'snapshot_bundle/payloads/master-0.json').read_text())
    assert payload['metadata']['formula_evidence']['formulas'] == []


def test_formula_evidence_changes_snapshot_identity_even_when_values_match(tmp_path):
    from copy import deepcopy

    from procurement_engine.google_adapter import capture_google
    from procurement_engine.raw_pipeline import bundle_from_capture

    registry_path, _ = inputs(tmp_path)
    registry = json.loads(registry_path.read_text())
    capture = capture_google(registry, Google())
    first = bundle_from_capture(capture, registry)
    modified = deepcopy(capture)
    modified['sources'][0]['formula_evidence'] = {'rows': 3, 'columns': 34,
                                               'formulas': [], 'sheets': [], 'named_ranges': []}
    second = bundle_from_capture(modified, registry)
    assert first.manifest['snapshot_id'] != second.manifest['snapshot_id']


def test_prefixed_snapshot_error_retains_safe_code_and_private_evidence(tmp_path):
    from procurement_engine.atomic_snapshot import AtomicSnapshotError

    registry, ledger = inputs(tmp_path)

    class Changed(Google):
        def revision(self, provider):
            raise AtomicSnapshotError('SOURCE_SCHEMA_CHANGED:private-source:private-fingerprint')

    state = tmp_path / 'state'
    status = run_once(registry, ledger, state, client=Changed())
    assert status['error_code'] == 'SOURCE_SCHEMA_CHANGED'
    assert 'private-source' not in json.dumps(status)
    evidence = json.loads((state / 'attempts' / status['attempt_id'] / 'error.json').read_text())
    assert evidence['message'] == 'SOURCE_SCHEMA_CHANGED:private-source:private-fingerprint'
    assert (state / 'attempts' / status['attempt_id'] / 'error.json').stat().st_mode & 0o777 == 0o600


def test_private_error_write_failure_does_not_leave_attempt_running(tmp_path, monkeypatch):
    from pathlib import Path

    from procurement_engine.atomic_snapshot import AtomicSnapshotError

    registry, ledger = inputs(tmp_path)
    original = Path.open

    def open_path(path, *args, **kwargs):
        if path.name == 'error.json':
            raise PermissionError('private diagnostics unavailable')
        return original(path, *args, **kwargs)

    class Changed(Google):
        def revision(self, _):
            raise AtomicSnapshotError('SOURCE_SCHEMA_CHANGED:private-source')

    monkeypatch.setattr(Path, 'open', open_path)
    status = run_once(registry, ledger, tmp_path / 'state', client=Changed())
    assert status['status'] == 'NOT_ISSUED'
    assert status['error_code'] == 'SOURCE_SCHEMA_CHANGED'
    assert status['private_error_saved'] is False
    assert json.loads((tmp_path / 'state/status.json').read_text()) == status


@pytest.mark.parametrize('message, expected', [
    ('GOOGLE_READ_HTTP_429', 'GOOGLE_READ_HTTP_429'),
    ('GOOGLE_FORMULA_ERROR:private-book:17', 'GOOGLE_FORMULA_ERROR'),
    ('SOURCE_CHANGED_DURING_FREEZE:private-book', 'SOURCE_CHANGED_DURING_FREEZE'),
    ('PRIVATE_SECRET', 'GENERATION_FAILED'),
])
def test_acquisition_error_code_survives_public_summary_without_private_details(tmp_path, message, expected):
    from procurement_engine.deployment_diagnostics import summarize_status
    from procurement_engine.google_adapter import GoogleReadError

    registry, ledger = inputs(tmp_path)

    class Failed(Google):
        def revision(self, provider):
            raise GoogleReadError(message)

    state = tmp_path / 'state'
    status = run_once(registry, ledger, state, client=Failed())
    assert status['error_code'] == expected
    assert summarize_status(status)['error_code'] == expected
    assert 'PRIVATE_SECRET' not in json.dumps(status)
    assert 'private-book' not in json.dumps(status)
    evidence = json.loads((state / 'attempts' / status['attempt_id'] / 'error.json').read_text())
    assert evidence['message'] == message
    assert evidence['attempt_id'] == status['attempt_id']
    assert evidence['stage'] == 'acquisition'
    assert 'revision' in evidence['traceback']


def test_missing_input_failure_is_distinguished_from_acquisition(tmp_path):
    state = tmp_path / 'state'
    status = run_once(tmp_path / 'missing.json', tmp_path / 'ledger.json', state, client=Google())
    assert status['failure_stage'] == 'inputs'
    evidence = json.loads((state / 'attempts' / status['attempt_id'] / 'error.json').read_text())
    assert evidence['stage'] == 'inputs'


def test_cli_run_emits_bounded_receipt_without_duplicating_assurance(tmp_path, capsys, monkeypatch):
    from procurement_engine import runtime
    from procurement_engine.cli import main

    status = {'status': 'VERIFIED', 'attempt_id': 'a' * 32,
              'automation_assurance': {'evidence': 'x' * 2_000_000},
              'publication': {'release_id': 'REL-' + 'b' * 64,
                              'automation_assurance': {'evidence': 'x' * 2_000_000}}}
    monkeypatch.setattr(runtime, 'run_once', lambda *args: status)
    code = main(['run-google', '--registry', 'registry.json', '--ledger', 'ledger.json',
                 '--state', str(tmp_path)])
    output = capsys.readouterr().out
    assert code == 0
    assert len(output.encode()) < 4096
    assert json.loads(output) == {'status': 'VERIFIED', 'attempt_id': 'a' * 32,
                                'release_id': 'REL-' + 'b' * 64}
    assert len(status['automation_assurance']['evidence']) == 2_000_000


def test_cli_busy_worker_is_not_a_successful_release(tmp_path, capsys):
    from procurement_engine.cli import main

    state = tmp_path / 'state'
    state.mkdir()
    (state / 'status.json').write_text('{"status":"VERIFIED","attempt_id":"previous"}')
    with (state / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = main(['run-google', '--registry', str(tmp_path / 'registry.json'),
                       '--ledger', str(tmp_path / 'ledger.json'), '--state', str(state)])
    assert result != 0
    assert json.loads(capsys.readouterr().out) == {'status': 'ALREADY_RUNNING'}
    assert json.loads((state / 'status.json').read_text())['attempt_id'] == 'previous'


def test_review_evidence_change_reissues_even_when_google_cells_are_unchanged(tmp_path, monkeypatch):
    from procurement_engine import report_health, runtime
    from procurement_engine.identity_store import IdentityStore
    from test_identity_and_metrics import row

    registry, ledger = inputs(tmp_path)

    class FormulaGoogle(Google):
        def formula_context(self, provider):
            return {'sheets': [{'sheetId': 0, 'title': self.grid(provider, 0)['title']}], 'named_ranges': []}

        def formulas(self, provider, title, start, end, columns):
            return self.values(provider, title, start, end, columns)

    state = tmp_path / 'state'
    identities = IdentityStore(state / 'identity.sqlite')
    initial = identities.ingest([row()], snapshot_id='seed', captured_at='2026-09-01T00:00:00Z')
    builds = []
    original_build = runtime.build_from_capture
    def tracked_build(*args, **kwargs):
        builds.append(True)
        return original_build(*args, **kwargs)
    monkeypatch.setattr(runtime, 'build_from_capture', tracked_build)
    first = run_once(registry, ledger, state, client=FormulaGoogle())
    unchanged = run_once(registry, ledger, state, client=FormulaGoogle())
    assert unchanged['reused_publication'] is True
    assert len(builds) == 1
    assert unchanged['publication']['release_id'] == first['publication']['release_id']
    assert json.loads((state / 'report-health.json').read_text())['last_success_at'] == unchanged['finished_at']
    original_record = report_health.record_attempt
    def denied_health(*args):
        raise OSError('private filesystem detail')
    monkeypatch.setattr(report_health, 'record_attempt', denied_health)
    denied = run_once(registry, ledger, state, client=FormulaGoogle())
    assert denied['status'] == unchanged['status']
    assert denied['reused_publication'] is True
    assert denied['publication']['release_id'] == unchanged['publication']['release_id']
    assert len(builds) == 1
    monkeypatch.setattr(report_health, 'record_attempt', original_record)
    identities.record_review(snapshot_id='seed', locator=row().physical_row_key,
        uid=initial['rows'][0]['procurement_uid'], reviewer='Ревизор',
        reviewed_at='2026-09-02T00:00:00Z', evidence={'source_ref': 'protocol/1', 'reason': 'Подтверждено'})
    updated = run_once(registry, ledger, state, client=FormulaGoogle())
    assert updated['status'] == 'VERIFIED'
    assert not updated.get('reused_publication')
    assert updated['snapshot_id'] != first['snapshot_id']


def test_revision_versions_are_private_and_public_status_keeps_only_code(tmp_path):
    from procurement_engine.atomic_snapshot import AtomicSnapshotError

    registry, ledger = inputs(tmp_path)

    class Drift(Google):
        def revision(self, provider):
            raise AtomicSnapshotError('SOURCE_CHANGED_DURING_FREEZE:private-source',
                evidence={'before': {'private-source': 'private-v1'},
                          'after': {'private-source': 'private-v2'}})

    state = tmp_path / 'state'
    status = run_once(registry, ledger, state, client=Drift())
    assert status['error_code'] == 'SOURCE_CHANGED_DURING_FREEZE'
    assert 'private-' not in json.dumps(status)
    error = json.loads((state / 'attempts' / status['attempt_id'] / 'error.json').read_text())
    assert error['evidence'] == {'before': {'private-source': 'private-v1'},
                                 'after': {'private-source': 'private-v2'}}


def test_sqlite_failure_keeps_machine_code_without_public_message(tmp_path, monkeypatch):
    import sqlite3

    registry, ledger = inputs(tmp_path)

    class FormulaGoogle(Google):
        def formula_context(self, provider):
            return {'sheets': [{'sheetId': 0, 'title': self.grid(provider, 0)['title']}], 'named_ranges': []}

        def formulas(self, provider, title, start, end, columns):
            return self.values(provider, title, start, end, columns)

    original_publish = PublicationStore.publish

    def fail_publish(self, *args, **kwargs):
        error = sqlite3.OperationalError('private database path and table')
        error.sqlite_errorname = 'SQLITE_BUSY'
        raise error

    monkeypatch.setattr(PublicationStore, 'publish', fail_publish)
    state = tmp_path / 'state'
    status = run_once(registry, ledger, state, client=FormulaGoogle())
    assert status['status'] == 'NOT_ISSUED'
    assert status['failure_stage'] == 'publication'
    assert status['error_type'] == 'OperationalError'
    assert status['sqlite_error'] == 'SQLITE_BUSY'
    assert 'private database' not in json.dumps(status)
    evidence = json.loads((state / 'attempts' / status['attempt_id'] / 'error.json').read_text())
    assert evidence['sqlite_error'] == 'SQLITE_BUSY'
    assert evidence['message'] == 'private database path and table'

    monkeypatch.setattr(PublicationStore, 'publish', original_publish)


def test_identity_recovery_degradation_is_visible_in_attempt_status(tmp_path, monkeypatch):
    from procurement_engine.identity_store import IdentityStore
    registry, ledger = inputs(tmp_path)
    def recover(self, *a, diagnostics=None, **kw):
        if diagnostics is not None:
            diagnostics.update(skipped_transient_donors=1, unrecovered_snapshots=1)
        return 0
    monkeypatch.setattr(IdentityStore, 'recover_latest_plan_signatures', recover)
    status = run_once(registry, ledger, tmp_path / 'state', client=Google())
    assert status['identity_recovery'] == {'skipped_transient_donors': 1, 'unrecovered_snapshots': 1}

@pytest.mark.parametrize('drift', ['hidden', 'format', 'money', 'date', 'formula', 'schema', 'geometry', 'dependency', 'unstable', 'late_unstable', 'read_error'])
def test_final_barrier_rechecks_source_content_not_workbook_presentation(tmp_path, monkeypatch, drift):
    from procurement_engine import runtime
    registry, ledger = inputs(tmp_path)

    class Rechecked(Google):
        changed = False
        checks = 0
        def revision(self, provider):
            if self.changed and provider == 'master-0':
                self.checks += 1
                return 'revision3' if ((drift == 'unstable' and self.checks > 1)
                                       or (drift == 'late_unstable' and self.checks > 2)) else 'revision2'
            return 'revision1'
        def grid(self, provider, sheet_id):
            result = super().grid(provider, sheet_id)
            if self.changed and provider == 'master-0' and drift == 'geometry':
                result['gridProperties']['rowCount'] = 4
            return result
        def formula_context(self, provider):
            extra = {'sheetId': 99, 'title': 'Unregistered system',
                     'gridProperties': {'rowCount': 65, 'columnCount': 12}, 'hidden': False, 'index': 1}
            if self.changed and provider == 'master-0':
                extra['hidden'] = True
                if drift == 'format': extra['gridProperties']['frozenRowCount'] = 2
            return {'sheets': [{'sheetId': 0, **self.grid(provider, 0)}, extra],
                    'named_ranges': ([{'name': 'Dependency', 'range': {'sheetId': 99, 'endRowIndex': 5}}]
                                     if self.changed and provider == 'master-0' and drift == 'dependency' else [])}
        def values(self, provider, title, start, end, columns):
            if self.changed and provider == 'master-0' and drift == 'read_error': raise OSError('private read failure')
            result = super().values(provider, title, start, end, columns)
            if self.changed and provider == 'master-0' and start == 1:
                if drift == 'money': result[1] = [1500]
                if drift == 'date': result[1] = ['12.10.2026']
                if drift == 'schema': result[2] = ['Changed header']
            return result
        def formulas(self, provider, title, start, end, columns):
            result = self.values(provider, title, start, end, columns)
            if self.changed and provider == 'master-0' and drift == 'formula': result[1] = ['=1+2']
            return result
    client = Rechecked()
    original = runtime.build_from_capture
    def build(*args, **kwargs):
        result = original(*args, **kwargs)
        client.changed = True
        return result
    monkeypatch.setattr(runtime, 'build_from_capture', build)
    state = tmp_path / 'state'
    status = run_once(registry, ledger, state, client=client)
    if drift in {'hidden', 'format'}:
        assert status['status'] == 'VERIFIED'
        receipt = status['publication']
        assert receipt['source_revisions_at_publish']['master-0'] == 'revision2'
        assert receipt['source_equivalence_at_publish']['master-0']['captured_revision'] == 'revision1'
        capture = json.loads((state / 'attempts' / status['attempt_id'] / 'capture.json').read_text())
        assert capture['sources'][0]['after'] == 'revision1'
        assert capture['sources'][0]['formula_evidence']['sheets'][1]['hidden'] is False
    else:
        assert status['status'] == 'NOT_ISSUED'
        assert PublicationStore(state / 'published').latest() is None

@pytest.mark.parametrize('key', ['SOURCE_CONTRACT', 'HISTORICAL_RECOMMENDATIONS', 'IDENTITY_REVIEWS', 'WEEKLY_BASELINE', 'RECOMMENDATION_HISTORY_EVIDENCE'])
def test_source_equivalence_never_authorizes_local_or_history_drift(tmp_path, key):
    from procurement_engine.publication_store import _revisions_equivalent
    expected = {'master': 'version1', key: 'original'}
    actual = {'master': 'version1', key: 'changed'}
    assert not _revisions_equivalent(tmp_path, expected, actual, {})


def test_publication_proof_requires_exact_key_set_and_stable_actual_tokens(tmp_path):
    from procurement_engine.publication_store import _revisions_equivalent
    assert not _revisions_equivalent(tmp_path, {'master': 'one'}, {}, {})
    assert not _revisions_equivalent(tmp_path, {'master': 'one'}, {'master': 'one', 'foreign': 'one'}, {})
    assert not _revisions_equivalent(tmp_path, {'master': 'one'}, {'master': 'two'}, {})

@pytest.mark.parametrize('drift', ['contract', 'ledger', 'identity', 'history'])
def test_equivalent_google_sources_still_block_changed_non_google_evidence(tmp_path, monkeypatch, drift):
    from procurement_engine import runtime
    registry, ledger = inputs(tmp_path)
    class StableContent(Google):
        changed = False
        def revision(self, provider):
            return 'revision2' if self.changed and provider == 'master-0' else 'revision1'
        def formula_context(self, provider):
            return {'sheets': [{'sheetId': 0, **self.grid(provider, 0)}], 'named_ranges': []}
        def formulas(self, *args): return self.values(*args)
    client = StableContent()
    original_build = runtime.build_from_capture
    original_reviews = runtime.IdentityStore.review_evidence
    original_history = runtime.read_google_history
    def reviews(self, **kwargs):
        return [{'changed_review': True}] if client.changed and drift == 'identity' else original_reviews(self, **kwargs)
    def history(*args, **kwargs):
        result = original_history(*args, **kwargs)
        if client.changed and drift == 'history': return result[0], result[1], {'changed': True}
        return result
    def build(*args, **kwargs):
        result = original_build(*args, **kwargs)
        client.changed = True
        if drift == 'contract':
            data = json.loads(registry.read_text()); data['changed_contract'] = True
            registry.write_text(json.dumps(data))
        if drift == 'ledger': ledger.write_text('[{"original":"Changed historical evidence"}]')
        return result
    monkeypatch.setattr(runtime, 'build_from_capture', build)
    monkeypatch.setattr(runtime.IdentityStore, 'review_evidence', reviews)
    monkeypatch.setattr(runtime, 'read_google_history', history)
    state = tmp_path / 'state'
    result = run_once(registry, ledger, state, client=client)
    assert result['status'] == 'NOT_ISSUED'
    assert result['error_code'] == 'SOURCE_CHANGED_BEFORE_PUBLICATION'
    assert PublicationStore(state / 'published').latest() is None

@pytest.mark.parametrize('alias', list(APPROVED_PRIMARY_TITLE_ALIASES.items()))
@pytest.mark.parametrize('unapproved_rename', [False, True])
def test_approved_primary_alias_remains_equivalent_on_workbook_only_drift(tmp_path, alias, unapproved_rename):
    from procurement_engine.google_adapter import (
        GoogleReadError,
        capture_google,
        recheck_google_sources,
    )
    from procurement_engine.publication_store import _revisions_equivalent
    from procurement_engine.raw_pipeline import bundle_from_capture
    from procurement_engine.snapshot_bundle_io import persist_atomic_bundle
    registry, _ = inputs(tmp_path)
    (provider, sheet_id, registered_title), live_title = alias
    data = json.loads(registry.read_text())
    data['sources'][0].update(provider_id=provider, sheet_id=sheet_id, sheet=registered_title)
    # A reviewed primary workbook has a real A:AH header. Previously this
    # synthetic fixture supplied only "Synthetic header" at A3; the strict
    # source reader correctly rejected it as a changed meaning in column A.
    # Preserve the guard; give this renamed *primary* the canonical header.
    from procurement_engine.department_directory import MASTER_FIELDS
    reviewed_header = [''] * 34
    for field in MASTER_FIELDS.values():
        reviewed_header[field['index']] = field['label']
    data['sources'][0]['schema_fingerprint'] = header_hash(
        [[], [], reviewed_header], 3,
    )
    class AliasGoogle(Google):
        changed = False
        def revision(self, book):
            return 'revision2' if self.changed and book == provider else 'revision1'
        def grid(self, book, tab):
            if book == provider:
                assert tab == sheet_id
                return {'title': 'Unapproved rename' if self.changed and unapproved_rename else live_title,
                        'gridProperties': {'rowCount': 3, 'columnCount': 34}}
            return super().grid(book, tab)
        def formula_context(self, book):
            return {'sheets': [{'sheetId': sheet_id if book == provider else 0,
                               **self.grid(book, sheet_id if book == provider else 0),
                               'hidden': self.changed}], 'named_ranges': []}
        def values(self, book, title, start, end, columns):
            if book == provider:
                return [[], [], reviewed_header][start - 1:end]
            return super().values(book, title, start, end, columns)
        def formulas(self, *args): return self.values(*args)
    client = AliasGoogle()
    capture = capture_google(data, client)
    bundle = bundle_from_capture(capture, data)
    stage = tmp_path / 'stage'
    persist_atomic_bundle(bundle, stage / 'snapshot_bundle')
    original_manifest = (stage / 'snapshot_bundle/manifest.json').read_bytes()
    client.changed = True
    if unapproved_rename:
        with pytest.raises(GoogleReadError, match='GOOGLE_SHEET_TITLE_CHANGED_REVIEW_CONTRACT'):
            recheck_google_sources(data, capture, client)
    else:
        observed, proof = recheck_google_sources(data, capture, client)
        assert _revisions_equivalent(stage, bundle.after, {**bundle.after, **observed}, proof)
        assert observed['master-0'] == 'revision2'
        assert proof['master-0']['captured_revision'] == 'revision1'
    assert capture['sources'][0]['sheet'] == registered_title
    assert capture['sources'][0]['formula_evidence']['sheets'][0]['title'] == live_title
    assert capture['sources'][0]['formula_evidence']['sheets'][0]['hidden'] is False
    assert (stage / 'snapshot_bundle/manifest.json').read_bytes() == original_manifest
