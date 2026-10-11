"""Worker-only recovery guards; synthetic status/Docker failures, no production IO."""
import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/worker_recovery.py'


class WorkerRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('worker_recovery', SCRIPT)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def status(self, identity='first', outcome='VERIFIED', **extra):
        return dict(status=outcome, attempt_id=identity, started_at='2026-10-11T21:00:00+00:00',
                    finished_at='2026-10-11T21:02:00+00:00', snapshot_id='synthetic-snapshot',
                    publication={'snapshot_id': 'synthetic-snapshot',
                                 'renderer_version': 'renderer-v1.5.0rc25', 'operational_available': True}, **extra)

    def test_two_different_cycles_and_frozen_word_are_required(self):
        seen = {}
        self.assertTrue(self.module.accept_cycle(self.status(), '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900))
        self.assertFalse(self.module.accept_cycle(self.status(), '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900))
        second = self.status('second')
        second.update(started_at='2026-10-11T21:17:00+00:00', finished_at='2026-10-11T21:19:00+00:00')
        self.assertTrue(self.module.accept_cycle(second, '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900))
        self.assertEqual(len(seen), 2)

    def test_old_or_running_status_cannot_close_a_cycle(self):
        self.assertFalse(self.module.accept_cycle(self.status(), '2026-10-11T21:05:00+00:00', {}, {'first'}, 900))
        self.assertFalse(self.module.accept_cycle(self.status(outcome='RUNNING'), '2026-10-11T20:59:00+00:00', {}, {'first'}, 900))

    def test_second_cycle_failure_does_not_preserve_false_acceptance(self):
        seen = {}
        self.module.accept_cycle(self.status(), '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900)
        with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_NEW_CYCLE_FAILED'):
            self.module.accept_cycle(self.status('second', 'NOT_ISSUED'), '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900)
        self.assertEqual(len(seen), 1)

    def test_snapshot_or_document_context_mismatch_fails(self):
        for change in ({'snapshot_id': 'different'}, {'operational_available': False}):
            status = self.status()
            status['publication'].update(change)
            with self.assertRaises(self.module.RecoveryError):
                self.module.accept_cycle(status, '2026-10-11T20:59:00+00:00', {}, {'first'}, 900)

    def test_invalid_timestamp_and_identifier_fail(self):
        for key, value in (('finished_at', '2026-10-11T19:00:00+00:00'), ('attempt_id', ''), ('started_at', 'bad')):
            status = self.status()
            status[key] = value
            with self.assertRaises(self.module.RecoveryError):
                self.module.accept_cycle(status, '2026-10-11T20:59:00+00:00', {}, {'first'}, 900)

    def test_distinct_ids_without_timer_wait_or_worker_attribution_are_not_accepted(self):
        seen = {}
        self.module.accept_cycle(self.status(), '2026-10-11T20:59:00+00:00', seen, {'first'}, 900)
        self.assertFalse(self.module.accept_cycle(self.status('manual'), '2026-10-11T20:59:00+00:00', seen, {'first'}, 900))
        with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_TIMER_ORDER_INVALID'):
            self.module.accept_cycle(self.status('second'), '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900)

    def test_lock_belongs_to_worker_process_not_manual_server_process(self):
        locks = '29: FLOCK  ADVISORY  WRITE 123 00:41:789 0 EOF'
        self.assertTrue(self.module.worker_lock_held(locks, {123}, 0, 65, 789))
        self.assertFalse(self.module.worker_lock_held(locks, {456}, 0, 65, 789))
        self.assertFalse(self.module.worker_lock_held(locks, {123}, 0, 65, 788))

    def test_default_docker_top_works_when_host_rejects_ps_format_options(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.server, recovery.worker = 'node', 'worker'
        processes = 'UID PID PPID C STIME TTY TIME CMD\nroot 123 1 0 21:00 ? 00:00:00 proc-report worker\n'
        def docker(args):
            if args[:2] == ['docker', 'exec']:
                return '[0, 65, 789]'
            if args == ['docker', 'top', 'worker', '-eo', 'pid']:
                return 'PID\n123\n'
            if args[:2] == ['docker', 'top'] and len(args) == 3:
                return processes if args[2] == 'worker' else processes.replace('proc-report worker', 'node server.js')
            raise self.module.RecoveryError('HOST_PS_FORMAT_UNSUPPORTED')
        recovery.call = docker
        recovery.require_no_manual_writer()
        with patch.object(Path, 'read_text', return_value='29: FLOCK ADVISORY WRITE 123 00:41:789 0 EOF'):
            self.assertTrue(recovery.holds_worker_lock())
        recovery.call = lambda args: processes.replace('worker', 'run-google')
        with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_CONCURRENT_MANUAL_WRITER'):
            recovery.require_no_manual_writer()

    def test_restore_failure_never_claims_rollback_or_restarts_partial_state(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.changed = True
        recovery.server = 'original-node'
        recovery.worker = 'replacement-worker'
        recovery.call = Mock(return_value="b" * 64)
        recovery.inspect = Mock(return_value={'State': {'Status': 'exited'}})
        recovery.tool = Mock(side_effect=self.module.RecoveryError('RESTORE_FAILED'))
        recovery.resume = Mock()
        recovery.compose = Mock()
        recovery.override = Mock()
        recovery.manifest_sha256 = 'a' * 64
        with self.assertRaises(self.module.RecoveryError):
            recovery.rollback()
        recovery.resume.assert_not_called()
        recovery.compose.assert_not_called()
    def test_rollback_reads_full_container_id_and_checks_both_writers(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.server, recovery.worker = 'a' * 64, 'b' * 64
        recovery.session = self.temp_path = Path('/tmp')
        recovery.original_worker = {'Image': 'sha256:' + 'c' * 64}
        recovery.manifest_sha256 = 'd' * 64
        calls = []
        def docker(args):
            calls.append(args)
            # Real Docker ps truncates IDs unless explicitly requested otherwise.
            if args[:2] == ['docker', 'ps']:
                return 'b' * (64 if '--no-trunc' in args else 12)
            return ''
        recovery.call = docker
        recovery.inspect = Mock(return_value={'State': {'Status': 'running'}})
        recovery.tool, recovery.resume, recovery.override = Mock(), Mock(), Mock()
        with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_ROLLBACK_WRITERS_NOT_QUIESCENT'):
            recovery.rollback()
        self.assertIn(['docker', 'stop', '--time', '75', 'b' * 64], calls)
        recovery.tool.assert_not_called()
        recovery.resume.assert_not_called()

    def test_valid_restore_resumes_node_even_when_stopped_worker_recreation_fails(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.server, recovery.worker = 'a' * 64, 'b' * 64
        recovery.original_worker = {'Image': 'sha256:' + 'c' * 64}
        recovery.manifest_sha256 = 'd' * 64
        recovery.call = Mock(return_value='b' * 64)
        recovery.inspect = Mock(return_value={'State': {'Status': 'exited'}})
        recovery.tool = Mock(return_value={'state': 'REPORT_SCOPE_RESTORED', 'core_state_preserved': True})
        recovery.override, recovery.resume, recovery.smoke = Mock(), Mock(), Mock()
        recovery.compose = Mock(side_effect=self.module.RecoveryError('COMPOSE_FAILED'))
        with self.assertRaisesRegex(self.module.RecoveryError, 'COMPOSE_FAILED'):
            recovery.rollback()
        recovery.resume.assert_called_once()
        recovery.smoke.assert_called_once()

    def test_manual_terminal_status_cannot_be_attributed_at_lock_turnover(self):
        first = self.status('manual', 'RUNNING')
        confirmed = self.status('manual', 'VERIFIED')
        self.assertFalse(self.module.same_running_attempt(first, confirmed))
        self.assertTrue(self.module.same_running_attempt(first, first))

    def test_tampered_backup_or_different_source_receipt_blocks_before_docker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo, backup, session = root/'repo', root/'backup', root/'recovery'
            repo.mkdir()
            (backup/'backup').mkdir(parents=True)
            session.mkdir()
            (backup/'backup/manifest.json').write_bytes(b'private synthetic manifest')
            baseline = {'server':'a'*64, 'worker':'b'*64, 'image':'sha256:'+'c'*64, 'volume':'synthetic', 'candidate':'d'*40}
            (backup/'runtime.json').write_text(json.dumps(baseline))
            receipt = {'full_restore':'VERIFIED_IN_SCRATCH', 'compatibility':'PASS', 'backup_sha':'d'*40,
                'backup_session':str(backup), 'manifest_sha256':hashlib.sha256((backup/'backup/manifest.json').read_bytes()).hexdigest()}
            (session/'receipt.json').write_text(json.dumps(receipt))
            self.module.Recovery(repo, session)
            receipt['backup_sha'] = 'e'*40
            (session/'receipt.json').write_text(json.dumps(receipt))
            with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_BACKUP_RECEIPT_INVALID'):
                self.module.Recovery(repo, session)
            receipt['backup_sha'] = 'd'*40
            (session/'receipt.json').write_text(json.dumps(receipt))
            (backup/'backup/manifest.json').write_bytes(b'changed')
            with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_BACKUP_RECEIPT_INVALID'):
                self.module.Recovery(repo, session)

    def test_failure_diagnostics_are_saved_privately_before_destructive_report_restore(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.worker = 'b'*64
        with tempfile.TemporaryDirectory() as tmp:
            recovery.session = Path(tmp)
            def copy(args, **kwargs):
                self.assertEqual(args[:2], ['docker', 'cp'])
                if args[-1].endswith('failure-status.json'):
                    Path(args[-1]).write_text(json.dumps({'attempt_id':'d'*32, 'status':'NOT_ISSUED'}))
                return ''
            recovery.call = Mock(side_effect=copy)
            recovery.save_failure_diagnostics()
            self.assertEqual(recovery.call.call_count, 2)
            recovery.call = Mock(side_effect=self.module.RecoveryError('CONTAINER_UNAVAILABLE'))
            recovery.save_failure_diagnostics()  # Failure to copy must not prevent rollback.

    def test_diagnostic_timeout_cannot_skip_recovery_failure_rollback(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.server, recovery.worker, recovery.volume = 'a'*64, 'b'*64, 'synthetic'
        recovery.image = 'sha256:'+'c'*64
        mounts = [{'Type':'volume', 'Name':'synthetic', 'Destination':'/app/packages/server/data'}]
        server = {'Image': recovery.image, 'Mounts': mounts, 'State': {'Status':'running'}}
        worker = {'Image':'sha256:'+'d'*64, 'Mounts': mounts, 'State': {'Status':'exited'},
                  'Config': {'Cmd':['proc-report', 'worker', '--interval-seconds', '900']}}
        recovery.require_no_manual_writer, recovery.smoke = Mock(), Mock()
        recovery.match_report_backup, recovery.override, recovery.rollback = Mock(), Mock(), Mock()
        for failure in (subprocess.TimeoutExpired('docker cp', 1), AttributeError('invalid private status shape')):
            recovery.inspect = Mock(side_effect=[server, worker])
            recovery.compose = Mock(side_effect=self.module.RecoveryError('COMPOSE_START_FAILED'))
            recovery.call = Mock(side_effect=failure)
            recovery.rollback.reset_mock()
            with tempfile.TemporaryDirectory() as tmp:
                recovery.session = Path(tmp)
                with self.assertRaisesRegex(self.module.RecoveryError, 'COMPOSE_START_FAILED'):
                    recovery.recover()
            recovery.rollback.assert_called_once()

    def test_stop_failure_still_resumes_original_node(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.server = 'original-node'
        recovery.call = Mock(side_effect=self.module.RecoveryError('STOP_FAILED_AFTER_STOP'))
        recovery.resume = Mock()
        recovery.tool = Mock()
        with self.assertRaises(self.module.RecoveryError):
            recovery.match_report_backup()
        recovery.resume.assert_called_once()
        recovery.tool.assert_not_called()


if __name__ == '__main__':
    unittest.main()
