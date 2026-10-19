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
        work('r', 'l', 's', interval_seconds=0, run=forbidden)


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
