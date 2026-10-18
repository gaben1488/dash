import json
import unittest

from runtime_lifecycle_probe import project_lifecycle


class LifecycleProjection(unittest.TestCase):
    def test_missing_is_unknown_not_zero(self):
        self.assertTrue(all(not v['available'] for v in project_lifecycle(None, None, None).values()))

    def test_private_state_and_unknown_services_do_not_escape(self):
        state = json.dumps({'checked_at': 100, 'token': 'SECRET',
            'failures': {'server': 3, 'SECRET': 4, 'web': None},
            'last_recovery': {'server': 99, 'caddy': True}})
        got = project_lifecycle(state, '', '')
        self.assertEqual(got['guard_state'], {'available': True, 'checked_at': 100,
            'failures': {'server': 3}, 'last_recovery': {'server': 99}})
        self.assertNotIn('SECRET', json.dumps(got))

    def test_guard_restart_has_time_and_service_without_raw_message(self):
        line = json.dumps({'__REALTIME_TIMESTAMP': '123456789',
            'MESSAGE': json.dumps({'service': 'server', 'event': 'restart', 'token': 'SECRET'}),
            '_CMDLINE': 'SECRET'})
        got = project_lifecycle('{}', line, '')
        self.assertEqual(got['guard_journal']['records'],
                         [{'at_us': 123456789, 'service': 'server', 'event': 'restart'}])
        self.assertNotIn('SECRET', json.dumps(got))

    def test_docker_exec_and_private_attributes_never_escape(self):
        lines = [json.dumps({'Action': action, 'timeNano': 123,
            'Actor': {'Attributes': {'execCommand': 'SECRET', 'signal': '15'}}})
            for action in ('exec_start: SECRET', 'kill', 'start')]
        got = project_lifecycle('{}', '', '\n'.join(lines))
        self.assertEqual([r['event'] for r in got['docker_events']['records']], ['kill', 'start'])
        self.assertNotIn('SECRET', json.dumps(got))

    def test_invalid_and_oversized_evidence_remains_unknown(self):
        for raw in ('{', 'x' * (1024 * 1024 + 1)):
            self.assertTrue(all(not v['available'] for v in project_lifecycle(raw, raw, raw).values()))

    def test_known_empty_journal_is_distinct_from_unavailable(self):
        got = project_lifecycle('{}', '', '')
        self.assertEqual(got['guard_journal'], {'available': True, 'records': []})
        self.assertFalse(project_lifecycle('{}', None, '')['guard_journal']['available'])


class ActualBoundedCapture(unittest.TestCase):
    def test_actual_workflow_capture_bounds_output_and_accepts_small_result(self):
        import ast
        import subprocess
        import sys
        from pathlib import Path

        import yaml

        document = yaml.safe_load((Path(__file__).parents[1] / 'workflows/ci.yml').read_text())
        step = next(s for s in document['jobs']['observe']['steps'] if s.get('name', '').startswith('Read operational'))
        source = step['with']['script'].split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
        capture = next(n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef) and n.name == 'capture')
        scope = {'subprocess': subprocess}
        exec(compile(ast.Module(body=[capture], type_ignores=[]), '<actual-capture>', 'exec'), scope)  # noqa: S102 - trusted workflow function
        self.assertEqual(scope['capture']([sys.executable, '-c', 'print("ok")']), 'ok\n')
        self.assertIsNone(scope['capture']([sys.executable, '-c', 'print("x" * 1100000)']))


if __name__ == '__main__':
    unittest.main()
