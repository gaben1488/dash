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


def read_private(path, limit):
    assert not any(parent.is_symlink() for parent in (path, *path.parents))
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        info = os.fstat(stream.fileno())
        assert stat.S_ISREG(info.st_mode) and info.st_uid in {0, 1000} and info.st_nlink == 1
        assert not info.st_mode & 0o022 and info.st_size <= limit
        body = stream.read(limit + 1)
        assert len(body) <= limit
    return json.loads(body)


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
    print(json.dumps({'source_drift_probe': True, 'expected_attempt': True,
                      'exception_type': error['error_type'] if error['error_type'] in {'GoogleReadError', 'PublicationError'} else 'OTHER',
                      'stored_evidence_present': isinstance(error.get('evidence'), dict)}), flush=True)
    path = root / 'attempts' / attempt / 'capture.json'
    info = path.lstat()
    print(json.dumps({'capture_metadata': True, 'bytes': info.st_size, 'links': info.st_nlink,
                      'mode': stat.S_IMODE(info.st_mode), 'owner_allowed': info.st_uid in {0, 1000}}), flush=True)
    capture = read_private(path, 40 * 1024 * 1024)
    registry = read_private(root / 'inputs/registry.json', 1024 * 1024)
    contracts = {source['source_id']: source for source in registry['sources']}
    sources = {source['source_id']: source for source in capture['sources']}
    assert set(contracts) == set(sources)
    client = GoogleReadClient()
    providers = sorted({source['provider_id'] for source in contracts.values()})
    before = {provider: client.revision(provider) for provider in providers}
    start = time.monotonic()
    for index, key in enumerate(sorted(sources)):
        frozen, contract = sources[key], contracts[key]
        if before[contract['provider_id']] == frozen['after']:
            continue
        assert time.monotonic() - start < 150
        payload = GoogleSheetSourceAdapter(contract, client).read_payload()
        result = compare_source(frozen, contract, payload, canonical_semantic_hash, source_semantic_metadata, header_hash)
        # The index is an ordinal within this registry; never publish provider IDs or source titles.
        print(json.dumps({'source_comparison': index, **result}), flush=True)
    after = {provider: client.revision(provider) for provider in providers}
    print(json.dumps({'source_drift_probe_complete': True, 'stable_during_probe': before == after,
                      'elapsed_seconds': round(time.monotonic() - start, 3)}), flush=True)


if __name__ == '__main__':
    import sys
    main(sys.argv[1])
