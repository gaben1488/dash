import fcntl
import json
from datetime import datetime, timezone

from procurement_engine.publication_reader import read_publication


def test_status_exposes_read_only_unknown_operations_without_creating_state(tmp_path):
    state = tmp_path / 'absent'
    result = json.loads(read_publication(state, 'status'))
    assert result['operations']['worker_state'] == 'unknown'
    assert result['operations']['check_stale'] is True
    assert not state.exists()


def test_running_lock_is_distinct_from_interrupted_attempt(tmp_path):
    from procurement_engine.report_health import report_health
    attempt = {'status': 'RUNNING', 'started_at': '2026-10-13T12:00:00+00:00'}
    now = datetime(2026, 10, 13, 12, 1, tzinfo=timezone.utc)
    with (tmp_path / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        health = report_health(tmp_path, attempt, now=now)
        assert health['worker_state'] == 'running'
        assert health['running_duration_seconds'] == 60
    assert report_health(tmp_path, attempt, now=now)['worker_state'] == 'interrupted'


def test_bad_or_future_health_index_never_establishes_fresh_success(tmp_path):
    from procurement_engine.report_health import report_health
    now = datetime(2026, 10, 13, 12, tzinfo=timezone.utc)
    for value in ['{broken', json.dumps({'last_success_at': '2999-01-01T00:00:00+00:00', 'last_failure_at': '2999-01-01T00:00:00+00:00', 'last_cycle_duration_seconds': True, 'last_failure_code': 'private error'})]:
        (tmp_path / 'report-health.json').write_text(value)
        result = report_health(tmp_path, {}, now=now)
        assert result['check_stale'] is True
        assert result['last_success_at'] is None
        assert result['last_failure_at'] is None
        assert result['last_cycle_duration_seconds'] is None
        assert 'private error' not in json.dumps(result)


def test_completed_reused_success_advances_check_without_changing_publication(tmp_path):
    from procurement_engine.report_health import record_attempt, report_health
    status = {'status': 'VERIFIED', 'started_at': '2026-10-12T11:59:00+00:00', 'finished_at': '2026-10-12T12:00:00+00:00', 'reused_publication': True}
    record_attempt(tmp_path, status)
    assert json.loads((tmp_path / 'report-health.json').read_text())['last_success_at'] == status['finished_at']
    result = report_health(tmp_path, status, {'cutoff_at': '2026-09-24T00:00:00+00:00'}, now=datetime(2026, 10, 12, 12, 1, tzinfo=timezone.utc))
    assert result['last_success_age_seconds'] == 60
    assert result['check_stale'] is False
    assert result['last_cycle_duration_seconds'] == 60
    assert result['publication_cutoff_at'].startswith('2026-09-24')
    assert (tmp_path / 'report-health.json').stat().st_mode & 0o777 == 0o600


def test_health_write_failure_does_not_change_completed_runtime_status(tmp_path, monkeypatch, capsys):
    from procurement_engine import report_health, runtime
    state = tmp_path / 'state'; state.mkdir()
    attempt = state / 'attempts' / 'attempt'; attempt.mkdir(parents=True)
    def fail(*args):
        raise OSError('private filesystem details')
    monkeypatch.setattr(report_health, 'record_attempt', fail)
    status = runtime._finish_attempt(state, attempt, {'status': 'VERIFIED', 'reused_publication': True})
    assert status['status'] == 'VERIFIED'
    assert json.loads((state / 'status.json').read_text()) == status
    assert capsys.readouterr().err.strip() == 'REPORT_HEALTH_WRITE_FAILED'
