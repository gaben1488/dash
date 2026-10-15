"""Offline release recovery: real filesystem/SQLite and kernel locks, fake Docker."""
import fcntl
import hashlib
import importlib.util
import json
import os
import select
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipUnless(os.geteuid() == 0, 'Privileged contract runs in the real user-namespace subprocess below')
class ReleaseRecoveryTests(unittest.TestCase):
    def setUp(self):
        # Production backup/installer entrypoints use 077. A CI runner's 022
        # must not make the private checkpoint manifest or parent directories public.
        previous_umask = os.umask(0o077)
        self.addCleanup(os.umask, previous_umask)
        self.assertTrue((ROOT / 'deploy/release_recovery.py').is_file(), 'Complete release recovery executor is missing')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.trusted = root / 'trusted'
        self.trusted.mkdir(mode=0o700)
        # Checkout files belong to the CI runner, not root. Exercise the same
        # root-owned installed bytes that module hashes admit on the host.
        self.module = load('release_recovery', self.trusted_source('deploy/release_recovery.py'))
        self.backup_tool = load('release_stateful_backup', self.trusted_source('deploy/stateful_backup.py'))
        self.private = root / 'private'
        self.private.mkdir(mode=0o700)
        self.runtime = self.private / 'release-runtime'
        self.runtime.mkdir(mode=0o700)
        self.backups = root / 'backups'
        self.backups.mkdir(mode=0o700)
        self.backup = self.backups / 'worker-123' / 'backup'
        self.backup.parent.mkdir(mode=0o700)
        self.volume_base = root / 'volumes'
        self.source = self.volume_base / 'aemr_server_data' / '_data'
        (self.source / 'reports/inputs').mkdir(parents=True)
        (self.source / 'reports/inputs/registry.json').write_text('{}')
        (self.source / 'reports/inputs/ledger.json').write_text('{}')
        with sqlite3.connect(self.source / 'aemr.db') as db:
            db.execute('create table receipt(value integer)')
            db.execute('insert into receipt values(17)')
        self.release_id = 'REL-' + 'a' * 64
        documents = self.source / 'reports/published/releases' / self.release_id
        documents.mkdir(parents=True)
        self.word_hashes = {}
        for view, name in [('main', 'main_report.docx'), ('supplement', 'management_report.docx'), ('operational', 'operational_report.docx')]:
            with zipfile.ZipFile(documents / name, 'w') as doc:
                doc.writestr('[Content_Types].xml', '<Types/>')
                doc.writestr('word/document.xml', '<document/>')
            self.word_hashes[view] = hashlib.sha256((documents / name).read_bytes()).hexdigest()
        self.backup_tool.create(self.source, self.backup, compressed=True)
        scratch = root / 'scratch'
        scratch.mkdir()
        self.backup_tool.verify(self.backup, scratch)
        self.expected = self.backup_tool.inventory(self.source)
        self.images = {s: 'sha256:' + str(i + 1) * 64 for i, s in enumerate(self.module.SERVICES)}
        self.candidate_images = {s: 'sha256:' + str(i + 5) * 64 for i, s in enumerate(self.module.SERVICES)}
        compose = {'name': 'aemr', 'services': {s: {'image': self.images[s], 'container_name': 'aemr-' + s + '-1'} for s in self.module.SERVICES},
                   'volumes': {'server_data': {'name': 'aemr_server_data'}}}
        for s in ('server', 'report-worker'):
            compose['services'][s]['volumes'] = [{'type': 'volume', 'source': 'server_data', 'target': '/app/packages/server/data'}]
        compose['services']['caddy']['volumes'] = [{'type': 'bind', 'source': '/home/aemr/dash/deploy/Caddyfile', 'target': '/etc/caddy/Caddyfile', 'read_only': True}]
        for name, data in {'compose.json': json.dumps(compose), 'candidate-compose.json': json.dumps(compose),
                           '.env.production': 'PRIVATE_SECRET=fixture', 'Caddyfile': ':80 { respond "fixture" }', 'candidate-Caddyfile': ':80 { respond "candidate fixture" }'}.items():
            (self.runtime / name).write_text(data)
            (self.runtime / name).chmod(0o600)
        self.tool = Path(self.backup_tool.__file__)
        self.pending = self.private / 'pending-release.json'
        self.lock_path = root / 'maintenance.lock'
        self.lock = self.lock_path.open('w')
        os.chmod(self.lock_path, 0o600)
        fcntl.flock(self.lock, fcntl.LOCK_EX)
        self.addCleanup(self.lock.close)
        for name, value in {'STATE_DIR': self.private, 'RUNTIME_DIR': self.runtime, 'PENDING': self.pending,
                            'BACKUP_BASE': self.backups, 'TOOL': self.tool, 'LOCK': self.lock_path,
                            'VOLUME_BASE': self.volume_base}.items():
            patcher = patch.object(self.module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.digest = hashlib.sha256((self.backup / 'manifest.json').read_bytes()).hexdigest()
        self.config_hashes = {n: hashlib.sha256((self.runtime / n).read_bytes()).hexdigest() for n in self.module.CONFIG_FILES}
        binding = {'release_sha': 'b' * 40, 'manifest_sha256': self.digest, 'images': self.images, 'config_sha256': self.config_hashes}
        self.plan = {'format': 'aemr-release-recovery-v1', **binding, 'candidate_images': self.candidate_images,
                     'backup_reference': 'worker-123/backup', 'volume': 'aemr_server_data',
                     'tool_sha256': hashlib.sha256(self.tool.read_bytes()).hexdigest(),
                     'original_running': {s: True for s in self.module.SERVICES},
                     'word': {'release_id': self.release_id, 'sha256': self.word_hashes},
                     'proofs': {name: {**binding, 'state': state} for name, state in self.module.PROOF_STATES.items()}}
        self.records = {s: {'Id': str(i + 1) * 64, 'Name': '/aemr-' + s + '-1', 'Image': self.images[s],
                          'Config': {'Labels': {'com.docker.compose.project': 'aemr', 'com.docker.compose.service': s}},
                          'State': {'Status': 'exited' if s in ('server', 'report-worker') else 'running', 'Health': {'Status': 'healthy'}},
                          'Mounts': [{'Type': 'volume', 'Name': 'aemr_server_data', 'Destination': '/app/packages/server/data'}] if s in ('server', 'report-worker') else []}
                        for i, s in enumerate(self.module.SERVICES)}
        self.calls = []
        self.record_templates = json.loads(json.dumps(self.records))
        self.daemon_state = self.private / 'fake-daemon.json'
        self.persist_records()
        self.kill_after_ingress = False
        self.fail_health = False
        self.executor = self.module.ReleaseRecovery(self.docker, lock_fd=self.lock.fileno(), sleep=lambda _: None)

    def trusted_source(self, relative):
        path = self.trusted / Path(relative).name
        path.write_bytes((ROOT / relative).read_bytes())
        path.chmod(0o600)
        return path

    def persist_records(self):
        self.daemon_state.write_text(json.dumps(self.records))

    def docker(self, args, **kwargs):
        self.records = json.loads(self.daemon_state.read_text())
        self.calls.append(args)
        if args[:2] == ['image', 'inspect']:
            return json.dumps([{'Id': args[2]}])
        if args[0] == 'inspect':
            name = next((s for s, r in self.records.items() if r['Id'] == args[1]), None)
            name = name or args[1].removeprefix('aemr-').removesuffix('-1')
            if name not in self.records:
                raise self.module.RecoveryError('RELEASE_COMMAND_FAILED')
            return json.dumps([self.records[name]])
        if args[0] == 'ps':
            service = next((x.split('=')[-1] for x in args if x.startswith('label=com.docker.compose.service=')), None)
            if service is None:
                return '\n'.join(r['Id'] for r in self.records.values() if '--all' in args or r['State']['Status'] == 'running')
            return '\n'.join(r['Id'] for r in self.records.values()
                             if r['Config']['Labels'].get('com.docker.compose.service') == service)
        if args[0] == 'stop':
            name = next((s for s, r in self.records.items() if r['Id'] == args[-1]), None)
            name = name or args[-1].removeprefix('aemr-').removesuffix('-1')
            self.records[name]['State']['Status'] = 'exited'
            self.persist_records()
            return ''
        if args[0] == 'rm':
            name = next(s for s, r in self.records.items() if r['Id'] == args[-1])
            self.assertIn(self.records[name]['State']['Status'], ('created', 'exited'))
            self.assertNotIn('--volumes', args)
            del self.records[name]
            self.persist_records()
            return ''
        if args[:2] == ['volume', 'inspect']:
            return json.dumps([{'Name': 'aemr_server_data', 'Driver': 'local', 'Options': None,
                                'Mountpoint': str(self.source), 'Labels': {'com.docker.compose.project': 'aemr',
                                'com.docker.compose.volume': 'server_data'}}])
        if args[0] == 'compose':
            services = [item for item in args[args.index('--no-deps') + 1:] if item in self.module.SERVICES]
            candidate = 'candidate-resume.json' in args[args.index('-f') + 1]
            if 'server' in services and not candidate:
                self.assertEqual(self.backup_tool.inventory(self.source), self.expected)
            for service in services:
                if service not in self.records:
                    self.records[service] = json.loads(json.dumps(self.record_templates[service]))
                self.records[service]['Name'] = '/aemr-' + service + '-1'
                self.records[service]['Image'] = (self.candidate_images if candidate else self.images)[service]
                self.records[service]['State']['Status'] = 'created' if '--no-start' in args else 'running'
            self.persist_records()
            if self.kill_after_ingress and 'caddy' in services and '--no-start' not in args:
                with sqlite3.connect(self.source / 'aemr.db') as db:
                    db.execute('update receipt set value=222')
                os.kill(os.getpid(), signal.SIGKILL)
            return ''
        if args[0] == 'exec':
            if self.fail_health:
                raise self.module.RecoveryError('RELEASE_COMMAND_FAILED')
            if 'python3' in args:
                compile(args[args.index('-c') + 1], '<native-word-check>', 'exec')
                return json.dumps(self.word_hashes)
            if './node_modules/.bin/tsx' in args:
                return 'CANDIDATE_SCHEMA_PASS\n'
            return ''
        raise AssertionError(args)

    def mutate(self):
        with sqlite3.connect(self.source / 'aemr.db') as db:
            db.execute('update receipt set value=99')
        (self.source / 'new.failed').write_text('must disappear on full rollback')
        for s in self.module.SERVICES:
            self.records[s]['Image'] = self.candidate_images[s]
            self.records[s]['State']['Status'] = 'running'
        self.persist_records()

    def test_arm_rejects_legacy_survivor_before_pending_or_runtime_stop(self):
        foreign = json.loads(json.dumps(self.records['server']))
        foreign.update({'Id': 'f' * 64, 'Name': '/retired-native-helper', 'Image': 'sha256:' + 'e' * 64, 'Mounts': []})
        foreign['State'] = {'Status': 'exited', 'Pid': 0}
        foreign['Config']['Labels'].pop('com.docker.compose.oneoff', None)
        self.records['foreign'] = foreign
        self.persist_records()
        previous = self.executor.command
        def command(args, **kwargs):
            if args[0] == 'ps' and 'label=com.docker.compose.oneoff=False' in args:
                role = next(x.split('=')[-1] for x in args if x.startswith('label=com.docker.compose.service='))
                return self.records[role]['Id']
            return previous(args, **kwargs)
        self.executor.command = command
        with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_RUNTIME_NOT_OWNED'):
            self.executor.arm(self.plan)
        self.assertFalse(self.pending.exists())
        self.assertFalse(any(c[0] in ('stop', 'start', 'rm', 'run') for c in self.calls))

    def test_foreign_writer_blocks_restore_without_deleting_current_data(self):
        self.executor.arm(self.plan)
        self.mutate()
        foreign = json.loads(json.dumps(self.records['server']))
        foreign['Id'] = 'f' * 64
        foreign['Name'] = '/foreign-reader-with-write-access'
        foreign['Mounts'][0]['RW'] = True
        self.records['foreign'] = foreign
        self.persist_records()
        with self.assertRaises(self.module.RecoveryError):
            self.executor.recover()
        with sqlite3.connect(self.source / 'aemr.db') as db:
            self.assertEqual(db.execute('select value from receipt').fetchone()[0], 99)
        self.assertTrue(self.pending.exists())

    def test_foreign_writable_bind_overlap_is_rejected_but_readonly_is_allowed(self):
        self.executor.arm(self.plan)
        for path in (self.source / 'reports', self.source.parent):
            with self.subTest(path=path):
                foreign = json.loads(json.dumps(self.records['web']))
                foreign['Id'] = 'f' * 64
                foreign['State']['Status'] = 'running'
                foreign['Mounts'] = [{'Type': 'bind', 'Source': str(path), 'RW': True}]
                self.records['foreign'] = foreign
                self.persist_records()
                with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_VOLUME_WRITER_PRESENT'):
                    self.executor._no_volume_writers(self.plan)
                foreign['Mounts'][0]['RW'] = False
                self.records['foreign'] = foreign
                self.persist_records()
                self.executor._no_volume_writers(self.plan)

    def test_candidate_schema_failure_cannot_commit_acceptance(self):
        self.executor.arm(self.plan)
        self.mutate()
        for service in ('caddy', 'report-worker'):
            self.records[service]['State']['Status'] = 'created'
        self.persist_records()
        actual = self.executor.command
        def reject_schema(args, **kwargs):
            if './node_modules/.bin/tsx' in args:
                return 'SCHEMA_INVALID'
            return actual(args, **kwargs)
        self.executor.command = reject_schema
        with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_CANDIDATE_SCHEMA_INVALID'):
            self.executor.accept()
        self.assertFalse((self.private / 'release-recovery-progress.json').exists())
        self.assertTrue(self.pending.exists())

    def test_sigkill_after_candidate_ingress_never_restores_old_checkpoint(self):
        self.executor.arm(self.plan)
        self.mutate()
        for service in ('caddy', 'report-worker'):
            self.records[service]['State']['Status'] = 'created'
        self.persist_records()
        self.executor.accept()
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        child = os.fork()
        if child == 0:
            self.lock.close()
            with self.lock_path.open('r+') as held:
                fcntl.flock(held, fcntl.LOCK_EX)
                self.executor.lock_fd = held.fileno()
                self.kill_after_ingress = True
                self.executor.recover()
            os._exit(1)
        _, status = os.waitpid(child, 0)
        self.assertEqual(os.WTERMSIG(status), signal.SIGKILL)
        fcntl.flock(self.lock, fcntl.LOCK_EX)
        self.assertTrue(self.pending.exists())
        with sqlite3.connect(self.source / 'aemr.db') as db:
            self.assertEqual(db.execute('select value from receipt').fetchone()[0], 222)
        self.assertEqual(self.executor.recover()['state'], 'RELEASE_CANDIDATE_ACCEPTED')
        with sqlite3.connect(self.source / 'aemr.db') as db:
            self.assertEqual(db.execute('select value from receipt').fetchone()[0], 222)
        self.assertTrue(all(r['Image'] == self.candidate_images[s] for s, r in self.records.items()))

    def test_candidate_acceptance_owner_death_preserves_candidate_state(self):
        self.executor.arm(self.plan)
        self.mutate()
        for service in ('caddy', 'report-worker'):
            self.records[service]['State']['Status'] = 'created'
        self.persist_records()
        self.executor.accept()
        self.assertTrue(self.pending.exists())
        with sqlite3.connect(self.source / 'aemr.db') as db:
            db.execute('update receipt set value=222')
        result = self.executor.recover()
        self.assertEqual(result['state'], 'RELEASE_CANDIDATE_ACCEPTED')
        with sqlite3.connect(self.source / 'aemr.db') as db:
            self.assertEqual(db.execute('select value from receipt').fetchone()[0], 222)
        self.assertTrue((self.source / 'new.failed').exists())
        self.assertFalse(self.pending.exists())
        self.assertTrue(all(r['Image'] == self.candidate_images[s] for s, r in self.records.items()))

    def test_full_recovery_restores_data_and_saved_runtime_before_ingress(self):
        self.executor.arm(self.plan)
        self.mutate()
        result = self.executor.recover()
        self.assertEqual(result['state'], 'RELEASE_RUNTIME_AND_STATE_RECOVERED')
        self.assertEqual(self.backup_tool.inventory(self.source), self.expected)
        self.assertFalse(self.pending.exists())
        start_api = next(i for i, call in enumerate(self.calls) if call[0] == 'compose' and 'up' in call and '--no-start' not in call and 'server' in call)
        start_worker = next(i for i, call in enumerate(self.calls) if call[0] == 'compose' and 'up' in call and '--no-start' not in call and 'report-worker' in call)
        start_ingress = max(i for i, call in enumerate(self.calls) if call[0] == 'compose' and 'up' in call and '--no-start' not in call and 'caddy' in call)
        self.assertFalse(any(c[0] == 'run' for c in self.calls), 'Restore must not outlive EX in a detached Docker writer')
        self.assertLess(start_api, start_worker)
        self.assertLess(start_worker, start_ingress)

    def test_interrupted_recreation_recovers_when_all_fixed_containers_are_missing(self):
        self.executor.arm(self.plan)
        self.mutate()
        self.records.clear()
        self.persist_records()
        result = self.executor.recover()
        self.assertEqual(result['state'], 'RELEASE_RUNTIME_AND_STATE_RECOVERED')
        self.assertEqual(self.backup_tool.inventory(self.source), self.expected)
        self.assertFalse(self.pending.exists())

    def test_interrupted_recreation_fences_and_replaces_renamed_owned_survivors(self):
        self.executor.arm(self.plan)
        self.mutate()
        for service, record in self.records.items():
            record['Name'] = '/' + record['Id'][:12] + '_aemr-' + service + '-1'
        self.persist_records()
        result = self.executor.recover()
        self.assertEqual(result['state'], 'RELEASE_RUNTIME_AND_STATE_RECOVERED')
        self.assertEqual(self.backup_tool.inventory(self.source), self.expected)
        self.assertEqual(len([c for c in self.calls if c[0] == 'rm']), 4)
        self.assertTrue(all(r['Name'] == '/aemr-' + s + '-1' for s, r in self.records.items()))

    def test_recovery_rejects_ambiguous_service_survivors_before_any_mutation(self):
        self.executor.arm(self.plan)
        self.mutate()
        duplicate = json.loads(json.dumps(self.records['server']))
        duplicate['Id'] = 'f' * 64
        duplicate['Name'] = '/old_aemr-server-1'
        self.records['duplicate'] = duplicate
        self.persist_records()
        self.calls.clear()
        with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_RUNTIME_NOT_OWNED'):
            self.executor.recover()
        self.assertFalse(any(c[0] in ('stop', 'rm', 'compose') for c in self.calls))
        self.assertTrue((self.source / 'new.failed').exists())

    def test_missing_service_never_hides_foreign_volume_writer(self):
        self.executor.arm(self.plan)
        self.mutate()
        foreign = self.records.pop('server')
        foreign['Name'] = '/foreign-writer'
        foreign['Config']['Labels'] = {}
        foreign['Mounts'][0]['RW'] = True
        self.records['foreign'] = foreign
        self.persist_records()
        with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_RECOVERY_FAILED'):
            self.executor.recover()
        self.assertTrue((self.source / 'new.failed').exists())
        self.assertFalse(any(c[0] in ('rm', 'compose') for c in self.calls))

    def test_foreign_fixed_name_collision_blocks_recovery_before_mutations(self):
        self.executor.arm(self.plan)
        self.mutate()
        self.records['server']['Config']['Labels'] = {}
        self.persist_records()
        self.calls.clear()
        with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_RUNTIME_NOT_OWNED'):
            self.executor.recover()
        self.assertFalse(any(c[0] in ('stop', 'rm', 'compose') for c in self.calls))
        self.assertTrue((self.source / 'new.failed').exists())

    def test_partial_prior_runtime_recreation_retries_full_restore(self):
        self.executor.arm(self.plan)
        self.mutate()
        actual = self.executor.command
        interrupted = False
        def recreate(args, **kwargs):
            nonlocal interrupted
            if args[0] == 'compose' and '--no-start' in args and not interrupted:
                interrupted = True
                self.records.pop('server')
                self.persist_records()
                raise self.module.RecoveryError('RELEASE_COMMAND_FAILED')
            return actual(args, **kwargs)
        self.executor.command = recreate
        with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_RECOVERY_FAILED'):
            self.executor.recover()
        self.assertTrue(self.pending.exists())
        self.assertEqual(self.executor.recover()['state'], 'RELEASE_RUNTIME_AND_STATE_RECOVERED')
        self.assertEqual(self.backup_tool.inventory(self.source), self.expected)

    def test_missing_or_renamed_runtime_remains_forbidden_during_arming(self):
        original = json.loads(json.dumps(self.records))
        for missing in (True, False):
            with self.subTest(missing=missing):
                self.records = json.loads(json.dumps(original))
                if missing:
                    del self.records['server']
                else:
                    self.records['server']['Name'] = '/old_aemr-server-1'
                self.persist_records()
                self.calls.clear()
                with self.assertRaises(self.module.RecoveryError):
                    self.executor.arm(self.plan)
                self.assertFalse(self.pending.exists())
                self.assertFalse(any(c[0] in ('stop', 'rm', 'compose') for c in self.calls))

    def test_missing_accepted_container_never_rolls_back_candidate_data(self):
        self.executor.arm(self.plan)
        self.mutate()
        for service in ('caddy', 'report-worker'):
            self.records[service]['State']['Status'] = 'created'
        self.persist_records()
        self.executor.accept()
        del self.records['server']
        self.persist_records()
        with self.assertRaises(self.module.RecoveryError):
            self.executor.recover()
        with sqlite3.connect(self.source / 'aemr.db') as db:
            self.assertEqual(db.execute('select value from receipt').fetchone()[0], 99)
        self.assertTrue((self.source / 'new.failed').exists())
        self.assertTrue(self.pending.exists())

    def test_missing_or_mismatched_previous_compatibility_never_arms(self):
        for key in ('proofs', 'manifest_sha256', 'config_sha256'):
            bad = json.loads(json.dumps(self.plan))
            if key == 'proofs':
                del bad[key]['previous_runtime']
            elif key == 'manifest_sha256':
                bad[key] = 'f' * 64
            else:
                bad[key]['Caddyfile'] = 'f' * 64
            with self.subTest(key=key), self.assertRaises(self.module.RecoveryError):
                self.executor.arm(bad)
            self.assertFalse(self.pending.exists())
            self.assertFalse(any(c[0] in ('stop', 'compose', 'run') for c in self.calls))

    def test_changed_source_and_foreign_image_reject_before_arming(self):
        (self.source / 'unexpected').write_text('new write')
        with self.assertRaises(self.module.RecoveryError):
            self.executor.arm(self.plan)
        self.assertFalse(self.pending.exists())
        (self.source / 'unexpected').unlink()
        self.records['server']['Image'] = 'sha256:' + 'f' * 64
        self.persist_records()
        with self.assertRaises(self.module.RecoveryError):
            self.executor.arm(self.plan)
        self.assertFalse(self.pending.exists())

    def test_corrupt_archive_does_not_delete_current_data_or_start_api(self):
        self.executor.arm(self.plan)
        self.mutate()
        before = self.backup_tool.inventory(self.source)
        archive = self.backup / 'state.tar.gz'
        archive.write_bytes(archive.read_bytes()[:-8])
        with self.assertRaises(self.module.RecoveryError):
            self.executor.recover()
        self.assertEqual(self.backup_tool.inventory(self.source), before)
        self.assertTrue(self.pending.exists())
        self.assertFalse(any(c[0] == 'compose' for c in self.calls))

    def test_killed_restore_keeps_receipt_and_retry_restores_complete_state(self):
        self.executor.arm(self.plan)
        self.mutate()
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        read_fd, write_fd = os.pipe()
        pid = os.fork()
        if pid == 0:
            # Inject death during real tar member copying, not a fake restore.
            child_lock = self.lock_path.open('r+')
            fcntl.flock(child_lock, fcntl.LOCK_EX)
            self.executor.lock_fd = child_lock.fileno()
            copy = __import__('shutil').copyfileobj
            def killed_copy(*args, **kwargs):
                copy(*args, **kwargs)
                os.write(write_fd, b'1')
                signal.pause()
            with patch('shutil.copyfileobj', side_effect=killed_copy):
                self.executor.recover()
            os._exit(8)
        try:
            self.assertTrue(select.select([read_fd], [], [], 5)[0], 'Actual extraction never started')
            os.read(read_fd, 1)
            with self.assertRaises(BlockingIOError):
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.kill(pid, signal.SIGKILL)
            os.close(read_fd)
            os.close(write_fd)
        _, status = os.waitpid(pid, 0)
        self.assertEqual(os.WTERMSIG(status), signal.SIGKILL)
        self.assertTrue(self.pending.exists())
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.assertNotEqual(self.backup_tool.inventory(self.source, require_complete=False), self.expected)
        self.executor.recover()
        self.assertEqual(self.backup_tool.inventory(self.source), self.expected)

    def test_owner_death_after_ingress_resume_never_rolls_back_new_user_writes(self):
        self.executor.arm(self.plan)
        self.mutate()
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        pid = os.fork()
        if pid == 0:
            child_lock = self.lock_path.open('r+')
            fcntl.flock(child_lock, fcntl.LOCK_EX)
            self.executor.lock_fd = child_lock.fileno()
            self.kill_after_ingress = True
            self.executor.recover()
            os._exit(8)
        _, status = os.waitpid(pid, 0)
        self.assertEqual(os.WTERMSIG(status), signal.SIGKILL)
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.assertTrue(self.pending.exists())
        self.executor.recover()
        with sqlite3.connect(self.source / 'aemr.db') as db:
            self.assertEqual(db.execute('select value from receipt').fetchone()[0], 222)

    def test_unproved_orphan_progress_blocks_new_arm_before_runtime_mutation(self):
        progress = self.private / 'release-recovery-progress.json'
        progress.write_text(json.dumps({'plan_sha256': 'e' * 64, 'phase': 'runtime_resume',
                                        'restored': {'state': 'STATE_RESTORED', 'manifest_sha256': self.digest}}))
        progress.chmod(0o600)
        completed = self.private / 'release-recovered.json'
        completed.write_text(json.dumps({'state': 'RELEASE_RUNTIME_AND_STATE_RECOVERED',
                                        'plan_sha256': 'f' * 64, 'manifest_sha256': self.digest,
                                        'restored': {'state': 'STATE_RESTORED', 'manifest_sha256': self.digest}}))
        completed.chmod(0o600)
        with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_PROGRESS_INVALID'):
            self.executor.arm(self.plan)
        self.assertEqual(self.calls, [])
        self.assertFalse(self.pending.exists())
        self.assertTrue(progress.exists())

    def test_active_progress_rejects_invalid_restore_proof_before_any_stop(self):
        self.executor.arm(self.plan)
        plan_hash = hashlib.sha256(json.dumps(self.plan, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        restored = {'state': 'STATE_RESTORED', 'manifest_sha256': self.digest,
                    'files': 6, 'bytes': 100, 'sqlite_checked': 1, 'docx_checked': 3}
        for key, value in [('manifest_sha256', None), ('bytes', True), ('files', -1), ('sqlite_checked', '1')]:
            with self.subTest(key=key):
                invalid = {**restored, key: value}
                self.module.atomic_json(self.private / 'release-recovery-progress.json',
                                        {'plan_sha256': plan_hash, 'phase': 'runtime_resume', 'restored': invalid})
                count = len([call for call in self.calls if call[0] == 'stop'])
                with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_PROGRESS_INVALID'):
                    self.executor.recover()
                self.assertEqual(len([call for call in self.calls if call[0] == 'stop']), count)
                self.assertTrue(self.pending.exists())

    def test_corrupt_orphan_null_missing_and_wrong_types_never_confirm_cleanup(self):
        restored = {'state': 'STATE_RESTORED', 'manifest_sha256': self.digest,
                    'files': 6, 'bytes': 100, 'sqlite_checked': 1, 'docx_checked': 3}
        baseline_progress = {'plan_sha256': 'e' * 64, 'phase': 'runtime_resume', 'restored': restored}
        baseline_completed = {'state': 'RELEASE_RUNTIME_AND_STATE_RECOVERED', 'release_sha': 'c' * 40,
                              'plan_sha256': 'e' * 64, 'manifest_sha256': self.digest, 'restored': restored}
        for field, value in [('plan_sha256', None), ('plan_sha256', 64), ('manifest_sha256', None),
                             ('release_sha', None), ('release_sha', 'invalid')]:
            with self.subTest(field=field, value=value):
                progress = json.loads(json.dumps(baseline_progress))
                completed = json.loads(json.dumps(baseline_completed))
                completed[field] = value
                if field == 'plan_sha256':
                    progress[field] = value
                if field == 'manifest_sha256':
                    progress['restored'][field] = value
                    completed['restored'][field] = value
                for name, data in [('release-recovery-progress.json', progress), ('release-recovered.json', completed)]:
                    path = self.private / name
                    path.write_text(json.dumps(data))
                    path.chmod(0o600)
                with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_PROGRESS_INVALID'):
                    self.executor.recover()
                self.assertTrue((self.private / 'release-recovery-progress.json').exists())
        completed = json.loads(json.dumps(baseline_completed))
        completed.pop('plan_sha256')
        progress = json.loads(json.dumps(baseline_progress))
        progress['plan_sha256'] = None
        for name, data in [('release-recovery-progress.json', progress), ('release-recovered.json', completed)]:
            path = self.private / name
            path.write_text(json.dumps(data))
            path.chmod(0o600)
        with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_PROGRESS_INVALID'):
            self.executor.recover()

    def test_sigkill_after_pending_unlink_allows_next_release_without_stale_progress(self):
        self.executor.arm(self.plan)
        self.mutate()
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        child = os.fork()
        if child == 0:
            self.lock.close()
            with self.lock_path.open('r+') as held:
                fcntl.flock(held, fcntl.LOCK_EX)
                self.executor.lock_fd = held.fileno()
                original = self.module.fsync_directory
                def kill_after_pending_unlink(path):
                    original(path)
                    if path == self.private and not self.pending.exists():
                        os.kill(os.getpid(), signal.SIGKILL)
                self.module.fsync_directory = kill_after_pending_unlink
                self.executor.recover()
            os._exit(1)
        _, status = os.waitpid(child, 0)
        self.assertEqual(os.WTERMSIG(status), signal.SIGKILL)
        fcntl.flock(self.lock, fcntl.LOCK_EX)
        self.assertFalse(self.pending.exists())
        self.assertTrue((self.private / 'release-recovery-progress.json').exists())
        self.assertIsNone(self.executor.recover())
        self.assertFalse((self.private / 'release-recovery-progress.json').exists())
        self.records = json.loads(self.daemon_state.read_text())
        for service in ('server', 'report-worker'):
            self.records[service]['State']['Status'] = 'exited'
        self.persist_records()
        self.plan['release_sha'] = 'c' * 40
        for proof in self.plan['proofs'].values():
            proof['release_sha'] = self.plan['release_sha']
        self.executor.arm(self.plan)
        self.mutate()
        self.assertEqual(self.executor.recover()['release_sha'], 'c' * 40)

    def test_saved_resolved_configuration_allows_generated_container_names(self):
        config = json.loads((self.runtime / 'compose.json').read_text())
        for item in config['services'].values():
            item.pop('container_name')
        (self.runtime / 'compose.json').write_text(json.dumps(config))
        self.plan['config_sha256']['compose.json'] = hashlib.sha256((self.runtime / 'compose.json').read_bytes()).hexdigest()
        self.executor.arm(self.plan)
        self.mutate()
        self.executor.recover()

    def test_candidate_volume_requires_owned_concrete_local_volume(self):
        path = self.runtime / 'candidate-compose.json'
        baseline = json.loads(path.read_text())
        for value in ({'name': 'foreign_server_data'}, {'driver': 'nfs'},
                      {'driver_opts': {'device': '/foreign'}}, {'external': {'name': 'foreign'}}):
            with self.subTest(value=value):
                config = json.loads(json.dumps(baseline))
                config['volumes']['server_data'] = value
                path.write_text(json.dumps(config))
                self.plan['config_sha256']['candidate-compose.json'] = hashlib.sha256(path.read_bytes()).hexdigest()
                with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_CONFIG_INVALID'):
                    self.executor.arm(self.plan)
                self.assertFalse(self.pending.exists())
        baseline['volumes']['server_data'] = {}
        path.write_text(json.dumps(baseline))
        self.plan['config_sha256']['candidate-compose.json'] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.executor.arm(self.plan)

    def test_caddy_mount_uses_immutable_capsule_instead_of_mutable_staging(self):
        _, resolved = self.executor._files(self.plan, candidate_runtime=True)
        mount = next(x for x in resolved['services']['caddy']['volumes'] if x['type'] == 'bind')
        active = Path(mount['source'])
        staged = self.runtime / 'candidate-Caddyfile'
        self.assertNotEqual(active, staged, 'Staging the next release must not replace a live bind source')
        original = active.read_bytes()
        staged.write_text(':80 { respond "a later staged candidate" }')
        self.assertEqual(active.read_bytes(), original)
        self.assertEqual(active.stat().st_mode & 0o777, 0o600)

    def test_existing_same_sha_caddy_capsule_cannot_be_overwritten(self):
        _, resolved = self.executor._files(self.plan, candidate_runtime=True)
        active = Path(next(x for x in resolved['services']['caddy']['volumes'] if x['type'] == 'bind')['source'])
        original = active.read_bytes()
        staged = self.runtime / 'candidate-Caddyfile'
        staged.write_text(':80 { respond "different source under the same SHA" }')
        self.plan['config_sha256']['candidate-Caddyfile'] = self.module.digest(staged.read_bytes())
        with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_CADDY_CAPSULE_CHANGED'):
            self.executor._files(self.plan, candidate_runtime=True)
        self.assertEqual(active.read_bytes(), original)

    def test_candidate_direct_api_port_cannot_be_armed_as_fenced_release(self):
        config = json.loads((self.runtime / 'candidate-compose.json').read_text())
        config['services']['server']['ports'] = [{'published': '3000', 'target': 3000}]
        (self.runtime / 'candidate-compose.json').write_text(json.dumps(config))
        self.plan['config_sha256']['candidate-compose.json'] = hashlib.sha256((self.runtime / 'candidate-compose.json').read_bytes()).hexdigest()
        with self.assertRaisesRegex(self.module.RecoveryError, 'RELEASE_CONFIG_INVALID'):
            self.executor.arm(self.plan)
        self.assertFalse(self.pending.exists())

    def test_health_failure_closes_runtime_and_preserves_retry_receipt(self):
        self.executor.arm(self.plan)
        self.mutate()
        self.fail_health = True
        with self.assertRaises(self.module.RecoveryError):
            self.executor.recover()
        self.assertTrue(self.pending.exists())
        self.assertTrue(all(r['State']['Status'] in ('exited', 'created') for r in self.records.values()))

    def test_live_cli_child_retains_actual_ex_after_owner_sigkill(self):
        ready = self.private / 'cli-ready'
        finish = self.private / 'cli-finish'
        done = self.private / 'cli-done'
        program = "import sys,time;from pathlib import Path;Path(sys.argv[1]).write_text('ready');\nwhile not Path(sys.argv[2]).exists():time.sleep(.02)\nPath(sys.argv[3]).write_text('done')"
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        child = os.fork()
        if child == 0:
            self.lock.close()
            with self.lock_path.open('r+') as held:
                fcntl.flock(held, fcntl.LOCK_EX)
                real_run = subprocess.run
                def native_cli(args, **kwargs):
                    return real_run([sys.executable, '-c', program, str(ready), str(finish), str(done)], **kwargs)
                self.module.subprocess.run = native_cli
                executor = self.module.ReleaseRecovery(lock_fd=held.fileno())
                executor.command(['compose', 'up'], timeout=10)
            os._exit(0)
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue(ready.exists())
            os.kill(child, signal.SIGKILL)
            os.waitpid(child, 0)
            with self.assertRaises(BlockingIOError):
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            fcntl.flock(self.lock, fcntl.LOCK_UN)
            finish.touch()
            deadline = time.monotonic() + 5
            while not done.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue(done.exists())
            while True:
                try:
                    fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(.02)

    def test_kernel_lock_and_private_receipt_are_required(self):
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        with self.assertRaises(self.module.RecoveryError):
            self.executor.arm(self.plan)
        self.assertEqual(self.calls, [])
        fcntl.flock(self.lock, fcntl.LOCK_EX)
        self.executor.arm(self.plan)
        self.pending.chmod(0o644)
        with self.assertRaises(self.module.RecoveryError):
            self.executor.recover()
        self.assertTrue(self.pending.exists())


class NamespaceRecoveryTests(unittest.TestCase):
    def test_real_privileged_contract_in_user_namespace(self):
        if os.geteuid() == 0:
            return
        result = subprocess.run(['unshare', '-Ur', sys.executable, str(Path(__file__).resolve()), '-q'],
                                capture_output=True, text=True, timeout=60, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stderr, r'Ran \d+ tests')


if __name__ == '__main__':
    unittest.main()
