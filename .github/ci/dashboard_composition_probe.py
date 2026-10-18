"""Bounded read-only composition comparison; no source rows or money leave API."""
import hashlib
import json
import os
import sqlite3
import urllib.request
from pathlib import Path

LIMIT = 64 * 1024 * 1024
YEAR = 2026
CUTOVER = '2026-10-18T15:29:26.000Z'


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
        table_count = connection.execute('SELECT count(*) FROM procurement_rows WHERE snapshot_id=?',
                                         (current['id'],)).fetchone()[0]
    finally:
        connection.close()
    print(json.dumps({'kind': 'dashboard_composition_readback', 'data_state': state,
        'response_bytes': len(body), 'response_sha256': hashlib.sha256(body).hexdigest(),
        'http': summarize(current), 'stored': None if stored is None else summarize(stored),
        'saved_atoms_table_count': table_count, 'pre_cutover_same_year': history,
        'history_comparison_available': bool(history), 'performance_accepted': False}, sort_keys=True))


if __name__ == '__main__':
    main()
