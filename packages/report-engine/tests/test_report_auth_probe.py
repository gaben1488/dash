import importlib.util
import json
from pathlib import Path

from google.auth import exceptions as auth
from requests import exceptions as transport

spec = importlib.util.spec_from_file_location('report_auth_probe', Path(__file__).resolve().parents[3] / '.github/ci/report_auth_probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def test_transport_cause_is_classified_without_message_or_url():
    error = auth.TransportError('PRIVATE account key token URL')
    error.__cause__ = transport.Timeout('PRIVATE secret')
    result = probe.classify_failure(error)
    assert result == {'class': 'TRANSPORT', 'transport_class': 'TIMEOUT'}
    assert 'PRIVATE' not in json.dumps(result)


def test_tls_failure_is_not_reported_as_retryable_network_error():
    error = auth.TransportError('PRIVATE')
    error.__cause__ = transport.SSLError('PRIVATE')
    assert probe.classify_failure(error) == {'class': 'TRANSPORT', 'transport_class': 'SSL'}


def test_permanent_grant_failure_keeps_only_allowlisted_provider_code():
    error = auth.RefreshError('PRIVATE', {'error': 'invalid_grant', 'error_description': 'PRIVATE'}, retryable=False)
    assert probe.classify_failure(error) == {'class': 'REFRESH', 'retryable': False, 'oauth_error': 'invalid_grant'}


def test_unknown_provider_error_is_not_echoed():
    error = auth.RefreshError('PRIVATE', {'error': 'PRIVATE', 'error_description': 'PRIVATE'}, retryable=True)
    result = probe.classify_failure(error)
    assert result == {'class': 'REFRESH', 'retryable': True, 'oauth_error': 'OTHER'}
    assert 'PRIVATE' not in json.dumps(result)


def test_configuration_and_unknown_failures_remain_sanitized():
    assert probe.classify_failure(ValueError('PRIVATE')) == {'class': 'CONFIGURATION_OR_LOCAL_IO'}
    assert probe.classify_failure(RuntimeError('PRIVATE')) == {'class': 'OTHER'}
