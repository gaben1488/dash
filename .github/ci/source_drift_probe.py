"""Read a single failed capture and compare live inputs; emit no source values."""
import json
import os
import re
import stat
import time
from pathlib import Path


def checkpoint_content_summary(files):
    """Bounded backup-manifest statistics, not a live hash check or deletion plan."""
    if not isinstance(files, dict) or len(files) > 65536:
        raise ValueError('CONTENT_INVENTORY_INVALID')
    groups, classes = {}, {}
    count = logical = 0
    for name, item in files.items():
        if not isinstance(name, str) or Path(name).is_absolute() or '..' in Path(name).parts or not isinstance(item, dict):
            raise ValueError('CONTENT_INVENTORY_INVALID')
        if item.get('kind') == 'directory':
            continue
        size, digest = item.get('bytes'), item.get('sha256')
        if type(size) is not int or size < 0 or not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
            raise ValueError('CONTENT_INVENTORY_INVALID')
        if digest in groups and groups[digest][0] != size:
            raise ValueError('CONTENT_INVENTORY_INVALID')
        previous = groups.get(digest, (size, 0))
        groups[digest] = (size, previous[1] + 1)
        leaf = Path(name).name
        category = ('source_payloads' if 'snapshot_bundle' in Path(name).parts or leaf == 'capture.json' else
                    'report_models' if leaf == 'report_model.json' else 'receipts' if leaf == 'receipt.json' else
                    'documents' if leaf.endswith('.docx') else
                    'attempt_status' if leaf == 'status.json' and 'attempts' in Path(name).parts else
                    'databases' if leaf.endswith(('.db', '.sqlite', '-wal')) else 'other')
        values = classes.setdefault(category, {'files': 0, 'logical_bytes': 0, 'hashes': {}})
        values['files'] += 1
        values['logical_bytes'] += size
        values['hashes'][digest] = size
        count += 1
        logical += size
    unique = sum(size for size, _ in groups.values())
    return {'files': count, 'logical_bytes': logical, 'unique_content_bytes': unique,
            'duplicate_logical_bytes': logical - unique,
            'duplicate_groups': sum(number > 1 for _, number in groups.values()),
            'physical_bytes_measured': False, 'content_reverified': False, 'deletion_plan': False,
            'classes': {key: {'files': value['files'], 'logical_bytes': value['logical_bytes'],
                              'unique_content_bytes': sum(value['hashes'].values())}
                        for key, value in sorted(classes.items())}}


def image_storage_summary(images, referenced):
    """Logical image census only; shared layers and protected rollback roots need separate proof."""
    if not isinstance(images,list) or len(images)>256:
        raise ValueError('IMAGE_INVENTORY_INVALID')
    seen,rows=set(),[]
    for image in images:
        if not isinstance(image,dict):
            raise TypeError('IMAGE_INVENTORY_INVALID')
        identity,size=image.get('Id'),image.get('Size')
        if (not isinstance(identity,str) or not re.fullmatch('sha256:[a-f0-9]{64}',identity)
                or identity in seen or type(size) is not int or not 0<=size<=2**63-1):
            raise ValueError('IMAGE_INVENTORY_INVALID')
        seen.add(identity)
        tags=image.get('RepoTags') or []
        if not isinstance(tags,list) or len(tags)>64 or any(not isinstance(tag,str) for tag in tags):
            raise ValueError('IMAGE_INVENTORY_INVALID')
        labels=(image.get('Config') or {}).get('Labels') or {}
        revision=labels.get('org.opencontainers.image.revision')
        rows.append({'image':identity,'logical_bytes':size,'referenced_by_container':identity in referenced,
                     'release_tags':[tag for tag in tags if re.fullmatch(r'aemr-(?:server|web):release-[a-f0-9]{40}',tag)],
                     'source_sha':revision if isinstance(revision,str) and re.fullmatch('[a-f0-9]{40}',revision) else None})
    return {'image_count':len(rows),'logical_image_bytes':sum(row['logical_bytes'] for row in rows),
            'physical_shared_layers_measured':False,'deletion_plan':False,'images':rows}


def retention_query_summary(database):
    """Compare query cost on one read transaction; no retention/deletion runs.

    The newest row simulates a candidate displaced by the next snapshot.
    This measures SQL cost, not the whole candidate application or policy.
    """
    import sqlite3
    from contextlib import closing

    deadline = time.monotonic() + 145
    with closing(sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True, timeout=1)) as connection:
        connection.execute('PRAGMA query_only=ON')
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        connection.execute('BEGIN')
        size = connection.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0]
        cases = connection.execute('''SELECT id FROM issues WHERE status <> 'open'
            OR length(trim(coalesce(comment, ''))) > 0
            OR EXISTS (SELECT 1 FROM issue_history WHERE issue_history.issue_id = issues.id)
            OR EXISTS (SELECT 1 FROM audit_log WHERE audit_log.entity_id = issues.id AND audit_log.action = 'issue_comment')
            LIMIT 129''').fetchall()
        if not 0 < size <= 256 or not 0 < len(cases) <= 128:
            raise ValueError('RETENTION_PROBE_WORK_BUDGET_EXCEEDED')
        candidate = connection.execute('SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 1').fetchone()[0]
        needles = [json.dumps(row[0], ensure_ascii=False) for row in cases]
        start = time.monotonic()
        before = [set(connection.execute('SELECT id FROM snapshots WHERE instr(data, ?) > 0', (needle,))) for needle in needles]
        full = time.monotonic() - start
        start = time.monotonic()
        after = [set(connection.execute('SELECT id FROM snapshots WHERE id = ? AND instr(data, ?) > 0', (candidate, needle))) for needle in needles]
        scoped = time.monotonic() - start
        if any(new != old & {(candidate,)} for old, new in zip(before, after, strict=True)):
            raise ValueError('RETENTION_QUERY_RESULTS_CHANGED')
    return {'snapshot_count': size, 'case_count': len(cases), 'simulated_candidate': True,
            'scoped_results_preserved': True, 'full_search_seconds': round(full, 3), 'scoped_search_seconds': round(scoped, 3)}


