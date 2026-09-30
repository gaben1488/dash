import fcntl
import json

import pytest
from procurement_engine.constants import GRBS_ORDER
from procurement_engine.raw_pipeline import header_hash
from procurement_engine.runtime import run_once
from test_publication_store import PublicationStore, candidate, revisions


class Google:
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


def test_review_evidence_change_reissues_even_when_google_cells_are_unchanged(tmp_path):
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
    first = run_once(registry, ledger, state, client=FormulaGoogle())
    unchanged = run_once(registry, ledger, state, client=FormulaGoogle())
    assert unchanged['reused_publication'] is True
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
