"""Read-only production acceptance through the same HTTP paths as native Word actions.

Only fixed PASS/error labels leave the server. No source rows, documents, API
keys, source identifiers or business metrics are printed to deployment logs.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import urllib.request
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
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
    needs_operational = str(release.get('renderer_version') or '').startswith('renderer-v1.5.0rc25')
    available_operational = release.get('operational_available') is True
    if needs_operational and not available_operational:
        raise ValueError('REPORT_EXPORT_DOCUMENT_INVALID')
    files = ['main.docx', 'supplement.docx']
    if available_operational:
        files.append('operational.docx')
    for file in files:
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
    return {'context': 'PASS', 'main': 'PASS', 'supplement': 'PASS',
            'operational': 'PASS' if available_operational else 'LEGACY_NOT_AVAILABLE',
            'snapshot': 'PASS'}


class WorkerCycleFailure(ValueError):
    """Fixed failure categories only; no business data or source identifiers."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__('REPORT_WORKER_CYCLE_FAILED')


def check_worker_cycle(read_status, since, *, sleep=time.sleep, attempts=91):
    """Wait for a complete *new* cycle and state precisely why acceptance failed."""
    try:
        marker = datetime.fromisoformat(since)
    except (TypeError, ValueError) as exc:
        raise WorkerCycleFailure('INVALID_MARKER') from exc
    if marker.tzinfo is None:
        raise WorkerCycleFailure('INVALID_MARKER')

    last_reason = 'NO_NEW_ATTEMPT'
    for attempt in range(attempts):
        try:
            status = read_status()
            started = datetime.fromisoformat(status['started_at'])
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
            # A missing or malformed status file is not evidence of no work.
            last_reason = 'STATUS_UNREADABLE'
            if attempt < attempts - 1:
                sleep(3)
            continue

        if started.tzinfo is not None and started >= marker:
            outcome = status.get('status')
            last_reason = 'ATTEMPT_NOT_COMPLETE'
            if outcome == 'NOT_ISSUED':
                raise WorkerCycleFailure('NOT_ISSUED')
            if outcome in {'FAILED', 'PLAN_CHANGED'}:
                raise WorkerCycleFailure('FAILED_ATTEMPT')
            if outcome in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}:
                try:
                    finished = datetime.fromisoformat(status.get('finished_at', ''))
                except (TypeError, ValueError) as exc:
                    raise WorkerCycleFailure('INVALID_FINISH_TIME') from exc
                publication = status.get('publication') or {}
                if (finished.tzinfo is None or finished < started):
                    raise WorkerCycleFailure('INVALID_FINISH_TIME')
                if not status.get('snapshot_id') or status['snapshot_id'] != publication.get('snapshot_id'):
                    raise WorkerCycleFailure('SNAPSHOT_MISMATCH')
                if (str(publication.get('renderer_version') or '').startswith('renderer-v1.5.0rc25')
                        and publication.get('operational_available') is not True):
                    raise WorkerCycleFailure('THIRD_DOCUMENT_MISSING')
                result = {'worker': 'PASS'}
                assurance = status.get('automation_assurance') or publication.get('automation_assurance')
                if assurance:
                    result['automation'] = {key: assurance.get(key) for key in ('fully_automated',
                        'user_action_count', 'engine_action_count', 'active_recommendations',
                        'link_status_counts', 'action_status_counts')}
                return result
        if attempt < attempts - 1:
            sleep(3)
    raise WorkerCycleFailure(last_reason)


def main(argv=()):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker-since')
    parser.add_argument('--state', default='/app/packages/server/data/reports')
    args = parser.parse_args(argv)
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
        if args.worker_since:
            result = check_worker_cycle(lambda: json.loads((Path(args.state) / 'status.json').read_text()),
                                        args.worker_since)
        else:
            result = check_exports(lambda path: fetch_when_ready(fetch, path))
        print(json.dumps(result))
        return 0
    except Exception as error:  # noqa: BLE001 — sanitize all deployment output.
        code = str(error)
        allowed = {'REPORT_EXPORT_CONTEXT_MISSING', 'REPORT_EXPORT_SNAPSHOT_MISMATCH',
                   'REPORT_EXPORT_DOCUMENT_INVALID', 'REPORT_EXPORT_RESPONSE_TOO_LARGE',
                   'REPORT_WORKER_CYCLE_FAILED'}
        public = code if code in allowed else ('REPORT_WORKER_CYCLE_FAILED' if args.worker_since
                                               else 'REPORT_EXPORT_HTTP_CHECK_FAILED')
        if isinstance(error, WorkerCycleFailure) and args.worker_since:
            # All reasons are closed, static categories. No private row/ID data.
            public = 'REPORT_WORKER_CYCLE_FAILED:' + error.reason
        if isinstance(error, HTTPError) and error.code in {400, 401, 403, 404, 429, 500, 502, 503, 504}:
            public = 'REPORT_EXPORT_HTTP_' + str(error.code)
        print(public, file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
