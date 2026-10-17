"""Read-only OAuth failure classification; never print credentials or response text."""
import json
import logging
from collections import Counter

from google.auth import exceptions as auth
from google.auth.transport.requests import Request
from requests import exceptions as transport

ALLOWED_STATUS = {200, 400, 401, 403, 408, 429, 500, 502, 503, 504}
ALLOWED_OAUTH = {'invalid_grant', 'invalid_client', 'unauthorized_client', 'invalid_scope',
                 'access_denied', 'temporarily_unavailable', 'server_error'}


def classify_failure(error):
    if isinstance(error, auth.TransportError):
        cause = error.__cause__
        kind = ('SSL' if isinstance(cause, transport.SSLError) else
                'TIMEOUT' if isinstance(cause, transport.Timeout) else
                'CONNECTION' if isinstance(cause, transport.ConnectionError) else 'OTHER')
        return {'class': 'TRANSPORT', 'transport_class': kind}
    if isinstance(error, auth.RefreshError):
        oauth = next((arg.get('error') for arg in error.args
                      if isinstance(arg, dict) and isinstance(arg.get('error'), str)
                      and arg.get('error') in ALLOWED_OAUTH), 'OTHER')
        return {'class': 'REFRESH', 'retryable': error.retryable is True, 'oauth_error': oauth}
    if isinstance(error, (ValueError, OSError)):
        return {'class': 'CONFIGURATION_OR_LOCAL_IO'}
    return {'class': 'OTHER_AUTH' if isinstance(error, auth.GoogleAuthError) else 'OTHER'}


def probe():
    from procurement_engine.google_adapter import GoogleReadClient

    logging.disable(logging.CRITICAL)
    statuses = Counter()

    class ProbeRequest(Request):
        def __call__(self, *args, **kwargs):
            kwargs['timeout'] = 20
            response = super().__call__(*args, **kwargs)
            status = response.status
            statuses[str(status) if status in ALLOWED_STATUS else 'OTHER'] += 1
            return response

    try:
        credentials = GoogleReadClient._environment_credentials()
        credentials.refresh(ProbeRequest())
        result = {'class': 'SUCCESS', 'token_present': bool(credentials.token)}
    except Exception as error:  # noqa: BLE001 — fail closed with fixed labels; never expose credential errors.
        result = classify_failure(error)
    result['http_status_counts'] = dict(statuses)
    return {'auth_refresh_diagnostic': result}


if __name__ == '__main__':
    print(json.dumps(probe(), sort_keys=True))
