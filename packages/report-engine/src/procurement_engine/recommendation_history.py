"""Enroll original private report evidence without rewriting historical decisions."""
import base64
import binascii
import copy
import hashlib
import json
import re
from datetime import datetime
from urllib.parse import quote

from .recommendation_links import verify_saved_report_origin

def uer_entry_origin(record, *, as_of=None):
    """A saved UЭР register entry is its own source, not a past Word file.

    This checks integrity and dating of the recorded issuance/revision. It does
    not claim any procurement linkage or evidence of implementation.
    """
    from .normalize import parse_date

    evidence = record.get('origin_evidence') or []
    if not isinstance(evidence, list):
        return None
    text = record.get('recommendation_text')
    ids = record.get('source_procurement_ids')
    if not isinstance(text, str) or not isinstance(ids, list):
        return None
    content_hash = hashlib.sha256(text.encode('utf-8')).hexdigest()
    ids_hash = hashlib.sha256(json.dumps(ids, ensure_ascii=False,
        separators=(',', ':')).encode('utf-8')).hexdigest()
    first_seen = parse_date(record.get('first_seen'))
    for item in reversed(evidence):
        if not isinstance(item, dict) or item.get('kind') != 'UER_REPORT_REGISTER_ENTRY_V1':
            continue
        issue_day = parse_date(item.get('document_date'))
        instant = item.get('registered_at')
        try:
            moment = datetime.fromisoformat(instant.replace('Z', '+00:00')) if isinstance(instant, str) else None
        except ValueError:
            moment = None
        if (not moment or moment.tzinfo is None or not issue_day
                or not first_seen or issue_day < first_seen
                or (as_of and issue_day > parse_date(as_of))
                or item.get('recommendation_id') != record.get('recommendation_id')
                or item.get('grbs') != record.get('grbs')
                or item.get('text_sha256') != content_hash
                or item.get('source_ids_sha256') != ids_hash):
            continue
        return {'kind': 'UER_REPORT_REGISTER_ENTRY_V1',
                'document_date': issue_day, 'grbs': item['grbs'],
                'text_sha256': content_hash, 'recommendation_id': item['recommendation_id'],
                'source_ids_sha256': ids_hash, 'registered_at': instant}
    return None


EDITOR_ONLY_FIELDS = frozenset({
    'editorial_state', 'editorial_updated_at', 'editorial_history', 'editor_note',
})


def issued_recommendations(records):
    """Project the ONE working ledger onto its official source corpus.

    Historical recommendations with no editorial_state retain their accepted
    semantics. Drafts and internal commentary never change document metrics,
    snapshot identity, archived original text or the current official release.
    """
    if not isinstance(records, list):
        raise ValueError('RECOMMENDATION_LEDGER_SCHEMA_INVALID')  # noqa: TRY004 — stable public contract
    issued = []
    for record in records:
        if not isinstance(record, dict):
            raise ValueError('RECOMMENDATION_LEDGER_SCHEMA_INVALID')  # noqa: TRY004 — stable public contract
        stage = record.get('editorial_state')
        if stage in ('DRAFT', 'ARCHIVED_DRAFT'):
            continue
        if stage not in (None, '', 'ISSUED'):
            raise ValueError('RECOMMENDATION_EDITORIAL_STATE_INVALID')
        if stage == 'ISSUED' and uer_entry_origin(record) is None:
            raise ValueError('UER_RECOMMENDATION_SOURCE_INVALID')
        issued.append({key: value for key, value in record.items()
                       if key not in EDITOR_ONLY_FIELDS})
    return issued


