from threading import Event

import pytest
from procurement_engine.worker import work


def test_idle_sources_do_not_repeat_generation_but_changed_input_does(tmp_path):
    stopped = Event()
    probes = []
    runs = []
    def probe(*_args):
        probes.append(len(probes))
        return 'same' if len(probes) < 4 else 'changed'
    def run(*_args):
        runs.append(len(probes))
        if len(runs) == 2:
            stopped.set()
        return {'status': 'VERIFIED'}
    assert work('r', 'l', tmp_path, interval_seconds=0.001, stop=stopped,
                probe=probe, run=run, seal=lambda *_: None,
                recover=lambda *_: None, compact=lambda *_: None) == 0
    assert runs == [1, 4]


def test_failed_attempt_is_not_an_accepted_unchanged_input(tmp_path):
    stopped = Event()
    runs = []
    def run(*_args):
        runs.append(1)
        if len(runs) == 2:
            stopped.set()
        return {'status': 'NOT_ISSUED'}
    work('r', 'l', tmp_path, interval_seconds=0.001, stop=stopped,
         probe=lambda *_: 'same', run=run, seal=lambda *_: None,
         recover=lambda *_: None, compact=lambda *_: None)
    assert len(runs) == 2


def test_probe_failure_does_not_reuse_an_accepted_revision(tmp_path):
    stopped = Event()
    runs = []
    probes = []
    def probe(*_args):
        probes.append(1)
        if len(probes) > 1:
            raise OSError('source metadata unavailable')
        return 'same'
    def run(*_args):
        runs.append(1)
        if len(runs) == 2:
            stopped.set()
        return {'status': 'VERIFIED'}
    work('r', 'l', tmp_path, interval_seconds=0.001, stop=stopped,
         probe=probe, run=run, seal=lambda *_: None,
         recover=lambda *_: None, compact=lambda *_: None)
    assert len(runs) == 2


def test_manual_request_bypasses_unchanged_input_and_poll_delay(tmp_path, monkeypatch):
    from procurement_engine import worker
    runs = []
    probes = []
    class Clock:
        now = 0
        pending = False
        def is_set(self):
            return len(runs) == 2
        def wait(self, seconds):
            self.now += seconds
            self.pending = True
    clock = Clock()
    monkeypatch.setattr(worker, 'monotonic', lambda: clock.now)
    monkeypatch.setattr(worker, 'has_pending_report', lambda _: clock.pending)
    def run(*_args):
        runs.append(clock.now)
        return {'status': 'VERIFIED'}
    def probe(*_args):
        probes.append(1)
        return 'same'
    work('r', 'l', tmp_path, interval_seconds=900, stop=clock, probe=probe,
         run=run, seal=lambda *_: None, recover=lambda *_: None, compact=lambda *_: None)
    assert runs == [0, 5]
    assert probes == [1]


def test_probe_tracks_full_input_and_week_without_downloading_grids(tmp_path):
    import json
    from datetime import datetime

    from procurement_engine.worker import input_revision
    registry = tmp_path / 'registry.json'
    ledger = tmp_path / 'ledger.json'
    registry.write_text(json.dumps({'sources': [{'provider_id': 'book'}, {'provider_id': 'book'}]}))
    ledger.write_text('[]')
    class Metadata:
        version = '1'
        def __init__(self):
            self.calls = []
        def revision(self, provider):
            self.calls.append(provider)
            return self.version
        def _get(self, url, params):
            assert url.endswith('/drive/v3/files')
            assert 'alt' not in params
            return {'files': []}
    client = Metadata()
    def probe(day):
        return input_revision(registry, ledger, tmp_path, client=client,
                              now=datetime.fromisoformat(day + 'T12:00:00+12:00'))
    baseline = probe('2026-10-19')
    assert probe('2026-10-21') == baseline
    assert client.calls == ['book', 'book']
    assert probe('2026-10-22') != baseline  # existing Thursday evidence obligation
    client.version = '2'
    assert probe('2026-10-21') != baseline
    client.version = '1'
    ledger.write_text('[{"recommendation_id":"new"}]')
    assert probe('2026-10-21') != baseline


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
                recover=forbidden, seal=forbidden, compact=forbidden, probe=forbidden) == 0


@pytest.mark.parametrize('status', ['ALREADY_RUNNING', 'IDLE'])
def test_zero_interval_waits_when_another_executor_owns_or_finished_the_command(monkeypatch, status):
    from procurement_engine import worker
    monkeypatch.setattr(worker, 'has_pending_report', lambda *_: True)
    stopped = Event()
    calls = []
    class Stop:
        def is_set(self):
            return stopped.is_set()
        def wait(self, seconds):
            assert seconds == 5
            stopped.set()
    def run(*args, **kwargs):
        assert kwargs == {'queued_only': True}
        calls.append(args)
        return {'status': status}
    def forbidden(*_args, **_kwargs):
        raise AssertionError('busy/empty command is not a capture or publication')
    work('r', 'l', 's', interval_seconds=0, stop=Stop(), run=run,
         recover=forbidden, seal=forbidden, compact=forbidden, probe=forbidden)
    assert len(calls) == 1


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
