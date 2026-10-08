"""Append-only official recommendation intake from the existing authenticated Drive input.

No generated suggestion becomes an official recommendation. New IDs are accepted
only with the exact original DOCX occurrence independently verified by the
registered historical-evidence package. Source registries and primary sheets are
never written by this module.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from urllib.parse import quote


INPUT_NAME = 'aemr-report-runtime-inputs-v1.json'
FORMAT = 'aemr-report-runtime-inputs-v1'


def _by_id(records):
    from .raw_pipeline import validate_ledger_contract

    validate_ledger_contract(records)
    return {record['recommendation_id']: record for record in records}


def validate_append_only(previous, current):
    """Never silently delete or rewrite historical recommendations.

    A previous active entry may become superseded only when a *new* item
    explicitly refers to it. Authentication and original-document evidence for
    that new item are checked separately before release.
    """
    old = _by_id(previous)
    now = _by_id(current)
    if not set(old) <= set(now):
        raise ValueError('OFFICIAL_LEDGER_HISTORY_MISSING')
    new = {key: now[key] for key in now.keys() - old.keys()}
    superseded = {}
    for key, record in new.items():
        references = record.get('supersedes_recommendation_ids', [])
        if (not isinstance(references, list) or len(set(map(str, references))) != len(references)
                or any(not isinstance(ref, str) or ref not in old or ref == key for ref in references)):
            raise ValueError('OFFICIAL_LEDGER_SUPERSESSION_INVALID')
        for ref in references:
            if ref in superseded:
                raise ValueError('OFFICIAL_LEDGER_SUPERSESSION_CONFLICT')
            superseded[ref] = key
    for key, record in old.items():
        successor = now[key]
        original = {k: v for k, v in record.items() if k not in {'origin_evidence', 'active_in_current_slice'}}
        comparison = {k: v for k, v in successor.items() if k not in {'origin_evidence', 'active_in_current_slice'}}
        if original != comparison:
            raise ValueError('OFFICIAL_LEDGER_IMMUTABLE_RECORD_CHANGED')
        old_proof = record.get('origin_evidence') or []
        new_proof = successor.get('origin_evidence') or []
        if any(proof not in new_proof for proof in old_proof):
            raise ValueError('OFFICIAL_LEDGER_ORIGIN_REMOVED')
        if record['active_in_current_slice'] != successor['active_in_current_slice']:
            if (record['active_in_current_slice'] is not True
                    or successor['active_in_current_slice'] is not False
                    or key not in superseded):
                raise ValueError('OFFICIAL_LEDGER_STATUS_CHANGED_WITHOUT_DECISION')
        elif key in superseded:
            raise ValueError('OFFICIAL_LEDGER_SUPERSESSION_NOT_APPLIED')
    return tuple(sorted(new))


def read_registered_ledger(client, baseline):
    """Read version-checked Drive input, preserving local bootstrap as fallback.

    Old test installations can lack the Drive package. Once a live publication
    records an authoritative remote source, losing it is a release blocker
    enforced by runtime, never interpreted as an empty/new zero ledger.
    """
    _by_id(baseline)
    listing = client._get('https://www.googleapis.com/drive/v3/files', {
        'q': f"trashed = false and name = '{INPUT_NAME}' and mimeType = 'application/json'",
        'pageSize': 2, 'fields': 'nextPageToken,files(id,name,mimeType,version,modifiedTime)',
        'includeItemsFromAllDrives': 'true', 'supportsAllDrives': 'true'})
    found = [item for item in listing.get('files', [])
             if isinstance(item, dict) and item.get('name') == INPUT_NAME]
    if listing.get('nextPageToken') or len(found) > 1:
        raise ValueError('OFFICIAL_LEDGER_SOURCE_NOT_UNIQUE')
    if not found:
        return copy.deepcopy(baseline), None, ()
    before = found[0]
    if (not isinstance(before.get('id'), str) or not before['id']
            or before.get('mimeType') != 'application/json' or not before.get('version')):
        raise ValueError('OFFICIAL_LEDGER_SOURCE_METADATA_INVALID')
    url = 'https://www.googleapis.com/drive/v3/files/' + quote(before['id'], safe='')
    body = client._get(url, {'alt': 'media', 'supportsAllDrives': 'true'})
    after = client._get(url, {'fields': 'id,name,mimeType,version,modifiedTime',
                              'supportsAllDrives': 'true'})
    if before != after:
        raise ValueError('OFFICIAL_LEDGER_SOURCE_CHANGED')
    if not isinstance(body, dict) or body.get('format') != FORMAT:
        raise ValueError('OFFICIAL_LEDGER_SOURCE_FORMAT_INVALID')
    ledger = body.get('ledger')
    new_ids = validate_append_only(baseline, ledger)
    return copy.deepcopy(ledger), before, new_ids


def verify_new_official_records(ledger, new_ids, documents, *, report_date):
    """A new declared recommendation must occur in an authentic dated DOCX.

    This proves that the recommendation appears in the registered official
    report. It does not prove management acceptance, contract execution,
    a replacement procurement, or any other outcome.
    """
    from .normalize import parse_date
    from .recommendation_links import verify_saved_report_origin

    today = parse_date(report_date)
    if not today:
        raise ValueError('OFFICIAL_LEDGER_REPORT_DATE_INVALID')
    records = _by_id(ledger)
    original_locations = {}
    for record in ledger:
        proof = verify_saved_report_origin(record, documents)
        if proof:
            location = (proof['document_sha256'], proof['table'], proof['row'], proof['cell'])
            if location in original_locations and record['recommendation_id'] in new_ids:
                raise ValueError('OFFICIAL_LEDGER_DUPLICATE_ORIGINAL_OCCURRENCE')
            original_locations[location] = record['recommendation_id']
    for key in new_ids:
        item = records[key]
        proof = verify_saved_report_origin(item, documents)
        first_seen = parse_date(item.get('first_seen'))
        if (not proof or not first_seen or first_seen > today
                or proof['document_date'] > today
                or first_seen > proof['document_date']):
            raise ValueError('OFFICIAL_LEDGER_NEW_ORIGIN_NOT_VERIFIED')
    return True


def previous_published_ledger(state, receipt):
    """Read a previously hash-checked release's frozen ledger, never current Sheets."""
    if receipt is None:
        return None
    path = (Path(state) / 'published' / 'releases' / receipt['release_id']
            / 'snapshot_bundle' / 'payloads' / 'HISTORICAL_RECOMMENDATIONS.json')
    if not path.is_file():
        raise ValueError('OFFICIAL_LEDGER_PREVIOUS_PROOF_MISSING')
    payload = json.loads(path.read_text(encoding='utf-8'))
    if (not isinstance(payload, dict) or payload.get('source_id') != 'HISTORICAL_RECOMMENDATIONS'):
        raise ValueError('OFFICIAL_LEDGER_PREVIOUS_PROOF_INVALID')
    records = payload.get('semantic_values')
    _by_id(records)
    return records
