"""Installed evidence must bind CI binaries, actual roles, data versions and ops tools."""
import hashlib
import importlib.util
import json
import unittest
from copy import deepcopy
from pathlib import Path

import runtime_artifact as artifact

SCRIPT = Path(__file__).with_name('runtime_passport.py')


class RuntimePassportTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'Installed runtime passport is missing')
        spec = importlib.util.spec_from_file_location('passport', SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        sha = 'a' * 40
        self.artifact = {'format': artifact.FORMAT, 'source_sha': sha, 'ci': {'run_id': 123, 'attempt': 1},
                         'platform': 'linux/amd64', 'versions': {'node': 'v22', 'python': '3.11', 'rules': 'new', 'renderer': 'r1'},
                         'source_files': dict.fromkeys(artifact.SOURCE_FILES, '0' * 64), 'images': {}}
        for role, digit in (('server', 'b'), ('web', 'c')):
            self.artifact['images'][role] = {'id': 'sha256:' + digit * 64, 'tag': f'aemr-{role}:release-{sha}',
                                           'archive': role + '.tar.gz', 'size': 10, 'sha256': '0' * 64}
        self.metadata = {'id': 7, 'digest': 'sha256:' + 'f' * 64, 'name': 'runtime-' + sha, 'expired': False,
                         'workflow_run': {'id': 123, 'head_sha': sha}}
        images = {'server': 'sha256:' + 'b' * 64, 'web': 'sha256:' + 'c' * 64,
                  'report-worker': 'sha256:' + 'b' * 64, 'caddy': 'sha256:' + 'e' * 64}
        config = dict.fromkeys(('compose.json', '.env.production', 'Caddyfile', 'candidate-compose.json', 'candidate-Caddyfile'), '0' * 64)
        self.stage = {'format': 'aemr-release-stage-v1', 'release_sha': sha, 'candidate_images': images,
                      'images': images, 'config_sha256': config}
        self.accepted = {'plan_sha256': 'f' * 64, 'acceptance': {'state': 'RELEASE_CANDIDATE_ACCEPTED',
                         'release_sha': sha, 'candidate_images': images, 'config_sha256': config}}
        self.containers = [{'Name': '/aemr-' + role + '-1', 'Id': digit * 64, 'Image': image,
                            'Config': {'Labels': {'org.opencontainers.image.revision': sha,
                              'com.docker.compose.project': 'aemr', 'com.docker.compose.service': role},
                              'Env': ['PRIVATE_SENTINEL=do-not-copy']},
                            'RestartCount': 0, 'State': {'Status': 'running', 'OOMKilled': False,
                              'StartedAt': '2026-10-18T00:00:00Z', 'Health': {'Status': 'healthy'}}}
                           for (role, image), digit in zip(images.items(), '1234', strict=True)]
        self.ops = {Path(name).name: digest for name, digest in self.artifact['source_files'].items() if name.startswith(('deploy/', '.github/'))}
        self.component = None
        self.observed = {'started_at': '2026-10-18T00:01:00Z', 'ended_at': '2026-10-18T00:01:03Z',
                         'database': {'schema_sha256': '9' * 64, 'user_version': 0},
                         'dashboard': {'snapshot_id': 'snapshot-new', 'created_at': '2026-10-18T00:00:00Z'},
                         'report': {'release_id': 'REL-' + 'a' * 64, 'snapshot_id': 'snapshot-previous',
                                    'rules_version': 'old', 'renderer_version': 'r1', 'cutoff_at': '2026-10-17T23:00:00Z'},
                         'runtime_versions': self.artifact['versions']}

    def build(self):
        return self.module.seal(self.artifact, self.metadata, self.stage, self.accepted,
                                self.containers, self.ops, self.observed, self.component)

    def test_actual_runtime_and_observed_data_keep_distinct_versions_without_copying_env(self):
        value = self.build()
        self.assertEqual(value['data']['dashboard']['snapshot_id'], 'snapshot-new')
        self.assertEqual(value['data']['report']['rules_version'], 'old')
        self.assertEqual(value['build']['versions']['rules'], 'new')
        self.assertNotIn('PRIVATE_SENTINEL', str(value))
        self.assertEqual(value['consistency'], 'observation_window')

    def test_retagged_or_restarted_runtime_and_wrong_ops_cannot_claim_acceptance(self):
        original = deepcopy(self.containers)
        for patch in ({'Image': 'sha256:' + 'd' * 64}, {'RestartCount': 1}, {'State': {'Status': 'exited'}}):
            self.containers = [{**original[0], **patch}, *original[1:]]
            with self.assertRaises(ValueError):
                self.build()
        self.containers = original
        self.ops['release-controller.py'] = '1' * 64
        with self.assertRaises(ValueError):
            self.build()

    def test_other_artifact_source_or_runtime_version_is_not_installed_proof(self):
        self.metadata['workflow_run']['head_sha'] = 'b' * 40
        with self.assertRaises(ValueError):
            self.build()
        self.metadata['workflow_run']['head_sha'] = 'a' * 40
        self.observed['runtime_versions'] = {**self.artifact['versions'], 'rules': 'unexpected'}
        with self.assertRaises(ValueError):
            self.build()

    def configure_web_release(self):
        self.stage['images'] = deepcopy(self.stage['images'])
        for role in ('server', 'report-worker'):
            self.stage['images'][role] = self.stage['candidate_images'][role] = 'sha256:' + 'd' * 64
        self.stage['container_ids'] = {role: row['Id'] for role, row in zip(
            ('server', 'web', 'report-worker', 'caddy'), self.containers, strict=True)}
        for row in self.containers:
            if row['Name'] in {'/aemr-server-1', '/aemr-report-worker-1'}:
                row['Image'] = 'sha256:' + 'd' * 64
                row['Config']['Labels']['org.opencontainers.image.revision'] = 'b' * 40
        self.accepted = {'state': 'RELEASE_WEB_ACCEPTED', 'release_sha': 'a' * 40,
                         'backend_sha': 'b' * 40, 'plan_sha256': 'f' * 64,
                         'images': self.stage['candidate_images'], 'config_sha256': self.stage['config_sha256'],
                         'container_ids': dict(self.stage['container_ids'])}
        fingerprints = {role: self.ops[name] for role, name in (
            ('controller', 'release-controller.py'), ('recovery', 'release_recovery.py'),
            ('trial', 'release_trial.py'), ('source_gate', 'source_ci_gate.py'))}
        fingerprints.update(runtime_guard='0' * 64, runtime_policy='0' * 64)
        self.component = {
            'mode': 'web', 'backend_sha': 'b' * 40,
            'stage_sha256': hashlib.sha256(json.dumps(
                self.stage, sort_keys=True, allow_nan=False).encode()).hexdigest(),
            'tools_sha256': fingerprints,
            'backend_runtime': {
                role: {'container': row['Id'], 'image': row['Image'],
                       'status': row['State']['Status'], 'started_at': row['State']['StartedAt'],
                       'restart_count': row['RestartCount']}
                for role in ('server', 'report-worker', 'caddy')
                for row in self.containers if row['Name'] == '/aemr-' + role + '-1'
            },
        }

    def test_web_release_records_actual_backend_revision_and_rejects_recreated_worker(self):
        self.configure_web_release()
        self.assertEqual(self.build()['build']['backend_source_sha'], 'b' * 40)
        self.containers[2]['Id'] = '9' * 64
        self.accepted['container_ids']['report-worker'] = '9' * 64
        with self.assertRaises(ValueError):
            self.build()

    def test_web_accepts_historical_rest_count_only_when_process_is_unchanged(self):
        self.configure_web_release()
        self.containers[2]['RestartCount'] = 3
        self.component['backend_runtime']['report-worker']['restart_count'] = 3
        self.assertEqual(self.build()['runtime']['report-worker']['restarts'], 3)
        self.containers[2]['RestartCount'] = 4
        with self.assertRaises(ValueError):
            self.build()
        self.containers[2]['RestartCount'] = 3
        self.containers[0]['State']['StartedAt'] = '2026-10-18T00:00:01Z'
        with self.assertRaises(ValueError):
            self.build()

    def test_web_requires_exact_staged_component_and_installed_tool_witness(self):
        self.configure_web_release()
        self.component['stage_sha256'] = 'f' * 64
        with self.assertRaises(ValueError):
            self.build()
        self.configure_web_release()
        self.component['tools_sha256']['source_gate'] = '1' * 64
        with self.assertRaises(ValueError):
            self.build()
        self.component = None
        with self.assertRaises(ValueError):
            self.build()

    def test_initial_state_is_not_fabricated_report_or_permission_to_lose_existing_report(self):
        self.observed['report'] = None
        with self.assertRaises(ValueError):
            self.build()
        self.stage['word'] = {'release_id': None, 'sha256': {}}
        self.accepted['acceptance']['word_sha256'] = {}
        self.assertIsNone(self.build()['data']['report'])


if __name__ == '__main__':
    unittest.main()
