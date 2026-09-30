import io
import json
from pathlib import Path
from textwrap import dedent
from urllib.error import HTTPError

from procurement_engine import deployment_smoke


def run_probe(monkeypatch, capsys, *, unavailable=False, state="ok"):
    root = Path(__file__).resolve().parents[3]
    source = (root / '.github/workflows/report-runtime-probe.yml').read_text().split("<<'PY'\n", 1)[1].rsplit('            PY', 1)[0]
    monkeypatch.setenv('AEMR_API_KEY', 'synthetic-secret')
    status = {'status': 'NOT_ISSUED', 'error_code': 'SOURCE_CHANGED_BEFORE_PUBLICATION',
              'error_type': 'PublicationError', 'private_subject': 'private business text'}
    monkeypatch.setattr(Path, 'read_text', lambda self: json.dumps(status))
    def open_url(request, timeout):
        assert request.headers['Authorization'] == 'Bearer synthetic-secret'
        if request.full_url.endswith('/api/health'):
            value = {'sources': {'state': state, 'loaded': 10, 'total': 10, 'failed': 0,
                                 'summary': 'private source text'}}
        elif unavailable:
            raise HTTPError(request.full_url, 503, 'private subject', {},
                            io.BytesIO(b'{"error":"ServiceUnavailable","message":"private source text"}'))
        else:
            value = {'period': {'year': 2026, 'quarter': 3, 'asOfDay': 20726}}
        response = io.BytesIO(json.dumps(value).encode()); response.status = 200
        return response
    monkeypatch.setattr('urllib.request.urlopen', open_url)
    # The upstream native acceptance already has end-to-end artifact tests.
    # Here exercise the probe's transport and privacy boundary.
    def check(fetch):
        fetch('/api/report')
        return {'context': 'PASS', 'main': 'PASS', 'supplement': 'PASS', 'snapshot': 'PASS'}
    monkeypatch.setattr(deployment_smoke, 'check_exports', check)
    exec(compile(dedent(source), '<runtime-probe>', 'exec'), {})  # noqa: S102 — execute this repository's workflow under mocked transport.
    return capsys.readouterr().out


def test_probe_reports_known_publication_failure_and_safe_native_transport(monkeypatch, capsys):
    output = run_probe(monkeypatch, capsys)
    rows = [json.loads(line) for line in output.splitlines()]
    assert rows[0]['error_code'] == 'SOURCE_CHANGED_BEFORE_PUBLICATION'
    assert any(r.get('source_cache') == {'state': 'ok', 'loaded': 10, 'total': 10, 'failed': 0} for r in rows)
    assert any(r.get('context') == 'PASS' for r in rows)
    assert 'private' not in output and 'synthetic-secret' not in output


def test_probe_identifies_503_without_exposing_body_or_request(monkeypatch, capsys):
    output = run_probe(monkeypatch, capsys, unavailable=True)
    rows = [json.loads(line) for line in output.splitlines()]
    assert any(r.get('step') == 'report' and r.get('http_status') == 503 for r in rows)
    assert any(r.get('exports') == 'FAIL' for r in rows)
    assert 'private' not in output and 'synthetic-secret' not in output


def test_probe_preserves_unknown_cache_state(monkeypatch, capsys):
    output = run_probe(monkeypatch, capsys, state='unknown')
    rows = [json.loads(line) for line in output.splitlines()]
    assert next(row['source_cache']['state'] for row in rows if 'source_cache' in row) == 'unknown'
