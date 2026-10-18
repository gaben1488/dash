"""Bounded read-only composition comparison; no source rows or money leave API."""
import hashlib
import json
import os
import sqlite3
import subprocess
import urllib.request
from pathlib import Path

LIMIT = 64 * 1024 * 1024
YEAR = 2026
CUTOVER = '2026-10-18T18:10:00.000Z'


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def same_scope(snapshot, year):
    return snapshot.get('metadata', {}).get('targetYear', 'absent') == year


def summarize(snapshot):
    metadata = snapshot.get('metadata', {})
    coverage = metadata.get('sourceCoverage')
    atoms = snapshot.get('rowsByDept')
    return {
        'snapshot_sha256': digest(snapshot.get('id')), 'created_at': snapshot.get('createdAt'),
        'demo': str(snapshot.get('id', '')).startswith('demo-'),
        'target_year': metadata.get('targetYear'), 'row_count': snapshot.get('rowCount'),
        'coverage': None if coverage is None else {
            'complete': coverage.get('complete'),
            'expected': len(coverage.get('expectedDepartments', [])),
            'read': len(coverage.get('readDepartments', [])),
            'unread': len(coverage.get('unreadDepartments', []))},
        'rows_by_department': None if atoms is None else {
            key: {'count': len(rows), 'sha256': digest(rows)} for key, rows in atoms.items()},
        'official_metric_count': len(snapshot.get('officialMetrics', {})),
        'calculated_metric_count': len(snapshot.get('calculatedMetrics', {})),
        'issue_count': len(snapshot.get('issues', [])),
        'sections_bytes': {key: len(encoded(snapshot[key])) for key in (
            'officialMetrics', 'calculatedMetrics', 'issues', 'metadata', 'datasetAnalyses') if key in snapshot},
        'metrics_sha256': digest([snapshot.get('officialMetrics'), snapshot.get('calculatedMetrics')]),
        'metric_values_sha256': digest({kind: {key: value.get('numericValue') for key, value in snapshot.get(kind, {}).items()}
            for kind in ('officialMetrics', 'calculatedMetrics')}),
    }


def main():
    request = urllib.request.Request(f'http://127.0.0.1:3000/api/dashboard?year={YEAR}&compact=1',
        headers={'Authorization': 'Bearer ' + os.environ['AEMR_API_KEY']})
    with urllib.request.urlopen(request, timeout=40) as response:
        body = response.read(LIMIT + 1)
        assert len(body) <= LIMIT
        api = json.loads(body)
        state = response.headers.get('x-aemr-data-state')
    current = api['snapshot']
    assert same_scope(current, YEAR)
    envelope_request = urllib.request.Request('http://127.0.0.1:3000/api/report-releases',
        headers={'Authorization': 'Bearer ' + os.environ['AEMR_API_KEY']})
    with urllib.request.urlopen(envelope_request, timeout=25) as response:
        envelope = response.read(LIMIT + 1)
        assert len(envelope) <= LIMIT
        encoding = response.headers.get('Content-Encoding', 'identity')
    valid_json = True
    try:
        json.loads(envelope.decode('utf-8'), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError):
        valid_json = False
    program = """(async()=>{const parts=[],types=new Set();let size=0;for await(const part of process.stdin){size+=part.length;types.add(typeof part+':'+Buffer.isBuffer(part));parts.push(part);}let valid=true,error=null;try{JSON.parse(Buffer.concat(parts).toString('utf8'));}catch(e){valid=false;error=['TypeError','SyntaxError'].includes(e.name)?e.name:'OTHER';}console.log(JSON.stringify({node:process.version,types:[...types],size,valid,error}));})().catch(()=>process.exitCode=2);"""
    node = subprocess.run(['node', '--import', 'tsx', '--eval', program], input=envelope,
        capture_output=True, timeout=20, check=False)
    assert node.returncode == 0 and len(node.stdout) <= 2048
    node_result = json.loads(node.stdout)
    assert set(node_result) == {'node', 'types', 'size', 'valid', 'error'}
    assert node_result['types'] in (['object:true'], ['string:false'], [])
    assert node_result['error'] in {None, 'TypeError', 'SyntaxError', 'OTHER'}
    envelope_summary = {'kind': 'live_envelope_boundary', 'bytes': len(envelope),
        'sha256': hashlib.sha256(envelope).hexdigest(), 'strict_json_valid': valid_json,
        'encoding': encoding if encoding in {'identity', 'gzip', 'br'} else 'OTHER', 'node_stream': node_result}
    path = Path(os.environ.get('SQLITE_PATH', '/app/packages/server/data/aemr.db')).resolve(strict=True)
    connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=5)
    connection.execute('PRAGMA query_only=ON')
    try:
        def load(identifier):
            row = connection.execute('SELECT data FROM snapshots WHERE id=? AND length(data)<=?',
                                     (identifier, LIMIT)).fetchone()
            return json.loads(row[0]) if row and row[0] else None
        stored = load(current['id'])
        history = []
        candidates = connection.execute(
            'SELECT id,created_at FROM snapshots WHERE created_at<? ORDER BY created_at DESC LIMIT 8',
            (CUTOVER,)).fetchall()
        for identifier, _ in candidates:
            value = load(identifier)
            if value is not None and same_scope(value, YEAR):
                history.append(summarize(value))
                break
        initial = connection.execute('SELECT id FROM snapshots WHERE created_at=? LIMIT 2',
                                     ('2026-10-18T15:59:37.937Z',)).fetchall()
        initial_summaries = [summarize(value) for (identifier,) in initial if (value := load(identifier)) is not None]
        catalog = connection.execute('SELECT created_at,row_count,metrics_count,length(data) FROM snapshots '
            'ORDER BY created_at DESC LIMIT 12').fetchall()
        table_count = connection.execute('SELECT count(*) FROM procurement_rows WHERE snapshot_id=?',
                                         (current['id'],)).fetchone()[0]
    finally:
        connection.close()
    print(json.dumps({'kind': 'dashboard_composition_readback', 'data_state': state,
        'envelope_boundary': envelope_summary,
        'response_bytes': len(body), 'response_sha256': hashlib.sha256(body).hexdigest(),
        'http': summarize(current), 'stored': None if stored is None else summarize(stored),
        'saved_atoms_table_count': table_count, 'pre_cutover_same_year': history,
        'initial_window_snapshot': initial_summaries, 'recent_catalog_counts': catalog,
        'history_comparison_available': bool(history), 'performance_accepted': False}, sort_keys=True))


if __name__ == '__main__':
    main()
