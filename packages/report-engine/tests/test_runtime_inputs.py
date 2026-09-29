import json

import pytest
from procurement_engine.runtime_inputs import install_google_inputs
from test_runtime import inputs


class Drive:
    def __init__(self, payload, *, count=1, changed=False):
        self.payload = payload
        self.count = count
        self.changed = changed
        self.calls = []

    def _get(self, url, params=None):
        self.calls.append((url, params))
        meta = {'id': 'synthetic-config', 'name': 'aemr-report-runtime-inputs-v1.json',
                'mimeType': 'application/json', 'version': '1', 'modifiedTime': '2026-01-01T00:00:00Z'}
        if url.endswith('/files'):
            assert "name = 'aemr-report-runtime-inputs-v1.json'" in params['q']
            return {'files': [meta] * self.count}
        if params.get('alt') == 'media':
            return self.payload
        return {**meta, 'version': '2' if self.changed else '1'}


def payload(tmp_path):
    registry, ledger = inputs(tmp_path)
    return {'format': 'aemr-report-runtime-inputs-v1',
            'registry': json.loads(registry.read_text()), 'ledger': json.loads(ledger.read_text())}


def test_private_pair_installs_atomically_and_existing_inputs_are_not_overwritten(tmp_path):
    body = payload(tmp_path); client = Drive(body)
    target = tmp_path / 'private' / 'inputs'
    install_google_inputs(target, client=client)
    assert json.loads((target / 'registry.json').read_text()) == body['registry']
    assert json.loads((target / 'ledger.json').read_text()) == body['ledger']
    unchanged = Drive({'wrong': True})
    install_google_inputs(target, client=unchanged)
    assert unchanged.calls == []


@pytest.mark.parametrize('count,changed,error', [(0, False, 'INPUT_FILE_NOT_UNIQUE'), (2, False, 'INPUT_FILE_NOT_UNIQUE'), (1, True, 'INPUT_FILE_CHANGED')])
def test_discovery_and_version_failures_leave_no_half_installed_inputs(tmp_path, count, changed, error):
    target = tmp_path / 'inputs'
    with pytest.raises(ValueError, match=error):
        install_google_inputs(target, client=Drive(payload(tmp_path), count=count, changed=changed))
    assert not target.exists()


def test_missing_master_does_not_install_plausible_but_incomplete_config(tmp_path):
    body = payload(tmp_path); body['registry']['sources'].pop(0)
    target = tmp_path / 'inputs'
    with pytest.raises(ValueError, match='INPUT_MASTER_SET_INVALID'):
        install_google_inputs(target, client=Drive(body))
    assert not target.exists()
