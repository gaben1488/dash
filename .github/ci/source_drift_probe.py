"""Read a single failed capture and compare live inputs; emit no source values."""
import json
import os
import re
import stat
import time
from pathlib import Path


def runtime_log_stages(raw, *, logger_utc=False):
    """Decode JSON or the installed multiline pino-pretty format privately."""
    from datetime import datetime, timedelta

    records, current = [], None
    for line in raw.splitlines():
        stamp, _, text = re.sub(r'\x1b\[[0-9;]*m', '', line).partition(' ')
        try:
            transported = datetime.fromisoformat(stamp)
        except ValueError:
            continue
        try:
            decoded = json.loads(text)
        except ValueError:
            decoded = None
        if isinstance(decoded, dict):
            records.append(decoded)
            current = None
            continue
        header = re.fullmatch(r'\[(\d{2}:\d{2}:\d{2}\.\d+)\]\s+(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\([^)]+\):\s*(.*)', text)
        if header:
            if logger_utc is not True or transported.utcoffset() != timedelta(0):
                raise ValueError('LOGGER_TIMEZONE_NOT_VERIFIED')
            # Docker timestamps describe buffered log delivery. Event time is
            # the logger's own UTC clock, with the date witnessed by transport.
            logged = datetime.fromisoformat(transported.date().isoformat() + 'T' + header[1] + '+00:00')
            if logged > transported + timedelta(seconds=1):
                logged -= timedelta(days=1)
            if not -1 <= (transported - logged).total_seconds() <= 3600:
                raise ValueError('LOGGER_EVENT_TIME_NOT_PROVEN')
            current = {'time': int(logged.timestamp() * 1000), 'msg': header[2]}
            records.append(current)
        elif current is not None:
            field = re.fullmatch(r'\s+(reqId|responseTime|ms):\s*(.+)', text)
            url = re.fullmatch(r'\s+"url":\s*(".*")\s*,?', text)
            try:
                if field:
                    current[field[1]] = json.loads(field[2])
                elif url and current['msg'] == 'incoming request':
                    current['req'] = {'url': json.loads(url[1])}
            except ValueError:
                continue
    stages = runtime_stage_summary(records)
    if not stages:
        raise ValueError('RUNTIME_STAGE_FORMAT_UNSUPPORTED')
    return stages


def runtime_stage_summary(records):
    """Project only fixed stage names/times from the existing private Pino log."""
    import math

    result, dashboard_requests = [], set()
    for record in records:
        if not isinstance(record, dict) or type(record.get('time')) is not int or not 0 <= record['time'] <= 2**53 - 1:
            continue
        message, request_id = record.get('msg'), record.get('reqId')
        stage, duration = None, None
        if message == 'incoming request' and isinstance(request_id, str):
            request = record.get('req')
            if isinstance(request, dict) and isinstance(request.get('url'), str) and request['url'].split('?', 1)[0] == '/api/dashboard':
                dashboard_requests.add(request_id)
                stage = 'dashboard_begin'
        elif message == 'request completed' and isinstance(request_id, str) and request_id in dashboard_requests:
            stage, duration = 'dashboard_complete', record.get('responseTime')
        elif isinstance(message, str):
            for prefix, category in (
                ('Источник прочитан', 'source_read'),
                ('Периметр строк собран', 'perimeter_ready'),
                ('Снимок сохраняется:', 'snapshot_save_begin'),
                ('Строки-атомы снимка записаны:', 'snapshot_rows_saved'),
                ('Чистка снимков по сроку хранения:', 'snapshot_pruned'),
            ):
                if message.startswith(prefix):
                    stage, duration = category, record.get('ms')
                    break
        if stage:
            event = {'at_ms': record['time'], 'stage': stage}
            if type(duration) in (int, float) and math.isfinite(duration) and 0 <= duration <= 2**53 - 1:
                event['duration_ms'] = duration
            result.append(event)
            if len(result) >= 80:
                break
    return result


def snapshot_stage_summary(database):
    """Read existing scalar timings; never scan/copy historical JSON payloads."""
    import sqlite3
    from contextlib import closing

    started = time.monotonic()
    with closing(sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True, timeout=1)) as connection:
        connection.execute('PRAGMA query_only=ON')
        connection.set_progress_handler(lambda: int(time.monotonic() - started > 10), 1000)
        recent = connection.execute('''SELECT read_duration_ms, pipeline_duration_ms, row_count, issue_count
            FROM snapshots ORDER BY created_at DESC LIMIT 5''').fetchall()
        reviewed = connection.execute('''SELECT COUNT(*) FROM issues WHERE status <> 'open'
            OR length(trim(coalesce(comment, ''))) > 0
            OR EXISTS (SELECT 1 FROM issue_history WHERE issue_history.issue_id = issues.id)
            OR EXISTS (SELECT 1 FROM audit_log WHERE audit_log.entity_id = issues.id
                AND audit_log.action = 'issue_comment')''').fetchone()[0]
        count = connection.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0]
    if any(value is not None and (type(value) is not int or not 0 <= value <= 2**53 - 1)
           for value in [count, reviewed, *(value for row in recent for value in row)]):
        raise ValueError('SNAPSHOT_STAGE_METADATA_INVALID')
    return {'recent_snapshots': [dict(zip(('read_ms', 'pipeline_ms', 'row_count', 'issue_count'), row, strict=True))
                                 for row in recent], 'snapshot_count': count, 'reviewed_case_count': reviewed}


def weekly_formula_summary(state):
    """Inspect validated frozen dependencies, without generation or live reads."""
    from collections import Counter
    from datetime import date

    from procurement_engine.archive_runtime import load_frozen_input
    from procurement_engine.deployment_diagnostics import PUBLIC_CODES
    from procurement_engine.formula_dependencies import audit_formula_dependencies

    weeks = sorted(Path(state).glob('archives/WEEKLY-*'))
    assert weeks
    source = weeks[-1]
    day = date.fromisoformat(source.name.removeprefix('WEEKLY-'))
    capture, *_ = load_frozen_input(source, day=day.isoformat(), year=day.year, quarter=(day.month - 1) // 3 + 1)
    assert capture.get('sources')
    audit = audit_formula_dependencies(capture)
    counts = Counter(item['code'] if item.get('code') in PUBLIC_CODES else 'UNRECOGNIZED_ERROR'
                     for item in audit.get('issues', []))
    refs = sum(isinstance(cell.get('formula'), str) and '#REF!' in cell['formula'].upper()
               for item in capture['sources'] for cell in (item.get('formula_evidence') or {}).get('formulas', []))
    return {'input_hashes_verified': True, 'closed': audit.get('closed') is True,
            'issue_counts': dict(counts), 'literal_ref_formulas': refs}


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
    if sys.argv[1] == 'weekly':
        print(json.dumps({'weekly_formula_dependencies': weekly_formula_summary('/app/packages/server/data/reports')}))
    elif sys.argv[1] == 'snapshot':
        print(json.dumps({'snapshot_stages': snapshot_stage_summary('/app/packages/server/data/aemr.db')}))
    else:
        main(sys.argv[1])
