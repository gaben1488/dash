"""One-time private input installation using the server's existing service account."""
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from urllib.parse import quote

from .google_adapter import GoogleReadClient
from .raw_pipeline import validate_ledger_contract
from .source_contract import registry_grbs_order

INPUT_NAME = 'aemr-report-runtime-inputs-v1.json'


def validate_inputs(registry, ledger):
    validate_ledger_contract(ledger)
    sources = registry.get('sources') if isinstance(registry, dict) else None
    if not isinstance(sources, list) or not all(isinstance(x, dict) for x in sources):
        raise ValueError('INPUT_REGISTRY_INVALID')
    if sorted(str(s.get('grbs')) for s in sources if s.get('role') == 'master') != sorted(registry_grbs_order(registry)):
        raise ValueError('INPUT_MASTER_SET_INVALID')
    ids = set(); paths = set(); sheets = set()
    for s in sources:
        for name in ('source_id', 'provider_id', 'sheet', 'role', 'units', 'schema_fingerprint'):
            if not isinstance(s.get(name), str) or not s[name]:
                raise ValueError('INPUT_SOURCE_CONTRACT_INVALID')
        if not re.fullmatch('[a-f0-9]{64}', s['schema_fingerprint']):
            raise ValueError('INPUT_SCHEMA_FINGERPRINT_INVALID')
        for name in ('sheet_id', 'columns', 'header_rows'):
            if isinstance(s.get(name), bool) or not isinstance(s.get(name), int) or s[name] < (0 if name == 'sheet_id' else 1):
                raise ValueError('INPUT_SOURCE_GEOMETRY_INVALID')
        for key in ('semantic_header_fingerprint', 'previous_semantic_header_fingerprint'):
            if key in s and (not isinstance(s[key], str) or not re.fullmatch('[a-f0-9]{64}', s[key])):
                raise ValueError('INPUT_SCHEMA_FINGERPRINT_INVALID')
        if 'previous_semantic_header_fingerprint' in s and (
            not s.get('semantic_header_fingerprint') or not isinstance(s.get('schema_change_reason'), str)
            or not s['schema_change_reason'].strip()):
            raise ValueError('INPUT_SCHEMA_MIGRATION_REASON_MISSING')
        safe = ''.join(ch if ch.isalnum() or ch in '-_' else '_' for ch in s['source_id'])
        pair = (s['provider_id'], s['sheet_id'])
        if s['source_id'] in ids or safe in paths or pair in sheets:
            raise ValueError('INPUT_SOURCE_DUPLICATE')
        ids.add(s['source_id']); paths.add(safe); sheets.add(pair)
    if not {'Рабочий реестр процедур', 'Процедуры в работе'} <= {s['sheet'] for s in sources}:
        raise ValueError('INPUT_PROCEDURE_SOURCES_MISSING')


def install_google_inputs(directory, *, client=None):
    target = Path(directory)
    if target.is_symlink():
        raise ValueError('INPUT_PATH_UNSAFE')
    if target.exists():
        validate_inputs(json.loads((target / 'registry.json').read_text()), json.loads((target / 'ledger.json').read_text()))
        return
    client = client or GoogleReadClient()
    listing = client._get('https://www.googleapis.com/drive/v3/files', {
        'q': f"trashed = false and name = '{INPUT_NAME}' and mimeType = 'application/json'",
        'pageSize': 2, 'fields': 'nextPageToken,files(id,name,mimeType,version,modifiedTime)',
        'includeItemsFromAllDrives': 'true', 'supportsAllDrives': 'true'})
    files = listing.get('files') or []
    if listing.get('nextPageToken') or len(files) != 1:
        raise ValueError('INPUT_FILE_NOT_UNIQUE')
    before = files[0]
    if before.get('name') != INPUT_NAME or before.get('mimeType') != 'application/json' or not before.get('version'):
        raise ValueError('INPUT_FILE_METADATA_INVALID')
    url = 'https://www.googleapis.com/drive/v3/files/' + quote(before['id'], safe='')
    body = client._get(url, {'alt': 'media', 'supportsAllDrives': 'true'})
    after = client._get(url, {'fields': 'id,name,mimeType,version,modifiedTime', 'supportsAllDrives': 'true'})
    if after != before:
        raise ValueError('INPUT_FILE_CHANGED')
    if not isinstance(body, dict) or body.get('format') != 'aemr-report-runtime-inputs-v1':
        raise ValueError('INPUT_FILE_FORMAT_INVALID')
    validate_inputs(body.get('registry'), body.get('ledger'))
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    stage = Path(tempfile.mkdtemp(prefix='.inputs-', dir=target.parent))
    try:
        for name in ('registry', 'ledger'):
            with (stage / (name + '.json')).open('x') as file:
                json.dump(body[name], file, ensure_ascii=False, allow_nan=False)
                file.flush(); os.fsync(file.fileno())
        fd = os.open(stage, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        os.rename(stage, target)
        fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
