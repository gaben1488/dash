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


def test_commands_only_executor_never_creates_a_periodic_capture(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    assert runtime.run_once(registry, ledger, state, queued_only=True, client=object()) == {'status': 'IDLE'}
    accepted = runtime.enqueue_report(registry, ledger, state)
    result = runtime.run_once(registry, ledger, state, queued_only=True, client=Google())
    assert result['attempt_id'] == accepted['attempt_id']
    assert runtime.run_once(registry, ledger, state, queued_only=True, client=object()) == {'status': 'IDLE'}


def test_separate_cli_processes_resume_an_accepted_command_without_a_periodic_worker(tmp_path):
    import subprocess
    import sys
    registry, ledger = inputs(tmp_path)
    registry.write_text('{}')  # Deterministic contract failure before any Google access.
    state = tmp_path / 'state'
    cli = [sys.executable, '-c', 'from procurement_engine.cli import main; raise SystemExit(main())']
    arguments = ['--registry', str(registry), '--ledger', str(ledger), '--state', str(state)]
    accepted = subprocess.run([*cli, 'enqueue-report', *arguments], capture_output=True, text=True,
                              check=True, timeout=20)
    identifier = json.loads(accepted.stdout)['attempt_id']
    subprocess.run([*cli, 'worker', '--queued-only', *arguments], capture_output=True, text=True,
                   check=True, timeout=30)
    observed = subprocess.run([*cli, 'read-report-command', '--state', str(state), '--attempt-id', identifier],
                              capture_output=True, text=True, check=True, timeout=20)
    receipt = json.loads(observed.stdout)
    assert receipt['attempt_id'] == identifier
    assert receipt['status'] == 'NOT_ISSUED'
    assert receipt['error_code'] == 'INPUT_REGISTRY_INVALID'
    assert len(observed.stdout) < 2048


def test_killed_executor_is_recovered_without_executing_the_next_accepted_command(tmp_path):
    import os
    import signal
    import subprocess
    import sys
    import time
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    first = runtime.enqueue_report(registry, ledger, state)
    marker = tmp_path / 'reading'
    source = '''
import sys, time
from pathlib import Path
sys.path.insert(0, 'tests')
from test_runtime import Google
from procurement_engine.runtime import run_once
class Waiting(Google):
    def revision(self, provider):
        Path(sys.argv[4]).write_text('reading')
        time.sleep(60)
        return super().revision(provider)
run_once(sys.argv[1], sys.argv[2], sys.argv[3], client=Waiting(), queued_only=True)
'''
    process = subprocess.Popen([sys.executable, '-c', source, str(registry), str(ledger), str(state), str(marker)])
    try:
        deadline = time.monotonic() + 15
        while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)
        assert marker.exists(), 'executor never reached acquisition'
        second = runtime.enqueue_report(registry, ledger, state)
        assert second['attempt_id'] != first['attempt_id']
        os.kill(process.pid, signal.SIGKILL)
        assert process.wait(timeout=10) == -signal.SIGKILL
        recovery = subprocess.run([sys.executable, '-c',
            'from procurement_engine.cli import main; raise SystemExit(main())',
            'recover-report-commands', '--state', str(state)], capture_output=True, text=True,
            check=True, timeout=20)
        result = json.loads(recovery.stdout)
        assert result == {'status': 'RECOVERED', 'recovered': 1, 'pending': 1}
        failed = runtime.read_report_command(state, first['attempt_id'])
        assert failed['status'] == 'NOT_ISSUED'
        assert failed['error_code'] == 'REPORT_ATTEMPT_INTERRUPTED'
        assert failed['finished_at'] is None
        assert runtime.read_report_command(state, second['attempt_id'])['status'] == 'QUEUED'
        assert runtime.run_once(registry, ledger, state, client=Google(), queued_only=True)['attempt_id'] == second['attempt_id']
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


def test_recovery_respects_a_live_owner_and_does_not_start_pending_commands(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    command = runtime.enqueue_report(registry, ledger, state)
    with (state / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert runtime.recover_report_commands(state) == {'status': 'BUSY'}
    assert runtime.recover_report_commands(state) == {'status': 'RECOVERED', 'recovered': 0, 'pending': 1}
    assert runtime.read_report_command(state, command['attempt_id']) == command


def test_recovery_keeps_a_committed_release_when_the_executor_lost_its_response(tmp_path, monkeypatch):
    from procurement_engine.publication_store import PublicationStore
    from test_weekly_archive import FormulaGoogle
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    command = runtime.enqueue_report(registry, ledger, state)
    publish = PublicationStore.publish
    committed = []
    def lose_response(self, *args, **kwargs):
        committed.append(publish(self, *args, **kwargs))
        raise KeyboardInterrupt('publication persisted; response lost')
    with monkeypatch.context() as patch:
        patch.setattr(PublicationStore, 'publish', lose_response)
        with pytest.raises(KeyboardInterrupt):
            runtime.run_once(registry, ledger, state, client=FormulaGoogle(), queued_only=True)
    assert runtime.recover_report_commands(state) == {'status': 'RECOVERED', 'recovered': 1, 'pending': 0}
    receipt = runtime.read_report_command(state, command['attempt_id'])
    assert receipt['status'] == committed[0]['status']
    assert receipt['release_id'] == committed[0]['release_id']
    assert receipt['finished_at'] == committed[0]['published_at']
    assert runtime.recover_report_commands(state) == {'status': 'RECOVERED', 'recovered': 0, 'pending': 0}