def runtime_failure_summary(raw):
    """Fixed failure vocabulary and own-code stack locations; never log values."""
    counts, frames = {}, []
    patterns = {
        'NODE_HEAP_OOM': r'FATAL ERROR: .*JavaScript heap out of memory',
        'ERR_STRING_TOO_LONG': r'\bERR_STRING_TOO_LONG\b',
        'SQLITE_FULL': r'\bSQLITE_FULL\b',
        'SQLITE_IOERR': r'\bSQLITE_IOERR\b',
        'SQLITE_BUSY': r'\bSQLITE_BUSY\b',
        'ERR_WORKER_OUT_OF_MEMORY': r'\bERR_WORKER_OUT_OF_MEMORY\b',
    }
    for line in raw.splitlines():
        for code, pattern in patterns.items():
            if re.search(pattern, line):
                counts[code] = counts.get(code, 0) + 1
        frame = re.search(r'\bat [^\n]*\(/app/packages/server/src/([a-zA-Z0-9_/-]+\.ts):(\d{1,6}):(\d{1,6})\)', line)
        if frame:
            item = {'file': frame[1], 'line': int(frame[2]), 'column': int(frame[3])}
            if item not in frames and len(frames) < 20:
                frames.append(item)
    return {'failure_counts': counts, 'frames': frames}


def runtime_log_stages(raw, *, logger_utc=False):
    """Decode JSON or the installed multiline pino-pretty format privately."""
    from datetime import datetime, timedelta

    if not raw.strip():
        raise ValueError('RUNTIME_STAGE_LOG_WINDOW_EMPTY')
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

    result, requests = [], {}
    for record in records:
        if not isinstance(record, dict) or type(record.get('time')) is not int or not 0 <= record['time'] <= 2**53 - 1:
            continue
        message, request_id = record.get('msg'), record.get('reqId')
        stage, duration = None, None
        if message == 'incoming request' and isinstance(request_id, str):
            request = record.get('req')
            if isinstance(request, dict) and isinstance(request.get('url'), str):
                category = {'/api/dashboard': 'dashboard', '/api/change-story': 'journal',
                            '/api/report-releases': 'report_status', '/api/trust': 'trust',
                            '/api/issues': 'issues'}.get(request['url'].split('?', 1)[0])
                if category:
                    requests[request_id] = category
                    stage = category + '_begin'
        elif message == 'request completed' and isinstance(request_id, str) and request_id in requests:
            stage, duration = requests.pop(request_id) + '_complete', record.get('responseTime')
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


def reviewed_case_census(database):
    """No snapshot payload reads."""
    import sqlite3
    from contextlib import closing

    deadline = time.monotonic() + 10
    with closing(sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True, timeout=1)) as connection:
        connection.execute('PRAGMA query_only=ON')
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        total, rules, signals = connection.execute('''SELECT COUNT(*),
            coalesce(sum(CASE WHEN detected_by LIKE 'rule:%' THEN 1 ELSE 0 END),0),
            coalesce(sum(CASE WHEN detected_by LIKE 'pipeline:signal:%' OR detected_by LIKE 'signal:%' THEN 1 ELSE 0 END),0)
            FROM issues WHERE status <> 'open' OR length(trim(coalesce(comment,''))) > 0
            OR EXISTS (SELECT 1 FROM issue_history WHERE issue_history.issue_id=issues.id)
            OR EXISTS (SELECT 1 FROM audit_log WHERE audit_log.entity_id=issues.id
                AND audit_log.action='issue_comment')''').fetchone()
    if any(type(v) is not int or not 0 <= v <= 2**53-1 for v in (total, rules, signals)) or rules + signals > total:
        raise ValueError('CASE_METADATA_INVALID')
    return {'reviewed_cases': total, 'rule_cases': rules, 'other_cases': total-rules, 'signal_cases': signals}


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
        storage = {key: connection.execute('PRAGMA ' + pragma).fetchone()[0] for key, pragma in
                   (('page_count', 'page_count'), ('freelist_pages', 'freelist_count'),
                    ('page_size', 'page_size'), ('auto_vacuum', 'auto_vacuum'))}
        for key, path in (('file_bytes', Path(database)), ('wal_bytes', Path(str(database) + '-wal'))):
            try:
                info = path.stat()
                storage[key] = info.st_size
                storage['allocated_' + key] = info.st_blocks * 512
            except FileNotFoundError:
                if key != 'wal_bytes':
                    raise
                storage[key] = storage['allocated_' + key] = 0
    if any(value is not None and (type(value) is not int or not 0 <= value <= 2**53 - 1)
           for value in [count, reviewed, *storage.values(), *(value for row in recent for value in row)]):
        raise ValueError('SNAPSHOT_STAGE_METADATA_INVALID')
    return {'recent_snapshots': [dict(zip(('read_ms', 'pipeline_ms', 'row_count', 'issue_count'), row, strict=True))
                                 for row in recent], 'snapshot_count': count, 'reviewed_case_count': reviewed,
            'sqlite_storage': storage}


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
    elif sys.argv[1] == 'retention':
        print(json.dumps({'retention_query_comparison': retention_query_summary('/app/packages/server/data/aemr.db')}))
    else:
        main(sys.argv[1])
