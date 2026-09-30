"""Read-only production acceptance through the same HTTP paths as native Word actions.

Only fixed PASS/error labels leave the server. No source rows, documents, API
keys, source identifiers or business metrics are printed to deployment logs.
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
import urllib.request
import zipfile
from datetime import date, timedelta
from urllib.error import HTTPError
from urllib.parse import urlencode
from xml.etree import ElementTree


def fetch_when_ready(fetch, path, *, sleep=time.sleep):
    """Allow a cold HTTP cache to become ready; never retry semantic failures."""
    for attempt in range(7):
        try:
            return fetch(path)
        except HTTPError as error:
            if error.code != 503 or attempt == 6:
                raise
            error.close()
            sleep(2 ** attempt)
    raise RuntimeError('REPORT_EXPORT_READINESS_BUDGET_EXHAUSTED')


def check_exports(fetch):
    period = json.loads(fetch('/api/report'))['period']
    day = (date(1970, 1, 1) + timedelta(days=period['asOfDay'])).isoformat()
    query = urlencode({'date': day, 'year': period['year'], 'quarter': period['quarter']})
    release = json.loads(fetch('/api/report-releases?' + query)).get('selected')
    if (not release or release['report_year'] != period['year'] or release['quarter'] != period['quarter']
            or '-'.join(reversed(release['report_date'].split('.'))) != day
            or release['status'] not in ('VERIFIED', 'VERIFIED_WITH_WARNINGS')):
        raise ValueError('REPORT_EXPORT_CONTEXT_MISSING')
    prefix = '/api/report-releases/' + release['release_id']
    dashboard = json.loads(fetch(prefix + '/dashboard'))
    if any(dashboard[key] != release[key] for key in ('snapshot_id', 'report_date', 'rules_version', 'renderer_version')):
        raise ValueError('REPORT_EXPORT_SNAPSHOT_MISMATCH')
    for file in ('main.docx', 'supplement.docx'):
        try:
            with zipfile.ZipFile(io.BytesIO(fetch(prefix + '/' + file))) as archive:
                if archive.getinfo('word/document.xml').file_size > 16 * 1024 * 1024:
                    raise ValueError('oversize document')
                text = ''.join(ElementTree.fromstring(archive.read('word/document.xml')).itertext())
            if release['snapshot_id'] not in text or release['report_date'] not in text:
                raise ValueError('document context differs')
        except (ValueError, KeyError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
            raise ValueError('REPORT_EXPORT_DOCUMENT_INVALID') from exc
    return {'context': 'PASS', 'main': 'PASS', 'supplement': 'PASS', 'snapshot': 'PASS'}


def main():
    def fetch(path):
        headers = {'Authorization': 'Bearer ' + os.environ.get('AEMR_API_KEY', '')}
        request = urllib.request.Request('http://127.0.0.1:' + str(int(os.environ.get('PORT', '3000'))) + path,
                                         headers=headers)
        with urllib.request.urlopen(request, timeout=40) as response:  # Fixed loopback HTTP endpoint.
            payload = response.read(32 * 1024 * 1024 + 1)
            if len(payload) > 32 * 1024 * 1024:
                raise ValueError('REPORT_EXPORT_RESPONSE_TOO_LARGE')
            return payload
    try:
        print(json.dumps(check_exports(lambda path: fetch_when_ready(fetch, path))))
        return 0
    except Exception as error:  # noqa: BLE001 — sanitize all deployment output.
        code = str(error)
        allowed = {'REPORT_EXPORT_CONTEXT_MISSING', 'REPORT_EXPORT_SNAPSHOT_MISMATCH',
                   'REPORT_EXPORT_DOCUMENT_INVALID', 'REPORT_EXPORT_RESPONSE_TOO_LARGE'}
        public = code if code in allowed else 'REPORT_EXPORT_HTTP_CHECK_FAILED'
        if isinstance(error, HTTPError) and error.code in {400, 401, 403, 404, 429, 500, 502, 503, 504}:
            public = 'REPORT_EXPORT_HTTP_' + str(error.code)
        print(public, file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
