import json

import pytest
from test_runtime import Google, inputs


class CompleteGoogle(Google):
    def formula_context(self, provider):
        return {'sheets': [{'sheetId': 0, 'title': self.grid(provider, 0)['title']}], 'named_ranges': []}

    def formulas(self, provider, title, start, end, columns):
        return [[], [], ['Synthetic header', '=1+1']][start - 1:end]

@pytest.mark.parametrize('builder', ['build_report_model', 'build_report_model_v2', 'build_report_model_v3'])
def test_every_report_model_preserves_the_accepted_source_revision(builder):
    from procurement_engine import report_model
    snapshot = {'report_date': '20.10.2026', 'model': {}, 'source_revision': 'SRC-' + 'a' * 64}
    model = getattr(report_model, builder)(snapshot, [])
    assert model['snapshot']['source_revision'] == snapshot['source_revision']


def test_shared_capture_gives_dash_the_exact_persisted_masters(tmp_path):
    from procurement_engine.shared_input import acquire_dashboard
    registry_path, _ = inputs(tmp_path)
    target = tmp_path / 'capture.json'
    result = acquire_dashboard(json.loads(registry_path.read_text()), target, client=CompleteGoogle())
    saved = json.loads(target.read_text())
    masters = [source for source in saved['sources'] if source['role'] == 'master']
    assert len(result['masters']) == len(masters) == 8
    for projected, source in zip(result['masters'], masters, strict=True):
        assert projected['book'] == source['grbs']
        assert projected['provider_id'] == source['provider_id']
        assert projected['values'] == source['values']
        assert projected['formulas'][2][1] == '=1+1'
        assert projected['revision'] == 'revision1'
        assert projected['readAt'] == saved['captured_at']
    import hashlib
    assert result['capture_sha256'] == hashlib.sha256(target.read_bytes()).hexdigest()


def test_shared_capture_does_not_accept_missing_formula_evidence(tmp_path):
    from procurement_engine.shared_input import acquire_dashboard
    registry_path, _ = inputs(tmp_path)
    target = tmp_path / 'capture.json'
    with pytest.raises(ValueError, match='SHARED_SOURCE_FORMULAS_UNVERIFIED'):
        acquire_dashboard(json.loads(registry_path.read_text()), target, client=Google())
    assert not target.exists()

def test_worker_consumes_the_coordinator_file_and_verifies_its_receipt(tmp_path):
    import hashlib
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from procurement_engine.shared_input import request_source_input

    attempt = tmp_path / ('a' * 32)
    attempt.mkdir()
    payload = b'{"sources":[],"test":"accepted by coordinator"}'
    (attempt / 'capture.json').write_bytes(payload)
    received = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            received.append((self.path, self.headers.get('Authorization')))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({'capture_sha256': hashlib.sha256(payload).hexdigest()}).encode())

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f'http://127.0.0.1:{server.server_port}'
        assert request_source_input(url, 'test-key', attempt) == json.loads(payload)
        assert received == [(f'/api/report-releases/commands/{attempt.name}/source-input', 'Bearer test-key')]
        (attempt / 'capture.json').write_text('{"sources":["changed"]}')
        with pytest.raises(ValueError, match='SHARED_SOURCE_HASH_MISMATCH'):
            request_source_input(url, 'test-key', attempt)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()

def test_runtime_does_not_fall_back_to_independent_capture_if_coordinator_fails(tmp_path, monkeypatch):
    import procurement_engine.shared_input as shared
    from procurement_engine import runtime
    registry, ledger = inputs(tmp_path)
    monkeypatch.setenv('REPORT_SOURCE_COORDINATOR_URL', 'http://coordinator.invalid')
    monkeypatch.setenv('AEMR_API_KEY', 'test-key')
    calls = []

    def refuse(url, key, attempt):
        calls.append(attempt.name)
        raise ValueError('SHARED_SOURCE_RECEIPT_INVALID')

    def forbidden(*args, **kwargs):
        raise AssertionError('independent capture must not run')

    monkeypatch.setattr(shared, 'request_source_input', refuse)
    monkeypatch.setattr(runtime, 'capture_google', forbidden)
    status = runtime.run_once(registry, ledger, tmp_path / 'state', client=Google())
    assert calls == [status['attempt_id']]
    assert status['status'] == 'NOT_ISSUED'
    assert status['failure_stage'] == 'acquisition'
    assert status['error_code'] == 'SHARED_SOURCE_RECEIPT_INVALID'

def test_source_revision_is_preserved_in_report_manifest_and_detects_mutation(tmp_path):
    from procurement_engine.raw_pipeline import bundle_from_capture
    from procurement_engine.shared_input import acquire_dashboard
    registry_path, _ = inputs(tmp_path)
    registry = json.loads(registry_path.read_text())
    target = tmp_path / 'capture.json'
    result = acquire_dashboard(registry, target, client=CompleteGoogle())
    saved = json.loads(target.read_text())
    assert result['source_revision'] == saved['source_revision']
    assert bundle_from_capture(saved, registry).manifest['source_revision'] == saved['source_revision']
    saved['sources'][0]['values'][2].append('changed after acceptance')
    with pytest.raises(ValueError, match='SHARED_SOURCE_REVISION_MISMATCH'):
        bundle_from_capture(saved, registry)

def test_source_revision_survives_order_and_legacy_reader_metadata(tmp_path):
    from procurement_engine.raw_pipeline import bundle_from_capture
    from procurement_engine.shared_input import acquire_dashboard
    registry_path, _ = inputs(tmp_path)
    registry = json.loads(registry_path.read_text())
    target = tmp_path / 'capture.json'
    acquire_dashboard(registry, target, client=CompleteGoogle())
    saved = json.loads(target.read_text())
    saved['sources'].reverse()
    for source in saved['sources']:
        source['capture_method'] = 'connector_bounded_ranges'
    assert bundle_from_capture(saved, registry).manifest['source_revision'] == saved['source_revision']

def test_publication_rejects_a_source_context_that_differs_from_its_model(tmp_path):
    import hashlib

    from procurement_engine.publication_store import PublicationError, _validate
    from test_publication_store import candidate
    root = tmp_path / 'candidate'
    candidate(root)
    manifest_path = root / 'snapshot_bundle/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['source_revision'] = 'SRC-' + 'a' * 64
    manifest_path.write_text(json.dumps(manifest))
    meta_path = root / 'snapshot_bundle/bundle.json'
    meta = json.loads(meta_path.read_text())
    meta['manifest_sha256'] = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    meta_path.write_text(json.dumps(meta))
    with pytest.raises(PublicationError, match='SNAPSHOT_MODEL_MISMATCH'):
        _validate(root)