def read_google_history(client, ledger, *, include_package=False):
    name = 'aemr-report-recommendation-history-v1.json'
    listing = client._get('https://www.googleapis.com/drive/v3/files', {
        'q': f"trashed = false and name = '{name}' and mimeType = 'application/json'",
        'pageSize': 2, 'fields': 'nextPageToken,files(id,name,mimeType,version,modifiedTime)',
        'includeItemsFromAllDrives': 'true', 'supportsAllDrives': 'true'})
    files = listing.get('files') or []
    if listing.get('nextPageToken') or len(files) > 1:
        raise ValueError('HISTORY_FILE_NOT_UNIQUE')
    if not files:
        return (copy.deepcopy(ledger), {}, None, None) if include_package else (copy.deepcopy(ledger), {}, None)
    before = files[0]
    if (not isinstance(before.get('id'), str) or not before['id']
        or before.get('name') != name or before.get('mimeType') != 'application/json' or not before.get('version')):
        raise ValueError('HISTORY_FILE_METADATA_INVALID')
    url = 'https://www.googleapis.com/drive/v3/files/' + quote(before['id'], safe='')
    body = client._get(url, {'alt': 'media', 'supportsAllDrives': 'true'})
    after = client._get(url, {'fields': 'id,name,mimeType,version,modifiedTime', 'supportsAllDrives': 'true'})
    if after != before:
        raise ValueError('HISTORY_FILE_CHANGED')
    enriched, documents = enroll_history_package(body, ledger)
    return (enriched, documents, before, body) if include_package else (enriched, documents, before)


def enroll_history_package(package, ledger):
    if not isinstance(package, dict) or package.get('format') != 'aemr-report-recommendation-history-v1':
        raise ValueError('HISTORY_PACKAGE_FORMAT_INVALID')
    encoded = package.get('documents'); records = package.get('records')
    if (not isinstance(encoded, dict) or not encoded or len(encoded) > 8
        or not isinstance(records, list) or not records or not isinstance(ledger, list)):
        raise ValueError('HISTORY_PACKAGE_STRUCTURE_INVALID')
    documents = {}
    for digest, value in encoded.items():
        if (not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest)
            or not isinstance(value, str) or len(value) > 24 * 1024 * 1024):
            raise ValueError('HISTORY_DOCUMENT_INVALID')
        try:
            content = base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('HISTORY_DOCUMENT_INVALID') from None
        if len(content) > 16 * 1024 * 1024 or hashlib.sha256(content).hexdigest() != digest:
            raise ValueError('HISTORY_DOCUMENT_HASH_MISMATCH')
        documents[digest] = content
    if sum(map(len, documents.values())) > 64 * 1024 * 1024:
        raise ValueError('HISTORY_DOCUMENT_SET_TOO_LARGE')
    enriched = copy.deepcopy(ledger)
    index = {}
    for record in enriched:
        key = record.get('recommendation_id') if isinstance(record, dict) else None
        if not isinstance(key, str) or not key or key in index:
            raise ValueError('HISTORY_LEDGER_IDENTITY_INVALID')
        index[key] = record
    seen = set(); referenced_documents = set()
    for record in records:
        key = record.get('recommendation_id') if isinstance(record, dict) else None
        if not isinstance(key, str) or key not in index or key in seen:
            raise ValueError('HISTORY_RECORD_IDENTITY_INVALID')
        seen.add(key); original = index[key]
        if any(record.get(k) != original.get(k) for k in ('grbs', 'recommendation_text')):
            raise ValueError('HISTORY_RECORD_TEXT_MISMATCH')
        incoming = record.get('origin_evidence')
        if not isinstance(incoming, list) or not incoming:
            raise ValueError('HISTORY_ORIGIN_UNPROVEN')
        for item in incoming:
            proof = verify_saved_report_origin({**record, 'origin_evidence': [item]}, documents)
            if proof is None:
                raise ValueError('HISTORY_ORIGIN_UNPROVEN')
            referenced_documents.add(proof['document_sha256'])
        evidence = original.setdefault('origin_evidence', [])
        if not isinstance(evidence, list):
            raise ValueError('HISTORY_LEDGER_EVIDENCE_INVALID')  # noqa: TRY004 — stable package validation contract.
        for item in incoming:
            if item not in evidence:
                evidence.append(copy.deepcopy(item))
    if set(documents) != referenced_documents:
        raise ValueError('HISTORY_DOCUMENT_SET_UNREGISTERED')
    return enriched, documents
