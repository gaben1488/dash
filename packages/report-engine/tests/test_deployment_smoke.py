import json
from datetime import date
from urllib.parse import parse_qs, urlsplit

import pytest
from procurement_engine.publication_reader import read_publication
from procurement_engine.runtime import run_once
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


def test_http_acceptance_checks_native_context_and_both_pinned_documents(tmp_path):
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
        view = {'main.docx': 'main', 'supplement.docx': 'supplement', 'dashboard': 'dashboard'}[suffix]
        return read_publication(state, view, receipt['release_id'])

    assert check_exports(fetch) == {'context': 'PASS', 'main': 'PASS', 'supplement': 'PASS', 'snapshot': 'PASS'}
    assert f"/api/report-releases/{receipt['release_id']}/main.docx" in calls
    assert f"/api/report-releases/{receipt['release_id']}/supplement.docx" in calls
    with pytest.raises(ValueError, match='REPORT_EXPORT_CONTEXT_MISSING'):
        check_exports(lambda path: json.dumps({'period': period}).encode() if path == '/api/report'
                      else b'{"selected":null}')
    with pytest.raises(ValueError, match='REPORT_EXPORT_DOCUMENT_INVALID'):
        check_exports(lambda path: b'old browser format' if path.endswith('.docx') else fetch(path))
