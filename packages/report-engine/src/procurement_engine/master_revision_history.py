"""Read-only exact-date Google Sheets revision evidence.

This module does not infer a historical state from the nearest revision.  It only
accepts revisions whose Drive modifiedTime falls on the exact source-document day
in the product timezone, then verifies that their exported workbook still matches
the registered source schema.  It is intentionally usable as a capability probe
before revision evidence participates in recommendation linkage.
"""
from __future__ import annotations

import hashlib
from datetime import datetime
from io import BytesIO
from urllib.parse import quote
from zoneinfo import ZoneInfo

from openpyxl import load_workbook

from .google_adapter import GoogleReadError
from .normalize import parse_date
from .raw_pipeline import header_hash

XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
CONTRACT = 'exact-master-revision-probe-v2'


def revision_export_unavailable(error):
    """A listed Drive revision can later lose retrievable bytes.

    Google can compact native-file revision history after revisions.list has
    exposed an id. Only 404/410 are evidence-unavailable states; authorization,
    quota, network and provider errors remain hard failures.
    """
    return isinstance(error, GoogleReadError) and str(error) in {
        'GOOGLE_READ_HTTP_404', 'GOOGLE_READ_HTTP_410'
    }


def _revision_pages(client, provider_id):
    token = None
    pages = 0
    while True:
        params = {
            'pageSize': 1000,
            'fields': 'nextPageToken,revisions(id,modifiedTime)',
        }
        if token:
            params['pageToken'] = token
        data = client._get(
            'https://www.googleapis.com/drive/v3/files/'
            + quote(provider_id, safe='') + '/revisions',
            params,
        )
        revisions = data.get('revisions')
        if not isinstance(revisions, list):
            raise TypeError('MASTER_REVISION_LIST_INVALID')
        for revision in revisions:
            if (not isinstance(revision, dict)
                    or not isinstance(revision.get('id'), str)
                    or not isinstance(revision.get('modifiedTime'), str)):
                raise TypeError('MASTER_REVISION_METADATA_INVALID')
            yield revision
        token = data.get('nextPageToken')
        pages += 1
        if not token:
            return
        if not isinstance(token, str) or pages >= 50:
            raise ValueError('MASTER_REVISION_PAGINATION_INVALID')


def revision_index(client, provider_id, *, timezone_name='Asia/Kamchatka'):
    """List a provider once and index returned revisions by product-local day."""
    zone = ZoneInfo(timezone_name)
    output = {}
    for revision in _revision_pages(client, provider_id):
        instant = datetime.fromisoformat(revision['modifiedTime'].replace('Z', '+00:00'))
        if instant.tzinfo is None:
            raise ValueError('MASTER_REVISION_TIMEZONE_MISSING')
        day = instant.astimezone(zone).date().isoformat()
        output.setdefault(day, []).append(revision)
    return {
        day: sorted(values, key=lambda item: (item['modifiedTime'], item['id']))
        for day, values in output.items()
    }


def exact_revisions(client, provider_id, day, *, timezone_name='Asia/Kamchatka'):
    target = parse_date(day)
    if not target:
        raise ValueError('MASTER_REVISION_DATE_INVALID')
    return revision_index(client, provider_id, timezone_name=timezone_name).get(target, [])


def _revision_export(client, provider_id, revision):
    url = (
        'https://www.googleapis.com/drive/v3/files/'
        + quote(provider_id, safe='')
        + '/revisions/'
        + quote(revision['id'], safe='')
    )
    metadata = client._get(
        url,
        {'fields': 'id,modifiedTime,exportLinks'},
    )
    if metadata.get('id') != revision['id'] or metadata.get('modifiedTime') != revision['modifiedTime']:
        raise ValueError('MASTER_REVISION_CHANGED')
    links = metadata.get('exportLinks')
    export_url = links.get(XLSX_MIME) if isinstance(links, dict) else None
    if not isinstance(export_url, str) or not export_url.startswith('https://'):
        raise ValueError('MASTER_REVISION_XLSX_EXPORT_MISSING')
    content = client._get_bytes(export_url)
    if not isinstance(content, bytes) or not content.startswith(b'PK') or len(content) > 64 * 1024 * 1024:
        raise ValueError('MASTER_REVISION_XLSX_INVALID')
    return content


