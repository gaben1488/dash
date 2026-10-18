import contextlib
import importlib.util
import io
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('probe', Path(__file__).with_name('dashboard_composition_probe.py'))
probe = importlib.util.module_from_spec(spec)


class CompositionProbeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec.loader.exec_module(probe)

    def test_full_and_partial_sources_remain_distinct_without_source_values(self):
        snapshot = {'id': 'real-1', 'createdAt': '2026-10-18T15:00:00Z', 'rowCount': 3,
                    'metadata': {'targetYear': 2026, 'sourceCoverage': {'complete': False,
                        'expectedDepartments': ['one', 'two'], 'readDepartments': ['one'],
                        'unreadDepartments': [{'department': 'two', 'reason': 'private failure'}]}},
                    'rowsByDept': {'one': [['PRIVATE ROW'], ['second']]},
                    'issues': [{'description': 'PRIVATE ISSUE'}],
                    'officialMetrics': {'x': {'numericValue': 99}}, 'calculatedMetrics': {}}
        result = probe.summarize(snapshot)
        self.assertFalse(result['coverage']['complete'])
        self.assertEqual(result['coverage']['read'], 1)
        self.assertEqual(result['rows_by_department']['one']['count'], 2)
        self.assertEqual(result['issue_count'], 1)
        self.assertNotIn('PRIVATE', str(result))
        self.assertNotIn('private failure', str(result))
        self.assertNotIn('numericValue', str(result))

    def test_unknown_coverage_and_missing_atoms_do_not_become_complete_or_zero(self):
        result = probe.summarize({'id': 'demo-snapshot', 'metadata': {}})
        self.assertTrue(result['demo'])
        self.assertIsNone(result['coverage'])
        self.assertIsNone(result['rows_by_department'])
        self.assertIsNone(result['target_year'])

    def test_oversized_or_different_scope_snapshot_is_not_comparable(self):
        self.assertFalse(probe.same_scope({'metadata': {}}, 2026))
        self.assertFalse(probe.same_scope({'metadata': {'targetYear': None}}, 2026))
        self.assertTrue(probe.same_scope({'metadata': {'targetYear': 2026}}, 2026))

    def test_stdout_remains_one_private_safe_json_envelope(self):
        snapshot = {'id': 'fixture', 'createdAt': '2026-10-18T17:00:00Z', 'rowCount': 1,
            'metadata': {'targetYear': 2026}, 'rowsByDept': {'one': [['PRIVATE_ROW']]},
            'issues': [], 'officialMetrics': {}, 'calculatedMetrics': {}}
        responses = []
        for body in ({'snapshot': snapshot}, {'latest': {'private': 'PRIVATE_REPORT'}}):
            response = io.BytesIO(json.dumps(body).encode()); response.headers = {}
            responses.append(response)
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / 'probe.db'
            with sqlite3.connect(database) as db:
                db.executescript('CREATE TABLE snapshots(id TEXT,data TEXT,created_at TEXT,row_count INTEGER,metrics_count INTEGER);CREATE TABLE procurement_rows(snapshot_id TEXT);')
                db.execute('INSERT INTO snapshots VALUES(?,?,?,?,?)', ('fixture', json.dumps(snapshot), snapshot['createdAt'], 1, 0))
            native = SimpleNamespace(returncode=0, stdout=json.dumps({'node': 'v22.0.0',
                'types': ['object:true'], 'size': 1, 'valid': True, 'error': None}).encode())
            with patch.dict(os.environ, {'SQLITE_PATH': str(database), 'AEMR_API_KEY': 'PRIVATE_TOKEN'}), \
                 patch.object(probe.urllib.request, 'urlopen', side_effect=responses), \
                 patch.object(probe.subprocess, 'run', return_value=native), contextlib.redirect_stdout(output):
                probe.main()
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        value = json.loads(output.getvalue())
        self.assertEqual(value['kind'], 'dashboard_composition_readback')
        self.assertTrue(value['envelope_boundary']['strict_json_valid'])
        self.assertNotIn('PRIVATE', output.getvalue())


if __name__ == '__main__':
    unittest.main()
