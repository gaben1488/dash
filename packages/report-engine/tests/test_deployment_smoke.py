import json
from datetime import date
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import pytest
from procurement_engine.publication_reader import read_publication
from procurement_engine.runtime import run_once
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


def test_worker_acceptance_waits_for_a_new_completed_cycle():
    from procurement_engine.deployment_smoke import check_worker_cycle

    old = {'started_at': '2026-10-06T08:00:00+00:00', 'status': 'VERIFIED'}
    running = {'started_at': '2026-10-06T08:02:00+00:00', 'status': 'RUNNING'}
    done = {**running, 'status': 'VERIFIED_WITH_WARNINGS', 'finished_at': '2026-10-06T08:03:00+00:00',
        'snapshot_id': 'snapshot', 'publication': {'snapshot_id': 'snapshot'}}
    statuses = iter([old, running, done]); waits = []
    assert check_worker_cycle(lambda: next(statuses), '2026-10-06T08:01:00+00:00',
        sleep=waits.append) == {'worker': 'PASS'}
    assert waits == [3, 3]


@pytest.mark.parametrize('status', [
    {'status': 'NOT_ISSUED', 'started_at': '2026-10-06T08:02:00+00:00'},
    {'status': 'VERIFIED', 'started_at': '2026-10-06T08:00:00+00:00'},
    {'status': 'VERIFIED', 'started_at': '2026-10-06T08:02:00+00:00',
     'finished_at': '2026-10-06T08:03:00+00:00', 'snapshot_id': 'new', 'publication': {'snapshot_id': 'old'}},
])
def test_worker_acceptance_rejects_failure_stale_cycle_or_wrong_snapshot(status):
    from procurement_engine.deployment_smoke import check_worker_cycle

    with pytest.raises(ValueError, match='REPORT_WORKER_CYCLE_FAILED'):
        check_worker_cycle(lambda: status, '2026-10-06T08:01:00+00:00', sleep=lambda _: None,
            attempts=2)


def test_readiness_retries_temporary_503_without_changing_report_selection():
    from procurement_engine.deployment_smoke import fetch_when_ready

    calls = []; delays = []
    def fetch(path):
        calls.append(path)
        if len(calls) < 3:
            raise HTTPError('http://localhost' + path, 503, 'not ready', {}, None)
        return b'original response'
    assert fetch_when_ready(fetch, '/api/report', sleep=delays.append) == b'original response'
    assert calls == ['/api/report'] * 3
    assert delays == [1, 2]


def test_readiness_has_a_bounded_retry_budget():
    from procurement_engine.deployment_smoke import fetch_when_ready

    calls = []; delays = []
    def fetch(path):
        calls.append(path)
        raise HTTPError('http://localhost' + path, 503, 'not ready', {}, None)
    with pytest.raises(HTTPError) as failure:
        fetch_when_ready(fetch, '/api/report', sleep=delays.append)
    assert failure.value.code == 503
    assert len(calls) == 7
    assert delays == [1, 2, 4, 8, 16, 32]


@pytest.mark.parametrize('code', [400, 401, 403, 404, 500])
def test_readiness_does_not_retry_auth_context_or_other_http_failures(code):
    from procurement_engine.deployment_smoke import fetch_when_ready

    calls = []; delays = []
    def fetch(path):
        calls.append(path)
        raise HTTPError('http://localhost' + path, code, 'failure', {}, None)
    with pytest.raises(HTTPError):
        fetch_when_ready(fetch, '/api/report', sleep=delays.append)
    assert len(calls) == 1
    assert delays == []


def test_http_failure_output_discloses_only_fixed_status_code(monkeypatch, capsys):
    from procurement_engine import deployment_smoke

    def failure(fetch):
        raise HTTPError('http://localhost/private-source', 503, 'private business text', {}, None)
    monkeypatch.setattr(deployment_smoke, 'check_exports', failure)
    assert deployment_smoke.main() == 1
    assert capsys.readouterr().err == 'REPORT_EXPORT_HTTP_503\n'


