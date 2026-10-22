"""One full source acquisition for the live master cache and report renderer."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from urllib.request import Request, urlopen

from .formula_dependencies import audit_formula_dependencies
from .google_adapter import capture_google
from .raw_pipeline import bundle_from_capture, captured_source_revision


def request_source_input(base_url, api_key, attempt):
    """The worker reads only the file explicitly accepted by the live coordinator."""
    attempt = Path(attempt)
    if not re.fullmatch(r'[a-f0-9]{32}', attempt.name) or not api_key:
        raise ValueError('SHARED_SOURCE_REQUEST_INVALID')
    request = Request(base_url.rstrip('/') + '/api/report-releases/commands/' + attempt.name + '/source-input',
                      headers={'Authorization': 'Bearer ' + api_key}, method='POST')
    with urlopen(request, timeout=570) as response:
        raw = response.read(4097)
        if response.status != 200 or len(raw) > 4096:
            raise ValueError('SHARED_SOURCE_RECEIPT_INVALID')
    receipt = json.loads(raw)
    if (not isinstance(receipt, dict) or set(receipt) != {'capture_sha256'}
            or not isinstance(receipt['capture_sha256'], str)
            or not re.fullmatch(r'[a-f0-9]{64}', receipt['capture_sha256'])):
        raise ValueError('SHARED_SOURCE_RECEIPT_INVALID')
    target = attempt / 'capture.json'
    if attempt.is_symlink() or target.is_symlink():
        raise ValueError('SHARED_SOURCE_PATH_INVALID')
    with target.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != receipt['capture_sha256']:
            raise ValueError('SHARED_SOURCE_HASH_MISMATCH')
        stream.seek(0)
        return json.load(stream)


def acquire_dashboard(registry, target, *, client=None, timezone_name='Asia/Kamchatka'):
    capture = capture_google(registry, client, timezone_name=timezone_name)
    capture['source_revision'] = captured_source_revision(capture)
    bundle_from_capture(capture, registry)
    if not audit_formula_dependencies(capture)['closed']:
        raise ValueError('SHARED_SOURCE_FORMULAS_UNVERIFIED')
    masters = []
    for source in capture['sources']:
        if source['role'] != 'master':
            continue
        formulas = [[] for _ in source['values']]
        for cell in source['formula_evidence']['formulas']:
            row = formulas[cell['row'] - 1]
            row.extend([None] * max(0, cell['column'] - len(row)))
            row[cell['column'] - 1] = cell['formula']
        masters.append({
            'book': source['grbs'], 'provider_id': source['provider_id'],
            'revision': source['after'], 'values': source['values'], 'formulas': formulas,
            'sheetName': source['sheet'], 'readAt': capture['captured_at'],
            'startRow': 1, 'formulasRead': True,
        })
    # The existing attempt owns retention and recovery. No second source archive.
    from .runtime import _write
    target = Path(target)
    _write(target, capture)
    with target.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'capture_sha256': digest, 'source_revision': capture['source_revision'], 'masters': masters}
