"""Enroll original private report evidence without rewriting historical decisions."""
import base64
import binascii
import copy
import hashlib
import re
from urllib.parse import quote

from .recommendation_links import verify_saved_report_origin


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