def test_http_acceptance_checks_native_context_and_three_pinned_documents(tmp_path):
    from procurement_engine.deployment_smoke import check_exports

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    result = run_once(registry, ledger, state, client=CompleteGoogle())
    receipt = result['publication']
    dashboard = json.loads(read_publication(state, 'dashboard', receipt['release_id']))
    day = date.fromisoformat('-'.join(reversed(receipt['report_date'].split('.'))))
    period = {'year': day.year, 'quarter': dashboard['headline']['current_quarter'],
              'asOfDay': (day - date(1970, 1, 1)).days, 'live': True}
    calls = []

    def fetch(path):
        calls.append(path)
        if path == '/api/report':
            return json.dumps({'period': period}).encode()
        if path.startswith('/api/report-releases?'):
            params = parse_qs(urlsplit(path).query)
            return read_publication(state, 'status', selection=(params['date'][0],
                int(params['year'][0]), int(params['quarter'][0])))
        suffix = path.rsplit('/', 1)[-1]
        view = {'main.docx': 'main', 'supplement.docx': 'supplement',
                'operational.docx': 'operational', 'dashboard': 'dashboard'}[suffix]
        return read_publication(state, view, receipt['release_id'])

    assert check_exports(fetch) == {'context': 'PASS', 'main': 'PASS',
                                    'supplement': 'PASS', 'operational': 'PASS',
                                    'snapshot': 'PASS'}
    assert f"/api/report-releases/{receipt['release_id']}/main.docx" in calls
    assert f"/api/report-releases/{receipt['release_id']}/supplement.docx" in calls
    assert f"/api/report-releases/{receipt['release_id']}/operational.docx" in calls
    with pytest.raises(ValueError, match='REPORT_EXPORT_CONTEXT_MISSING'):
        check_exports(lambda path: json.dumps({'period': period}).encode() if path == '/api/report'
                      else b'{"selected":null}')
    with pytest.raises(ValueError, match='REPORT_EXPORT_DOCUMENT_INVALID'):
        check_exports(lambda path: b'old browser format' if path.endswith('.docx') else fetch(path))



def test_worker_acceptance_requires_third_word_on_rc25():
    from procurement_engine.deployment_smoke import check_worker_cycle

    since = '2026-10-09T07:00:00+00:00'
    release = {'snapshot_id': 'SNP-test', 'renderer_version': 'renderer-v1.5.0rc25'}
    cycle = {
        'started_at': '2026-10-09T07:01:00+00:00',
        'finished_at': '2026-10-09T07:02:00+00:00',
        'status': 'VERIFIED',
        'snapshot_id': 'SNP-test',
        'publication': release,
    }
    with pytest.raises(ValueError, match='REPORT_WORKER_CYCLE_FAILED'):
        check_worker_cycle(lambda: cycle, since, sleep=lambda _: None, attempts=1)
    cycle['publication'] = {**release, 'operational_available': True}
    assert check_worker_cycle(lambda: cycle, since, sleep=lambda _: None, attempts=1) == {'worker': 'PASS'}


def test_three_word_acceptance_rejects_a_missing_or_corrupt_operational_document(tmp_path):
    from procurement_engine.deployment_smoke import check_exports

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    status = run_once(registry, ledger, state, client=CompleteGoogle())
    assert status['status'] == 'VERIFIED'
    receipt = status['publication']
    dashboard = json.loads(read_publication(state, 'dashboard', receipt['release_id']))
    day = date.fromisoformat('-'.join(reversed(receipt['report_date'].split('.'))))
    period = {'year': day.year, 'quarter': dashboard['headline']['current_quarter'],
              'asOfDay': (day - date(1970, 1, 1)).days, 'live': True}
    def fetch(path):
        if path == '/api/report':
            return json.dumps({'period': period}).encode()
        if path.startswith('/api/report-releases?'):
            params = parse_qs(urlsplit(path).query)
            return read_publication(state, 'status', selection=(params['date'][0],
                int(params['year'][0]), int(params['quarter'][0])))
        if path.endswith('/operational.docx'):
            return b'corrupt word'
        view = 'dashboard' if path.endswith('/dashboard') else (
            'main' if path.endswith('/main.docx') else 'supplement')
        return read_publication(state, view, receipt['release_id'])
    with pytest.raises(ValueError, match='REPORT_EXPORT_DOCUMENT_INVALID'):
        check_exports(fetch)
