"""Only fixed inclusive timings may leave the private request log."""
import ast
import unittest
from pathlib import Path


def project(records):
    source = Path(__file__).with_name('source_drift_probe.py').read_text()
    tree = ast.parse(source)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'runtime_stage_summary')
    namespace = {}
    exec(compile(ast.Module(body=[function], type_ignores=[]), '<reviewed-stage-projector>', 'exec'), namespace)  # noqa: S102 - repository function, synthetic records.
    return namespace['runtime_stage_summary'](records)


class RequestWindowProjectionTests(unittest.TestCase):
    def test_projects_new_request_windows_without_leaking_url_values_or_unrecognised_stages(self):
        rows = project([{'time': 1000, 'kind': 'request_window', 'route': '/api/report-releases',
                         'elapsedMs': 100, 'stagesMs': {'reader': 80, 'PRIVATE_SENTINEL': 9},
                         'processCpuMs': 85, 'eventLoopProcessMaxDelayMs': 7,
                         'eventLoopSampleIntervalMs': 20, 'eventLoopSamplingComplete': True,
                         'req': {'url': '/api/report-releases?private=PRIVATE_SENTINEL'}}])
        self.assertEqual({row['stage'] for row in rows}, {'report_status_app_window', 'report_status_reader',
                                                         'report_status_process_cpu', 'report_status_event_loop_max'})
        self.assertTrue(all(row['inclusive_non_additive'] is True for row in rows))
        self.assertNotIn('PRIVATE_SENTINEL', str(rows))
        event_loop = next(row for row in rows if row['stage'].endswith('event_loop_max'))
        self.assertEqual(event_loop['sample_interval_ms'], 20)
        self.assertTrue(event_loop['sampling_complete'])

    def test_invalid_timings_and_unknown_routes_are_not_fabricated_as_zero(self):
        self.assertEqual(project([{'time': 1, 'kind': 'request_window', 'route': '/private', 'elapsedMs': 1}]), [])
        self.assertEqual(project([{'time': 1, 'kind': 'request_window', 'route': '/api/dashboard',
                                   'elapsedMs': float('nan'), 'stagesMs': {'model': -1}}]), [])


if __name__ == '__main__':
    unittest.main()