def _matrix(content, contract):
    """Read a bounded historical matrix even when OOXML dimension metadata is absent.

    Google revision exports can omit a usable worksheet <dimension>; in openpyxl
    read-only mode that leaves max_row/max_column as None. Dimensions are metadata,
    not evidence. Stream the actual cells instead and apply explicit resource bounds.
    """
    try:
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception as error:
        raise ValueError('MASTER_REVISION_XLSX_INVALID') from error
    try:
        if contract['sheet'] not in workbook.sheetnames:
            raise ValueError('MASTER_REVISION_SHEET_MISSING')
        columns = contract['columns']
        headers = contract['header_rows']
        if type(columns) is not int or type(headers) is not int or not 1 <= columns <= 512 or not 1 <= headers <= 100:
            raise ValueError('MASTER_REVISION_CONTRACT_INVALID')
        sheet = workbook[contract['sheet']]
        values = []
        observed_width = 0
        for number, row in enumerate(sheet.iter_rows(min_row=1, values_only=True), 1):
            if number > 200000:
                raise ValueError('MASTER_REVISION_RANGE_TOO_LARGE')
            observed_width = max(observed_width, len(row))
            values.append(list(row[:columns]))
        if len(values) < headers or observed_width < columns:
            raise ValueError('MASTER_REVISION_RANGE_INCOMPLETE')
    finally:
        workbook.close()
    if header_hash(values, headers) != contract['schema_fingerprint']:
        raise ValueError('MASTER_REVISION_SCHEMA_CHANGED')
    return values


def required_revision_days(ledger):
    """Return exact evidence days requested by verified recommendation origins."""
    result = {}
    for record in ledger:
        if not isinstance(record, dict) or not record.get('active_in_current_slice'):
            continue
        grbs = record.get('grbs')
        for evidence in record.get('origin_evidence') or []:
            day = parse_date(evidence.get('document_date')) if isinstance(evidence, dict) else None
            if grbs and day:
                result.setdefault(grbs, set()).add(day)
    return result


def probe_exact_master_revisions(registry, ledger, client, *, timezone_name='Asia/Kamchatka'):
    """Return aggregate capability coverage; no row values or business IDs are emitted."""
    masters = {source.get('grbs'): source for source in registry.get('sources', [])
               if source.get('role') == 'master' and source.get('grbs')}
    requested = required_revision_days(ledger)
    totals = {
        'grbs_with_requested_history': 0,
        'requested_exact_days': 0,
        'days_with_exact_revision': 0,
        'days_with_readable_schema': 0,
        'days_rejected_schema': 0,
        'days_without_exportable_revision': 0,
        'exact_revisions_read': 0,
        'unavailable_revisions': 0,
    }
    by_grbs = {}
    for grbs in sorted(requested):
        dates = sorted(requested[grbs])
        totals['grbs_with_requested_history'] += 1
        totals['requested_exact_days'] += len(dates)
        source = masters.get(grbs)
        item = {'requested_days': len(dates), 'exact_days': 0, 'readable_days': 0,
                'rejected_days': 0, 'unexportable_days': 0, 'exact_revisions': 0,
                'unavailable_revisions': 0, 'source_registered': source is not None}
        if source is not None:
            indexed = revision_index(client, source['provider_id'], timezone_name=timezone_name)
            for day in dates:
                revisions = indexed.get(day, [])
                if not revisions:
                    continue
                item['exact_days'] += 1
                totals['days_with_exact_revision'] += 1
                readable_exports = 0
                rejected_exports = 0
                for revision in revisions:
                    try:
                        content = _revision_export(client, source['provider_id'], revision)
                    except GoogleReadError as error:
                        if not revision_export_unavailable(error):
                            raise
                        item['unavailable_revisions'] += 1
                        totals['unavailable_revisions'] += 1
                        continue
                    item['exact_revisions'] += 1
                    totals['exact_revisions_read'] += 1
                    # Digest is deliberately computed but not emitted; reading all
                    # bytes proves that the export link is usable and bounded.
                    hashlib.sha256(content).digest()
                    try:
                        _matrix(content, source)
                    except ValueError as error:
                        if str(error) not in {
                            'MASTER_REVISION_SHEET_MISSING',
                            'MASTER_REVISION_RANGE_INCOMPLETE',
                            'MASTER_REVISION_SCHEMA_CHANGED',
                        }:
                            raise
                        rejected_exports += 1
                    else:
                        readable_exports += 1
                if readable_exports:
                    item['readable_days'] += 1
                    totals['days_with_readable_schema'] += 1
                elif rejected_exports:
                    item['rejected_days'] += 1
                    totals['days_rejected_schema'] += 1
                else:
                    item['unexportable_days'] += 1
                    totals['days_without_exportable_revision'] += 1
        by_grbs[grbs] = item
    return {'contract': CONTRACT, **totals, 'by_grbs': by_grbs}
