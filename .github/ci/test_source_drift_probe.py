"""The operational source probe reveals comparisons, never primary values."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


class DriftProbeTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('source_drift_probe', Path(__file__).with_name('source_drift_probe.py'))
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_runtime_stage_projection_does_not_expose_log_text_or_request_details(self):
        records = [
            {'time': 1000, 'msg': 'incoming request', 'reqId': 'PRIVATE_REQUEST',
             'req': {'url': '/api/dashboard?year=2026&PRIVATE_QUERY'}},
            {'time': 1100, 'msg': 'Источник прочитан PRIVATE', 'ms': 75, 'what': 'PRIVATE_SOURCE'},
            {'time': 2000, 'msg': 'Снимок сохраняется: PRIVATE', 'bytes': 9999},
            {'time': 3000, 'msg': 'Строки-атомы снимка записаны: PRIVATE'},
            {'time': 4000, 'msg': 'Чистка снимков по сроку хранения: PRIVATE'},
            {'time': 5000, 'msg': 'request completed', 'reqId': 'PRIVATE_REQUEST',
             'responseTime': 4000.5, 'res': {'statusCode': 200}},
            {'time': 6000, 'msg': 'PRIVATE_VALUE'},
            {'time': 6001, 'msg': 'request completed', 'reqId': []},
            {'time': 'PRIVATE_TIME', 'msg': 'Снимок сохраняется: PRIVATE'},
        ]
        result = self.module.runtime_stage_summary(records)
        self.assertEqual(result, [
            {'at_ms': 1000, 'stage': 'dashboard_begin'},
            {'at_ms': 1100, 'stage': 'source_read', 'duration_ms': 75},
            {'at_ms': 2000, 'stage': 'snapshot_save_begin'},
            {'at_ms': 3000, 'stage': 'snapshot_rows_saved'},
            {'at_ms': 4000, 'stage': 'snapshot_pruned'},
            {'at_ms': 5000, 'stage': 'dashboard_complete', 'duration_ms': 4000.5},
        ])
        self.assertNotIn('PRIVATE', str(result))
        self.assertEqual(len(self.module.runtime_stage_summary(records * 100)), 80)

    def test_runtime_stages_read_actual_ansi_multiline_pretty_format(self):
        raw = '''2026-10-16T07:22:01.123456789Z [07:22:01.123] \x1b[32mINFO\x1b[39m (123): \x1b[36mincoming request\x1b[39m
2026-10-16T07:22:01.123456789Z     \x1b[35mreqId\x1b[39m: "PRIVATE_REQUEST"
2026-10-16T07:22:01.123456789Z     req: {
2026-10-16T07:22:01.123456789Z       "url": "/api/dashboard?PRIVATE_QUERY"
2026-10-16T07:22:01.123456789Z     }
2026-10-16T07:22:02.123456789Z [07:22:02.123] INFO (123): Снимок сохраняется: PRIVATE
2026-10-16T07:22:03.123456789Z [07:22:03.123] INFO (123): request completed
2026-10-16T07:22:03.123456789Z     reqId: "PRIVATE_REQUEST"
2026-10-16T07:22:03.123456789Z     responseTime: 2000.5
'''
        result = self.module.runtime_log_stages(raw)
        self.assertEqual([item['stage'] for item in result],
                         ['dashboard_begin', 'snapshot_save_begin', 'dashboard_complete'])
        self.assertEqual(result[-1]['duration_ms'], 2000.5)
        self.assertEqual(result[1]['at_ms'] - result[0]['at_ms'], 1000)
        self.assertNotIn('PRIVATE', str(result))
        with self.assertRaisesRegex(ValueError, '^RUNTIME_STAGE_FORMAT_UNSUPPORTED$'):
            self.module.runtime_log_stages('PRIVATE_OTHER_FORMAT')

    def test_snapshot_stage_probe_reads_scalar_metadata_without_payload_or_writes(self):
        import json
        import sqlite3
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / 'state.sqlite'
            with sqlite3.connect(database) as connection:
                connection.executescript('''
                    CREATE TABLE snapshots (created_at TEXT, read_duration_ms INTEGER,
                        pipeline_duration_ms INTEGER, row_count INTEGER, issue_count INTEGER, data TEXT);
                    CREATE TABLE issues (id TEXT, status TEXT, comment TEXT);
                    CREATE TABLE issue_history (issue_id TEXT);
                    CREATE TABLE audit_log (entity_id TEXT, action TEXT);
                    INSERT INTO snapshots VALUES ('2026-10-16T07:22:00Z', 123, 25000, 5000, 700, 'PRIVATE_PAYLOAD');
                    INSERT INTO issues VALUES ('PRIVATE_ID', 'false_positive', NULL);
                ''')
            real_connect = sqlite3.connect
            statements = []
            def connect(*args, **kwargs):
                connection = real_connect(*args, **kwargs)
                connection.set_trace_callback(statements.append)
                connection.set_authorizer(lambda action, name, column, *_:
                    sqlite3.SQLITE_DENY if action == sqlite3.SQLITE_READ and column == 'data'
                    else sqlite3.SQLITE_OK)
                return connection
            with patch.object(sqlite3, 'connect', side_effect=connect):
                result = self.module.snapshot_stage_summary(database)
            self.assertEqual(result['recent_snapshots'], [{'read_ms': 123, 'pipeline_ms': 25000,
                'row_count': 5000, 'issue_count': 700}])
            self.assertEqual(result['reviewed_case_count'], 1)
            self.assertEqual(result['snapshot_count'], 1)
            self.assertNotIn('PRIVATE', json.dumps(result))
            self.assertFalse(any(statement.lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE', 'CREATE'))
                                 for statement in statements))
            # SQLite INTEGER affinity still admits text/REAL values. Corrupt
            # metadata must never turn a numeric-only public probe into a leak.
            for malformed in ('PRIVATE_TIMING', -1, 1e300):
                with self.subTest(malformed=type(malformed).__name__), real_connect(database) as connection:
                    connection.execute('UPDATE snapshots SET pipeline_duration_ms = ?', (malformed,))
                with self.assertRaisesRegex(ValueError, '^SNAPSHOT_STAGE_METADATA_INVALID$'):
                    self.module.snapshot_stage_summary(database)

    def test_weekly_formula_diagnostic_reports_codes_and_literal_ref_count_only(self):
        import json
        import tempfile

        capture = {'sources': [{'source_id': 'PRIVATE_SOURCE', 'provider_id': 'PRIVATE_BOOK',
            'sheet_id': 1, 'sheet': 'PRIVATE_SHEET', 'rows': 1, 'columns': 1,
            'values': [['PRIVATE_VALUE']], 'formula_evidence': {'rows': 1, 'columns': 1,
                'formulas': [{'row': 1, 'column': 1, 'formula': '=#REF!A1'}],
                'sheets': [{'sheetId': 1, 'title': 'PRIVATE_SHEET'}], 'named_ranges': []}}]}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'archives/WEEKLY-2026-10-15').mkdir(parents=True)
            with patch('procurement_engine.archive_runtime.load_frozen_input', return_value=(capture, {}, [], {})):
                result = self.module.weekly_formula_summary(root)
        self.assertFalse(result['closed'])
        self.assertEqual(result['literal_ref_formulas'], 1)
        self.assertGreater(result['issue_counts']['FORMULA_DEPENDENCY_NOT_CAPTURED'], 0)
        self.assertNotIn('PRIVATE', json.dumps(result))

    def test_exact_coordinates_preserve_missing_empty_zero_and_type(self):
        result = self.module.value_differences([[0, '', None, 3]], [['0', '', None], ['PRIVATE_SENTINEL']])
        self.assertEqual(result, {'changed_cells': 3, 'coordinates': [[1, 1], [1, 4], [2, 1]], 'truncated': False})
        self.assertNotIn('PRIVATE_SENTINEL', str(result))

    def test_coordinates_are_bounded_without_losing_total(self):
        result = self.module.value_differences([[1] * 120], [[]])
        self.assertEqual(result['changed_cells'], 120)
        self.assertEqual(len(result['coordinates']), 50)
        self.assertTrue(result['truncated'])

    def test_metadata_and_schema_are_reported_separately(self):
        source = {'values': [['PRIVATE_OLD']], 'sheet': 'PRIVATE_TITLE', 'grbs': 'PRIVATE_CUSTOMER',
                  'rows': 2, 'columns': 1, 'formula_evidence': {'PRIVATE_FORMULA': 'OLD'}}
        contract = {'header_rows': 1, 'units': 'rubles', 'schema_fingerprint': 'old'}
        payload = SimpleNamespace(semantic_values=[['PRIVATE_NEW']], schema_fingerprint='new',
                                  metadata={'formula_evidence': {'PRIVATE_FORMULA': 'NEW'}})
        result = self.module.compare_source(source, contract, payload, lambda x: repr(x), lambda x: x,
                                            lambda *a, **k: 'old')
        self.assertEqual(result['values_equal'], False)
        self.assertEqual(result['metadata_equal'], False)
        self.assertEqual(result['schema_equal'], False)
        self.assertNotIn('PRIVATE', str(result))

    def test_installed_semantic_helpers_ignore_display_only_changes(self):
        import copy

        from procurement_engine.google_adapter import source_semantic_metadata
        from procurement_engine.raw_pipeline import header_hash
        from procurement_engine.snapshot import canonical_semantic_hash

        evidence = {'sheets': [{'sheetId': 1, 'title': 'PRIVATE', 'hidden': False,
                               'gridProperties': {'rowCount': 2, 'columnCount': 1}}],
                    'named_ranges': [], 'formulas': [['=1']], 'rows': 2, 'columns': 1}
        frozen = {'sheet': 'PRIVATE', 'grbs': None, 'values': [['Header'], [1]],
                  'rows': 2, 'columns': 1, 'formula_evidence': evidence}
        contract = {'header_rows': 1, 'units': 'rubles', 'schema_fingerprint': header_hash(frozen['values'], 1)}
        changed = copy.deepcopy(evidence)
        changed['sheets'][0]['hidden'] = True
        payload = SimpleNamespace(semantic_values=frozen['values'], schema_fingerprint=contract['schema_fingerprint'],
                                  metadata={'formula_evidence': changed})
        result = self.module.compare_source(frozen, contract, payload, canonical_semantic_hash, source_semantic_metadata, header_hash)
        self.assertTrue(result['values_equal'])
        self.assertTrue(result['metadata_equal'])
        self.assertTrue(result['schema_equal'])
        self.assertFalse(result['formula_evidence_equal'])

    def test_one_source_reuses_shared_payload_without_loading_full_capture(self):
        import json
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            bundle = Path(temporary)
            (bundle / 'payloads').mkdir()
            path = bundle / 'payloads/TEST.json'
            contract = {'provider_id': 'private', 'role': 'master', 'sheet_id': 1}
            payload = {'source_id': 'TEST', **contract, 'sheet_or_tab_id': '1',
                       'semantic_values': [['PRIVATE']], 'metadata': {'sheet_title': 'Private', 'grbs': 'Private',
                       'row_count': 1, 'column_count': 1, 'formula_evidence': {}, 'capture_method': 'native'}}
            path.write_text(json.dumps(payload))
            path.chmod(0o600)
            os.link(path, bundle / 'same-content.json')
            frozen = self.module.frozen_source(bundle, 'TEST', contract, {'TEST': 'captured'})
            self.assertEqual(frozen['values'], [['PRIVATE']])
            self.assertEqual(frozen['after'], 'captured')
            # Shared payloads are legitimate; mutable private config remains stricter.
            with self.assertRaises(AssertionError):
                self.module.read_private(path, 16384)

    def test_streaming_manifest_rejects_fifo_symlink_and_wrong_hash(self):
        import hashlib
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'manifest.json'
            path.write_bytes(b'private-fixture')
            path.chmod(0o600)
            digest = hashlib.sha256(b'private-fixture').hexdigest()
            self.module.verify_manifest(path, digest)
            with self.assertRaises(AssertionError):
                self.module.verify_manifest(path, '0' * 64)
            os.symlink(path, root / 'link.json')
            with self.assertRaises(AssertionError):
                self.module.verify_manifest(root / 'link.json', digest)
            os.mkfifo(root / 'fifo.json', 0o600)
            with self.assertRaises(AssertionError):
                self.module.verify_manifest(root / 'fifo.json', digest)


if __name__ == '__main__':
    unittest.main()
