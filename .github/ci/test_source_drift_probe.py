"""The operational source probe reveals comparisons, never primary values."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


class DriftProbeTests(unittest.TestCase):
    def test_storage_census_is_metadata_only_and_never_discloses_paths(self):
        files = {
            'reports/published/releases/PRIVATE_RELEASE/snapshot.json': {'bytes': 9000, 'sha256': 'a' * 64},
            'reports/published/releases/PRIVATE_RELEASE/retained_evidence/payloads/PRIVATE_SOURCE.json': {'bytes': 7000, 'sha256': 'b' * 64},
            'reports/attempts/PRIVATE_ATTEMPT/bundle/identity.sqlite3': {'bytes': 6000, 'sha256': 'c' * 64},
            'reports/attempts/PRIVATE_ATTEMPT/bundle/snapshot.json': {'bytes': 9000, 'sha256': 'a' * 64},
        }
        result = self.module.checkpoint_content_summary(files)
        self.assertEqual(result['families']['snapshot.json'], {'files': 2, 'logical_bytes': 18000, 'unique_content_bytes': 9000})
        self.assertEqual(result['families']['retained_source_payloads']['logical_bytes'], 7000)
        self.assertEqual(result['families']['databases']['logical_bytes'], 6000)
        self.assertEqual(sum(item['logical_bytes'] for item in result['areas'].values()), result['logical_bytes'])
        self.assertEqual(result['families']['snapshot.json']['logical_bytes'],
                         sum(item['logical_bytes'] for item in result['area_families'].values() if item['family'] == 'snapshot.json'))
        import json
        self.assertNotIn('PRIVATE', json.dumps(result))

    def test_storage_mode_does_not_read_attempt_bodies_or_run_recovery(self):
        import ast
        import contextlib
        import io
        import json
        import textwrap
        source = (Path(__file__).resolve().parents[2] / '.github/workflows/ci.yml').read_text()
        body = []
        for line in source.split('            def main():\n', 1)[1].splitlines():
            if line.strip() and len(line) - len(line.lstrip()) <= 12:
                break
            body.append(line)
        module = ast.parse(textwrap.dedent('            def main():\n' + '\n'.join(body)))
        calls = []
        scope = {'os': SimpleNamespace(environ={'STORAGE_CENSUS_ONLY': 'yes'}), 'json': json,
                 'checkpoint_metadata': lambda **kwargs: calls.append(('checkpoint', kwargs)),
                 'snapshot': lambda run: calls.append(('runtime', {})) or []}
        exec(compile(module, '<actual-observer-main>', 'exec'), scope)  # noqa: S102 - trusted workflow function
        with contextlib.redirect_stdout(io.StringIO()):
            scope['main']()
        self.assertEqual(calls, [('checkpoint', {'storage_only': True}), ('runtime', {})])

    def test_selected_acceptance_progress_reads_receipts_without_bulk_census(self):
        import ast
        import contextlib
        import io
        import json
        import textwrap

        source = (Path(__file__).resolve().parents[2] / '.github/workflows/ci.yml').read_text()
        body = []
        for line in source.split('            def main():\n', 1)[1].splitlines():
            if line.strip() and len(line) - len(line.lstrip()) <= 12:
                break
            body.append(line)
        module = ast.parse(textwrap.dedent('            def main():\n' + '\n'.join(body)))
        for selected in ('acceptance-123-1', ''):
            calls = []
            scope = {'os': SimpleNamespace(environ={'RELEASE_PROGRESS_ONLY': 'yes', 'WORKER_ACCEPTANCE': selected}),
                     'json': json,
                     'worker_operational_metadata': lambda calls=calls, **kwargs: calls.append(('worker', kwargs)),
                     'accepted_cycle_metadata': lambda calls=calls: calls.append(('receipts', {})),
                     'checkpoint_metadata': lambda calls=calls: calls.append(('bulk_checkpoint_census', {})),
                     'snapshot': lambda run, calls=calls: calls.append(('runtime', {})) or []}
            exec(compile(module, '<actual-observer-main>', 'exec'), scope)  # noqa: S102 - trusted workflow function
            with contextlib.redirect_stdout(io.StringIO()):
                scope['main']()
            expected = 'receipts' if selected else 'bulk_checkpoint_census'
            self.assertEqual(calls, [('worker', {'include_saved': False}), (expected, {}), ('runtime', {})])

    def test_timing_transport_contains_only_bounded_runtime_projectors(self):
        import ast
        import base64
        import os
        import subprocess
        import sys
        import tempfile
        import textwrap

        root = Path(__file__).resolve().parents[2]
        workflow = (root / '.github/workflows/ci.yml').read_text()
        section = workflow.split('      - name: Bind reviewed runtime log projector\n', 1)[1]
        binder = textwrap.dedent(section.split("<<'PYBIND'\n", 1)[1].split('\n          PYBIND', 1)[0])
        source = (root / '.github/ci/source_drift_probe.py').read_text()
        bodies = []
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            path = work / '.github/ci/source_drift_probe.py'
            path.parent.mkdir(parents=True)
            (path.parent / 'header_api_probe.mjs').write_bytes((root / '.github/ci/header_api_probe.mjs').read_bytes())
            (path.parent / 'native_selection_profile.py').write_bytes((root / '.github/ci/native_selection_profile.py').read_bytes())
            for suffix in ('', '\n' + '#' * 100_000 + '\ndef unrelated_private_probe():\n    raise RuntimeError("PRIVATE_CANARY")\n'):
                path.write_text(source + suffix)
                output = work / 'environment'
                output.write_text('')
                result = subprocess.run([sys.executable, '-IB', '-c', binder], cwd=work,
                                        env={**os.environ, 'GITHUB_ENV': str(output)},
                                        capture_output=True, text=True, timeout=10, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                values = dict(line.split('=', 1) for line in output.read_text().splitlines())
                body = base64.b64decode(values['DRIFT_PROBE'], validate=True)
                self.assertLessEqual(len(body), 24576)
                self.assertEqual(__import__('hashlib').sha256(body).hexdigest(), values['DRIFT_PROBE_SHA'])
                parsed = ast.parse(body)
                self.assertEqual({node.name for node in parsed.body if isinstance(node, ast.FunctionDef)},
                                 {'runtime_log_stages', 'runtime_stage_summary'})
                self.assertNotIn(b'PRIVATE_CANARY', body)
                bodies.append(body)
        self.assertEqual(bodies[0], bodies[1])
        namespace = {'__name__': 'isolated_runtime_projector'}
        exec(compile(bodies[0], '<runtime-projector>', 'exec'), namespace)  # noqa: S102 - exact bounded workflow output
        raw = ('2026-10-18T00:00:01Z {"time":1,"msg":"incoming request","reqId":"PRIVATE",'
               '"req":{"url":"/api/dashboard?PRIVATE_QUERY"}}\n'
               '2026-10-18T00:00:02Z {"time":2,"msg":"request completed","reqId":"PRIVATE","responseTime":5}')
        self.assertEqual(namespace['runtime_log_stages'](raw, logger_utc=True),
                         [{'at_ms': 1, 'stage': 'dashboard_begin'},
                          {'at_ms': 2, 'stage': 'dashboard_complete', 'duration_ms': 5}])

    def test_finished_attempt_inventory_extracts_only_bound_scalar_metadata(self):
        import hashlib
        import json
        import tempfile

        attempt='a'*32
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);name=f'reports/attempts/{attempt}/status.json';path=root/name;path.parent.mkdir(parents=True)
            value={'attempt_id':attempt,'status':'VERIFIED_WITH_WARNINGS','finished_at':'2026-10-17T15:00:00Z',
                   'private_payload':{'subject':'PRIVATE_VALUE','status':'RUNNING'}}
            def save(body):
                path.write_bytes(body)
                return {name:{'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}}
            files=save(json.dumps(value).encode())
            checker=lambda source,relative,expected:(source/relative).stat()
            result=self.module.terminal_attempt_keys(root,files,checker)
            self.assertEqual(result['attempt_ids'],{attempt})
            self.assertNotIn('PRIVATE',str(result))
            for body in (b'not json',json.dumps({**value,'status':'RUNNING'}).encode(),
                         (json.dumps(value)[:-1]+',"status":"RUNNING"}').encode()):
                files=save(body)
                self.assertEqual(self.module.terminal_attempt_keys(root,files,checker)['attempt_ids'],set())
            files=save(json.dumps(value).encode());path.write_bytes(b'changed')
            self.assertEqual(self.module.terminal_attempt_keys(root,files,checker)['attempt_ids'],set())

    def test_immutable_sharing_inventory_counts_inodes_without_touching_bytes(self):
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);one=root/'one';two=root/'two'
            one.write_bytes(b'a'*8192);two.write_bytes(one.read_bytes())
            group=[{'relative':'one'},{'relative':'two'}]
            planner=lambda *args:[group]
            result=self.module.immutable_sharing_summary(root,{}, {},planner)
            self.assertEqual(result['allocated_reclaimable_upper_bound_bytes'],two.stat().st_blocks*512)
            self.assertFalse(result['applied'])
            self.assertEqual(two.read_bytes(),one.read_bytes())
            two.unlink();os.link(one,two)
            result=self.module.immutable_sharing_summary(root,{}, {},planner)
            self.assertEqual(result['allocated_reclaimable_upper_bound_bytes'],0)

    def test_image_inventory_projects_only_release_metadata_and_references(self):
        import json

        images=[{'Id':'sha256:'+'a'*64,'Size':100,'RepoTags':['aemr-server:release-'+'b'*40,'PRIVATE_REPOSITORY'],
                 'Config':{'Env':['SECRET=PRIVATE_VALUE'],'Labels':{'org.opencontainers.image.revision':'b'*40}}},
                {'Id':'sha256:'+'c'*64,'Size':200,'RepoTags':None,'Config':{}}]
        result=self.module.image_storage_summary(images,{'sha256:'+'a'*64})
        self.assertEqual(result['logical_image_bytes'],300)
        self.assertEqual([v['referenced_by_container'] for v in result['images']],[True,False])
        self.assertFalse(result['physical_shared_layers_measured'])
        self.assertFalse(result['deletion_plan'])
        self.assertNotIn('PRIVATE',json.dumps(result))

    def test_image_layer_inventory_reports_engine_estimates_without_claiming_deletion(self):
        identity='sha256:'+'a'*64
        images=[{'Id':identity,'Size':100,'RepoTags':[],'Config':{}}]
        usage={'Images':[{'Id':identity,'Size':150,'SharedSize':120,'Containers':1,
                          'RepoTags':['PRIVATE']}],'LayersSize':100}
        result=self.module.image_storage_summary(images,{identity},usage)
        self.assertEqual(result['images'][0]['logical_bytes'],100)
        self.assertEqual(result['images'][0]['engine_reported_size_bytes'],150)
        self.assertEqual(result['images'][0]['engine_reported_unique_bytes'],30)
        self.assertEqual(result['images'][0]['engine_reported_shared_bytes'],120)
        self.assertEqual(result['images'][0]['engine_container_count'],1)
        self.assertNotIn('PRIVATE',str(result))
        self.assertFalse(result['physical_shared_layers_measured'])
        self.assertFalse(result['deletion_plan'])
        for changed in ({'Size':-1},{'Size':True},{'SharedSize':151},{'SharedSize':-1},{'Containers':True}):
            with self.subTest(changed=changed),self.assertRaises(ValueError):
                self.module.image_storage_summary(images,set(),{'Images':[{**usage['Images'][0],**changed}]})
        with self.assertRaises(ValueError):
            self.module.image_storage_summary(images,set(),{'Images':[]})

    def test_image_inventory_rejects_ambiguous_or_unbounded_input(self):
        image={'Id':'sha256:'+'a'*64,'Size':100,'RepoTags':[],'Config':{}}
        for images in ([image,image],[{**image,'Size':True}],[{**image,'Id':'bad'}],[image]*257):
            with self.subTest(images=len(images)),self.assertRaises(ValueError):
                self.module.image_storage_summary(images,set())

    def test_checkpoint_inventory_counts_equal_content_without_merging_entities_or_leaking_paths(self):
        import json

        files = {
            'PRIVATE/': {'kind': 'directory', 'bytes': 0},
            'reports/attempts/PRIVATE/capture.json': {'bytes': 100, 'sha256': 'a' * 64},
            'reports/published/releases/PRIVATE/capture.json': {'bytes': 100, 'sha256': 'a' * 64},
            'reports/published/releases/PRIVATE/report_model.json': {'bytes': 60, 'sha256': 'b' * 64},
        }
        before = json.dumps(files, sort_keys=True)
        result = self.module.checkpoint_content_summary(files)
        self.assertEqual(result['files'], 3)
        self.assertEqual(result['logical_bytes'], 260)
        self.assertEqual(result['unique_content_bytes'], 160)
        self.assertEqual(result['duplicate_logical_bytes'], 100)
        self.assertEqual(result['duplicate_groups'], 1)
        self.assertIs(result['physical_bytes_measured'], False)
        self.assertIs(result['content_reverified'], False)
        self.assertIs(result['deletion_plan'], False)
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('a' * 64, json.dumps(result))
        self.assertEqual(json.dumps(files, sort_keys=True), before)

    def test_checkpoint_inventory_rejects_invalid_evidence_instead_of_claiming_savings(self):
        for item in ({'bytes': -1, 'sha256': 'a' * 64}, {'bytes': True, 'sha256': 'a' * 64},
                     {'bytes': 20, 'sha256': 'INVALID'}):
            with self.assertRaises(ValueError):
                self.module.checkpoint_content_summary({'file': item})
        with self.assertRaises(ValueError):
            self.module.checkpoint_content_summary({'one': {'bytes': 10, 'sha256': 'a' * 64},
                                                  'two': {'bytes': 20, 'sha256': 'a' * 64}})

    def test_incident_projection_reports_failure_classes_without_private_log_text(self):
        import json

        raw = '''2026-10-17T08:58:00Z FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory PRIVATE
2026-10-17T08:58:01Z RangeError [ERR_STRING_TOO_LONG]: PRIVATE
2026-10-17T08:58:02Z     at JSON.stringify (<anonymous>)
2026-10-17T08:58:03Z     at saveSnapshot (/app/packages/server/src/snapshots/repository.ts:123:45)
2026-10-17T08:58:04Z Error: SQLITE_FULL: PRIVATE
2026-10-17T08:58:05Z Error: PRIVATE_UNRECOGNIZED
'''
        result = self.module.runtime_failure_summary(raw)
        self.assertEqual(result['failure_counts'],
                         {'NODE_HEAP_OOM': 1, 'ERR_STRING_TOO_LONG': 1, 'SQLITE_FULL': 1})
        self.assertEqual(result['frames'], [{'file': 'snapshots/repository.ts', 'line': 123, 'column': 45}])
        self.assertNotIn('PRIVATE', json.dumps(result))

    def test_incident_projection_is_bounded_and_does_not_copy_unknown_paths(self):
        raw = '2026-10-17T08:58:01Z     at private (/private/PRIVATE.js:1:2)\n' * 1000
        self.assertEqual(self.module.runtime_failure_summary(raw), {'failure_counts': {}, 'frames': []})
        raw = '2026-10-17T08:58:01Z     at f (/app/packages/server/src/routes/dashboard.ts:1:2)\n' * 1000
        self.assertEqual(len(self.module.runtime_failure_summary(raw)['frames']), 1)

    def test_isolated_scope_probe_accepts_stdin_and_bounds_its_daemon_process(self):
        import ast
        import textwrap

        workflow = Path(__file__).parents[1] / 'workflows' / 'ci.yml'
        body = workflow.read_text().split("<<'PYSCOPE'\n", 1)[1].split('\n            PYSCOPE', 1)[0]
        tree = ast.parse(textwrap.dedent(body))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Attribute) and node.func.attr == 'run'
                 and node.args and isinstance(node.args[0], ast.List)
                 and any(keyword.arg == 'input' and isinstance(keyword.value, ast.Name)
                         and keyword.value.id == 'code' for keyword in node.keywords)]
        self.assertEqual(len(calls), 1)
        values = [item.value for item in calls[0].args[0].elts if isinstance(item, ast.Constant)]
        self.assertEqual(values[:2], ['docker', 'run'])
        self.assertIn('-i', values, 'Docker must forward the submitted Node program')
        self.assertIn('TMPDIR=/probe', values)
        self.assertEqual(values[values.index('--entrypoint') + 1], '/usr/bin/timeout')
        self.assertIn('180s', values)
        self.assertIn('5s', values)
        self.assertIn('node', values)

    def setUp(self):
        spec = importlib.util.spec_from_file_location('source_drift_probe', Path(__file__).with_name('source_drift_probe.py'))
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_retention_query_comparison_preserves_scoped_results_and_private_state(self):
        import json
        import sqlite3
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / 'state.sqlite'
            with sqlite3.connect(database) as connection:
                connection.executescript('''
                    CREATE TABLE snapshots (id TEXT PRIMARY KEY, created_at TEXT, data TEXT);
                    CREATE TABLE issues (id TEXT, status TEXT, comment TEXT);
                    CREATE TABLE issue_history (issue_id TEXT);
                    CREATE TABLE audit_log (entity_id TEXT, action TEXT);
                    INSERT INTO snapshots VALUES ('PRIVATE_OLD', '2026-10-01', '{"issues":[{"id":"PRIVATE_CASE"}]}');
                    INSERT INTO snapshots VALUES ('PRIVATE_CURRENT', '2026-10-16', '{"issues":[{"id":"PRIVATE_CASE"}]}');
                    INSERT INTO issues VALUES ('PRIVATE_CASE', 'false_positive', NULL);
                ''')
            before = database.read_bytes()
            result = self.module.retention_query_summary(database)
            self.assertEqual(result['snapshot_count'], 2)
            self.assertEqual(result['case_count'], 1)
            self.assertTrue(result['scoped_results_preserved'])
            self.assertTrue(result['simulated_candidate'])
            self.assertGreaterEqual(result['full_search_seconds'], 0)
            self.assertGreaterEqual(result['scoped_search_seconds'], 0)
            self.assertNotIn('PRIVATE', json.dumps(result))
            self.assertEqual(database.read_bytes(), before)

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

    def test_saved_case_census_distinguishes_rule_work_without_reading_snapshot_payload(self):
        import json
        import sqlite3
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / 'cases.sqlite'
            with sqlite3.connect(database) as connection:
                connection.executescript('''
                    CREATE TABLE issues (id TEXT, status TEXT, comment TEXT, detected_by TEXT);
                    CREATE TABLE issue_history (issue_id TEXT);
                    CREATE TABLE audit_log (entity_id TEXT, action TEXT);
                    INSERT INTO issues VALUES ('PRIVATE_A','false_positive',NULL,'rule:budget_sum_plan');
                    INSERT INTO issues VALUES ('PRIVATE_B','open','PRIVATE','pipeline:signal:overdue');
                    INSERT INTO issues VALUES ('PRIVATE_C','open',NULL,'rule:formula');
                    INSERT INTO issues VALUES ('PRIVATE_D','open',NULL,'signal:overdue');
                    INSERT INTO issue_history VALUES ('PRIVATE_C'),('PRIVATE_C');
                ''')
            before = database.read_bytes()
            result = self.module.reviewed_case_census(database)
            self.assertEqual(result, {'reviewed_cases': 3, 'rule_cases': 2, 'other_cases': 1, 'signal_cases': 1})
            self.assertNotIn('PRIVATE', json.dumps(result))
            self.assertEqual(database.read_bytes(), before)

    def test_native_and_decision_requests_keep_fixed_stage_names_without_private_queries(self):
        records = []
        for index, path in enumerate(('/api/report-releases', '/api/trust', '/api/issues')):
            records.extend([
                {'time': index * 10 + 1, 'msg': 'incoming request', 'reqId': str(index),
                 'req': {'url': path + '?PRIVATE'}},
                {'time': index * 10 + 2, 'msg': 'request completed', 'reqId': str(index), 'responseTime': 10},
            ])
        result = self.module.runtime_stage_summary(records)
        self.assertEqual([r['stage'] for r in result], ['report_status_begin', 'report_status_complete',
                         'trust_begin', 'trust_complete', 'issues_begin', 'issues_complete'])
        self.assertNotIn('PRIVATE', str(result))

    def test_runtime_stages_read_actual_ansi_multiline_pretty_format(self):
        raw = '''2026-10-16T07:22:39.123456789Z [07:22:01.123] \x1b[32mINFO\x1b[39m (123): \x1b[36mincoming request\x1b[39m
2026-10-16T07:22:01.123456789Z     \x1b[35mreqId\x1b[39m: "PRIVATE_REQUEST"
2026-10-16T07:22:01.123456789Z     req: {
2026-10-16T07:22:01.123456789Z       "url": "/api/dashboard?PRIVATE_QUERY"
2026-10-16T07:22:01.123456789Z     }
2026-10-16T07:22:02.123456789Z [07:22:02.123] INFO (123): Снимок сохраняется: PRIVATE
2026-10-16T07:22:03.123456789Z [07:22:03.123] INFO (123): request completed
2026-10-16T07:22:03.123456789Z     reqId: "PRIVATE_REQUEST"
2026-10-16T07:22:03.123456789Z     responseTime: 2000.5
'''
        with self.assertRaisesRegex(ValueError, '^LOGGER_TIMEZONE_NOT_VERIFIED$'):
            self.module.runtime_log_stages(raw)
        result = self.module.runtime_log_stages(raw, logger_utc=True)
        self.assertEqual([item['stage'] for item in result],
                         ['dashboard_begin', 'snapshot_save_begin', 'dashboard_complete'])
        self.assertEqual(result[-1]['duration_ms'], 2000.5)
        self.assertEqual(result[1]['at_ms'] - result[0]['at_ms'], 1000)
        self.assertNotIn('PRIVATE', str(result))
        with self.assertRaisesRegex(ValueError, '^RUNTIME_STAGE_FORMAT_UNSUPPORTED$'):
            self.module.runtime_log_stages('PRIVATE_OTHER_FORMAT')
        with self.assertRaisesRegex(ValueError, '^RUNTIME_STAGE_LOG_WINDOW_EMPTY$'):
            self.module.runtime_log_stages('')

    def test_journal_request_timing_is_distinct_from_dashboard_and_ignores_other_paths(self):
        records = [
            {'time': 1, 'msg': 'incoming request', 'reqId': 'PRIVATE_JOURNAL',
             'req': {'url': '/api/change-story?PRIVATE_FILTER'}},
            {'time': 2, 'msg': 'incoming request', 'reqId': 'PRIVATE_OTHER',
             'req': {'url': '/api/PRIVATE_PATH'}},
            {'time': 3, 'msg': 'request completed', 'reqId': 'PRIVATE_OTHER', 'responseTime': 1},
            {'time': 4, 'msg': 'request completed', 'reqId': 'PRIVATE_JOURNAL', 'responseTime': 15001},
        ]
        result = self.module.runtime_stage_summary(records)
        self.assertEqual(result, [{'at_ms': 1, 'stage': 'journal_begin'},
                                  {'at_ms': 4, 'stage': 'journal_complete', 'duration_ms': 15001}])
        self.assertNotIn('PRIVATE', str(result))

    def test_pretty_event_time_handles_midnight_and_rejects_unproven_dates(self):
        from datetime import datetime

        raw = '2026-10-17T00:00:01Z [23:59:59.000] INFO (123): Снимок сохраняется: PRIVATE'
        event = self.module.runtime_log_stages(raw, logger_utc=True)[0]
        self.assertEqual(event['at_ms'], int(datetime.fromisoformat('2026-10-16T23:59:59Z').timestamp() * 1000))
        with self.assertRaisesRegex(ValueError, '^LOGGER_EVENT_TIME_NOT_PROVEN$'):
            self.module.runtime_log_stages(raw.replace('[23:59:59.000]', '[07:00:00.000]'), logger_utc=True)
        with self.assertRaisesRegex(ValueError, '^LOGGER_TIMEZONE_NOT_VERIFIED$'):
            self.module.runtime_log_stages(raw.replace('T00:00:01Z', 'T00:00:01+12:00'), logger_utc=True)

    def test_snapshot_stage_probe_reads_scalar_metadata_without_payload_or_writes(self):
        import json
        import sqlite3
        import tempfile

        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / 'state.sqlite'
            with sqlite3.connect(database) as connection:
                connection.executescript('''
                    PRAGMA journal_mode=WAL;
                    CREATE TABLE snapshots (created_at TEXT, read_duration_ms INTEGER,
                        pipeline_duration_ms INTEGER, row_count INTEGER, issue_count INTEGER, data TEXT);
                    CREATE TABLE issues (id TEXT, status TEXT, comment TEXT);
                    CREATE TABLE issue_history (issue_id TEXT);
                    CREATE TABLE audit_log (entity_id TEXT, action TEXT);
                    INSERT INTO snapshots VALUES ('2026-10-16T07:22:00Z', 123, 25000, 5000, 700, 'PRIVATE_PAYLOAD');
                    INSERT INTO issues VALUES ('PRIVATE_ID', 'false_positive', NULL);
                    CREATE TABLE discarded (value BLOB);
                    INSERT INTO discarded VALUES (zeroblob(65536));
                    DROP TABLE discarded;
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
            storage=result['sqlite_storage']
            self.assertGreater(storage['freelist_pages'],0)
            self.assertGreaterEqual(storage['page_count'],storage['freelist_pages'])
            self.assertGreater(storage['page_size'],0)
            self.assertIn(storage['auto_vacuum'],(0,1,2))
            self.assertEqual(storage['file_bytes'],database.stat().st_size)
            self.assertGreater(storage['wal_bytes'],0)
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
