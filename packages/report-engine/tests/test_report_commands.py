import fcntl
import json

import pytest
from procurement_engine import runtime
from test_runtime import Google, inputs


def test_accepted_command_survives_new_invocation_and_has_the_same_attempt_id(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    accepted = runtime.enqueue_report(registry, ledger, state)
    assert accepted['status'] == 'QUEUED'
    assert runtime.read_report_command(state, accepted['attempt_id']) == accepted
    assert runtime.enqueue_report(registry, ledger, state)['attempt_id'] == accepted['attempt_id']
    result = runtime.run_once(registry, ledger, state, client=Google())
    assert result['attempt_id'] == accepted['attempt_id']
    assert runtime.read_report_command(state, accepted['attempt_id'])['status'] == result['status']
    assert not runtime.has_pending_report(state)


def test_changed_inputs_fail_accepted_command_without_reading_google(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    command = runtime.enqueue_report(registry, ledger, state)
    ledger.write_text('[{"changed":true}]')
    result = runtime.run_once(registry, ledger, state, client=object())
    assert result['attempt_id'] == command['attempt_id']
    assert result['status'] == 'NOT_ISSUED'
    assert result['error_code'] == 'REPORT_COMMAND_INPUTS_CHANGED'


def test_failed_admission_does_not_acknowledge_a_command(tmp_path, monkeypatch):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    def fail(*_args):
        raise OSError('disk full')
    monkeypatch.setattr(runtime, '_write', fail)
    with pytest.raises(OSError, match='disk full'):
        runtime.enqueue_report(registry, ledger, state)
    assert not runtime.has_pending_report(state)


def test_new_request_does_not_join_a_capture_that_has_already_started(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    first = runtime.enqueue_report(registry, ledger, state)
    queued = []
    class DuringCapture(Google):
        def revision(self, provider):
            if not queued:
                queued.append(runtime.enqueue_report(registry, ledger, state))
            return super().revision(provider)
    result = runtime.run_once(registry, ledger, state, client=DuringCapture())
    assert result['attempt_id'] == first['attempt_id']
    assert queued[0]['attempt_id'] != first['attempt_id']
    assert runtime.has_pending_report(state)
    following = runtime.run_once(registry, ledger, state, client=Google())
    assert following['attempt_id'] == queued[0]['attempt_id']


def test_receipt_does_not_expose_private_evidence_and_rejects_path_traversal(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    accepted = runtime.enqueue_report(registry, ledger, state)
    path = state / 'commands' / (accepted['attempt_id'] + '.json')
    value = json.loads(path.read_text())
    value['private_evidence'] = 'SECRET'
    path.write_text(json.dumps(value))
    assert 'SECRET' not in json.dumps(runtime.read_report_command(state, accepted['attempt_id']))
    with pytest.raises(ValueError, match='REPORT_COMMAND_ID_INVALID'):
        runtime.read_report_command(state, '../private')


def test_busy_executor_keeps_accepted_command_for_its_next_pass(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    accepted = runtime.enqueue_report(registry, ledger, state)
    with (state / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert runtime.run_once(registry, ledger, state) == {'status': 'ALREADY_RUNNING'}
        assert runtime.read_report_command(state, accepted['attempt_id'])['status'] == 'QUEUED'
    assert runtime.run_once(registry, ledger, state, client=Google())['attempt_id'] == accepted['attempt_id']


def test_crash_after_terminal_write_does_not_repeat_the_accepted_command(tmp_path, monkeypatch):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    accepted = runtime.enqueue_report(registry, ledger, state)
    command_path = state / 'commands' / (accepted['attempt_id'] + '.json')
    unlink = type(command_path).unlink
    def crash(path, *args, **kwargs):
        if path == command_path:
            raise KeyboardInterrupt('after durable terminal state')
        return unlink(path, *args, **kwargs)
    with monkeypatch.context() as patch:
        patch.setattr(type(command_path), 'unlink', crash)
        with pytest.raises(KeyboardInterrupt):
            runtime.run_once(registry, ledger, state, client=Google())
    terminal = runtime.read_report_command(state, accepted['attempt_id'])
    assert terminal['status'] != 'RUNNING'
    next_run = runtime.run_once(registry, ledger, state, client=Google())
    assert next_run['attempt_id'] != accepted['attempt_id']
    assert runtime.read_report_command(state, accepted['attempt_id']) == terminal
    assert not command_path.exists()


def test_cli_accepts_and_reads_the_same_bounded_receipt(tmp_path, capsys):
    from procurement_engine.cli import main
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    assert main(['enqueue-report', '--registry', str(registry), '--ledger', str(ledger),
                 '--state', str(state)]) == 0
    accepted = json.loads(capsys.readouterr().out)
    assert main(['read-report-command', '--state', str(state),
                 '--attempt-id', accepted['attempt_id']]) == 0
    assert json.loads(capsys.readouterr().out) == accepted


def test_concurrent_admissions_join_one_not_yet_started_command(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    with ThreadPoolExecutor(max_workers=8) as pool:
        receipts = list(pool.map(lambda _: runtime.enqueue_report(registry, ledger, state), range(8)))
    assert len({item['attempt_id'] for item in receipts}) == 1
    assert runtime.read_report_command(state, receipts[0]['attempt_id']) == receipts[0]


def test_read_during_queue_removal_finds_the_completed_command(tmp_path, monkeypatch):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    accepted = runtime.enqueue_report(registry, ledger, state)
    command = state / 'commands' / (accepted['attempt_id'] + '.json')
    load = runtime._load
    triggered = False
    def complete_during_read(path):
        nonlocal triggered
        if path == command and not triggered:
            triggered = True
            runtime.run_once(registry, ledger, state, client=Google())
        return load(path)
    monkeypatch.setattr(runtime, '_load', complete_during_read)
    receipt = runtime.read_report_command(state, accepted['attempt_id'])
    assert triggered
    assert receipt['attempt_id'] == accepted['attempt_id']
    assert receipt['status'] not in {'QUEUED', 'RUNNING'}
