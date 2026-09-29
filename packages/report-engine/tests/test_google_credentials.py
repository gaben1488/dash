import io
from urllib.error import HTTPError

import pytest
from procurement_engine.google_adapter import GoogleReadClient, GoogleReadError


class Credentials:
    valid = False
    token = None
    refresh_count = 0

    def refresh(self, request):
        self.refresh_count += 1
        self.token = f'synthetic-token-{self.refresh_count}'
        self.valid = True


def test_expired_credentials_refresh_without_restarting_capture(monkeypatch):
    credentials = Credentials()
    client = GoogleReadClient(credentials=credentials)
    observed = []

    def read(request, timeout):
        observed.append(request.get_header('Authorization'))
        return io.BytesIO(b'{"values": [[1]]}')

    monkeypatch.setattr('procurement_engine.google_adapter.urlopen', read)
    assert client.values('synthetic-book', 'Sheet', 1, 1, 1) == [[1]]
    credentials.valid = False
    assert client.values('synthetic-book', 'Sheet', 1, 1, 1) == [[1]]
    assert observed == ['Bearer synthetic-token-1', 'Bearer synthetic-token-2']


def test_refresh_failure_does_not_expose_credential_payload(monkeypatch):
    credentials = Credentials()

    def fail(request):
        raise ValueError('private credential payload must not appear')

    credentials.refresh = fail
    client = GoogleReadClient(credentials=credentials)
    with pytest.raises(GoogleReadError, match='GOOGLE_AUTH_REFRESH_FAILED') as error:
        client.revision('synthetic-book')
    assert 'private credential' not in str(error.value)


def test_explicit_token_http_error_is_sanitized(monkeypatch):
    client = GoogleReadClient(access_token='synthetic-token')

    def fail(request, timeout):
        raise HTTPError(request.full_url, 403, 'private response', {}, None)

    monkeypatch.setattr('procurement_engine.google_adapter.urlopen', fail)
    with pytest.raises(GoogleReadError, match='^GOOGLE_READ_HTTP_403$'):
        client.revision('synthetic-book')
