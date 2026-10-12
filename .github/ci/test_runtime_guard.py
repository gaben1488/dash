"""Fault recovery remains isolated from report data and other services."""
import importlib.util
import json
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/runtime_guard.py'


class RuntimeGuardTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'Host process supervision is missing')
        spec = importlib.util.spec_from_file_location('runtime_guard', SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.policy = {'project': 'aemr', 'worker_enabled': True, 'cooldown_seconds': 300,
                       'failure_threshold': 3, 'services': {
                           'server': {'container': 'aemr-server-1'},
                           'report-worker': {'container': 'aemr-report-worker-1'}}}
        self.records = {name: {'Name': '/' + cfg['container'], 'Image': 'sha256:verified',
                              'Config': {'Labels': {'com.docker.compose.project': 'aemr',
                                                   'com.docker.compose.service': name}},
                              'State': {'Status': 'running'}}
                        for name, cfg in self.policy['services'].items()}
        self.calls = []
        self.state = {'failures': {}, 'last_recovery': {}}
        self.healthy = True

    def docker(self, args):
        self.calls.append(args)
        if args[0] == 'inspect':
            return json.dumps([next(r for r in self.records.values() if r['Name'] == '/' + args[1])])
        if args[0] == 'exec' and not self.healthy:
            raise RuntimeError('Probe failure; private stderr must not escape')
        return ''

    def check(self, now=1000, **kwargs):
        return self.module.supervise(self.policy, self.state, self.docker, now=now, **kwargs)

    def test_stopped_api_is_started_without_touching_report_data(self):
        self.records['server']['State']['Status'] = 'exited'
        self.check()
        self.assertIn(['start', 'aemr-server-1'], self.calls)
        self.assertFalse(any('restore-reports' in arg for cmd in self.calls for arg in cmd))

    def test_three_failed_process_probes_restart_only_api(self):
        self.healthy = False
        for t in [1000, 1030, 1060]:
            self.check(now=t)
        self.assertIn(['restart', '--time', '20', 'aemr-server-1'], self.calls)
        self.assertNotIn(['restart', '--time', '20', 'aemr-report-worker-1'], self.calls)

    def test_different_worker_image_is_never_started_blindly(self):
        self.records['report-worker']['Image'] = 'sha256:unreviewed'
        self.records['report-worker']['State']['Status'] = 'created'
        self.check()
        self.assertNotIn(['start', 'aemr-report-worker-1'], self.calls)

    def test_matching_worker_is_recovered_independently(self):
        self.records['report-worker']['State']['Status'] = 'exited'
        self.check()
        self.assertIn(['start', 'aemr-report-worker-1'], self.calls)
        self.assertNotIn(['restart', '--time', '20', 'aemr-server-1'], self.calls)

    def test_maintenance_and_recovery_cooldown_are_respected(self):
        self.records['server']['State']['Status'] = 'exited'
        self.check(maintenance=True)
        self.assertEqual(self.calls, [])
        self.state['last_recovery']['server'] = 950
        self.check()
        self.assertNotIn(['start', 'aemr-server-1'], self.calls)

    def test_foreign_container_labels_cannot_trigger_recovery(self):
        self.records['server']['State']['Status'] = 'exited'
        self.records['server']['Config']['Labels']['com.docker.compose.project'] = 'other'
        self.check()
        self.assertNotIn(['start', 'aemr-server-1'], self.calls)

    def test_worker_maintenance_disables_recovery_but_keeps_resource_protection(self):
        self.policy['worker_enabled'] = False
        self.policy['services']['report-worker']['limits'] = {'mem_limit': 2304 * 1024 * 1024}
        self.records['report-worker']['State']['Status'] = 'exited'
        for image in ('sha256:verified', 'sha256:worker-only-hotfix'):
            with self.subTest(image=image):
                self.records['report-worker']['Image'] = image
                self.calls.clear()
                self.check()
                self.assertIn(['update', '--memory', str(2304 * 1024 * 1024), 'aemr-report-worker-1'], self.calls)
                self.assertNotIn(['start', 'aemr-report-worker-1'], self.calls)


if __name__ == '__main__':
    unittest.main()
