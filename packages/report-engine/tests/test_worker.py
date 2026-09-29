from threading import Event

import pytest
from procurement_engine.worker import work


def test_worker_retries_after_failed_attempt_and_stops_without_extra_run():
    stopped = Event(); calls = []

    def attempt(*args):
        calls.append(args)
        if len(calls) == 2:
            stopped.set()
        return {'status': 'NOT_ISSUED'}

    assert work('registry', 'ledger', 'state', interval_seconds=0.001,
                stop=stopped, run=attempt) == 0
    assert calls == [('registry', 'ledger', 'state')] * 2


def test_worker_refuses_busy_loop_and_does_not_run_after_shutdown():
    stopped = Event(); stopped.set()
    def forbidden(*args):
        raise AssertionError('already stopped')
    assert work('r', 'l', 's', stop=stopped, run=forbidden) == 0
    with pytest.raises(ValueError, match='INTERVAL_INVALID'):
        work('r', 'l', 's', interval_seconds=0, run=forbidden)
