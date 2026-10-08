"""Apply explicitly reviewed private header migrations; never infer schema acceptance."""
import fcntl
import json
from copy import deepcopy
from pathlib import Path
from urllib.parse import quote

from .google_adapter import GoogleReadClient
from .raw_pipeline import header_hash
from .runtime import _write
from .runtime_inputs import validate_inputs
from .snapshot import canonical_semantic_hash
from .semantic_headers import semantic_header_hash

NAME = 'aemr-report-schema-migrations-v1.json'


def apply_google_schema_migrations(registry_path, *, client=None):
    path = Path(registry_path)
    with (path.parent / '.schema-migrations.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('SCHEMA_MIGRATION_ALREADY_RUNNING') from None
        return _apply_google_schema_migrations(path, client=client)


def _apply_google_schema_migrations(path, *, client):
    client = client or GoogleReadClient()
    listing = client._get('https://www.googleapis.com/drive/v3/files', {
        'q': f"trashed = false and name = '{NAME}' and mimeType = 'application/json'",
        'pageSize': 2, 'fields': 'nextPageToken,files(id,name,mimeType,version,modifiedTime)',
        'includeItemsFromAllDrives': 'true', 'supportsAllDrives': 'true'})
    files = listing.get('files') or []
    if not files and not listing.get('nextPageToken'):
        return 0
    if listing.get('nextPageToken') or len(files) != 1:
        raise ValueError('SCHEMA_MIGRATION_FILE_NOT_UNIQUE')
    before = files[0]
    if before.get('name') != NAME or before.get('mimeType') != 'application/json' or not before.get('version'):
        raise ValueError('SCHEMA_MIGRATION_METADATA_INVALID')
    url = 'https://www.googleapis.com/drive/v3/files/' + quote(before['id'], safe='')
    body = client._get(url, {'alt': 'media', 'supportsAllDrives': 'true'})
    after = client._get(url, {'fields': 'id,name,mimeType,version,modifiedTime', 'supportsAllDrives': 'true'})
    if before != after:
        raise ValueError('SCHEMA_MIGRATION_FILE_CHANGED')
    if (not isinstance(body, dict) or body.get('format') != 'aemr-report-schema-migrations-v1'
        or not isinstance(body.get('migrations'), list)):
        raise ValueError('SCHEMA_MIGRATION_FORMAT_INVALID')
    original = json.loads(path.read_text())
    registry = deepcopy(original)
    original_hash = canonical_semantic_hash(original)
    seen = set(); changed = 0
    for patch in body['migrations']:
        if not isinstance(patch, dict) or not isinstance(patch.get('reason'), str) or not patch['reason'].strip():
            raise ValueError('SCHEMA_MIGRATION_REVIEW_MISSING')
        sid = patch.get('source_id')
        if not isinstance(sid, str) or sid in seen:
            raise ValueError('SCHEMA_MIGRATION_DUPLICATE_SOURCE')
        seen.add(sid)
        matches = [s for s in registry['sources'] if s['source_id'] == sid]
        if len(matches) != 1:
            raise ValueError('SCHEMA_MIGRATION_SOURCE_NOT_FOUND')
        source = matches[0]
        if any(source.get(key) != patch.get(key) for key in ('provider_id','sheet_id','sheet','role','columns','header_rows')):
            raise ValueError('SCHEMA_MIGRATION_CONTRACT_MISMATCH')
        if source['role'] != 'formula_dependency':
            raise ValueError('SCHEMA_MIGRATION_ROLE_NOT_SUPPORTED')
        for prefix in ('old', 'new'):
            headers = patch.get(prefix + '_headers')
            if (not isinstance(headers, list) or len(headers) > source['header_rows']
                or not all(isinstance(row, list) and len(row) <= source['columns'] for row in headers)
                or header_hash(headers, source['header_rows']) != patch.get(prefix + '_fingerprint')):
                raise ValueError('SCHEMA_MIGRATION_HEADER_PROOF_INVALID')
        if source['schema_fingerprint'] not in {patch['old_fingerprint'], patch['new_fingerprint']}:
            raise ValueError('SCHEMA_MIGRATION_BASE_MISMATCH')
        revision = client.revision(source['provider_id'])
        grid = client.grid(source['provider_id'], source['sheet_id'])
        headers = client.values(source['provider_id'], source['sheet'], 1, source['header_rows'], source['columns'])
        if not revision or revision != client.revision(source['provider_id']):
            raise ValueError('SCHEMA_MIGRATION_SOURCE_CHANGED')
        if (grid['title'] != source['sheet'] or grid['gridProperties']['columnCount'] < source['columns']
            or header_hash(headers, source['header_rows']) != patch['new_fingerprint']):
            raise ValueError('SCHEMA_MIGRATION_LIVE_HEADER_MISMATCH')
        update = {'schema_fingerprint': patch['new_fingerprint']}
        remove_volatile = False
        if 'new_semantic_fingerprint' in patch:
            old_volatile = patch.get('old_volatile_header_cells', ())
            new_volatile = patch.get('new_volatile_header_cells', ())
            old_semantic = semantic_header_hash(patch['old_headers'], source['header_rows'], source['columns'], volatile_cells=old_volatile)
            new_semantic = semantic_header_hash(patch['new_headers'], source['header_rows'], source['columns'], volatile_cells=new_volatile)
            if (old_semantic != patch.get('old_semantic_fingerprint')
                or new_semantic != patch['new_semantic_fingerprint']
                or source.get('semantic_header_fingerprint') not in (old_semantic, new_semantic)):
                raise ValueError('SCHEMA_MIGRATION_SEMANTIC_PROOF_INVALID')
            if semantic_header_hash(headers, source['header_rows'], source['columns'], volatile_cells=new_volatile) != new_semantic:
                raise ValueError('SCHEMA_MIGRATION_LIVE_SEMANTIC_MISMATCH')
            update.update(semantic_header_fingerprint=new_semantic,
                previous_semantic_header_fingerprint=old_semantic,
                schema_change_reason=patch['reason'])
            if new_volatile:
                update['volatile_header_cells'] = list(new_volatile)
            else:
                remove_volatile = 'volatile_header_cells' in source
        if remove_volatile or any(source.get(key) != value for key, value in update.items()):
            source.update(update)
            if remove_volatile:
                source.pop('volatile_header_cells', None)
            changed += 1
    if changed:
        validate_inputs(registry, json.loads((path.parent / 'ledger.json').read_text()))
        if canonical_semantic_hash(json.loads(path.read_text())) != original_hash:
            raise ValueError('SCHEMA_MIGRATION_REGISTRY_CHANGED')
        history = path.parent / 'registry-history'; history.mkdir(mode=0o700, exist_ok=True)
        backup = history / (original_hash + '.json')
        if backup.exists():
            if json.loads(backup.read_text()) != original:
                raise ValueError('SCHEMA_MIGRATION_BACKUP_MISMATCH')
        else:
            _write(backup, original)
        record_path = history / (original_hash + '-' + canonical_semantic_hash(body) + '.migration.json')
        record = {'package': body, 'drive_revision': before, 'previous_registry_hash': original_hash}
        if record_path.exists():
            previous = json.loads(record_path.read_text())
            if previous.get('package') != body or previous.get('previous_registry_hash') != original_hash:
                raise ValueError('SCHEMA_MIGRATION_HISTORY_MISMATCH')
        else:
            _write(record_path, record)
        if canonical_semantic_hash(json.loads(path.read_text())) != original_hash:
            raise ValueError('SCHEMA_MIGRATION_REGISTRY_CHANGED')
        _write(path, registry)
    return changed
