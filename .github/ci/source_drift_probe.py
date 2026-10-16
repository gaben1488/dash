"""Read a single failed capture and compare live inputs; emit no source values."""
import json
import os
import re
import stat
import time
from pathlib import Path


def value_differences(before, after):
    missing = object()
    count, coordinates = 0, []
    for row in range(max(len(before), len(after))):
        left = before[row] if row < len(before) else []
        right = after[row] if row < len(after) else []
        for column in range(max(len(left), len(right))):
            a = left[column] if column < len(left) else missing
            b = right[column] if column < len(right) else missing
            if type(a) is type(b) and a == b:
                continue
            count += 1
            if len(coordinates) < 50:
                coordinates.append([row + 1, column + 1])
    return {'changed_cells': count, 'coordinates': coordinates, 'truncated': count > len(coordinates)}


def compare_source(frozen, contract, payload, digest, normalize, header_hash):
    metadata = {'sheet_title': frozen['sheet'], 'grbs': frozen.get('grbs'),
                'row_count': frozen['rows'], 'column_count': frozen['columns'],
                'header_rows': contract['header_rows'], 'units': contract['units'],
                'capture_method': frozen.get('capture_method', 'connector_bounded_ranges'),
                'formula_evidence': frozen.get('formula_evidence')}
    observed = {**metadata, **payload.metadata, 'sheet_title': frozen['sheet']}
    schema = header_hash(frozen['values'], contract['header_rows'],
                         volatile_cells=contract.get('volatile_header_cells', ()))
    return {'values_equal': digest(frozen['values']) == digest(payload.semantic_values),
            'metadata_equal': digest(normalize(metadata)) == digest(normalize(observed)),
            'formula_evidence_equal': digest(frozen.get('formula_evidence')) == digest(payload.metadata.get('formula_evidence')),
            'schema_equal': schema == payload.schema_fingerprint == contract['schema_fingerprint'],
            **value_differences(frozen['values'], payload.semantic_values)}


def read_private(path, limit, *, shared=False):
    assert not any(parent.is_symlink() for parent in (path, *path.parents))
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        info = os.fstat(stream.fileno())
        assert stat.S_ISREG(info.st_mode) and info.st_uid in {0, 1000} and (shared or info.st_nlink == 1)
        assert not info.st_mode & 0o022 and info.st_size <= limit
        body = stream.read(limit + 1)
        assert len(body) <= limit
    return json.loads(body)


def frozen_source(bundle, key, contract, revisions):
    safe = ''.join(ch if ch.isalnum() or ch in '-_' else '_' for ch in key)
    body = read_private(bundle / 'payloads' / (safe + '.json'), 16 * 1024 * 1024, shared=True)
    assert body['source_id'] == key and body['provider_id'] == contract['provider_id']
    assert body['role'] == contract['role'] and body['sheet_or_tab_id'] == str(contract['sheet_id'])
    metadata = body['metadata']
    return {'values': body['semantic_values'], 'sheet': metadata['sheet_title'],
            'grbs': metadata['grbs'], 'rows': metadata['row_count'], 'columns': metadata['column_count'],
            'formula_evidence': metadata['formula_evidence'], 'after': revisions[key],
            'capture_method': metadata['capture_method']}


def verify_manifest(path, expected):
    import hashlib

    assert not any(parent.is_symlink() for parent in (path, *path.parents))
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        info = os.fstat(stream.fileno())
        assert stat.S_ISREG(info.st_mode) and info.st_uid in {0, 1000}
        assert not info.st_mode & 0o022 and info.st_size <= 256 * 1024 * 1024
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == expected


def main(attempt):
    from procurement_engine.google_adapter import (
        GoogleReadClient,
        GoogleSheetSourceAdapter,
        source_semantic_metadata,
    )
    from procurement_engine.raw_pipeline import header_hash
    from procurement_engine.snapshot import canonical_semantic_hash
    assert re.fullmatch('[a-f0-9]{32}', attempt)
    root = Path('/app/packages/server/data/reports')
    error = read_private(root / 'attempts' / attempt / 'error.json', 1024 * 1024)
    assert error['error_code'] == 'SOURCE_CHANGED_BEFORE_PUBLICATION' and error['stage'] == 'publication'
    print(json.dumps({'source_drift_probe': True, 'expected_attempt': True, 'publication_evidence': False,
                      'exception_type': error['error_type'] if error['error_type'] in {'GoogleReadError', 'PublicationError'} else 'OTHER',
                      'stored_evidence_present': isinstance(error.get('evidence'), dict)}), flush=True)
    path = root / 'attempts' / attempt / 'capture.json'
    info = path.lstat()
    print(json.dumps({'capture_metadata': True, 'bytes': info.st_size, 'links': info.st_nlink,
                      'mode': stat.S_IMODE(info.st_mode), 'owner_allowed': info.st_uid in {0, 1000}}), flush=True)
    # Reuse the existing per-source bundle. The 67 MiB capture and manifest
    # repeat full evidence; neither is parsed just to select one source.
    bundle = root / 'attempts' / attempt / 'bundle/snapshot_bundle'
    meta = read_private(bundle / 'bundle.json', 1024 * 1024)
    manifest = bundle / 'manifest.json'
    verify_manifest(manifest, meta['manifest_sha256'])
    registry = read_private(bundle / 'payloads/SOURCE_CONTRACT.json', 1024 * 1024, shared=True)['semantic_values']
    contracts = {source['source_id']: source for source in registry['sources']}
    assert set(contracts) <= set(meta['after'])
    client = GoogleReadClient()
    providers = sorted({source['provider_id'] for source in contracts.values()})
    before = {provider: client.revision(provider) for provider in providers}
    start = time.monotonic()
    frozen = payload = None
    for index, key in enumerate(sorted(contracts)):
        contract = contracts[key]
        if before[contract['provider_id']] == meta['after'][key]:
            continue
        assert time.monotonic() - start < 150
        frozen = payload = None  # Release the previous matrix before reading the next source.
        frozen = frozen_source(bundle, key, contract, meta['after'])
        payload = GoogleSheetSourceAdapter(contract, client).read_payload()
        result = compare_source(frozen, contract, payload, canonical_semantic_hash, source_semantic_metadata, header_hash)
        # A tab's integer identifier is technical metadata, not a Drive file ID.
        # Source titles, provider identities, values and revision tokens stay private.
        roles = {'master', 'procedure_lifecycle', 'formula_dependency', 'historical_control_dependency'}
        print(json.dumps({'source_comparison': index, 'sheet_id': contract['sheet_id'],
                          'role': contract['role'] if contract['role'] in roles else 'OTHER', **result}), flush=True)
    after = {provider: client.revision(provider) for provider in providers}
    print(json.dumps({'source_drift_probe_complete': True, 'stable_during_probe': before == after,
                      'elapsed_seconds': round(time.monotonic() - start, 3)}), flush=True)


if __name__ == '__main__':
    import sys
    main(sys.argv[1])
