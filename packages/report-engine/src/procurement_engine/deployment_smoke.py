"""Read-only production acceptance through the same HTTP paths as native Word actions.

Only fixed PASS/error labels leave the server. No source rows, documents, API
keys, source identifiers or business metrics are printed to deployment logs.
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.request
import zipfile
from datetime import date, timedelta
from urllib.parse import urlencode
from xml.etree import ElementTree


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
                metadata = ElementTree.fromstring(archive.read('docProps/core.xml'))
                identifier = metadata.find('{http://purl.org/dc/elements/1.1/}identifier')
            if identifier is None or identifier.text != release['snapshot_id'] or release['report_date'] not in text:
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
        print(json.dumps(check_exports(fetch)))
        return 0
    except Exception as error:  # noqa: BLE001 — sanitize all deployment output.
        code = str(error)
        allowed = {'REPORT_EXPORT_CONTEXT_MISSING', 'REPORT_EXPORT_SNAPSHOT_MISMATCH',
                   'REPORT_EXPORT_DOCUMENT_INVALID', 'REPORT_EXPORT_RESPONSE_TOO_LARGE'}
        print(code if code in allowed else 'REPORT_EXPORT_HTTP_CHECK_FAILED', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
