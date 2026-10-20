from threading import Event

import pytest
from procurement_engine.worker import work


def test_worker_retries_after_failed_attempt_and_stops_without_extra_run():
    stopped = Event()
    calls = []

    def attempt(*args):
        calls.append(args)
        if len(calls) == 2:
            stopped.set()
        return {'status': 'NOT_ISSUED'}

    assert work('registry', 'ledger', 'state', interval_seconds=0.001,
                stop=stopped, run=attempt) == 0
    assert calls == [('registry', 'ledger', 'state')] * 2


def test_worker_refuses_busy_loop_and_does_not_run_after_shutdown():
    stopped = Event()
    stopped.set()
    def forbidden(*args):
        raise AssertionError('already stopped')
    assert work('r', 'l', 's', stop=stopped, run=forbidden) == 0
    with pytest.raises(ValueError, match='INTERVAL_INVALID'):
        work('r', 'l', 's', interval_seconds=-1, run=forbidden)


def test_zero_interval_waits_for_commands_without_reading_sources_or_history(monkeypatch):
    from procurement_engine import worker
    stopped = Event()
    monkeypatch.setattr(worker, 'has_pending_report', lambda *_: False)
    class Stop:
        def is_set(self):
            return stopped.is_set()
        def wait(self, seconds):
            assert seconds == 5
            stopped.set()
    def forbidden(*_args, **_kwargs):
        raise AssertionError('idle service must not read sources or history')
    assert work('r', 'l', 's', interval_seconds=0, stop=Stop(), run=forbidden,
                recover=forbidden, seal=forbidden, compact=forbidden) == 0


def test_worker_recovers_before_first_compaction_and_seals_before_each_compaction():
    stopped = Event()
    order = []

    def recover(state):
        order.append(("recover", state))
        return []

    def compact(state):
        order.append(("compact", state))
        return {"status": "NO_ATTEMPTS"}

    def attempt(registry, ledger, state):
        order.append(("run", state))
        stopped.set()
        return {"status": "NOT_ISSUED", "attempt_id": "a"}

    def seal(state, result):
        order.append(("seal", state, result["attempt_id"]))
        return {"status": "NOT_READY"}

    assert work(
        "r", "l", "state", interval_seconds=0.001, stop=stopped,
        run=attempt, seal=seal, recover=recover, compact=compact,
    ) == 0
    assert order == [
        ("recover", "state"),
        ("compact", "state"),
        ("run", "state"),
        ("seal", "state", "a"),
        ("compact", "state"),
    ]


def test_manual_command_is_not_delayed_until_the_next_periodic_capture(tmp_path, monkeypatch):
    from procurement_engine import worker
    from procurement_engine.runtime import enqueue_report
    from test_runtime import inputs
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    calls = []
    class Clock:
        now = 0
        def is_set(self):
            return len(calls) == 2
        def wait(self, seconds):
            assert seconds <= 5
            self.now += seconds
            if len(calls) == 1:
                enqueue_report(registry, ledger, state)
    clock = Clock()
    monkeypatch.setattr(worker, 'monotonic', lambda: clock.now)
    def run(*_args):
        calls.append(clock.now)
        return {'status': 'NOT_ISSUED'}
    assert work(registry, ledger, state, interval_seconds=900, stop=clock,
                run=run, recover=lambda *_: None, compact=lambda *_: None,
                seal=lambda *_: None) == 0
    assert calls == [0, 5]


def test_commands_only_worker_drains_saved_request_without_a_periodic_service(tmp_path):
    from procurement_engine.runtime import enqueue_report, read_report_command, run_once
    from test_runtime import Google, inputs
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    command = enqueue_report(registry, ledger, state)
    outcomes = []
    def run(*args, **kwargs):
        outcome = run_once(*args, **kwargs, client=Google())
        outcomes.append(outcome['status'])
        return outcome
    def no_history_scan(*_args):
        raise AssertionError('empty manual drain must not scan archive history')
    assert work(registry, ledger, state, queued_only=True, run=run,
                recover=no_history_scan, seal=lambda *_: None, compact=lambda *_: None) == 0
    assert len(outcomes) == 2
    assert outcomes[-1] == 'IDLE'
    assert read_report_command(state, command['attempt_id'])['status'] == outcomes[0]


def test_commands_only_worker_waits_for_a_busy_executor_before_draining(tmp_path):
    from procurement_engine.runtime import enqueue_report, read_report_command, run_once
    from test_runtime import Google, inputs
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    command = enqueue_report(registry, ledger, state)
    calls = []
    waits = []
    class Stop:
        def is_set(self):
            return False
        def wait(self, seconds):
            waits.append(seconds)
    def run(*args, **kwargs):
        calls.append(True)
        assert len(calls) <= 3
        return {'status': 'ALREADY_RUNNING'} if len(calls) == 1 else run_once(*args, **kwargs, client=Google())
    assert work(registry, ledger, state, queued_only=True, stop=Stop(), run=run,
                seal=lambda *_: None, compact=lambda *_: None) == 0
    assert waits == [5]
    assert read_report_command(state, command['attempt_id'])['status'] not in {'QUEUED', 'RUNNING'}
