import io
import time
from urllib.error import HTTPError

import pytest
from procurement_engine import google_adapter
from procurement_engine.google_adapter import GoogleReadClient, GoogleReadError


def test_rate_limit_retries_then_returns_real_response(monkeypatch):
    sleeps = []; attempts = []
    def request(*args, **kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise HTTPError('https://sheets.googleapis.com', 429, 'quota', {'Retry-After': '2'}, None)
        return io.BytesIO(b'{"values":[[7]]}')
    monkeypatch.setattr(google_adapter, 'urlopen', request)
    monkeypatch.setattr(time, 'sleep', sleeps.append)
    assert GoogleReadClient('synthetic')._get('https://sheets.googleapis.com') == {'values': [[7]]}
    assert len(attempts) == 2 and sleeps == [2]


def test_permission_failure_is_not_retried_and_exhaustion_stays_a_failure(monkeypatch):
    sleeps = []; attempts = []
    def request(*args, **kwargs):
        attempts.append(1)
        raise HTTPError('https://sheets.googleapis.com', 403, 'private response', {}, None)
    monkeypatch.setattr(google_adapter, 'urlopen', request)
    monkeypatch.setattr(time, 'sleep', sleeps.append)
    with pytest.raises(GoogleReadError, match='^GOOGLE_READ_HTTP_403$'):
        GoogleReadClient('synthetic')._get('https://sheets.googleapis.com')
    assert len(attempts) == 1 and sleeps == []
    def unavailable(*args, **kwargs):
        raise HTTPError('https://sheets.googleapis.com', 503, 'private response', {}, None)
    monkeypatch.setattr(google_adapter, 'urlopen', unavailable)
    with pytest.raises(GoogleReadError, match='^GOOGLE_READ_HTTP_503$'):
        GoogleReadClient('synthetic')._get('https://sheets.googleapis.com')
    assert sleeps == [1, 2, 4, 8]
